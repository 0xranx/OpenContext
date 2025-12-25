// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use futures::StreamExt;
use opencontext_core::events::{create_event_bus, SharedEventBus};
use opencontext_core::search::{
    IndexStats, IndexSyncService, Indexer, SearchConfig, SearchOptions, SearchResults, Searcher,
};
use opencontext_core::{EnvOverrides, OpenContext};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, State};
use tokio::sync::Mutex as AsyncMutex;

struct AppState {
    ctx: Mutex<OpenContext>,
    searcher: AsyncMutex<Option<Searcher>>,
    indexer: AsyncMutex<Option<Indexer>>,
    search_config: SearchConfig,
    #[allow(dead_code)]
    event_bus: SharedEventBus,
}

// Tauri command 返回结果类型
type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ===== Folder Commands =====

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListFoldersOptions {
    all: Option<bool>,
}

#[tauri::command]
fn list_folders(
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
struct CreateFolderOptions {
    path: String,
    description: Option<String>,
}

#[tauri::command]
fn create_folder(
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
struct RenameFolderOptions {
    path: String,
    new_name: String,
}

#[tauri::command]
fn rename_folder(
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
struct MoveFolderOptions {
    path: String,
    dest_folder_path: String,
}

#[tauri::command]
fn move_folder(state: State<AppState>, options: MoveFolderOptions) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let folder = ctx
        .move_folder(&options.path, &options.dest_folder_path)
        .map_err(map_err)?;
    serde_json::to_value(&folder).map_err(map_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveFolderOptions {
    path: String,
    force: Option<bool>,
}

#[tauri::command]
fn remove_folder(state: State<AppState>, options: RemoveFolderOptions) -> CmdResult<bool> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    ctx.remove_folder(&options.path, options.force.unwrap_or(false))
        .map_err(map_err)?;
    Ok(true)
}

// ===== Document Commands =====

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListDocsOptions {
    folder_path: String,
    recursive: Option<bool>,
}

#[tauri::command]
fn list_docs(state: State<AppState>, options: ListDocsOptions) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let docs = ctx
        .list_docs(&options.folder_path, options.recursive.unwrap_or(false))
        .map_err(map_err)?;
    serde_json::to_value(&docs).map_err(map_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDocOptions {
    folder_path: String,
    name: String,
    description: Option<String>,
}

#[tauri::command]
fn create_doc(state: State<AppState>, options: CreateDocOptions) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let doc = ctx
        .create_doc(
            &options.folder_path,
            &options.name,
            options.description.as_deref(),
        )
        .map_err(map_err)?;
    serde_json::to_value(&doc).map_err(map_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveDocOptions {
    doc_path: String,
    dest_folder_path: String,
}

#[tauri::command]
fn move_doc(state: State<AppState>, options: MoveDocOptions) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let doc = ctx
        .move_doc(&options.doc_path, &options.dest_folder_path)
        .map_err(map_err)?;
    serde_json::to_value(&doc).map_err(map_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameDocOptions {
    doc_path: String,
    new_name: String,
}

#[tauri::command]
fn rename_doc(state: State<AppState>, options: RenameDocOptions) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let doc = ctx
        .rename_doc(&options.doc_path, &options.new_name)
        .map_err(map_err)?;
    serde_json::to_value(&doc).map_err(map_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveDocOptions {
    doc_path: String,
}

#[tauri::command]
fn remove_doc(state: State<AppState>, options: RemoveDocOptions) -> CmdResult<bool> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    ctx.remove_doc(&options.doc_path).map_err(map_err)?;
    Ok(true)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetDescriptionOptions {
    doc_path: String,
    description: String,
}

#[tauri::command]
fn set_doc_description(
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
struct GetDocContentOptions {
    path: String,
}

#[derive(Serialize)]
struct DocContentResponse {
    content: String,
}

#[tauri::command]
fn get_doc_content(
    state: State<AppState>,
    options: GetDocContentOptions,
) -> CmdResult<DocContentResponse> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let content = ctx.get_doc_content(&options.path).map_err(map_err)?;
    Ok(DocContentResponse { content })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveDocOptions {
    path: String,
    content: String,
    description: Option<String>,
}

#[tauri::command]
fn save_doc_content(
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
struct GetDocByIdOptions {
    stable_id: String,
}

#[tauri::command]
fn get_doc_by_id(
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
struct GetDocMetaOptions {
    path: String,
}

#[tauri::command]
fn get_doc_meta(
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
struct ManifestOptions {
    folder_path: String,
    limit: Option<u32>,
}

#[tauri::command]
fn generate_manifest(
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
fn get_env_info(state: State<AppState>) -> CmdResult<serde_json::Value> {
    let ctx = state.ctx.lock().map_err(map_err)?;
    let base_info = ctx.env_info();
    let config = &state.search_config;

    // Mask API key for security (show only last 4 chars)
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
struct SaveConfigOptions {
    api_key: Option<String>,
    api_base: Option<String>,
    model: Option<String>,
}

#[tauri::command]
fn save_config(options: SaveConfigOptions) -> CmdResult<serde_json::Value> {
    use std::collections::HashMap;

    let config_path = SearchConfig::json_config_path();

    // Read existing config or create new
    let mut config: HashMap<String, serde_json::Value> = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path).map_err(map_err)?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        HashMap::new()
    };

    // Update only provided fields (use new naming convention)
    if let Some(key) = options.api_key {
        if !key.is_empty() {
            config.insert(
                "EMBEDDING_API_KEY".to_string(),
                serde_json::Value::String(key),
            );
            // Remove legacy key if it exists
            config.remove("OPENAI_API_KEY");
        }
    }
    if let Some(base) = options.api_base {
        config.insert(
            "EMBEDDING_API_BASE".to_string(),
            serde_json::Value::String(base),
        );
        // Remove legacy key if it exists
        config.remove("OPENAI_BASE_URL");
    }
    if let Some(model) = options.model {
        config.insert(
            "EMBEDDING_MODEL".to_string(),
            serde_json::Value::String(model),
        );
    }

    // Ensure directory exists
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(map_err)?;
    }

    // Write config
    let content = serde_json::to_string_pretty(&config).map_err(map_err)?;
    std::fs::write(&config_path, content).map_err(map_err)?;

    Ok(serde_json::json!({
        "success": true,
        "config_path": config_path.to_string_lossy()
    }))
}

// ===== AI Commands =====

const DEFAULT_AI_PROMPT: &str = "You are an AI within a journaling app. Your job is to help the user reflect on their thoughts in a thoughtful and kind manner. The user can never directly address you or directly respond to you. Try not to repeat what the user said, instead try to seed new ideas, encourage or debate. Keep your responses concise, but meaningful. Respond in the same language as the user.";

fn get_config_value(key: &str) -> Option<String> {
    let config_path = SearchConfig::json_config_path();
    if !config_path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(&config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&content).ok()?;
    config
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

#[tauri::command]
fn get_ai_config() -> CmdResult<serde_json::Value> {
    let provider = get_config_value("AI_PROVIDER").unwrap_or_else(|| "openai".to_string());
    let api_key = get_config_value("AI_API_KEY");
    let api_base =
        get_config_value("AI_API_BASE").unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let model = get_config_value("AI_MODEL").unwrap_or_else(|| "gpt-4o".to_string());
    let prompt = get_config_value("AI_PROMPT").unwrap_or_else(|| DEFAULT_AI_PROMPT.to_string());

    let api_key_masked = api_key.as_ref().map(|key| {
        if key.len() > 7 {
            format!("{}...{}", &key[..3], &key[key.len() - 4..])
        } else {
            "****".to_string()
        }
    });

    Ok(serde_json::json!({
        "provider": provider,
        "model": model,
        "api_base": api_base,
        "api_key_masked": api_key_masked,
        "has_api_key": api_key.is_some() && !api_key.as_ref().unwrap().is_empty(),
        "prompt": prompt,
        "default_prompt": DEFAULT_AI_PROMPT
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveAIConfigOptions {
    provider: Option<String>,
    api_key: Option<String>,
    api_base: Option<String>,
    model: Option<String>,
    prompt: Option<String>,
}

#[tauri::command]
fn save_ai_config(options: SaveAIConfigOptions) -> CmdResult<serde_json::Value> {
    use std::collections::HashMap;

    let config_path = SearchConfig::json_config_path();

    let mut config: HashMap<String, serde_json::Value> = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path).map_err(map_err)?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        HashMap::new()
    };

    if let Some(provider) = options.provider {
        config.insert(
            "AI_PROVIDER".to_string(),
            serde_json::Value::String(provider),
        );
    }
    if let Some(key) = options.api_key {
        if !key.is_empty() {
            config.insert("AI_API_KEY".to_string(), serde_json::Value::String(key));
        }
    }
    if let Some(base) = options.api_base {
        config.insert("AI_API_BASE".to_string(), serde_json::Value::String(base));
    }
    if let Some(model) = options.model {
        config.insert("AI_MODEL".to_string(), serde_json::Value::String(model));
    }
    if let Some(prompt) = options.prompt {
        config.insert("AI_PROMPT".to_string(), serde_json::Value::String(prompt));
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

#[derive(Deserialize, Clone)]
struct ChatMessage {
    role: String,
    content: serde_json::Value,
}

#[derive(Deserialize)]
struct AIChatOptions {
    messages: Vec<ChatMessage>,
    #[serde(rename = "requestId")]
    request_id: Option<String>,
}

#[derive(Serialize, Clone)]
struct AIStreamEvent {
    content: Option<String>,
    done: Option<bool>,
    error: Option<String>,
}

#[tauri::command]
async fn ai_chat(window: tauri::Window, options: AIChatOptions) -> CmdResult<()> {
    let provider = get_config_value("AI_PROVIDER").unwrap_or_else(|| "openai".to_string());
    let api_key = get_config_value("AI_API_KEY");
    let api_base =
        get_config_value("AI_API_BASE").unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let model = get_config_value("AI_MODEL").unwrap_or_else(|| "gpt-4o".to_string());

    // 使用 request_id 构建唯一的事件名，支持并行请求
    let event_name = match &options.request_id {
        Some(id) => format!("ai-stream-{}", id),
        None => "ai-stream".to_string(),
    };

    // helper: extract text content from OpenAI/compatible streaming payloads
    fn extract_stream_content(value: &serde_json::Value) -> Option<String> {
        // Acceptable shapes:
        // 1) "string"
        // 2) [{ type: "text", text: "..." }]
        // 3) [{ text: { value: "..." } }]
        // 4) [{ content: "..." }] or content.value
        // 5) ["partial", "chunks"]
        if let Some(s) = value.as_str() {
            return Some(s.to_string());
        }
        if let Some(arr) = value.as_array() {
            let mut parts: Vec<String> = Vec::new();
            for item in arr {
                // item itself is a string
                if let Some(s) = item.as_str() {
                    parts.push(s.to_string());
                    continue;
                }
                if let Some(obj) = item.as_object() {
                    // text: "..."
                    if let Some(text) = obj.get("text").and_then(|t| t.as_str()) {
                        parts.push(text.to_string());
                        continue;
                    }
                    // text: { value: "..." }
                    if let Some(text_obj) = obj.get("text").and_then(|t| t.as_object()) {
                        if let Some(val) = text_obj.get("value").and_then(|v| v.as_str()) {
                            parts.push(val.to_string());
                            continue;
                        }
                    }
                    // content: "..."
                    if let Some(content) = obj.get("content").and_then(|t| t.as_str()) {
                        parts.push(content.to_string());
                        continue;
                    }
                    // content: { value: "..." }
                    if let Some(content_obj) = obj.get("content").and_then(|t| t.as_object()) {
                        if let Some(val) = content_obj.get("value").and_then(|v| v.as_str()) {
                            parts.push(val.to_string());
                            continue;
                        }
                    }
                }
            }
            if !parts.is_empty() {
                return Some(parts.join(""));
            }
        }
        None
    }

    let client = reqwest::Client::new();

    fn content_for_ollama(content: &serde_json::Value) -> (String, Vec<String>) {
        if let Some(s) = content.as_str() {
            return (s.to_string(), Vec::new());
        }
        if let Some(arr) = content.as_array() {
            let mut text_parts: Vec<String> = Vec::new();
            let mut images: Vec<String> = Vec::new();
            for item in arr {
                if let Some(obj) = item.as_object() {
                    if let Some(t) = obj.get("text").and_then(|v| v.as_str()) {
                        text_parts.push(t.to_string());
                    }
                    if let Some(url) = obj
                        .get("image_url")
                        .and_then(|v| v.get("url"))
                        .and_then(|v| v.as_str())
                    {
                        if let Some(encoded) = url.split("base64,").nth(1) {
                            images.push(encoded.to_string());
                        }
                    }
                }
            }
            return (text_parts.join("\n"), images);
        }
        (String::new(), Vec::new())
    }

    if provider == "ollama" {
        // Ollama API
        let ollama_url = if api_base.contains("ollama") || api_base.contains("11434") {
            api_base.clone()
        } else {
            "http://localhost:11434/api".to_string()
        };

        let messages: Vec<serde_json::Value> = options
            .messages
            .iter()
            .map(|m| {
                let (text, images) = content_for_ollama(&m.content);
                let mut msg = serde_json::json!({
                    "role": m.role,
                    "content": text
                });
                if !images.is_empty() {
                    msg["images"] = serde_json::Value::Array(
                        images.into_iter().map(serde_json::Value::String).collect(),
                    );
                }
                msg
            })
            .collect();

        let response = client
            .post(format!("{}/chat", ollama_url))
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "model": model,
                "messages": messages,
                "stream": true
            }))
            .send()
            .await
            .map_err(map_err)?;

        if !response.status().is_success() {
            let _ = window.emit(
                &event_name,
                AIStreamEvent {
                    content: None,
                    done: None,
                    error: Some(format!("Ollama error: {}", response.status())),
                },
            );
            return Ok(());
        }

        let mut stream = response.bytes_stream();
        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(chunk) => {
                    let text = String::from_utf8_lossy(&chunk);
                    for line in text.lines() {
                        if line.trim().is_empty() {
                            continue;
                        }
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                            if let Some(content) = json
                                .get("message")
                                .and_then(|m| m.get("content"))
                                .and_then(|c| c.as_str())
                            {
                                let _ = window.emit(
                                    &event_name,
                                    AIStreamEvent {
                                        content: Some(content.to_string()),
                                        done: None,
                                        error: None,
                                    },
                                );
                            }
                            if json.get("done").and_then(|d| d.as_bool()).unwrap_or(false) {
                                let _ = window.emit(
                                    &event_name,
                                    AIStreamEvent {
                                        content: None,
                                        done: Some(true),
                                        error: None,
                                    },
                                );
                            }
                        }
                    }
                }
                Err(e) => {
                    let _ = window.emit(
                        &event_name,
                        AIStreamEvent {
                            content: None,
                            done: None,
                            error: Some(e.to_string()),
                        },
                    );
                    break;
                }
            }
        }
    } else {
        // OpenAI-compatible API
        let Some(key) = api_key else {
            let _ = window.emit(
                &event_name,
                AIStreamEvent {
                    content: None,
                    done: None,
                    error: Some("AI API key not configured".to_string()),
                },
            );
            return Ok(());
        };

        let messages: Vec<serde_json::Value> = options
            .messages
            .iter()
            .map(|m| {
                serde_json::json!({
                    "role": m.role,
                    "content": m.content
                })
            })
            .collect();

        let response = client
            .post(format!("{}/chat/completions", api_base))
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", key))
            .json(&serde_json::json!({
                "model": model,
                "messages": messages,
                "stream": true,
                "max_tokens": 500
            }))
            .send()
            .await
            .map_err(map_err)?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            let _ = window.emit(
                &event_name,
                AIStreamEvent {
                    content: None,
                    done: None,
                    error: Some(format!("API error: {}", error_text)),
                },
            );
            return Ok(());
        }

        let mut stream = response.bytes_stream();
        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(chunk) => {
                    let text = String::from_utf8_lossy(&chunk);
                    for line in text.lines() {
                        if !line.starts_with("data: ") {
                            continue;
                        }
                        let data = &line[6..];
                        if data == "[DONE]" {
                            let _ = window.emit(
                                &event_name,
                                AIStreamEvent {
                                    content: None,
                                    done: Some(true),
                                    error: None,
                                },
                            );
                            break;
                        }
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                            // Try delta.content (streaming)
                            let delta_content = json
                                .get("choices")
                                .and_then(|c| c.get(0))
                                .and_then(|c| c.get("delta"))
                                .and_then(|d| d.get("content"))
                                .and_then(|c| extract_stream_content(c));

                            // Fallback to full message.content (non-stream or some providers)
                            let message_content = json
                                .get("choices")
                                .and_then(|c| c.get(0))
                                .and_then(|c| c.get("message"))
                                .and_then(|m| m.get("content"))
                                .and_then(|c| extract_stream_content(c));

                            if let Some(content) = delta_content.or(message_content) {
                                let _ = window.emit(
                                    &event_name,
                                    AIStreamEvent {
                                        content: Some(content),
                                        done: None,
                                        error: None,
                                    },
                                );
                            }
                        }
                    }
                }
                Err(e) => {
                    let _ = window.emit(
                        &event_name,
                        AIStreamEvent {
                            content: None,
                            done: None,
                            error: Some(e.to_string()),
                        },
                    );
                    break;
                }
            }
        }
    }

    Ok(())
}

// ===== Search Commands =====

#[tauri::command]
async fn semantic_search(
    state: State<'_, AppState>,
    options: SearchOptions,
) -> CmdResult<SearchResults> {
    let mut searcher_guard = state.searcher.lock().await;

    // Initialize searcher if not already done
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
struct BuildIndexOptions {
    folder_path: Option<String>,
}

#[tauri::command]
async fn build_search_index(
    window: tauri::Window,
    state: State<'_, AppState>,
    _options: Option<BuildIndexOptions>,
) -> CmdResult<IndexStats> {
    // Get contexts_root from OpenContext
    let contexts_root = {
        let ctx = state.ctx.lock().map_err(map_err)?;
        ctx.env_info().contexts_root
    };

    // Get all documents
    let docs = {
        let ctx = state.ctx.lock().map_err(map_err)?;
        // List all folders first
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

    // Initialize indexer if not already done
    if indexer_guard.is_none() {
        let indexer = Indexer::new(state.search_config.clone(), contexts_root)
            .await
            .map_err(map_err)?;
        *indexer_guard = Some(indexer);
    }

    let indexer = indexer_guard.as_mut().unwrap();

    // Build with progress callback
    let result = indexer
        .build_all_with_progress(docs, |progress| {
            // Emit progress event to frontend
            let _ = window.emit("index-progress", &progress);
        })
        .await
        .map_err(map_err)?;

    // Save index metadata with last update time
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
struct IndexStatus {
    exists: bool,
    chunk_count: usize,
    last_updated: Option<u64>,
}

#[tauri::command]
async fn get_index_status(state: State<'_, AppState>) -> CmdResult<IndexStatus> {
    // Get contexts_root from OpenContext
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

    // Try to read last update time from index-metadata.json
    // Prefer lastUpdated (any update), fallback to lastFullBuild (full rebuild only)
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
async fn clean_search_index(state: State<'_, AppState>) -> CmdResult<bool> {
    // Get contexts_root from OpenContext
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

fn main() {
    // Create event bus for document lifecycle events
    let event_bus = create_event_bus();

    // Initialize OpenContext with event bus
    let ctx = OpenContext::initialize(EnvOverrides::default())
        .expect("failed to initialize OpenContext core")
        .with_event_bus(event_bus.clone());

    let search_config = SearchConfig::load().unwrap_or_default();
    let contexts_root = ctx.env_info().contexts_root.clone();

    // Clone for setup hook
    let sync_event_bus = event_bus.clone();
    let sync_config = search_config.clone();
    let sync_contexts_root = contexts_root.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState {
            ctx: Mutex::new(ctx),
            searcher: AsyncMutex::new(None),
            indexer: AsyncMutex::new(None),
            search_config,
            event_bus,
        })
        .setup(move |app| {
            // Create Edit menu with predefined items for macOS
            // PredefinedMenuItem items automatically trigger native WebView edit actions
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, PredefinedMenuItem, Submenu};

                let edit_menu = Submenu::with_items(
                    app,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(app, Some("Undo")).unwrap(),
                        &PredefinedMenuItem::redo(app, Some("Redo")).unwrap(),
                        &PredefinedMenuItem::separator(app).unwrap(),
                        &PredefinedMenuItem::cut(app, Some("Cut")).unwrap(),
                        &PredefinedMenuItem::copy(app, Some("Copy")).unwrap(),
                        &PredefinedMenuItem::paste(app, Some("Paste")).unwrap(),
                        &PredefinedMenuItem::select_all(app, Some("Select All")).unwrap(),
                    ],
                )
                .unwrap();

                let menu = Menu::with_items(app, &[&edit_menu]).unwrap();
                app.set_menu(menu).unwrap();
            }

            // Start index sync service in background
            // Use tauri::async_runtime::spawn which works with Tauri's runtime management
            tauri::async_runtime::spawn(async move {
                let sync_service = IndexSyncService::new(sync_config, sync_contexts_root);
                if let Err(e) = sync_service.start(sync_event_bus).await {
                    log::error!("[IndexSync] Service error: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Folder commands
            list_folders,
            create_folder,
            rename_folder,
            move_folder,
            remove_folder,
            // Document commands
            list_docs,
            create_doc,
            get_doc_by_id,
            get_doc_meta,
            move_doc,
            rename_doc,
            remove_doc,
            set_doc_description,
            get_doc_content,
            save_doc_content,
            // Utility commands
            generate_manifest,
            get_env_info,
            save_config,
            // Search commands
            semantic_search,
            build_search_index,
            get_index_status,
            clean_search_index,
            // AI commands
            get_ai_config,
            save_ai_config,
            ai_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
