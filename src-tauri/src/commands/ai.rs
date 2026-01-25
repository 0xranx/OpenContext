use crate::chat::ChatMessage;
use crate::utils::{map_err, CmdResult};
use futures::StreamExt;
use opencontext_core::search::SearchConfig;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

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
pub(crate) fn get_ai_config() -> CmdResult<serde_json::Value> {
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
pub(crate) struct SaveAIConfigOptions {
    provider: Option<String>,
    api_key: Option<String>,
    api_base: Option<String>,
    model: Option<String>,
    prompt: Option<String>,
}

#[tauri::command]
pub(crate) fn save_ai_config(options: SaveAIConfigOptions) -> CmdResult<serde_json::Value> {
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

#[derive(Deserialize)]
pub(crate) struct AIChatOptions {
    messages: Vec<ChatMessage>,
    #[serde(rename = "requestId")]
    request_id: Option<String>,
    model: Option<String>,
}

#[derive(Serialize, Clone)]
pub(crate) struct AIStreamEvent {
    content: Option<String>,
    done: Option<bool>,
    error: Option<String>,
}

pub(crate) fn extract_stream_content(value: &serde_json::Value) -> Option<String> {
    if let Some(s) = value.as_str() {
        return Some(s.to_string());
    }
    if let Some(arr) = value.as_array() {
        let mut parts: Vec<String> = Vec::new();
        for item in arr {
            if let Some(s) = item.as_str() {
                parts.push(s.to_string());
                continue;
            }
            if let Some(obj) = item.as_object() {
                if let Some(text) = obj.get("text").and_then(|t| t.as_str()) {
                    parts.push(text.to_string());
                    continue;
                }
                if let Some(text_obj) = obj.get("text").and_then(|t| t.as_object()) {
                    if let Some(val) = text_obj.get("value").and_then(|v| v.as_str()) {
                        parts.push(val.to_string());
                        continue;
                    }
                }
                if let Some(content) = obj.get("content").and_then(|t| t.as_str()) {
                    parts.push(content.to_string());
                    continue;
                }
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

pub(crate) fn content_for_ollama(content: &serde_json::Value) -> (String, Vec<String>) {
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

#[tauri::command]
pub(crate) async fn ai_chat(window: tauri::Window, options: AIChatOptions) -> CmdResult<()> {
    let provider = get_config_value("AI_PROVIDER").unwrap_or_else(|| "openai".to_string());
    let api_key = get_config_value("AI_API_KEY");
    let api_base =
        get_config_value("AI_API_BASE").unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let model = options
        .model
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| get_config_value("AI_MODEL").unwrap_or_else(|| "gpt-4o".to_string()));

    let event_name = match &options.request_id {
        Some(id) => format!("ai-stream-{}", id),
        None => "ai-stream".to_string(),
    };

    let client = reqwest::Client::new();

    if provider == "ollama" {
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
                            error: Some(format!("Ollama error: {}", e)),
                        },
                    );
                    return Ok(());
                }
            }
        }

        let _ = window.emit(
            &event_name,
            AIStreamEvent {
                content: None,
                done: Some(true),
                error: None,
            },
        );
        return Ok(());
    }

    let api_key = api_key.ok_or_else(|| "OpenAI API key not configured".to_string())?;

    let response = client
        .post(format!("{}/chat/completions", api_base))
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&serde_json::json!({
            "model": model,
            "messages": options.messages,
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
                error: Some(format!("OpenAI error: {}", response.status())),
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
                    let content = line.trim_start_matches("data: ").trim();
                    if content == "[DONE]" {
                        let _ = window.emit(
                            &event_name,
                            AIStreamEvent {
                                content: None,
                                done: Some(true),
                                error: None,
                            },
                        );
                        return Ok(());
                    }
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(content) {
                        let text_chunk = json
                            .get("choices")
                            .and_then(|c| c.get(0))
                            .and_then(|c| c.get("delta"))
                            .and_then(|d| d.get("content"))
                            .and_then(|c| extract_stream_content(c));
                        if let Some(token) = text_chunk {
                            let _ = window.emit(
                                &event_name,
                                AIStreamEvent {
                                    content: Some(token),
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
                        error: Some(format!("OpenAI error: {}", e)),
                    },
                );
                return Ok(());
            }
        }
    }

    let _ = window.emit(
        &event_name,
        AIStreamEvent {
            content: None,
            done: Some(true),
            error: None,
        },
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extract_stream_content_handles_text_shapes() {
        assert_eq!(extract_stream_content(&json!("ping")), Some("ping".to_string()));
        assert_eq!(
            extract_stream_content(&json!([{ "text": "a" }, { "content": { "value": "b" } }])),
            Some("ab".to_string())
        );
    }

    #[test]
    fn content_for_ollama_extracts_images() {
        let (text, images) = content_for_ollama(&json!([
            { "text": "Hello" },
            { "image_url": { "url": "data:image/png;base64,ABC123" } }
        ]));
        assert_eq!(text, "Hello");
        assert_eq!(images, vec!["ABC123".to_string()]);
    }
}
