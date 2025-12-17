//! OpenContext Search Module
//!
//! This module provides semantic search capabilities for OpenContext documents.
//!
//! ## Features
//!
//! - Vector-based semantic search using LanceDB
//! - OpenAI Embedding API integration
//! - Markdown-aware document chunking
//! - Hybrid search (vector + keyword)
//! - Event-driven index synchronization
//!
//! ## Usage
//!
//! ```rust,ignore
//! use opencontext_core::search::{Searcher, SearchOptions};
//!
//! let searcher = Searcher::new(config).await?;
//! let results = searcher.search(SearchOptions {
//!     query: "how to use opencontext".into(),
//!     limit: Some(10),
//!     ..Default::default()
//! }).await?;
//! ```

mod chunker;
mod config;
mod embedding;
mod error;
mod index_sync;
mod indexer;
mod searcher;
mod types;
mod vector_store;

#[cfg(test)]
mod tests;

pub use chunker::Chunker;
pub use config::{EmbeddingConfig, SearchConfig};
pub use embedding::EmbeddingClient;
pub use error::{SearchError, SearchResult};
pub use index_sync::IndexSyncService;
pub use indexer::{IndexProgress, IndexStats, Indexer};
pub use searcher::Searcher;
pub use types::*;
pub use vector_store::VectorStore;
