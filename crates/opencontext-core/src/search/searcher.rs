//! Search executor
//! Aligned with Node.js searcher.js implementation

use std::collections::{HashMap, HashSet};

use super::config::SearchConfig;
use super::embedding::EmbeddingClient;
use super::error::SearchResult;
use super::types::{AggregateBy, MatchType, SearchHit, SearchMode, SearchOptions, SearchResults};
use super::vector_store::VectorStore;

/// RRF constant, typically 60
const RRF_K: f32 = 60.0;

/// Vector search weight in hybrid mode
const VECTOR_WEIGHT: f32 = 0.7;

/// Keyword search weight in hybrid mode  
const KEYWORD_WEIGHT: f32 = 0.3;

/// Search executor
pub struct Searcher {
    #[allow(dead_code)]
    config: SearchConfig,
    vector_store: VectorStore,
    embedding_client: EmbeddingClient,
    /// All chunks for keyword search (loaded on init)
    all_chunks: Vec<SearchHit>,
}

impl Searcher {
    /// Create a new searcher
    pub async fn new(config: SearchConfig) -> SearchResult<Self> {
        let lancedb_path = config.paths.get_lancedb_path();
        let dimensions = config.embedding.dimensions;

        let mut vector_store = VectorStore::new(lancedb_path, dimensions);
        vector_store.initialize().await?;

        let embedding_client = EmbeddingClient::new(config.embedding.clone())?;

        // Load all chunks for keyword search
        let all_chunks = vector_store.get_all_chunks().await.unwrap_or_default();

        Ok(Self {
            config,
            vector_store,
            embedding_client,
            all_chunks,
        })
    }

    /// Execute a search
    pub async fn search(&self, options: SearchOptions) -> SearchResult<SearchResults> {
        let query = options.query.trim();

        if query.is_empty() {
            return Ok(SearchResults::empty(query.to_string()));
        }

        // Check if index exists
        if !self.vector_store.exists().await {
            return Ok(SearchResults::index_not_built(query.to_string()));
        }

        let limit = options.limit();
        let mode = options.mode();
        let aggregate_by = options.aggregate_by();

        // For aggregation, get more candidates
        let search_limit = if aggregate_by == AggregateBy::Content {
            limit
        } else {
            limit * 5
        };

        // Execute search based on mode
        let hits = match mode {
            SearchMode::Vector => self.vector_search(query, search_limit).await?,
            SearchMode::Keyword => self.keyword_search(query, search_limit),
            SearchMode::Hybrid => self.hybrid_search(query, search_limit).await?,
        };

        // Aggregate results
        let results = match aggregate_by {
            AggregateBy::Content => hits.into_iter().take(limit).collect(),
            AggregateBy::Doc => self.aggregate_by_doc(hits, limit),
            AggregateBy::Folder => self.aggregate_by_folder(hits, limit),
        };

        // Convert mode and aggregate_by to strings for response
        let mode_str = match mode {
            SearchMode::Vector => "vector",
            SearchMode::Keyword => "keyword",
            SearchMode::Hybrid => "hybrid",
        };
        let aggregate_str = match aggregate_by {
            AggregateBy::Content => "content",
            AggregateBy::Doc => "doc",
            AggregateBy::Folder => "folder",
        };

        Ok(SearchResults {
            query: query.to_string(),
            count: results.len(),
            results,
            mode: Some(mode_str.to_string()),
            aggregate_by: Some(aggregate_str.to_string()),
            index_missing: None,
            error: None,
        })
    }

    /// Perform vector search
    async fn vector_search(&self, query: &str, limit: usize) -> SearchResult<Vec<SearchHit>> {
        // Generate query embedding
        let query_vector = self.embedding_client.embed_one(query).await?;

        // Search vector store
        let mut results = self.vector_store.search(&query_vector, limit).await?;

        // Mark as vector match
        for hit in &mut results {
            hit.matched_by = MatchType::Vector;
        }

        Ok(results)
    }

    /// Perform keyword search using BM25 algorithm
    /// Matches Node.js KeywordSearcher implementation
    fn keyword_search(&self, query: &str, limit: usize) -> Vec<SearchHit> {
        // BM25 parameters (same as Node.js)
        const K1: f32 = 1.2; // Term frequency saturation parameter
        const B: f32 = 0.75; // Document length normalization parameter

        let query_tokens = Self::tokenize(query);

        if query_tokens.is_empty() || self.all_chunks.is_empty() {
            return vec![];
        }

        // Pre-compute document statistics
        let total_docs = self.all_chunks.len();

        // Tokenize all documents and compute stats
        let doc_data: Vec<(Vec<String>, HashMap<String, usize>, usize)> = self
            .all_chunks
            .iter()
            .map(|chunk| {
                let combined = format!(
                    "{} {}",
                    chunk.content,
                    chunk.heading_path.as_deref().unwrap_or("")
                );
                let tokens = Self::tokenize(&combined);
                let token_freq = Self::count_tokens(&tokens);
                let length = tokens.len();
                (tokens, token_freq, length)
            })
            .collect();

        // Calculate average document length
        let total_length: usize = doc_data.iter().map(|(_, _, len)| len).sum();
        let avg_doc_length = if total_docs > 0 {
            total_length as f32 / total_docs as f32
        } else {
            1.0
        };

        // Calculate document frequency for query terms
        let mut doc_frequency: HashMap<String, usize> = HashMap::new();
        for token in &query_tokens {
            let df = doc_data
                .iter()
                .filter(|(_, freq, _)| freq.contains_key(token))
                .count();
            doc_frequency.insert(token.clone(), df);
        }

        // Score each document using BM25
        let mut scored_hits: Vec<(f32, SearchHit)> = self
            .all_chunks
            .iter()
            .zip(doc_data.iter())
            .filter_map(|(chunk, (_, token_freq, doc_length))| {
                let mut score = 0.0f32;

                for term in &query_tokens {
                    let tf = *token_freq.get(term).unwrap_or(&0) as f32;
                    if tf == 0.0 {
                        continue;
                    }

                    let df = *doc_frequency.get(term).unwrap_or(&0) as f32;
                    if df == 0.0 {
                        continue;
                    }

                    // IDF calculation: log((N - df + 0.5) / (df + 0.5) + 1)
                    let idf = ((total_docs as f32 - df + 0.5) / (df + 0.5) + 1.0).ln();

                    // TF normalization with document length
                    let tf_norm = (tf * (K1 + 1.0))
                        / (tf + K1 * (1.0 - B + B * (*doc_length as f32 / avg_doc_length)));

                    score += idf * tf_norm;
                }

                if score > 0.0 {
                    let mut hit = chunk.clone();
                    hit.score = score;
                    hit.matched_by = MatchType::Keyword;
                    Some((score, hit))
                } else {
                    None
                }
            })
            .collect();

        // Sort by score descending
        scored_hits.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        // Normalize scores to 0-1 range (same as Node.js)
        let max_score = scored_hits.first().map(|(s, _)| *s).unwrap_or(1.0);

        scored_hits
            .into_iter()
            .take(limit)
            .map(|(score, mut hit)| {
                hit.score = if max_score > 0.0 {
                    score / max_score
                } else {
                    0.0
                };
                hit
            })
            .collect()
    }

    /// Tokenize text (matches Node.js implementation)
    /// Supports Chinese (character-level + 2-gram) and English
    fn tokenize(text: &str) -> Vec<String> {
        if text.is_empty() {
            return vec![];
        }

        let normalized = text.to_lowercase();
        let mut tokens = Vec::new();

        // Regex-like matching for Chinese, English words, and numbers
        let mut current_english = String::new();
        let mut current_chinese = String::new();

        for c in normalized.chars() {
            if c.is_ascii_alphanumeric() {
                // Flush Chinese if any
                if !current_chinese.is_empty() {
                    Self::add_chinese_tokens(&current_chinese, &mut tokens);
                    current_chinese.clear();
                }
                current_english.push(c);
            } else if Self::is_chinese_char(c) {
                // Flush English if any
                if !current_english.is_empty() {
                    if current_english.len() >= 2 {
                        tokens.push(current_english.clone());
                    }
                    current_english.clear();
                }
                current_chinese.push(c);
            } else {
                // Non-alphanumeric, non-Chinese - flush both
                if !current_english.is_empty() {
                    if current_english.len() >= 2 {
                        tokens.push(current_english.clone());
                    }
                    current_english.clear();
                }
                if !current_chinese.is_empty() {
                    Self::add_chinese_tokens(&current_chinese, &mut tokens);
                    current_chinese.clear();
                }
            }
        }

        // Flush remaining
        if !current_english.is_empty() && current_english.len() >= 2 {
            tokens.push(current_english);
        }
        if !current_chinese.is_empty() {
            Self::add_chinese_tokens(&current_chinese, &mut tokens);
        }

        tokens
    }

    /// Check if character is Chinese
    fn is_chinese_char(c: char) -> bool {
        // Common Chinese Unicode range
        ('\u{4e00}'..='\u{9fff}').contains(&c)
    }

    /// Add Chinese tokens (character-level + 2-gram)
    fn add_chinese_tokens(text: &str, tokens: &mut Vec<String>) {
        let chars: Vec<char> = text.chars().collect();
        for i in 0..chars.len() {
            // Single character
            tokens.push(chars[i].to_string());
            // 2-gram
            if i < chars.len() - 1 {
                tokens.push(format!("{}{}", chars[i], chars[i + 1]));
            }
        }
    }

    /// Count token frequency
    fn count_tokens(tokens: &[String]) -> HashMap<String, usize> {
        let mut freq = HashMap::new();
        for token in tokens {
            *freq.entry(token.clone()).or_insert(0) += 1;
        }
        freq
    }

    /// Perform hybrid search using RRF (Reciprocal Rank Fusion)
    async fn hybrid_search(&self, query: &str, limit: usize) -> SearchResult<Vec<SearchHit>> {
        let candidate_limit = limit * 3;

        // Execute both searches
        let vector_results = self.vector_search(query, candidate_limit).await?;
        let keyword_results = self.keyword_search(query, candidate_limit);

        // Use RRF to fuse results
        let fused = self.rrf_fusion(vector_results, keyword_results, limit);

        Ok(fused)
    }

    /// Reciprocal Rank Fusion (RRF) algorithm
    /// RRF(d) = Σ weight / (k + rank(d))
    fn rrf_fusion(
        &self,
        vector_results: Vec<SearchHit>,
        keyword_results: Vec<SearchHit>,
        limit: usize,
    ) -> Vec<SearchHit> {
        // Key: file_path:line_start (or file_path:0 if no line_start)
        struct FusedEntry {
            score: f32,
            hit: SearchHit,
            sources: Vec<&'static str>,
        }

        let mut scores: HashMap<String, FusedEntry> = HashMap::new();

        // Process vector search results
        for (index, hit) in vector_results.into_iter().enumerate() {
            let key = format!("{}:{}", hit.file_path, hit.line_start.unwrap_or(0));
            let rrf_score = VECTOR_WEIGHT / (RRF_K + index as f32 + 1.0);

            if let Some(entry) = scores.get_mut(&key) {
                entry.score += rrf_score;
                entry.sources.push("vector");
            } else {
                scores.insert(
                    key,
                    FusedEntry {
                        score: rrf_score,
                        hit: SearchHit {
                            matched_by: MatchType::Hybrid,
                            ..hit
                        },
                        sources: vec!["vector"],
                    },
                );
            }
        }

        // Process keyword search results
        for (index, hit) in keyword_results.into_iter().enumerate() {
            let key = format!("{}:{}", hit.file_path, hit.line_start.unwrap_or(0));
            let rrf_score = KEYWORD_WEIGHT / (RRF_K + index as f32 + 1.0);

            if let Some(entry) = scores.get_mut(&key) {
                entry.score += rrf_score;
                entry.sources.push("keyword");
            } else {
                scores.insert(
                    key,
                    FusedEntry {
                        score: rrf_score,
                        hit: SearchHit {
                            matched_by: MatchType::Hybrid,
                            ..hit
                        },
                        sources: vec!["keyword"],
                    },
                );
            }
        }

        // Convert to results and sort
        let mut results: Vec<SearchHit> = scores
            .into_values()
            .map(|entry| {
                let matched_by = if entry.sources.len() > 1 {
                    MatchType::Hybrid // vector+keyword
                } else if entry.sources.contains(&"vector") {
                    MatchType::Vector
                } else {
                    MatchType::Keyword
                };
                SearchHit {
                    score: entry.score,
                    matched_by,
                    ..entry.hit
                }
            })
            .collect();

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(limit);
        results
    }

    /// Aggregate results by document
    /// Uses weighted score formula matching Node.js:
    /// score = topScore * 0.6 + min(hitCount/5, 1) * topScore * 0.4
    fn aggregate_by_doc(&self, hits: Vec<SearchHit>, limit: usize) -> Vec<SearchHit> {
        struct DocAgg {
            file_path: String,
            display_name: String,
            top_score: f32,
            hit_count: usize,
            top_chunk: SearchHit,
        }

        let mut doc_map: HashMap<String, DocAgg> = HashMap::new();

        for hit in hits {
            let display_name = hit
                .file_path
                .split('/')
                .last()
                .unwrap_or(&hit.file_path)
                .trim_end_matches(".md")
                .to_string();

            let entry = doc_map
                .entry(hit.file_path.clone())
                .or_insert_with(|| DocAgg {
                    file_path: hit.file_path.clone(),
                    display_name: display_name.clone(),
                    top_score: 0.0,
                    hit_count: 0,
                    top_chunk: hit.clone(),
                });

            entry.hit_count += 1;

            // Update with best chunk
            if hit.score > entry.top_score {
                entry.top_score = hit.score;
                entry.top_chunk = hit;
            }
        }

        // Calculate aggregated scores and build results
        let mut results: Vec<SearchHit> = doc_map
            .into_values()
            .map(|doc| {
                // Aggregated score: weighted combination of top score and hit count
                // score = topScore * 0.6 + min(hitCount/5, 1) * topScore * 0.4
                let hit_bonus = (doc.hit_count as f32 / 5.0).min(1.0);
                let aggregated_score = doc.top_score * 0.6 + hit_bonus * doc.top_score * 0.4;

                SearchHit {
                    file_path: doc.file_path,
                    display_name: doc.display_name,
                    content: doc.top_chunk.content,
                    heading_path: doc.top_chunk.heading_path,
                    section_title: doc.top_chunk.section_title,
                    line_start: doc.top_chunk.line_start,
                    line_end: doc.top_chunk.line_end,
                    score: aggregated_score,
                    matched_by: doc.top_chunk.matched_by,
                    hit_count: Some(doc.hit_count),
                    doc_count: None,
                    folder_path: None,
                    aggregate_type: Some("doc".to_string()),
                }
            })
            .collect();

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(limit);
        results
    }

    /// Aggregate results by folder
    /// Uses weighted score formula matching Node.js:
    /// score = topScore * 0.5 + min(hitCount/10, 1) * topScore * 0.3 + min(docCount/3, 1) * topScore * 0.2
    fn aggregate_by_folder(&self, hits: Vec<SearchHit>, limit: usize) -> Vec<SearchHit> {
        struct FolderAgg {
            folder_path: String,
            display_name: String,
            top_score: f32,
            hit_count: usize,
            docs: HashSet<String>,
            top_chunk: SearchHit,
        }

        let mut folder_map: HashMap<String, FolderAgg> = HashMap::new();

        for hit in hits {
            let folder_path = hit
                .file_path
                .rsplit_once('/')
                .map(|(folder, _)| folder.to_string())
                .unwrap_or_else(|| ".".to_string());

            let display_name = if folder_path == "." {
                "(root)".to_string()
            } else {
                folder_path
                    .split('/')
                    .last()
                    .unwrap_or(&folder_path)
                    .to_string()
            };

            let entry = folder_map
                .entry(folder_path.clone())
                .or_insert_with(|| FolderAgg {
                    folder_path: folder_path.clone(),
                    display_name,
                    top_score: 0.0,
                    hit_count: 0,
                    docs: HashSet::new(),
                    top_chunk: hit.clone(),
                });

            entry.hit_count += 1;
            entry.docs.insert(hit.file_path.clone());

            if hit.score > entry.top_score {
                entry.top_score = hit.score;
                entry.top_chunk = hit;
            }
        }

        // Calculate aggregated scores and build results
        let mut results: Vec<SearchHit> = folder_map
            .into_values()
            .map(|folder| {
                // Aggregated score: weighted combination
                // score = topScore * 0.5 + min(hitCount/10, 1) * topScore * 0.3 + min(docCount/3, 1) * topScore * 0.2
                let hit_bonus = (folder.hit_count as f32 / 10.0).min(1.0);
                let doc_bonus = (folder.docs.len() as f32 / 3.0).min(1.0);
                let aggregated_score = folder.top_score * 0.5
                    + hit_bonus * folder.top_score * 0.3
                    + doc_bonus * folder.top_score * 0.2;

                SearchHit {
                    file_path: folder.top_chunk.file_path,
                    display_name: folder.display_name,
                    content: folder.top_chunk.content,
                    heading_path: folder.top_chunk.heading_path,
                    section_title: folder.top_chunk.section_title,
                    line_start: folder.top_chunk.line_start,
                    line_end: folder.top_chunk.line_end,
                    score: aggregated_score,
                    matched_by: folder.top_chunk.matched_by,
                    hit_count: Some(folder.hit_count),
                    doc_count: Some(folder.docs.len()),
                    folder_path: Some(folder.folder_path),
                    aggregate_type: Some("folder".to_string()),
                }
            })
            .collect();

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(limit);
        results
    }

    /// Check if index is built
    pub async fn index_exists(&self) -> bool {
        self.vector_store.exists().await
    }
}
