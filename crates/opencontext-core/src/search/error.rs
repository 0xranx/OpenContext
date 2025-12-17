//! Search error types

use thiserror::Error;

/// Search-specific error type
#[derive(Debug, Error)]
pub enum SearchError {
    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Embedding API error: {0}")]
    Embedding(String),

    #[error("Vector store error: {0}")]
    VectorStore(String),

    #[error("Index error: {0}")]
    Index(String),

    #[error("Search error: {0}")]
    Search(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("LanceDB error: {0}")]
    Lance(#[from] lancedb::Error),

    #[error("Index not built. Run 'oc index build' first.")]
    IndexNotBuilt,

    #[error(
        "API key not configured. Set OPENAI_API_KEY or configure in ~/.opencontext/config.toml"
    )]
    ApiKeyMissing,
}

/// Result type alias for search operations
pub type SearchResult<T> = std::result::Result<T, SearchError>;
