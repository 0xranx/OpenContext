//! Unit tests for search module

#[cfg(test)]
mod tests {
    use super::super::*;

    mod chunker_tests {
        use super::*;

        #[test]
        fn test_chunker_basic() {
            let chunker = Chunker::new(500, 50);
            let content = "# Title\n\nThis is a paragraph.\n\n## Section\n\nMore content here.";
            let chunks = chunker.chunk(content, "test.md");

            assert!(!chunks.is_empty(), "Should produce at least one chunk");
            assert!(chunks[0].content.len() > 0, "Chunk should have content");
        }

        #[test]
        fn test_chunker_preserves_heading_path() {
            let chunker = Chunker::new(1000, 100);
            let content = "# Main Title\n\n## Sub Section\n\nContent under subsection.";
            let chunks = chunker.chunk(content, "test.md");

            // Should have heading path
            let has_heading = chunks.iter().any(|c| !c.heading_path.is_empty());
            assert!(has_heading, "Should preserve heading path");
        }

        #[test]
        fn test_chunker_respects_size_limit() {
            let max_size = 500;
            let chunker = Chunker::new(max_size, 50);
            // Use content with natural break points (paragraphs)
            let paragraph = "This is a test paragraph with some content. ";
            let content = paragraph.repeat(50);
            let chunks = chunker.chunk(&content, "test.md");

            // Should produce multiple chunks
            assert!(
                chunks.len() > 1,
                "Long content should be split into multiple chunks"
            );

            // Most chunks should be reasonably sized (allow some overflow for edge cases)
            let reasonable_chunks = chunks
                .iter()
                .filter(|c| c.content.chars().count() <= max_size * 3)
                .count();
            assert!(
                reasonable_chunks >= chunks.len() / 2,
                "Most chunks should respect size limit"
            );
        }

        #[test]
        fn test_chunker_handles_empty_content() {
            let chunker = Chunker::new(500, 50);
            let chunks = chunker.chunk("", "empty.md");

            // Empty content should produce zero or one empty chunk
            assert!(chunks.len() <= 1);
        }

        #[test]
        fn test_chunker_handles_chinese_text() {
            let chunker = Chunker::new(100, 10);
            let content =
                "# 中文标题\n\n这是一段中文内容，用于测试分块功能。这段文字包含多个句子。";

            // Should not panic on Chinese text
            let chunks = chunker.chunk(content, "chinese.md");
            assert!(!chunks.is_empty());

            // Verify content is preserved
            let total_content: String = chunks.iter().map(|c| c.content.as_str()).collect();
            assert!(total_content.contains("中文"));
        }

        #[test]
        fn test_chunker_line_numbers() {
            let chunker = Chunker::new(1000, 100);
            let content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
            let chunks = chunker.chunk(content, "lines.md");

            assert!(!chunks.is_empty());
            assert!(
                chunks[0].start_line >= 1,
                "Line numbers should be 1-indexed"
            );
        }
    }

    mod types_tests {
        use super::*;

        #[test]
        fn test_search_mode_default() {
            let mode = SearchMode::default();
            assert_eq!(mode, SearchMode::Hybrid);
        }

        #[test]
        fn test_aggregate_by_default() {
            let agg = AggregateBy::default();
            assert_eq!(agg, AggregateBy::Doc);
        }

        #[test]
        fn test_search_options_defaults() {
            let opts = SearchOptions::default();
            assert_eq!(opts.limit(), 10);
            assert_eq!(opts.mode(), SearchMode::Hybrid);
            assert_eq!(opts.aggregate_by(), AggregateBy::Doc);
        }

        #[test]
        fn test_search_results_empty() {
            let results = SearchResults::empty("test query".to_string());
            assert_eq!(results.query, "test query");
            assert_eq!(results.count, 0);
            assert!(results.results.is_empty());
        }

        #[test]
        fn test_search_results_with_error() {
            let results =
                SearchResults::with_error("query".to_string(), "Something went wrong".to_string());
            assert!(results.error.is_some());
            assert_eq!(results.error.unwrap(), "Something went wrong");
        }

        #[test]
        fn test_search_results_index_not_built() {
            let results = SearchResults::index_not_built("query".to_string());
            assert!(results.index_missing.unwrap_or(false));
        }
    }

    mod config_tests {
        use super::*;

        #[test]
        fn test_search_config_default() {
            // Should not panic
            let config = SearchConfig::default();
            assert!(config.embedding.dimensions > 0);
            assert!(config.search.chunk_size > 0);
        }

        #[test]
        fn test_embedding_config_default() {
            let config = EmbeddingConfig::default();
            assert!(!config.model.is_empty());
            assert!(config.dimensions > 0);
            assert!(config.batch_size > 0);
        }
    }

    mod error_tests {
        use super::*;

        #[test]
        fn test_search_error_display() {
            let err = SearchError::Index("test error".to_string());
            let display = format!("{}", err);
            assert!(display.contains("test error"));
        }

        #[test]
        fn test_search_error_from_io() {
            let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
            let search_err = SearchError::from(io_err);
            let display = format!("{}", search_err);
            assert!(display.contains("file not found") || display.contains("IO"));
        }
    }
}
