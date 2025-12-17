//! Search configuration

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use super::error::{SearchError, SearchResult};

/// Main search configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchConfig {
    /// Embedding API configuration
    #[serde(default)]
    pub embedding: EmbeddingConfig,

    /// Search behavior configuration
    #[serde(default)]
    pub search: SearchBehaviorConfig,

    /// Paths configuration
    #[serde(default)]
    pub paths: PathsConfig,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            embedding: EmbeddingConfig::default(),
            search: SearchBehaviorConfig::default(),
            paths: PathsConfig::default(),
        }
    }
}

/// Embedding API configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingConfig {
    /// OpenAI API key (can also use OPENAI_API_KEY env var)
    #[serde(default)]
    pub api_key: Option<String>,

    /// API base URL
    #[serde(default = "default_api_base")]
    pub api_base: String,

    /// Model name
    #[serde(default = "default_model")]
    pub model: String,

    /// Embedding dimensions
    #[serde(default = "default_dimensions")]
    pub dimensions: usize,

    /// Batch size for embedding requests
    #[serde(default = "default_batch_size")]
    pub batch_size: usize,
}

impl Default for EmbeddingConfig {
    fn default() -> Self {
        Self {
            api_key: None,
            api_base: default_api_base(),
            model: default_model(),
            dimensions: default_dimensions(),
            batch_size: default_batch_size(),
        }
    }
}

impl EmbeddingConfig {
    /// Get API key from config or environment
    pub fn get_api_key(&self) -> SearchResult<String> {
        if let Some(ref key) = self.api_key {
            if !key.is_empty() {
                return Ok(key.clone());
            }
        }

        std::env::var("OPENAI_API_KEY")
            .or_else(|_| std::env::var("OPENAI_KEY"))
            .map_err(|_| SearchError::ApiKeyMissing)
    }
}

fn default_api_base() -> String {
    std::env::var("OPENAI_API_BASE").unwrap_or_else(|_| "https://api.openai.com/v1".to_string())
}

fn default_model() -> String {
    "text-embedding-3-small".to_string()
}

fn default_dimensions() -> usize {
    // Note: Different models have different dimensions:
    // - OpenAI text-embedding-3-small: 1536
    // - OpenAI text-embedding-3-large: 3072
    // - DashScope text-embedding-v4: 1024
    // This will be auto-detected from first embedding response if not specified
    1536
}

fn default_batch_size() -> usize {
    10 // DashScope and some other APIs limit batch size to 10
}

/// Search behavior configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchBehaviorConfig {
    /// Default result limit
    #[serde(default = "default_limit")]
    pub default_limit: usize,

    /// Maximum chunk size in characters
    #[serde(default = "default_chunk_size")]
    pub chunk_size: usize,

    /// Overlap between chunks in characters
    #[serde(default = "default_chunk_overlap")]
    pub chunk_overlap: usize,
}

impl Default for SearchBehaviorConfig {
    fn default() -> Self {
        Self {
            default_limit: default_limit(),
            chunk_size: default_chunk_size(),
            chunk_overlap: default_chunk_overlap(),
        }
    }
}

fn default_limit() -> usize {
    10
}

fn default_chunk_size() -> usize {
    1500
}

fn default_chunk_overlap() -> usize {
    200
}

/// Paths configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathsConfig {
    /// LanceDB database path
    #[serde(default)]
    pub lancedb_path: Option<PathBuf>,

    /// Index metadata path
    #[serde(default)]
    pub index_metadata_path: Option<PathBuf>,
}

impl Default for PathsConfig {
    fn default() -> Self {
        Self {
            lancedb_path: None,
            index_metadata_path: None,
        }
    }
}

impl PathsConfig {
    /// Get LanceDB path, using default if not specified
    pub fn get_lancedb_path(&self) -> PathBuf {
        if let Some(ref path) = self.lancedb_path {
            return path.clone();
        }

        if let Ok(root) = std::env::var("OPENCONTEXT_ROOT") {
            return PathBuf::from(root).join("lancedb");
        }

        dirs::home_dir()
            .map(|h| h.join(".opencontext").join("lancedb"))
            .unwrap_or_else(|| PathBuf::from(".opencontext/lancedb"))
    }

    /// Get index metadata path
    pub fn get_index_metadata_path(&self) -> PathBuf {
        if let Some(ref path) = self.index_metadata_path {
            return path.clone();
        }

        if let Ok(root) = std::env::var("OPENCONTEXT_ROOT") {
            return PathBuf::from(root).join("index-metadata.json");
        }

        dirs::home_dir()
            .map(|h| h.join(".opencontext").join("index-metadata.json"))
            .unwrap_or_else(|| PathBuf::from(".opencontext/index-metadata.json"))
    }
}

/// Node.js compatible config format (config.json)
/// Supports both new naming (EMBEDDING_*) and legacy naming (OPENAI_*) for backward compatibility
#[derive(Debug, Clone, Default, Deserialize)]
struct NodeJsConfig {
    // New naming convention
    #[serde(rename = "EMBEDDING_API_KEY")]
    embedding_api_key: Option<String>,
    #[serde(rename = "EMBEDDING_API_BASE")]
    embedding_api_base: Option<String>,
    #[serde(rename = "EMBEDDING_MODEL")]
    embedding_model: Option<String>,

    // Legacy naming (backward compatibility)
    #[serde(rename = "OPENAI_API_KEY")]
    openai_api_key: Option<String>,
    #[serde(rename = "OPENAI_BASE_URL")]
    openai_base_url: Option<String>,
}

impl SearchConfig {
    /// Load configuration from file and environment
    /// Priority: environment variables > config.json (Node.js) > config.toml (Rust) > defaults
    pub fn load() -> SearchResult<Self> {
        let mut config = Self::default();

        // 1. Try loading from config.toml (Rust format)
        let toml_path = Self::toml_config_path();
        if toml_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&toml_path) {
                if let Ok(toml_config) = toml::from_str::<SearchConfig>(&content) {
                    config = toml_config;
                }
            }
        }

        // 2. Try loading from config.json (Node.js format) - this takes precedence
        let json_path = Self::json_config_path();
        if json_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&json_path) {
                if let Ok(node_config) = serde_json::from_str::<NodeJsConfig>(&content) {
                    // Merge Node.js config into our config
                    // New naming takes precedence over legacy naming
                    let api_key = node_config.embedding_api_key.or(node_config.openai_api_key);
                    if let Some(key) = api_key {
                        if !key.is_empty() {
                            config.embedding.api_key = Some(key);
                        }
                    }
                    let api_base = node_config
                        .embedding_api_base
                        .or(node_config.openai_base_url);
                    if let Some(base_url) = api_base {
                        if !base_url.is_empty() {
                            config.embedding.api_base = base_url;
                        }
                    }
                    if let Some(model) = node_config.embedding_model {
                        if !model.is_empty() {
                            config.embedding.model = model;
                        }
                    }
                }
            }
        }

        // 3. Override with environment variables (highest priority)
        // New naming takes precedence over legacy naming
        if let Ok(api_base) =
            std::env::var("EMBEDDING_API_BASE").or_else(|_| std::env::var("OPENAI_API_BASE"))
        {
            config.embedding.api_base = api_base;
        }
        if let Ok(api_key) =
            std::env::var("EMBEDDING_API_KEY").or_else(|_| std::env::var("OPENAI_API_KEY"))
        {
            config.embedding.api_key = Some(api_key);
        }
        if let Ok(model) = std::env::var("EMBEDDING_MODEL") {
            config.embedding.model = model;
        }

        Ok(config)
    }

    /// Get base config directory
    fn config_dir() -> PathBuf {
        if let Ok(root) = std::env::var("OPENCONTEXT_ROOT") {
            return PathBuf::from(root);
        }

        dirs::home_dir()
            .map(|h| h.join(".opencontext"))
            .unwrap_or_else(|| PathBuf::from(".opencontext"))
    }

    /// Get Node.js config file path (config.json)
    pub fn json_config_path() -> PathBuf {
        Self::config_dir().join("config.json")
    }

    /// Get Rust config file path (config.toml)
    pub fn toml_config_path() -> PathBuf {
        Self::config_dir().join("config.toml")
    }

    /// Get default config file path (for backward compatibility)
    pub fn config_path() -> PathBuf {
        Self::json_config_path()
    }
}
