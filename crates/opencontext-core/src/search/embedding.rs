//! OpenAI Embedding API client

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicUsize, Ordering};

use super::config::EmbeddingConfig;
use super::error::{SearchError, SearchResult};

/// OpenAI Embedding API client
pub struct EmbeddingClient {
    config: EmbeddingConfig,
    client: Client,
    /// Actual dimensions detected from API response (0 = not yet detected)
    actual_dimensions: AtomicUsize,
}

#[derive(Debug, Serialize)]
struct EmbeddingRequest {
    model: String,
    input: Vec<String>,
    /// Only sent for models that support it (e.g. text-embedding-3-*)
    #[serde(skip_serializing_if = "Option::is_none")]
    dimensions: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
    #[allow(dead_code)]
    usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
    #[allow(dead_code)]
    index: usize,
}

#[derive(Debug, Deserialize)]
struct Usage {
    #[allow(dead_code)]
    prompt_tokens: usize,
    #[allow(dead_code)]
    total_tokens: usize,
}

#[derive(Debug, Deserialize)]
struct ErrorResponse {
    error: ErrorDetail,
}

#[derive(Debug, Deserialize)]
struct ErrorDetail {
    message: String,
}

impl EmbeddingClient {
    /// Create a new embedding client
    pub fn new(config: EmbeddingConfig) -> SearchResult<Self> {
        // Validate API key is available
        config.get_api_key()?;

        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(SearchError::Http)?;

        Ok(Self {
            config,
            client,
            actual_dimensions: AtomicUsize::new(0),
        })
    }

    /// Get embedding dimensions (returns actual detected dimensions if available)
    pub fn dimensions(&self) -> usize {
        let actual = self.actual_dimensions.load(Ordering::Relaxed);
        if actual > 0 {
            actual
        } else {
            self.config.dimensions
        }
    }

    /// Get actual dimensions detected from API (0 if not yet detected)
    pub fn actual_dimensions(&self) -> usize {
        self.actual_dimensions.load(Ordering::Relaxed)
    }

    /// Generate embeddings for multiple texts
    pub async fn embed(&self, texts: Vec<String>) -> SearchResult<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(vec![]);
        }

        let api_key = self.config.get_api_key()?;
        let url = format!("{}/embeddings", self.config.api_base);

        // Process in batches
        let mut all_embeddings = Vec::with_capacity(texts.len());

        for batch in texts.chunks(self.config.batch_size) {
            let batch_embeddings = self.embed_batch(batch.to_vec(), &api_key, &url).await?;
            all_embeddings.extend(batch_embeddings);
        }

        Ok(all_embeddings)
    }

    /// Generate embedding for a single text
    pub async fn embed_one(&self, text: &str) -> SearchResult<Vec<f32>> {
        let embeddings = self.embed(vec![text.to_string()]).await?;
        embeddings
            .into_iter()
            .next()
            .ok_or_else(|| SearchError::Embedding("No embedding returned".to_string()))
    }

    async fn embed_batch(
        &self,
        texts: Vec<String>,
        api_key: &str,
        url: &str,
    ) -> SearchResult<Vec<Vec<f32>>> {
        let input_count = texts.len();

        // Truncate texts that are too long (most embedding APIs have ~8K token limit)
        // Using char count as approximation: ~4 chars per token for English, ~1-2 for CJK/Cyrillic
        // nomic-embed-text and similar models have 8192 token limit
        // Conservative limit: 2000 chars (safe for all languages including Cyrillic/CJK)
        const MAX_CHARS: usize = 2000;
        let texts: Vec<String> = texts
            .into_iter()
            .map(|t| {
                if t.chars().count() > MAX_CHARS {
                    t.chars().take(MAX_CHARS).collect()
                } else {
                    t
                }
            })
            .collect();

        // Only send dimensions for OpenAI text-embedding-3 models
        // Other APIs (like DashScope) may not support this parameter
        let dimensions = if self.config.model.starts_with("text-embedding-3") {
            Some(self.config.dimensions)
        } else {
            None
        };

        let request = EmbeddingRequest {
            model: self.config.model.clone(),
            input: texts,
            dimensions,
        };

        let response = self
            .client
            .post(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(SearchError::Http)?;

        let status = response.status();
        let body = response.text().await.map_err(SearchError::Http)?;

        if !status.is_success() {
            // Try to parse error message
            if let Ok(error_response) = serde_json::from_str::<ErrorResponse>(&body) {
                return Err(SearchError::Embedding(error_response.error.message));
            }
            return Err(SearchError::Embedding(format!(
                "API error ({}): {}",
                status, body
            )));
        }

        let response: EmbeddingResponse = serde_json::from_str(&body).map_err(SearchError::Json)?;

        // Verify we got embeddings for all inputs
        if response.data.len() != input_count {
            return Err(SearchError::Embedding(format!(
                "Embedding count mismatch: sent {} texts, got {} embeddings",
                input_count,
                response.data.len()
            )));
        }

        // Sort by index to ensure correct order
        let mut data = response.data;
        data.sort_by_key(|d| d.index);

        // Auto-detect actual dimensions from first embedding
        if let Some(first) = data.first() {
            let detected_dim = first.embedding.len();
            let current = self.actual_dimensions.load(Ordering::Relaxed);
            if current == 0 {
                self.actual_dimensions
                    .store(detected_dim, Ordering::Relaxed);
                log::info!("Auto-detected embedding dimensions: {}", detected_dim);
            } else if current != detected_dim {
                log::warn!(
                    "Embedding dimension mismatch: expected {}, got {}",
                    current,
                    detected_dim
                );
            }
        }

        Ok(data.into_iter().map(|d| d.embedding).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_defaults() {
        let config = EmbeddingConfig::default();
        assert_eq!(config.model, "text-embedding-3-small");
        assert_eq!(config.dimensions, 1536);
    }
}
