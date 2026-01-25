use crate::utils::{map_err, CmdResult};
use crate::AppState;
use opencontext_core::search::{IndexStats, Indexer, SearchOptions, SearchResults, Searcher};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

#[tauri::command]
pub(crate) async fn semantic_search(
    state: State<'_, AppState>,
    options: SearchOptions,
) -> CmdResult<SearchResults> {
    let mut searcher_guard = state.searcher.lock().await;

    if searcher_guard.is_none() {
        let searcher = Searcher::new(state.search_config.clone())
            .await
            .map_err(map_err)?;
        *searcher_guard = Some(searcher);
    }

    let searcher = searcher_guard.as_ref().unwrap();
    searcher.search(options).await.map_err(map_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(crate) struct BuildIndexOptions {
    folder_path: Option<String>,
}

#[tauri::command]
pub(crate) async fn build_search_index(
    window: tauri::Window,
    state: State<'_, AppState>,
    _options: Option<BuildIndexOptions>,
) -> CmdResult<IndexStats> {
    let contexts_root = {
        let ctx = state.ctx.lock().map_err(map_err)?;
        ctx.env_info().contexts_root
    };

    let docs = {
        let ctx = state.ctx.lock().map_err(map_err)?;
        let folders = ctx.list_folders(true).map_err(map_err)?;
        let mut all_docs = Vec::new();
        for folder in folders {
            if let Ok(docs) = ctx.list_docs(&folder.rel_path, false) {
                all_docs.extend(docs);
            }
        }
        all_docs
    };

    let mut indexer_guard = state.indexer.lock().await;

    if indexer_guard.is_none() {
        let indexer = Indexer::new(state.search_config.clone(), contexts_root)
            .await
            .map_err(map_err)?;
        *indexer_guard = Some(indexer);
    }

    let indexer = indexer_guard.as_mut().unwrap();

    let result = indexer
        .build_all_with_progress(docs, |progress| {
            let _ = window.emit("index-progress", &progress);
        })
        .await
        .map_err(map_err)?;

    let metadata_path = state.search_config.paths.get_index_metadata_path();
    let metadata = serde_json::json!({
        "lastFullBuild": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        "totalChunks": result.total_chunks,
        "totalDocs": result.total_docs,
    });
    if let Some(parent) = metadata_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(
        &metadata_path,
        serde_json::to_string_pretty(&metadata).unwrap_or_default(),
    );

    Ok(result)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IndexStatus {
    exists: bool,
    chunk_count: usize,
    last_updated: Option<u64>,
}

#[tauri::command]
pub(crate) async fn get_index_status(state: State<'_, AppState>) -> CmdResult<IndexStatus> {
    let contexts_root = {
        let ctx = state.ctx.lock().map_err(map_err)?;
        ctx.env_info().contexts_root
    };

    let mut indexer_guard = state.indexer.lock().await;

    if indexer_guard.is_none() {
        let indexer = Indexer::new(state.search_config.clone(), contexts_root)
            .await
            .map_err(map_err)?;
        *indexer_guard = Some(indexer);
    }

    let indexer = indexer_guard.as_ref().unwrap();
    let exists = indexer.index_exists().await;
    let stats = indexer.get_stats().await.map_err(map_err)?;

    let last_updated = {
        let metadata_path = state.search_config.paths.get_index_metadata_path();
        if metadata_path.exists() {
            std::fs::read_to_string(&metadata_path)
                .ok()
                .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
                .and_then(|v| {
                    v.get("lastUpdated")
                        .and_then(|x| x.as_u64())
                        .or_else(|| v.get("lastFullBuild").and_then(|x| x.as_u64()))
                })
        } else {
            None
        }
    };

    Ok(IndexStatus {
        exists,
        chunk_count: stats.total_chunks,
        last_updated,
    })
}

#[tauri::command]
pub(crate) async fn clean_search_index(state: State<'_, AppState>) -> CmdResult<bool> {
    let contexts_root = {
        let ctx = state.ctx.lock().map_err(map_err)?;
        ctx.env_info().contexts_root
    };

    let mut indexer_guard = state.indexer.lock().await;

    if indexer_guard.is_none() {
        let indexer = Indexer::new(state.search_config.clone(), contexts_root)
            .await
            .map_err(map_err)?;
        *indexer_guard = Some(indexer);
    }

    let indexer = indexer_guard.as_mut().unwrap();
    indexer.clean().await.map_err(map_err)?;

    Ok(true)
}
