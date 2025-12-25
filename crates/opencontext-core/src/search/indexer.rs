//! Document indexer

use std::collections::HashMap;
use std::path::PathBuf;

use regex::Regex;
use urlencoding::decode;

use super::chunker::Chunker;
use super::config::SearchConfig;
use super::embedding::EmbeddingClient;
use super::error::{SearchError, SearchResult};
use super::types::Chunk;
use super::vector_store::VectorStore;

#[derive(Clone)]
struct DocInfo {
    name: String,
    rel_path: String,
    description: String,
}

#[derive(Clone)]
struct IdeaEntry {
    id: String,
    created_at: String,
    content: String,
}

fn parse_idea_marker(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if !trimmed.starts_with("[//]: # (") || !trimmed.ends_with(')') {
        return None;
    }
    let inner = trimmed.strip_prefix("[//]: # (")?.strip_suffix(')')?;
    let mut id = None;
    let mut created_at = None;
    for part in inner.split_whitespace() {
        if let Some(value) = part.strip_prefix("idea:id=") {
            id = Some(value.to_string());
        } else if let Some(value) = part.strip_prefix("created_at=") {
            created_at = Some(value.to_string());
        }
    }
    match (id, created_at) {
        (Some(id), Some(created_at)) => Some((id, created_at)),
        _ => None,
    }
}

fn parse_idea_entries(content: &str) -> Vec<IdeaEntry> {
    let mut entries = Vec::new();
    let mut current_id: Option<String> = None;
    let mut current_created: Option<String> = None;
    let mut buffer: Vec<String> = Vec::new();

    for line in content.lines() {
        if let Some((id, created_at)) = parse_idea_marker(line) {
            if let (Some(id), Some(created_at)) = (current_id.take(), current_created.take()) {
                entries.push(IdeaEntry {
                    id,
                    created_at,
                    content: buffer.join("\n").trim().to_string(),
                });
            }
            buffer.clear();
            current_id = Some(id);
            current_created = Some(created_at);
            continue;
        }
        if current_id.is_some() {
            buffer.push(line.to_string());
        }
    }

    if let (Some(id), Some(created_at)) = (current_id.take(), current_created.take()) {
        entries.push(IdeaEntry {
            id,
            created_at,
            content: buffer.join("\n").trim().to_string(),
        });
    }

    entries
}

fn extract_refs(text: &str) -> Vec<(String, String)> {
    let regex = Regex::new(r"\[([^\]]+)\]\((oc://[^)]+)\)").unwrap();
    regex
        .captures_iter(text)
        .map(|cap| (cap[1].to_string(), cap[2].to_string()))
        .collect()
}

fn parse_doc_href(href: &str) -> (Option<String>, Option<String>) {
    if !href.starts_with("oc://doc/") {
        return (None, None);
    }
    let raw = href.trim_start_matches("oc://doc/");
    let mut stable_id = raw.to_string();
    let mut path_param: Option<String> = None;
    if let Some((id, query)) = raw.split_once('?') {
        stable_id = id.to_string();
        if let Some(path) = query.split('&').find_map(|pair| {
            let mut iter = pair.splitn(2, '=');
            match (iter.next(), iter.next()) {
                (Some("path"), Some(value)) => Some(value.to_string()),
                _ => None,
            }
        }) {
            if let Ok(decoded) = decode(&path) {
                path_param = Some(decoded.to_string());
            }
        }
    }
    let stable_id = if stable_id.is_empty() {
        None
    } else {
        Some(stable_id)
    };
    (stable_id, path_param)
}

fn append_reference_summary(
    text: &str,
    doc_by_stable: &HashMap<String, DocInfo>,
    doc_by_path: &HashMap<String, DocInfo>,
) -> String {
    let refs = extract_refs(text);
    if refs.is_empty() {
        return text.to_string();
    }

    let mut lines: Vec<String> = Vec::new();
    for (label, href) in refs {
        if href.starts_with("oc://doc/") {
            let (stable_id, path) = parse_doc_href(&href);
            let meta = stable_id
                .as_ref()
                .and_then(|id| doc_by_stable.get(id))
                .cloned()
                .or_else(|| path.as_ref().and_then(|p| doc_by_path.get(p)).cloned());
            let title = if !label.is_empty() {
                label
            } else {
                meta.as_ref()
                    .map(|m| m.name.clone())
                    .unwrap_or_else(|| "文档".to_string())
            };
            let summary = meta
                .as_ref()
                .map(|m| {
                    let mut parts = Vec::new();
                    if !m.description.is_empty() {
                        parts.push(m.description.clone());
                    }
                    if !m.rel_path.is_empty() {
                        parts.push(m.rel_path.clone());
                    }
                    parts.join(" · ")
                })
                .unwrap_or_default();
            if summary.is_empty() {
                lines.push(format!("文档: {}", title));
            } else {
                lines.push(format!("文档: {} — {}", title, summary));
            }
        } else if href.starts_with("oc://idea/") {
            let title = if !label.is_empty() {
                label
            } else {
                "想法".to_string()
            };
            lines.push(format!("想法: {}", title));
        }
    }

    if lines.is_empty() {
        return text.to_string();
    }

    format!("{text}\n\n引用:\n- {}", lines.join("\n- "))
}

/// Index build statistics
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    /// Total documents indexed
    pub total_docs: usize,
    /// Total chunks created
    pub total_chunks: usize,
    /// Total tokens used (if available)
    pub total_tokens: Option<usize>,
    /// Time elapsed in milliseconds
    pub elapsed_ms: u64,
    /// Last updated timestamp (ms since epoch)
    pub last_updated: Option<u64>,
}

/// Index build progress
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexProgress {
    /// Current phase: "chunking", "embedding", "storing"
    pub phase: String,
    /// Current item being processed
    pub current: usize,
    /// Total items to process
    pub total: usize,
    /// Percentage complete (0-100)
    pub percent: u8,
    /// Optional message
    pub message: Option<String>,
}

/// Document indexer for building search index
pub struct Indexer {
    config: SearchConfig,
    contexts_root: PathBuf,
    vector_store: VectorStore,
    embedding_client: EmbeddingClient,
    chunker: Chunker,
    /// Whether vector_store has been re-initialized with actual dimensions
    dimensions_verified: bool,
}

impl Indexer {
    /// Create a new indexer
    pub async fn new(config: SearchConfig, contexts_root: PathBuf) -> SearchResult<Self> {
        let lancedb_path = config.paths.get_lancedb_path();
        let dimensions = config.embedding.dimensions;

        let mut vector_store = VectorStore::new(lancedb_path, dimensions);
        vector_store.initialize().await?;

        let embedding_client = EmbeddingClient::new(config.embedding.clone())?;

        let chunker = Chunker::new(config.search.chunk_size, config.search.chunk_overlap);

        Ok(Self {
            config,
            contexts_root,
            vector_store,
            embedding_client,
            chunker,
            dimensions_verified: false,
        })
    }

    /// Verify and update vector store dimensions based on actual embedding dimensions
    async fn verify_dimensions(&mut self) -> SearchResult<()> {
        if self.dimensions_verified {
            return Ok(());
        }

        let actual_dim = self.embedding_client.actual_dimensions();
        if actual_dim > 0 && actual_dim != self.config.embedding.dimensions {
            log::info!(
                "Re-initializing vector store with actual dimensions: {} (was {})",
                actual_dim,
                self.config.embedding.dimensions
            );

            let lancedb_path = self.config.paths.get_lancedb_path();
            self.vector_store = VectorStore::new(lancedb_path, actual_dim);
            self.vector_store.initialize().await?;
        }

        self.dimensions_verified = true;
        Ok(())
    }

    /// Build index for all documents
    pub async fn build_all(&mut self, docs: Vec<crate::Doc>) -> SearchResult<IndexStats> {
        self.build_all_with_progress(docs, |_| {}).await
    }

    /// Build index for all documents with progress callback
    pub async fn build_all_with_progress<F>(
        &mut self,
        docs: Vec<crate::Doc>,
        mut on_progress: F,
    ) -> SearchResult<IndexStats>
    where
        F: FnMut(IndexProgress),
    {
        let start = std::time::Instant::now();
        let total_docs = docs.len();
        let mut total_chunks = 0;
        let mut processed_docs = 0;

        let mut doc_by_stable: HashMap<String, DocInfo> = HashMap::new();
        let mut doc_by_path: HashMap<String, DocInfo> = HashMap::new();
        for doc in &docs {
            let info = DocInfo {
                name: doc.name.clone(),
                rel_path: doc.rel_path.clone(),
                description: doc.description.clone(),
            };
            doc_by_stable.insert(doc.stable_id.clone(), info.clone());
            doc_by_path.insert(doc.rel_path.clone(), info);
        }

        // Reset existing index
        self.vector_store.reset().await?;

        // Process documents in batches
        let batch_size = 10;
        let total_batches = docs.len().div_ceil(batch_size);

        for (batch_idx, batch) in docs.chunks(batch_size).enumerate() {
            let mut all_chunks = Vec::new();

            // Phase 1: Chunking
            on_progress(IndexProgress {
                phase: "chunking".to_string(),
                current: batch_idx + 1,
                total: total_batches,
                percent: ((batch_idx * 100) / total_batches.max(1)) as u8,
                message: Some(format!(
                    "正在分块处理文档 ({}/{})",
                    processed_docs, total_docs
                )),
            });

            for doc in batch {
                let content = std::fs::read_to_string(&doc.abs_path)?;
                if content.trim().is_empty() {
                    processed_docs += 1;
                    continue;
                }

                if doc.rel_path.starts_with(".ideas/") {
                    let entries = parse_idea_entries(&content);
                    for (i, entry) in entries.into_iter().enumerate() {
                        let entry_date = entry.created_at.get(0..10).unwrap_or("").to_string();
                        let title_line = entry
                            .content
                            .split('\n')
                            .next()
                            .unwrap_or("")
                            .trim()
                            .to_string();
                        let entry_content =
                            append_reference_summary(&entry.content, &doc_by_stable, &doc_by_path);
                        let id = format!("{}#{}", doc.rel_path, entry.id);
                        all_chunks.push(Chunk {
                            id,
                            file_path: doc.rel_path.clone(),
                            content: entry_content,
                            heading_path: String::new(),
                            section_title: if title_line.is_empty() {
                                None
                            } else {
                                Some(title_line)
                            },
                            doc_type: Some("idea".to_string()),
                            entry_id: Some(entry.id),
                            entry_date: if entry_date.is_empty() {
                                None
                            } else {
                                Some(entry_date)
                            },
                            entry_created_at: Some(entry.created_at),
                            chunk_index: i,
                            vector: vec![], // Will be filled below
                        });
                    }
                } else {
                    let text_chunks = self.chunker.chunk(&content, &doc.rel_path);

                    for (i, text_chunk) in text_chunks.into_iter().enumerate() {
                        let id = format!("{}#{}", doc.rel_path, i);
                        all_chunks.push(Chunk {
                            id,
                            file_path: doc.rel_path.clone(),
                            content: text_chunk.content,
                            heading_path: text_chunk.heading_path,
                            section_title: None,
                            doc_type: Some("doc".to_string()),
                            entry_id: None,
                            entry_date: None,
                            entry_created_at: None,
                            chunk_index: i,
                            vector: vec![], // Will be filled below
                        });
                    }
                }
                processed_docs += 1;
            }

            if all_chunks.is_empty() {
                continue;
            }

            // Phase 2: Embedding
            on_progress(IndexProgress {
                phase: "embedding".to_string(),
                current: batch_idx + 1,
                total: total_batches,
                percent: ((batch_idx * 100 + 33) / total_batches.max(1)) as u8,
                message: Some(format!("正在生成向量 ({} 个文本块)", all_chunks.len())),
            });

            let texts: Vec<String> = all_chunks.iter().map(|c| c.content.clone()).collect();
            let embeddings = self.embedding_client.embed(texts).await?;

            // After first embedding batch, verify dimensions match and re-init vector store if needed
            if !self.dimensions_verified {
                self.verify_dimensions().await?;
            }

            // Attach embeddings to chunks
            for (chunk, embedding) in all_chunks.iter_mut().zip(embeddings.into_iter()) {
                chunk.vector = embedding;
            }

            // Phase 3: Storing
            on_progress(IndexProgress {
                phase: "storing".to_string(),
                current: batch_idx + 1,
                total: total_batches,
                percent: ((batch_idx * 100 + 66) / total_batches.max(1)) as u8,
                message: Some("正在写入索引...".to_string()),
            });

            let count = self.vector_store.upsert(all_chunks).await?;
            total_chunks += count;
        }

        // Final progress
        on_progress(IndexProgress {
            phase: "done".to_string(),
            current: total_batches,
            total: total_batches,
            percent: 100,
            message: Some(format!(
                "索引构建完成！共 {} 个文档，{} 个文本块",
                total_docs, total_chunks
            )),
        });

        let elapsed_ms = start.elapsed().as_millis() as u64;

        Ok(IndexStats {
            total_docs,
            total_chunks,
            total_tokens: None,
            elapsed_ms,
            last_updated: Some(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            ),
        })
    }

    /// Index a single file
    pub async fn index_file(&mut self, rel_path: &str) -> SearchResult<usize> {
        let abs_path = self.contexts_root.join(rel_path);

        if !abs_path.exists() {
            return Err(SearchError::Index(format!("File not found: {}", rel_path)));
        }

        // Remove existing chunks for this file
        self.vector_store.delete_by_file(rel_path).await?;

        // Read and chunk the document
        let content = std::fs::read_to_string(&abs_path)?;
        if content.trim().is_empty() {
            return Ok(0);
        }

        let mut chunks = Vec::new();

        if rel_path.starts_with(".ideas/") {
            let entries = parse_idea_entries(&content);
            for (i, entry) in entries.into_iter().enumerate() {
                let entry_date = entry.created_at.get(0..10).unwrap_or("").to_string();
                let title_line = entry
                    .content
                    .split('\n')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let id = format!("{}#{}", rel_path, entry.id);
                chunks.push(Chunk {
                    id,
                    file_path: rel_path.to_string(),
                    content: entry.content,
                    heading_path: String::new(),
                    section_title: if title_line.is_empty() {
                        None
                    } else {
                        Some(title_line)
                    },
                    doc_type: Some("idea".to_string()),
                    entry_id: Some(entry.id),
                    entry_date: if entry_date.is_empty() {
                        None
                    } else {
                        Some(entry_date)
                    },
                    entry_created_at: Some(entry.created_at),
                    chunk_index: i,
                    vector: vec![],
                });
            }
        } else {
            let text_chunks = self.chunker.chunk(&content, rel_path);
            for (i, text_chunk) in text_chunks.into_iter().enumerate() {
                let id = format!("{}#{}", rel_path, i);
                chunks.push(Chunk {
                    id,
                    file_path: rel_path.to_string(),
                    content: text_chunk.content,
                    heading_path: text_chunk.heading_path,
                    section_title: None,
                    doc_type: Some("doc".to_string()),
                    entry_id: None,
                    entry_date: None,
                    entry_created_at: None,
                    chunk_index: i,
                    vector: vec![],
                });
            }
        }

        if chunks.is_empty() {
            return Ok(0);
        }

        // Generate embeddings
        let texts: Vec<String> = chunks.iter().map(|c| c.content.clone()).collect();
        let embeddings = self.embedding_client.embed(texts).await?;

        // Verify dimensions after getting embeddings
        if !self.dimensions_verified {
            self.verify_dimensions().await?;
        }

        for (chunk, embedding) in chunks.iter_mut().zip(embeddings.into_iter()) {
            chunk.vector = embedding;
        }

        // Store
        let count = self.vector_store.upsert(chunks).await?;
        Ok(count)
    }

    /// Remove a file from the index
    pub async fn remove_file(&mut self, rel_path: &str) -> SearchResult<()> {
        self.vector_store.delete_by_file(rel_path).await?;
        Ok(())
    }

    /// Update file path (for rename/move operations)
    pub async fn update_file_path(&mut self, old_path: &str, new_path: &str) -> SearchResult<()> {
        // For now, we simply remove old and re-index new
        self.remove_file(old_path).await?;

        let abs_path = self.contexts_root.join(new_path);
        if abs_path.exists() {
            self.index_file(new_path).await?;
        }

        Ok(())
    }

    /// Check if index exists
    pub async fn index_exists(&self) -> bool {
        self.vector_store.exists().await
    }

    /// Get index statistics
    pub async fn get_stats(&self) -> SearchResult<IndexStats> {
        let count = self.vector_store.count().await?;

        // Read lastUpdated from metadata file
        let metadata_path = self.config.paths.get_index_metadata_path();
        let last_updated = if metadata_path.exists() {
            std::fs::read_to_string(&metadata_path)
                .ok()
                .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
                .and_then(|v| v.get("lastUpdated").and_then(|v| v.as_u64()))
        } else {
            None
        };

        Ok(IndexStats {
            total_docs: 0, // We don't track this separately
            total_chunks: count,
            total_tokens: None,
            elapsed_ms: 0,
            last_updated,
        })
    }

    /// Clean the index
    pub async fn clean(&mut self) -> SearchResult<()> {
        self.vector_store.reset().await
    }

    /// Update index metadata with current timestamp
    pub fn update_metadata(&self) -> SearchResult<()> {
        let metadata_path = self.config.paths.get_index_metadata_path();

        // Read existing metadata or create new
        let mut metadata: serde_json::Value = if metadata_path.exists() {
            std::fs::read_to_string(&metadata_path)
                .ok()
                .and_then(|content| serde_json::from_str(&content).ok())
                .unwrap_or_else(|| serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        // Update lastUpdated timestamp
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        metadata["lastUpdated"] = serde_json::json!(now);

        // Ensure directory exists
        if let Some(parent) = metadata_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        std::fs::write(
            &metadata_path,
            serde_json::to_string_pretty(&metadata).unwrap_or_default(),
        )
        .map_err(|e| SearchError::Index(format!("Failed to write metadata: {}", e)))?;

        Ok(())
    }
}
