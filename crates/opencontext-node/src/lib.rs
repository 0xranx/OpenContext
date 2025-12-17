#![allow(clippy::needless_borrow)]

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use napi::bindgen_prelude::*;
use napi::Result as NapiResult;
use napi::{Env, JsUnknown};
use napi_derive::napi;
use once_cell::sync::Lazy;
use once_cell::sync::OnceCell;
use opencontext_core::events::{create_event_bus, SharedEventBus};
use opencontext_core::search::{
    IndexSyncService, Indexer as RustIndexer, SearchConfig, SearchOptions as RustSearchOptions,
    Searcher as RustSearcher,
};
use opencontext_core::{CoreError, EnvOverrides, OpenContext};
use serde::Serialize;
use tokio::sync::Mutex;

// Global event bus for document/folder events
static EVENT_BUS: Lazy<SharedEventBus> = Lazy::new(create_event_bus);

// Flag to track if IndexSyncService is running
static INDEX_SYNC_RUNNING: AtomicBool = AtomicBool::new(false);

static CONTEXT: OnceCell<OpenContext> = OnceCell::new();

fn ctx() -> NapiResult<&'static OpenContext> {
    CONTEXT.get_or_try_init(|| {
        OpenContext::initialize(EnvOverrides::default())
            .map(|ctx| ctx.with_event_bus(EVENT_BUS.clone()))
            .map_err(to_napi_error)
    })
}

fn to_napi_error(err: CoreError) -> napi::Error {
    napi::Error::from_reason(err.to_string())
}

#[napi(object)]
pub struct FolderOptions {
    pub path: String,
    pub description: Option<String>,
}

#[napi(object)]
pub struct RenameFolderOptions {
    pub path: String,
    pub new_name: String,
}

#[napi(object)]
pub struct MoveFolderOptions {
    pub path: String,
    pub dest_folder_path: String,
}

#[napi(object)]
pub struct RemoveFolderOptions {
    pub path: String,
    pub force: Option<bool>,
}

#[napi(object)]
pub struct ListFolderOptions {
    pub all: Option<bool>,
}

#[napi(object)]
pub struct ListDocsOptions {
    pub folder_path: String,
    pub recursive: Option<bool>,
}

#[napi(object)]
pub struct CreateDocOptions {
    pub folder_path: String,
    pub name: String,
    pub description: Option<String>,
}

#[napi(object)]
pub struct MoveDocOptions {
    pub doc_path: String,
    pub dest_folder_path: String,
}

#[napi(object)]
pub struct RenameDocOptions {
    pub doc_path: String,
    pub new_name: String,
}

#[napi(object)]
pub struct RemoveDocOptions {
    pub doc_path: String,
}

#[napi(object)]
pub struct SetDescriptionOptions {
    pub doc_path: String,
    pub description: String,
}

#[napi(object)]
pub struct SaveDocOptions {
    pub doc_path: String,
    pub content: String,
    pub description: Option<String>,
}

#[napi(object)]
pub struct ManifestOptions {
    pub folder_path: String,
    pub limit: Option<u32>,
}

#[napi]
pub fn init_environment(env: Env) -> NapiResult<JsUnknown> {
    let ctx = ctx()?;
    to_js(env, &ctx.env_info())
}

#[napi]
pub fn list_folders(env: Env, options: Option<ListFolderOptions>) -> NapiResult<JsUnknown> {
    let ctx = ctx()?;
    let folders = convert(ctx.list_folders(options.and_then(|o| o.all).unwrap_or(false)))?;
    to_js(env, &folders)
}

#[napi]
pub fn create_folder(env: Env, options: FolderOptions) -> NapiResult<JsUnknown> {
    let ctx = ctx()?;
    let result = convert(ctx.create_folder(&options.path, options.description.as_deref()))?;
    to_js(env, &result)
}

#[napi]
pub fn rename_folder(env: Env, options: RenameFolderOptions) -> NapiResult<JsUnknown> {
    let ctx = ctx()?;
    let result = convert(ctx.rename_folder(&options.path, &options.new_name))?;
    to_js(env, &result)
}

#[napi]
pub fn move_folder(env: Env, options: MoveFolderOptions) -> NapiResult<JsUnknown> {
    let ctx = ctx()?;
    let result = convert(ctx.move_folder(&options.path, &options.dest_folder_path))?;
    to_js(env, &result)
}

#[napi]
pub fn remove_folder(env: Env, options: RemoveFolderOptions) -> NapiResult<JsUnknown> {
    let ctx = ctx()?;
    let result = convert(ctx.remove_folder(&options.path, options.force.unwrap_or(false)))?;
    to_js(env, &result)
}

#[napi]
pub fn list_docs(env: Env, options: ListDocsOptions) -> NapiResult<JsUnknown> {
    let ctx = ctx()?;
    let docs = convert(ctx.list_docs(&options.folder_path, options.recursive.unwrap_or(false)))?;
    to_js(env, &docs)
}

#[napi]
pub fn create_doc(env: Env, options: CreateDocOptions) -> NapiResult<JsUnknown> {
    let ctx = ctx()?;
    let doc = convert(ctx.create_doc(
        &options.folder_path,
        &options.name,
        options.description.as_deref(),
    ))?;
    to_js(env, &doc)
}

#[napi]
pub fn move_doc(env: Env, options: MoveDocOptions) -> NapiResult<JsUnknown> {
    let ctx = ctx()?;
    let result = convert(ctx.move_doc(&options.doc_path, &options.dest_folder_path))?;
    to_js(env, &result)
}

#[napi]
pub fn rename_doc(env: Env, options: RenameDocOptions) -> NapiResult<JsUnknown> {
    let ctx = ctx()?;
    let result = convert(ctx.rename_doc(&options.doc_path, &options.new_name))?;
    to_js(env, &result)
}

#[napi]
pub fn remove_doc(env: Env, options: RemoveDocOptions) -> NapiResult<JsUnknown> {
    let ctx = ctx()?;
    let result = convert(ctx.remove_doc(&options.doc_path))?;
    to_js(env, &result)
}

#[napi]
pub fn set_doc_description(env: Env, options: SetDescriptionOptions) -> NapiResult<JsUnknown> {
    let ctx = ctx()?;
    let result = convert(ctx.set_doc_description(&options.doc_path, &options.description))?;
    to_js(env, &result)
}

#[napi]
pub fn get_doc_content(doc_path: String) -> NapiResult<String> {
    let ctx = ctx()?;
    let content = convert(ctx.get_doc_content(&doc_path))?;
    Ok(content)
}

#[napi]
pub fn get_doc_meta(env: Env, doc_path: String) -> NapiResult<JsUnknown> {
    let ctx = ctx()?;
    let doc = convert(ctx.get_doc_meta(&doc_path))?;
    to_js(env, &doc)
}

#[napi]
pub fn get_doc_by_stable_id(env: Env, stable_id: String) -> NapiResult<JsUnknown> {
    let ctx = ctx()?;
    let doc = convert(ctx.get_doc_by_stable_id(&stable_id))?;
    to_js(env, &doc)
}

#[napi]
pub fn save_doc_content(env: Env, options: SaveDocOptions) -> NapiResult<JsUnknown> {
    let ctx = ctx()?;
    let result = convert(ctx.save_doc_content(
        &options.doc_path,
        &options.content,
        options.description.as_deref(),
    ))?;
    to_js(env, &result)
}

#[napi]
pub fn generate_manifest(env: Env, options: ManifestOptions) -> NapiResult<JsUnknown> {
    let ctx = ctx()?;
    let manifest =
        convert(ctx.generate_manifest(&options.folder_path, options.limit.map(|v| v as usize)))?;
    to_js(env, &manifest)
}

fn to_js<T: Serialize>(env: Env, value: &T) -> NapiResult<JsUnknown> {
    env.to_js_value(value)
}

fn convert<T>(value: opencontext_core::CoreResult<T>) -> NapiResult<T> {
    value.map_err(to_napi_error)
}

// ==================== Search Module ====================

fn search_error_to_napi(err: opencontext_core::search::SearchError) -> napi::Error {
    napi::Error::from_reason(err.to_string())
}

/// Search options passed from JavaScript
#[napi(object)]
pub struct SearchOptions {
    pub query: String,
    pub limit: Option<u32>,
    pub mode: Option<String>,
    pub aggregate_by: Option<String>,
}

impl From<SearchOptions> for RustSearchOptions {
    fn from(opts: SearchOptions) -> Self {
        use opencontext_core::search::{AggregateBy, SearchMode};

        let mode = opts.mode.as_deref().map(|s| match s {
            "vector" => SearchMode::Vector,
            "keyword" => SearchMode::Keyword,
            _ => SearchMode::Hybrid,
        });

        let aggregate_by = opts.aggregate_by.as_deref().map(|s| match s {
            "content" => AggregateBy::Content,
            "folder" => AggregateBy::Folder,
            _ => AggregateBy::Doc,
        });

        RustSearchOptions {
            query: opts.query,
            limit: opts.limit.map(|v| v as usize),
            mode,
            aggregate_by,
        }
    }
}

/// Searcher - async search executor
#[napi]
pub struct Searcher {
    inner: Arc<Mutex<RustSearcher>>,
}

#[napi]
impl Searcher {
    /// Create a new Searcher instance
    /// contexts_root is optional - if not provided, uses default from environment
    #[napi(factory)]
    pub async fn create() -> Result<Searcher> {
        let config = SearchConfig::load().map_err(search_error_to_napi)?;
        let searcher = RustSearcher::new(config)
            .await
            .map_err(search_error_to_napi)?;
        Ok(Searcher {
            inner: Arc::new(Mutex::new(searcher)),
        })
    }

    /// Execute a search query
    #[napi]
    pub async fn search(&self, options: SearchOptions) -> Result<serde_json::Value> {
        let rust_options: RustSearchOptions = options.into();
        let searcher = self.inner.lock().await;
        let results = searcher
            .search(rust_options)
            .await
            .map_err(search_error_to_napi)?;

        serde_json::to_value(&results).map_err(|e| napi::Error::from_reason(e.to_string()))
    }
}

/// Indexer - async index builder
#[napi]
pub struct Indexer {
    inner: Arc<Mutex<RustIndexer>>,
}

#[napi]
impl Indexer {
    /// Create a new Indexer instance
    /// Uses contexts_root from OpenContext environment
    #[napi(factory)]
    pub async fn create() -> Result<Indexer> {
        // Get contexts_root from the initialized OpenContext
        let oc_ctx = ctx()?;
        let contexts_root = PathBuf::from(&oc_ctx.env_info().contexts_root);

        let config = SearchConfig::load().map_err(search_error_to_napi)?;
        let indexer = RustIndexer::new(config, contexts_root)
            .await
            .map_err(search_error_to_napi)?;
        Ok(Indexer {
            inner: Arc::new(Mutex::new(indexer)),
        })
    }

    /// Build index for all documents
    /// Automatically fetches all documents from OpenContext
    #[napi]
    pub async fn build_all(&self) -> Result<serde_json::Value> {
        // Get all documents from OpenContext
        let oc_ctx = ctx()?;
        let folders = oc_ctx.list_folders(true).map_err(to_napi_error)?;

        let mut all_docs = Vec::new();
        for folder in folders {
            let docs = oc_ctx
                .list_docs(&folder.rel_path, true)
                .map_err(to_napi_error)?;
            all_docs.extend(docs);
        }

        let mut indexer = self.inner.lock().await;
        let stats = indexer
            .build_all(all_docs)
            .await
            .map_err(search_error_to_napi)?;

        serde_json::to_value(&stats).map_err(|e| napi::Error::from_reason(e.to_string()))
    }

    /// Index a single file
    #[napi]
    pub async fn index_file(&self, rel_path: String) -> Result<u32> {
        let mut indexer = self.inner.lock().await;
        let count = indexer
            .index_file(&rel_path)
            .await
            .map_err(search_error_to_napi)?;
        Ok(count as u32)
    }

    /// Remove a file from the index
    #[napi]
    pub async fn remove_file(&self, rel_path: String) -> Result<()> {
        let mut indexer = self.inner.lock().await;
        indexer
            .remove_file(&rel_path)
            .await
            .map_err(search_error_to_napi)?;
        Ok(())
    }

    /// Check if index exists
    #[napi]
    pub async fn index_exists(&self) -> Result<bool> {
        let indexer = self.inner.lock().await;
        Ok(indexer.index_exists().await)
    }

    /// Get index statistics
    #[napi]
    pub async fn get_stats(&self) -> Result<serde_json::Value> {
        let indexer = self.inner.lock().await;
        let stats = indexer.get_stats().await.map_err(search_error_to_napi)?;

        serde_json::to_value(&stats).map_err(|e| napi::Error::from_reason(e.to_string()))
    }

    /// Clean/reset the index
    #[napi]
    pub async fn clean(&self) -> Result<()> {
        let mut indexer = self.inner.lock().await;
        indexer.clean().await.map_err(search_error_to_napi)?;
        Ok(())
    }
}

/// Load search config
#[napi]
pub fn load_search_config() -> Result<serde_json::Value> {
    let config = SearchConfig::load().map_err(search_error_to_napi)?;

    serde_json::to_value(&config).map_err(|e| napi::Error::from_reason(e.to_string()))
}

// ==================== Index Sync Service ====================

/// Start the index sync service
///
/// This service listens to document/folder events and automatically
/// updates the search index in batches at regular intervals.
///
/// @param interval_secs - Interval in seconds between batch processing (default: 300 = 5 minutes)
/// @returns true if started, false if already running
#[napi]
pub async fn start_index_sync(interval_secs: Option<u32>) -> Result<bool> {
    // Check if already running
    if INDEX_SYNC_RUNNING.swap(true, Ordering::SeqCst) {
        return Ok(false); // Already running
    }

    let oc_ctx = ctx()?;
    let contexts_root = PathBuf::from(&oc_ctx.env_info().contexts_root);

    let config = SearchConfig::load().map_err(search_error_to_napi)?;

    let interval = interval_secs.unwrap_or(300) as u64;
    let sync_service = IndexSyncService::new(config, contexts_root).with_interval(interval);

    let event_bus = EVENT_BUS.clone();

    // Spawn the sync service in a background task
    tokio::spawn(async move {
        if let Err(e) = sync_service.start(event_bus).await {
            log::error!("[IndexSync] Service error: {}", e);
        }
        INDEX_SYNC_RUNNING.store(false, Ordering::SeqCst);
    });

    Ok(true)
}

/// Check if index sync service is running
#[napi]
pub fn is_index_sync_running() -> bool {
    INDEX_SYNC_RUNNING.load(Ordering::SeqCst)
}

/// Get pending updates count from index sync service
/// Note: This is approximate as the service runs in background
#[napi]
pub fn get_index_sync_status() -> serde_json::Value {
    serde_json::json!({
        "running": INDEX_SYNC_RUNNING.load(Ordering::SeqCst),
    })
}
