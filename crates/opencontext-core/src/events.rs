//! Document event system for OpenContext
//!
//! This module provides an event bus for document lifecycle events,
//! enabling decoupled index synchronization and other reactive features.

use std::sync::Arc;
use tokio::sync::broadcast;

/// Document lifecycle events
#[derive(Debug, Clone)]
pub enum DocEvent {
    /// A new document was created
    Created { rel_path: String },
    /// Document content was updated
    Updated { rel_path: String },
    /// A document was deleted
    Deleted { rel_path: String },
    /// A document was renamed
    Renamed { old_path: String, new_path: String },
    /// A document was moved to another folder
    Moved { old_path: String, new_path: String },
}

/// Folder lifecycle events
#[derive(Debug, Clone)]
pub enum FolderEvent {
    /// A folder was created
    Created { rel_path: String },
    /// A folder was renamed (affects all docs inside)
    Renamed {
        old_path: String,
        new_path: String,
        /// Affected documents with their old and new paths
        affected_docs: Vec<(String, String)>,
    },
    /// A folder was moved (affects all docs inside)
    Moved {
        old_path: String,
        new_path: String,
        /// Affected documents with their old and new paths
        affected_docs: Vec<(String, String)>,
    },
    /// A folder was deleted (all docs inside removed)
    Deleted {
        rel_path: String,
        /// Documents that were removed
        removed_docs: Vec<String>,
    },
}

/// Combined event type
#[derive(Debug, Clone)]
pub enum Event {
    Doc(DocEvent),
    Folder(FolderEvent),
}

/// Event bus for broadcasting document events
#[derive(Clone)]
pub struct EventBus {
    sender: broadcast::Sender<Event>,
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl EventBus {
    /// Create a new event bus with default capacity
    pub fn new() -> Self {
        Self::with_capacity(256)
    }

    /// Create a new event bus with specified capacity
    pub fn with_capacity(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self { sender }
    }

    /// Subscribe to events
    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.sender.subscribe()
    }

    /// Emit a document event
    pub fn emit_doc(&self, event: DocEvent) {
        let _ = self.sender.send(Event::Doc(event));
    }

    /// Emit a folder event
    pub fn emit_folder(&self, event: FolderEvent) {
        let _ = self.sender.send(Event::Folder(event));
    }

    /// Get the number of active subscribers
    pub fn subscriber_count(&self) -> usize {
        self.sender.receiver_count()
    }
}

/// Shared event bus type
pub type SharedEventBus = Arc<EventBus>;

/// Create a shared event bus
pub fn create_event_bus() -> SharedEventBus {
    Arc::new(EventBus::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_event_bus() {
        let bus = EventBus::new();
        let mut rx = bus.subscribe();

        bus.emit_doc(DocEvent::Created {
            rel_path: "test/doc.md".to_string(),
        });

        let event = rx.recv().await.unwrap();
        match event {
            Event::Doc(DocEvent::Created { rel_path }) => {
                assert_eq!(rel_path, "test/doc.md");
            }
            _ => panic!("Unexpected event type"),
        }
    }
}
