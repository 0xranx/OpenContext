use crate::utils::{map_err, CmdResult};
use crate::AppState;
use opencontext_core::search::SearchConfig;
use serde::{Deserialize, Serialize};
use tauri::State;

// ===== Folder Commands =====

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListFoldersOptions {
    all: Option<bool>,
}

#[tauri::command]
pub(crate) fn list_folders(
    state: State<AppState>,
    options: Option<ListFoldersOptions>,
) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let folders = ctx
        .list_folders(options.and_then(|o| o.all).unwrap_or(false))
        .map_err(map_err)?;
    serde_json::to_value(&folders).map_err(map_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateFolderOptions {
    path: String,
    description: Option<String>,
}

#[tauri::command]
pub(crate) fn create_folder(
    state: State<AppState>,
    options: CreateFolderOptions,
) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let folder = ctx
        .create_folder(&options.path, options.description.as_deref())
        .map_err(map_err)?;
    serde_json::to_value(&folder).map_err(map_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenameFolderOptions {
    path: String,
    new_name: String,
}

#[tauri::command]
pub(crate) fn rename_folder(
    state: State<AppState>,
    options: RenameFolderOptions,
) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let folder = ctx
        .rename_folder(&options.path, &options.new_name)
        .map_err(map_err)?;
    serde_json::to_value(&folder).map_err(map_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MoveFolderOptions {
    path: String,
    dest_folder_path: String,
}

#[tauri::command]
pub(crate) fn move_folder(
    state: State<AppState>,
    options: MoveFolderOptions,
) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let folder = ctx
        .move_folder(&options.path, &options.dest_folder_path)
        .map_err(map_err)?;
    serde_json::to_value(&folder).map_err(map_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoveFolderOptions {
    path: String,
    force: Option<bool>,
}

#[tauri::command]
pub(crate) fn remove_folder(state: State<AppState>, options: RemoveFolderOptions) -> CmdResult<bool> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    ctx.remove_folder(&options.path, options.force.unwrap_or(false))
        .map_err(map_err)?;
    Ok(true)
}

// ===== Document Commands =====

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListDocsOptions {
    folder_path: String,
    recursive: Option<bool>,
}

#[tauri::command]
pub(crate) fn list_docs(state: State<AppState>, options: ListDocsOptions) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let docs = ctx
        .list_docs(&options.folder_path, options.recursive.unwrap_or(false))
        .map_err(map_err)?;
    serde_json::to_value(&docs).map_err(map_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateDocOptions {
    folder_path: String,
    name: String,
    description: Option<String>,
}

#[tauri::command]
pub(crate) fn create_doc(state: State<AppState>, options: CreateDocOptions) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let doc = ctx
        .create_doc(&options.folder_path, &options.name, options.description.as_deref())
        .map_err(map_err)?;
    serde_json::to_value(&doc).map_err(map_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MoveDocOptions {
    doc_path: String,
    dest_folder_path: String,
}

#[tauri::command]
pub(crate) fn move_doc(state: State<AppState>, options: MoveDocOptions) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let doc = ctx
        .move_doc(&options.doc_path, &options.dest_folder_path)
        .map_err(map_err)?;
    serde_json::to_value(&doc).map_err(map_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenameDocOptions {
    doc_path: String,
    new_name: String,
}

#[tauri::command]
pub(crate) fn rename_doc(state: State<AppState>, options: RenameDocOptions) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let doc = ctx
        .rename_doc(&options.doc_path, &options.new_name)
        .map_err(map_err)?;
    serde_json::to_value(&doc).map_err(map_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoveDocOptions {
    doc_path: String,
}

#[tauri::command]
pub(crate) fn remove_doc(state: State<AppState>, options: RemoveDocOptions) -> CmdResult<bool> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    ctx.remove_doc(&options.doc_path).map_err(map_err)?;
    Ok(true)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetDescriptionOptions {
    doc_path: String,
    description: String,
}

#[tauri::command]
pub(crate) fn set_doc_description(
    state: State<AppState>,
    options: SetDescriptionOptions,
) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let doc = ctx
        .set_doc_description(&options.doc_path, &options.description)
        .map_err(map_err)?;
    serde_json::to_value(&doc).map_err(map_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GetDocContentOptions {
    path: String,
}

#[derive(Serialize)]
pub(crate) struct DocContentResponse {
    content: String,
}

#[tauri::command]
pub(crate) fn get_doc_content(
    state: State<AppState>,
    options: GetDocContentOptions,
) -> CmdResult<DocContentResponse> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let content = ctx.get_doc_content(&options.path).map_err(map_err)?;
    Ok(DocContentResponse { content })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveDocOptions {
    path: String,
    content: String,
    description: Option<String>,
}

#[tauri::command]
pub(crate) fn save_doc_content(
    state: State<AppState>,
    options: SaveDocOptions,
) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let doc = ctx
        .save_doc_content(
            &options.path,
            &options.content,
            options.description.as_deref(),
        )
        .map_err(map_err)?;
    serde_json::to_value(&doc).map_err(map_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GetDocByIdOptions {
    stable_id: String,
}

#[tauri::command]
pub(crate) fn get_doc_by_id(
    state: State<AppState>,
    options: GetDocByIdOptions,
) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let doc = ctx
        .get_doc_by_stable_id(&options.stable_id)
        .map_err(map_err)?;
    serde_json::to_value(&doc).map_err(map_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GetDocMetaOptions {
    path: String,
}

#[tauri::command]
pub(crate) fn get_doc_meta(
    state: State<AppState>,
    options: GetDocMetaOptions,
) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let doc = ctx.get_doc_meta(&options.path).map_err(map_err)?;
    serde_json::to_value(&doc).map_err(map_err)
}

// ===== Manifest Command =====

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManifestOptions {
    folder_path: String,
    limit: Option<u32>,
}

#[tauri::command]
pub(crate) fn generate_manifest(
    state: State<AppState>,
    options: ManifestOptions,
) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let manifest = ctx
        .generate_manifest(&options.folder_path, options.limit.map(|v| v as usize))
        .map_err(map_err)?;
    serde_json::to_value(&manifest).map_err(map_err)
}

// ===== Environment Info Command =====

#[tauri::command]
pub(crate) fn get_env_info(state: State<AppState>) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let base_info = ctx.env_info();
    let config = &state.search_config;

    let masked_api_key = config.embedding.api_key.as_ref().map(|key| {
        if key.len() > 4 {
            format!("{}...{}", &key[..3], &key[key.len() - 4..])
        } else {
            "****".to_string()
        }
    });

    let info = serde_json::json!({
        "contexts_root": base_info.contexts_root,
        "db_path": base_info.db_path,
        "embedding_model": config.embedding.model,
        "embedding_api_base": config.embedding.api_base,
        "api_key_masked": masked_api_key,
        "has_api_key": config.embedding.api_key.is_some() && !config.embedding.api_key.as_ref().unwrap().is_empty(),
        "config_path": SearchConfig::json_config_path().to_string_lossy(),
        "dimensions": config.embedding.dimensions,
    });

    Ok(info)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveConfigOptions {
    api_key: Option<String>,
    api_base: Option<String>,
    model: Option<String>,
}

#[tauri::command]
pub(crate) fn save_config(options: SaveConfigOptions) -> CmdResult<serde_json::Value> {
    use std::collections::HashMap;

    let config_path = SearchConfig::json_config_path();

    let mut config: HashMap<String, serde_json::Value> = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path).map_err(map_err)?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        HashMap::new()
    };

    if let Some(key) = options.api_key {
        if !key.is_empty() {
            config.insert(
                "EMBEDDING_API_KEY".to_string(),
                serde_json::Value::String(key),
            );
            config.remove("OPENAI_API_KEY");
        }
    }
    if let Some(base) = options.api_base {
        config.insert(
            "EMBEDDING_API_BASE".to_string(),
            serde_json::Value::String(base),
        );
        config.remove("OPENAI_BASE_URL");
    }
    if let Some(model) = options.model {
        config.insert(
            "EMBEDDING_MODEL".to_string(),
            serde_json::Value::String(model),
        );
    }

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(map_err)?;
    }

    let content = serde_json::to_string_pretty(&config).map_err(map_err)?;
    std::fs::write(&config_path, content).map_err(map_err)?;

    Ok(serde_json::json!({
        "success": true,
        "config_path": config_path.to_string_lossy()
    }))
}
