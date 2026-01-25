use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Clone)]
pub(crate) struct ChatMessage {
    pub(crate) role: String,
    pub(crate) content: serde_json::Value,
}

pub(crate) fn flatten_message_content(value: &serde_json::Value) -> String {
    if value.is_null() {
        return String::new();
    }
    if let Some(s) = value.as_str() {
        return s.to_string();
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
                if let Some(content) = obj.get("content") {
                    let flattened = flatten_message_content(content);
                    if !flattened.is_empty() {
                        parts.push(flattened);
                        continue;
                    }
                }
                if let Some(text) = obj.get("message").and_then(|t| t.as_str()) {
                    parts.push(text.to_string());
                }
            }
        }
        return parts.join("");
    }
    if let Some(obj) = value.as_object() {
        if let Some(text) = obj.get("text").and_then(|t| t.as_str()) {
            return text.to_string();
        }
        if let Some(content) = obj.get("content") {
            return flatten_message_content(content);
        }
    }
    value.to_string()
}

pub(crate) fn build_cli_prompt(messages: &[ChatMessage]) -> String {
    let mut lines: Vec<String> = Vec::new();
    for msg in messages {
        let content = flatten_message_content(&msg.content);
        if content.trim().is_empty() {
            continue;
        }
        lines.push(format!(
            "{}: {}",
            msg.role.to_uppercase(),
            content.trim()
        ));
    }
    lines.join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn flatten_message_content_handles_nested_arrays() {
        let value = json!([
            { "text": "Hello" },
            { "content": [{ "text": " " }, { "text": "World" }] },
            { "content": { "text": "!" } }
        ]);
        assert_eq!(flatten_message_content(&value), "Hello World!");
    }

    #[test]
    fn build_cli_prompt_formats_roles() {
        let messages = vec![
            ChatMessage {
                role: "user".to_string(),
                content: json!("Hi"),
            },
            ChatMessage {
                role: "assistant".to_string(),
                content: json!("Ok"),
            },
        ];
        assert_eq!(build_cli_prompt(&messages), "USER: Hi\n\nASSISTANT: Ok");
    }
}
