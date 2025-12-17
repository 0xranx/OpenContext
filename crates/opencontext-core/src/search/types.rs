//! Common types for search module

use serde::{Deserialize, Serialize};

/// A chunk of document content with its embedding
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chunk {
    /// Unique identifier for this chunk
    pub id: String,
    /// Relative path to the source document
    pub file_path: String,
    /// The text content of this chunk
    pub content: String,
    /// Heading path (e.g., "## Background > ### Goals")
    pub heading_path: String,
    /// Index of this chunk within the document
    pub chunk_index: usize,
    /// Embedding vector
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub vector: Vec<f32>,
}

/// A text chunk before embedding is generated
#[derive(Debug, Clone)]
pub struct TextChunk {
    /// The text content
    pub content: String,
    /// Heading path
    pub heading_path: String,
    /// Start line number (1-indexed)
    pub start_line: usize,
    /// End line number (1-indexed)
    pub end_line: usize,
}

/// Search mode
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SearchMode {
    /// Vector search only
    Vector,
    /// Keyword search only
    Keyword,
    /// Hybrid search (vector + keyword with RRF fusion)
    #[default]
    Hybrid,
}

/// Aggregation level for search results
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AggregateBy {
    /// Return individual content chunks
    Content,
    /// Aggregate by document
    #[default]
    Doc,
    /// Aggregate by folder
    Folder,
}

/// How a result was matched
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MatchType {
    Vector,
    Keyword,
    #[serde(rename = "vector+keyword")]
    Hybrid,
}

/// Search options
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    /// The search query
    pub query: String,
    /// Maximum number of results
    pub limit: Option<usize>,
    /// Search mode
    pub mode: Option<SearchMode>,
    /// Aggregation level
    pub aggregate_by: Option<AggregateBy>,
}

impl SearchOptions {
    pub fn limit(&self) -> usize {
        self.limit.unwrap_or(10)
    }

    pub fn mode(&self) -> SearchMode {
        self.mode.unwrap_or_default()
    }

    pub fn aggregate_by(&self) -> AggregateBy {
        self.aggregate_by.unwrap_or_default()
    }
}

/// A single search result
/// Uses snake_case to match Node.js API format
#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    /// File path of the matched document
    pub file_path: String,
    /// Display name for the document
    pub display_name: String,
    /// Matched content snippet
    pub content: String,
    /// Heading path within the document
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading_path: Option<String>,
    /// Section title
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section_title: Option<String>,
    /// Start line number
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_start: Option<usize>,
    /// End line number
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_end: Option<usize>,
    /// Relevance score (0-1)
    pub score: f32,
    /// How this result was matched
    pub matched_by: MatchType,
    /// Number of hits in this document (for aggregated results)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hit_count: Option<usize>,
    /// Number of documents (for folder aggregation)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc_count: Option<usize>,
    /// Folder path (for folder aggregation)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_path: Option<String>,
    /// Aggregation type: 'doc' | 'folder'
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aggregate_type: Option<String>,
}

/// Search results response
/// Uses snake_case to match Node.js API format
#[derive(Debug, Clone, Serialize)]
pub struct SearchResults {
    /// The original query
    pub query: String,
    /// Search results
    pub results: Vec<SearchHit>,
    /// Total number of results
    pub count: usize,
    /// Search mode used
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    /// Aggregation type used
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aggregate_by: Option<String>,
    /// Whether the index exists
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index_missing: Option<bool>,
    /// Error message if any
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl SearchResults {
    pub fn empty(query: String) -> Self {
        Self {
            query,
            results: vec![],
            count: 0,
            mode: None,
            aggregate_by: None,
            index_missing: None,
            error: None,
        }
    }

    pub fn with_error(query: String, error: String) -> Self {
        Self {
            query,
            results: vec![],
            count: 0,
            mode: None,
            aggregate_by: None,
            index_missing: None,
            error: Some(error),
        }
    }

    pub fn index_not_built(query: String) -> Self {
        Self {
            query,
            results: vec![],
            count: 0,
            mode: None,
            aggregate_by: None,
            index_missing: Some(true),
            error: None,
        }
    }
}
