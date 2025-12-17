//! Index synchronization service
//!
//! Listens to document events and batches index updates.
//! Uses interval-based checking (default: 5 minutes) instead of real-time updates.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{broadcast, Mutex};
use tokio::time::{interval_at, Instant};

use super::config::SearchConfig;
use super::error::SearchResult;
use super::indexer::Indexer;
use crate::events::{DocEvent, Event, FolderEvent, SharedEventBus};

/// Update action for the index
#[derive(Debug, Clone)]
enum IndexAction {
    /// Index or re-index a file
    Update { rel_path: String },
    /// Remove a file from the index
    Remove { rel_path: String },
    /// Rename/move a file in the index
    Rename { old_path: String, new_path: String },
}

/// Index synchronization service
///
/// Collects file change events and processes them in batches at regular intervals.
pub struct IndexSyncService {
    config: SearchConfig,
    contexts_root: PathBuf,
    indexer: Arc<Mutex<Option<Indexer>>>,
    enabled: Arc<std::sync::atomic::AtomicBool>,
    /// Pending actions waiting to be processed
    pending_actions: Arc<Mutex<HashMap<String, IndexAction>>>,
    /// Interval in seconds for checking pending updates (default: 300 = 5 minutes)
    check_interval_secs: u64,
}

impl IndexSyncService {
    /// Create a new index sync service
    /// Default check interval is 5 minutes (300 seconds)
    pub fn new(config: SearchConfig, contexts_root: PathBuf) -> Self {
        Self {
            config,
            contexts_root,
            indexer: Arc::new(Mutex::new(None)),
            enabled: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            pending_actions: Arc::new(Mutex::new(HashMap::new())),
            check_interval_secs: 300, // 5 minutes
        }
    }

    /// Set check interval in seconds
    pub fn with_interval(mut self, secs: u64) -> Self {
        self.check_interval_secs = secs;
        self
    }

    /// Enable or disable the service
    pub fn set_enabled(&self, enabled: bool) {
        self.enabled
            .store(enabled, std::sync::atomic::Ordering::SeqCst);
    }

    /// Check if the service is enabled
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Get count of pending updates
    pub async fn pending_count(&self) -> usize {
        self.pending_actions.lock().await.len()
    }

    /// Start the sync service, listening to events from the event bus
    ///
    /// Events are collected and processed in batches at regular intervals (default: 5 minutes)
    pub async fn start(&self, event_bus: SharedEventBus) -> SearchResult<()> {
        let mut receiver = event_bus.subscribe();

        // Initialize indexer
        {
            let mut indexer_guard = self.indexer.lock().await;
            if indexer_guard.is_none() {
                let indexer = Indexer::new(self.config.clone(), self.contexts_root.clone()).await?;
                *indexer_guard = Some(indexer);
            }
        }

        // Spawn interval processor (every N seconds)
        let indexer = self.indexer.clone();
        let enabled = self.enabled.clone();
        let pending = self.pending_actions.clone();
        let interval_secs = self.check_interval_secs;

        tokio::spawn(async move {
            Self::process_pending_interval(pending, indexer, enabled, interval_secs).await;
        });

        log::info!(
            "[IndexSync] Started with {} second interval",
            self.check_interval_secs
        );

        // Event listener loop - just collect actions, don't process immediately
        loop {
            match receiver.recv().await {
                Ok(event) => {
                    if !self.is_enabled() {
                        continue;
                    }

                    let actions = Self::event_to_actions(event);
                    let mut pending_guard = self.pending_actions.lock().await;
                    for action in actions {
                        match &action {
                            IndexAction::Update { rel_path } => {
                                pending_guard.insert(rel_path.clone(), action);
                            }
                            IndexAction::Remove { rel_path } => {
                                pending_guard.insert(rel_path.clone(), action);
                            }
                            IndexAction::Rename { old_path, new_path } => {
                                // Remove any pending action for the old path
                                pending_guard.remove(old_path);
                                // Insert rename action with new_path as key
                                pending_guard.insert(new_path.clone(), action);
                            }
                        }
                    }

                    let count = pending_guard.len();
                    if count > 0 {
                        log::debug!("[IndexSync] {} pending updates", count);
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    log::warn!("[IndexSync] Lagged behind by {} events", n);
                }
                Err(broadcast::error::RecvError::Closed) => {
                    log::info!("[IndexSync] Event bus closed, stopping sync service");
                    break;
                }
            }
        }

        Ok(())
    }

    /// Convert an event to index actions
    fn event_to_actions(event: Event) -> Vec<IndexAction> {
        match event {
            Event::Doc(doc_event) => match doc_event {
                DocEvent::Created { rel_path } | DocEvent::Updated { rel_path } => {
                    vec![IndexAction::Update { rel_path }]
                }
                DocEvent::Deleted { rel_path } => {
                    vec![IndexAction::Remove { rel_path }]
                }
                DocEvent::Renamed { old_path, new_path }
                | DocEvent::Moved { old_path, new_path } => {
                    vec![IndexAction::Rename { old_path, new_path }]
                }
            },
            Event::Folder(folder_event) => match folder_event {
                FolderEvent::Created { .. } => vec![],
                FolderEvent::Renamed { affected_docs, .. }
                | FolderEvent::Moved { affected_docs, .. } => affected_docs
                    .into_iter()
                    .map(|(old_path, new_path)| IndexAction::Rename { old_path, new_path })
                    .collect(),
                FolderEvent::Deleted { removed_docs, .. } => removed_docs
                    .into_iter()
                    .map(|rel_path| IndexAction::Remove { rel_path })
                    .collect(),
            },
        }
    }

    /// Process pending actions at regular intervals
    async fn process_pending_interval(
        pending: Arc<Mutex<HashMap<String, IndexAction>>>,
        indexer: Arc<Mutex<Option<Indexer>>>,
        enabled: Arc<std::sync::atomic::AtomicBool>,
        interval_secs: u64,
    ) {
        // Start first tick after interval_secs (not immediately)
        let start = Instant::now() + Duration::from_secs(interval_secs);
        let mut ticker = interval_at(start, Duration::from_secs(interval_secs));

        loop {
            ticker.tick().await;

            if !enabled.load(std::sync::atomic::Ordering::SeqCst) {
                continue;
            }

            // Take all pending actions
            let actions: Vec<IndexAction> = {
                let mut pending_guard = pending.lock().await;
                if pending_guard.is_empty() {
                    continue;
                }
                pending_guard.drain().map(|(_, v)| v).collect()
            };

            let action_count = actions.len();
            log::info!("[IndexSync] Processing {} pending updates", action_count);

            let mut indexer_guard = indexer.lock().await;
            if let Some(ref mut indexer) = *indexer_guard {
                // Check if index exists before processing
                if !indexer.index_exists().await {
                    log::debug!("[IndexSync] Index not built, skipping updates");
                    continue;
                }

                let mut success_count = 0;
                let mut error_count = 0;

                for action in actions {
                    let result = match action {
                        IndexAction::Update { rel_path } => {
                            match indexer.index_file(&rel_path).await {
                                Ok(count) => {
                                    log::debug!(
                                        "[IndexSync] Updated: {} ({} chunks)",
                                        rel_path,
                                        count
                                    );
                                    Ok(())
                                }
                                Err(e) => Err(e),
                            }
                        }
                        IndexAction::Remove { rel_path } => {
                            match indexer.remove_file(&rel_path).await {
                                Ok(()) => {
                                    log::debug!("[IndexSync] Removed: {}", rel_path);
                                    Ok(())
                                }
                                Err(e) => Err(e),
                            }
                        }
                        IndexAction::Rename { old_path, new_path } => {
                            match indexer.update_file_path(&old_path, &new_path).await {
                                Ok(()) => {
                                    log::debug!(
                                        "[IndexSync] Renamed: {} -> {}",
                                        old_path,
                                        new_path
                                    );
                                    Ok(())
                                }
                                Err(e) => Err(e),
                            }
                        }
                    };

                    if let Err(e) = result {
                        log::warn!("[IndexSync] Error: {}", e);
                        error_count += 1;
                    } else {
                        success_count += 1;
                    }
                }

                // Update metadata once after all actions
                if success_count > 0 {
                    if let Err(e) = indexer.update_metadata() {
                        log::warn!("[IndexSync] Failed to update metadata: {}", e);
                    }
                }

                log::info!(
                    "[IndexSync] Batch complete: {} success, {} errors",
                    success_count,
                    error_count
                );
            }
        }
    }
}
