//! LanceDB vector store

use std::path::PathBuf;
use std::sync::Arc;

use arrow_array::{
    types::Float32Type, FixedSizeListArray, RecordBatch, RecordBatchIterator, StringArray,
    UInt32Array,
};
use arrow_schema::{DataType, Field, Schema};
use futures::TryStreamExt;
use lancedb::query::{ExecutableQuery, QueryBase};
use lancedb::{connect, Connection, Table};

use super::error::{SearchError, SearchResult};
use super::types::{Chunk, MatchType, SearchHit};

const TABLE_NAME: &str = "chunks";

/// LanceDB vector store for semantic search
pub struct VectorStore {
    db_path: PathBuf,
    dimensions: usize,
    db: Option<Connection>,
    table: Option<Table>,
}

impl VectorStore {
    /// Create a new vector store
    pub fn new(db_path: PathBuf, dimensions: usize) -> Self {
        Self {
            db_path,
            dimensions,
            db: None,
            table: None,
        }
    }

    /// Initialize the database connection
    pub async fn initialize(&mut self) -> SearchResult<()> {
        // Create directory if it doesn't exist
        if let Some(parent) = self.db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let db = connect(self.db_path.to_string_lossy().as_ref())
            .execute()
            .await
            .map_err(SearchError::Lance)?;

        self.db = Some(db);

        // Try to open existing table
        if let Some(ref db) = self.db {
            let table_names = db
                .table_names()
                .execute()
                .await
                .map_err(SearchError::Lance)?;
            if table_names.contains(&TABLE_NAME.to_string()) {
                let table = db
                    .open_table(TABLE_NAME)
                    .execute()
                    .await
                    .map_err(SearchError::Lance)?;
                self.table = Some(table);
            }
        }

        Ok(())
    }

    /// Check if index exists
    pub async fn exists(&self) -> bool {
        self.table.is_some()
    }

    /// Create the table schema
    fn create_schema(&self) -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new("id", DataType::Utf8, false),
            Field::new("file_path", DataType::Utf8, false),
            Field::new("content", DataType::Utf8, false),
            Field::new("heading_path", DataType::Utf8, false),
            Field::new("chunk_index", DataType::UInt32, false),
            Field::new(
                "vector",
                DataType::FixedSizeList(
                    Arc::new(Field::new("item", DataType::Float32, true)),
                    self.dimensions as i32,
                ),
                false,
            ),
        ]))
    }

    /// Insert or update chunks
    pub async fn upsert(&mut self, chunks: Vec<Chunk>) -> SearchResult<usize> {
        if chunks.is_empty() {
            return Ok(0);
        }

        let db = self
            .db
            .as_ref()
            .ok_or_else(|| SearchError::VectorStore("Database not initialized".to_string()))?;

        let schema = self.create_schema();
        let batch = self.chunks_to_batch(&chunks, schema.clone())?;
        let count = batch.num_rows();

        // Wrap in iterator
        let batches = RecordBatchIterator::new(vec![Ok(batch)], schema.clone());

        if self.table.is_none() {
            // Create new table
            let table = db
                .create_table(TABLE_NAME, Box::new(batches))
                .execute()
                .await
                .map_err(SearchError::Lance)?;
            self.table = Some(table);
        } else {
            // Add to existing table
            let table = self.table.as_ref().unwrap();
            table
                .add(Box::new(batches))
                .execute()
                .await
                .map_err(SearchError::Lance)?;
        }

        Ok(count)
    }

    /// Convert chunks to Arrow RecordBatch
    fn chunks_to_batch(&self, chunks: &[Chunk], schema: Arc<Schema>) -> SearchResult<RecordBatch> {
        let ids: Vec<&str> = chunks.iter().map(|c| c.id.as_str()).collect();
        let file_paths: Vec<&str> = chunks.iter().map(|c| c.file_path.as_str()).collect();
        let contents: Vec<&str> = chunks.iter().map(|c| c.content.as_str()).collect();
        let heading_paths: Vec<&str> = chunks.iter().map(|c| c.heading_path.as_str()).collect();
        let chunk_indices: Vec<u32> = chunks.iter().map(|c| c.chunk_index as u32).collect();

        let vectors_array = FixedSizeListArray::from_iter_primitive::<Float32Type, _, _>(
            chunks
                .iter()
                .map(|c| Some(c.vector.iter().copied().map(Some).collect::<Vec<_>>())),
            self.dimensions as i32,
        );

        let batch = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(StringArray::from(ids)),
                Arc::new(StringArray::from(file_paths)),
                Arc::new(StringArray::from(contents)),
                Arc::new(StringArray::from(heading_paths)),
                Arc::new(UInt32Array::from(chunk_indices)),
                Arc::new(vectors_array),
            ],
        )
        .map_err(|e| SearchError::VectorStore(e.to_string()))?;

        Ok(batch)
    }

    /// Search for similar vectors
    pub async fn search(&self, query_vector: &[f32], limit: usize) -> SearchResult<Vec<SearchHit>> {
        let table = self.table.as_ref().ok_or(SearchError::IndexNotBuilt)?;

        let results = table
            .vector_search(query_vector.to_vec())
            .map_err(SearchError::Lance)?
            .limit(limit)
            .execute()
            .await
            .map_err(SearchError::Lance)?
            .try_collect::<Vec<_>>()
            .await
            .map_err(SearchError::Lance)?;

        let mut hits = Vec::new();

        for batch in results {
            let file_paths = batch
                .column_by_name("file_path")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>())
                .ok_or_else(|| SearchError::VectorStore("Missing file_path column".to_string()))?;

            let contents = batch
                .column_by_name("content")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>())
                .ok_or_else(|| SearchError::VectorStore("Missing content column".to_string()))?;

            let heading_paths = batch
                .column_by_name("heading_path")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>())
                .ok_or_else(|| {
                    SearchError::VectorStore("Missing heading_path column".to_string())
                })?;

            // Try to get optional columns that may exist in Node.js-built indexes
            let section_titles = batch
                .column_by_name("section_title")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>());

            let line_starts = batch
                .column_by_name("line_start")
                .and_then(|c| c.as_any().downcast_ref::<arrow_array::Int64Array>());

            let line_ends = batch
                .column_by_name("line_end")
                .and_then(|c| c.as_any().downcast_ref::<arrow_array::Int64Array>());

            // LanceDB returns _distance column for vector search
            let distances = batch
                .column_by_name("_distance")
                .and_then(|c| c.as_any().downcast_ref::<arrow_array::Float32Array>());

            for i in 0..batch.num_rows() {
                let file_path = file_paths.value(i).to_string();
                let display_name = file_path
                    .split('/')
                    .last()
                    .unwrap_or(&file_path)
                    .trim_end_matches(".md")
                    .to_string();

                let heading_path = heading_paths.value(i);
                let heading_path = if heading_path.is_empty() {
                    None
                } else {
                    Some(heading_path.to_string())
                };

                // Get optional fields from Node.js-built index
                let section_title = section_titles.and_then(|arr| {
                    let val = arr.value(i);
                    if val.is_empty() {
                        None
                    } else {
                        Some(val.to_string())
                    }
                });

                let line_start = line_starts.map(|arr| arr.value(i) as usize);
                let line_end = line_ends.map(|arr| arr.value(i) as usize);

                // Convert distance to similarity score
                // Use same formula as Node.js: score = 1 / (1 + distance)
                // This ensures score is always in (0, 1] range
                let score = distances
                    .map(|d| 1.0 / (1.0 + d.value(i).max(0.0)))
                    .unwrap_or(0.5);

                hits.push(SearchHit {
                    file_path,
                    display_name,
                    content: contents.value(i).to_string(),
                    heading_path,
                    section_title,
                    line_start,
                    line_end,
                    score,
                    matched_by: MatchType::Vector,
                    hit_count: None,
                    doc_count: None,
                    folder_path: None,
                    aggregate_type: None,
                });
            }
        }

        Ok(hits)
    }

    /// Delete chunks by file path
    pub async fn delete_by_file(&self, file_path: &str) -> SearchResult<usize> {
        let table = match self.table.as_ref() {
            Some(t) => t,
            None => return Ok(0),
        };

        // Use delete with filter
        table
            .delete(&format!("file_path = '{}'", file_path.replace('\'', "''")))
            .await
            .map_err(SearchError::Lance)?;

        // LanceDB delete doesn't return count, so we return 0
        Ok(0)
    }

    /// Reset the index (delete all data)
    pub async fn reset(&mut self) -> SearchResult<()> {
        let db = self
            .db
            .as_ref()
            .ok_or_else(|| SearchError::VectorStore("Database not initialized".to_string()))?;

        // Drop and recreate table
        if self.table.is_some() {
            db.drop_table(TABLE_NAME)
                .await
                .map_err(SearchError::Lance)?;
            self.table = None;
        }

        Ok(())
    }

    /// Get total chunk count
    pub async fn count(&self) -> SearchResult<usize> {
        let table = match self.table.as_ref() {
            Some(t) => t,
            None => return Ok(0),
        };

        let count = table.count_rows(None).await.map_err(SearchError::Lance)?;
        Ok(count)
    }

    /// Get all chunks (for keyword search)
    pub async fn get_all_chunks(&self) -> SearchResult<Vec<SearchHit>> {
        let table = match self.table.as_ref() {
            Some(t) => t,
            None => return Ok(vec![]),
        };

        let results = table
            .query()
            .execute()
            .await
            .map_err(SearchError::Lance)?
            .try_collect::<Vec<_>>()
            .await
            .map_err(SearchError::Lance)?;

        let mut hits = Vec::new();

        for batch in results {
            let file_paths = match batch
                .column_by_name("file_path")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>())
            {
                Some(arr) => arr,
                None => continue,
            };

            let contents = match batch
                .column_by_name("content")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>())
            {
                Some(arr) => arr,
                None => continue,
            };

            let heading_paths = batch
                .column_by_name("heading_path")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>());

            let section_titles = batch
                .column_by_name("section_title")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>());

            let line_starts = batch
                .column_by_name("line_start")
                .and_then(|c| c.as_any().downcast_ref::<arrow_array::Int64Array>());

            let line_ends = batch
                .column_by_name("line_end")
                .and_then(|c| c.as_any().downcast_ref::<arrow_array::Int64Array>());

            for i in 0..batch.num_rows() {
                let file_path = file_paths.value(i).to_string();
                let display_name = file_path
                    .split('/')
                    .last()
                    .unwrap_or(&file_path)
                    .trim_end_matches(".md")
                    .to_string();

                let heading_path = heading_paths.and_then(|arr| {
                    let val = arr.value(i);
                    if val.is_empty() {
                        None
                    } else {
                        Some(val.to_string())
                    }
                });

                let section_title = section_titles.and_then(|arr| {
                    let val = arr.value(i);
                    if val.is_empty() {
                        None
                    } else {
                        Some(val.to_string())
                    }
                });

                let line_start = line_starts.map(|arr| arr.value(i) as usize);
                let line_end = line_ends.map(|arr| arr.value(i) as usize);

                hits.push(SearchHit {
                    file_path,
                    display_name,
                    content: contents.value(i).to_string(),
                    heading_path,
                    section_title,
                    line_start,
                    line_end,
                    score: 0.0,
                    matched_by: MatchType::Keyword,
                    hit_count: None,
                    doc_count: None,
                    folder_path: None,
                    aggregate_type: None,
                });
            }
        }

        Ok(hits)
    }
}
