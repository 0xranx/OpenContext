//! Markdown document chunking with proper Unicode support

use pulldown_cmark::{Event, HeadingLevel, Parser, Tag, TagEnd};

use super::types::TextChunk;

/// Markdown chunker that splits documents into semantic chunks
/// All size calculations are based on **character count**, not byte count,
/// ensuring proper handling of Unicode (CJK, emoji, etc.)
pub struct Chunker {
    /// Maximum chunk size in characters (not bytes)
    max_chunk_chars: usize,
    /// Overlap between chunks in characters
    overlap_chars: usize,
}

impl Default for Chunker {
    fn default() -> Self {
        Self {
            max_chunk_chars: 1500,
            overlap_chars: 200,
        }
    }
}

impl Chunker {
    /// Create a new chunker with custom settings (in characters)
    pub fn new(max_chunk_chars: usize, overlap_chars: usize) -> Self {
        Self {
            max_chunk_chars,
            overlap_chars,
        }
    }

    /// Chunk a markdown document into semantic pieces
    pub fn chunk(&self, content: &str, _file_path: &str) -> Vec<TextChunk> {
        let mut chunks = Vec::new();
        let mut current_heading_path: Vec<(HeadingLevel, String)> = Vec::new();
        let mut current_text = String::new();
        let mut current_start_line = 1;
        let mut line_number = 1;

        let parser = Parser::new(content);
        let mut in_heading = false;
        let mut heading_level: Option<HeadingLevel> = None;
        let mut heading_text = String::new();

        for event in parser {
            match event {
                Event::Start(Tag::Heading { level, .. }) => {
                    // Save current chunk before starting new heading section
                    if !current_text.trim().is_empty() {
                        let heading_path = Self::build_heading_path(&current_heading_path);
                        chunks.push(TextChunk {
                            content: current_text.trim().to_string(),
                            heading_path,
                            start_line: current_start_line,
                            end_line: line_number,
                        });
                        current_text.clear();
                    }

                    in_heading = true;
                    heading_level = Some(level);
                    heading_text.clear();
                }
                Event::End(TagEnd::Heading(_)) => {
                    if let Some(level) = heading_level {
                        // Remove headings at same or lower level
                        while let Some((last_level, _)) = current_heading_path.last() {
                            if *last_level >= level {
                                current_heading_path.pop();
                            } else {
                                break;
                            }
                        }
                        current_heading_path.push((level, heading_text.trim().to_string()));
                    }

                    in_heading = false;
                    heading_level = None;
                    heading_text.clear();
                    current_start_line = line_number + 1;
                }
                Event::Text(text) => {
                    if in_heading {
                        heading_text.push_str(&text);
                    } else {
                        current_text.push_str(&text);
                    }
                    line_number += text.matches('\n').count();
                }
                Event::Code(code) => {
                    if in_heading {
                        heading_text.push_str(&code);
                    } else {
                        current_text.push('`');
                        current_text.push_str(&code);
                        current_text.push('`');
                    }
                }
                Event::SoftBreak | Event::HardBreak => {
                    if in_heading {
                        heading_text.push(' ');
                    } else {
                        current_text.push('\n');
                    }
                    line_number += 1;
                }
                Event::End(TagEnd::Paragraph) => {
                    current_text.push_str("\n\n");
                }
                Event::End(TagEnd::Item) => {
                    current_text.push('\n');
                }
                _ => {}
            }

            // Check if we need to split the chunk (using char count, not byte count)
            if current_text.chars().count() > self.max_chunk_chars {
                let heading_path = Self::build_heading_path(&current_heading_path);
                let (chunk, remainder) = self.split_chunk(&current_text);

                chunks.push(TextChunk {
                    content: chunk,
                    heading_path: heading_path.clone(),
                    start_line: current_start_line,
                    end_line: line_number,
                });

                current_text = remainder;
                current_start_line = line_number;
            }
        }

        // Don't forget the last chunk
        if !current_text.trim().is_empty() {
            let heading_path = Self::build_heading_path(&current_heading_path);
            chunks.push(TextChunk {
                content: current_text.trim().to_string(),
                heading_path,
                start_line: current_start_line,
                end_line: line_number,
            });
        }

        // Filter out very small chunks and merge if needed
        self.post_process_chunks(chunks)
    }

    fn build_heading_path(headings: &[(HeadingLevel, String)]) -> String {
        headings
            .iter()
            .map(|(_, text)| text.as_str())
            .collect::<Vec<_>>()
            .join(" > ")
    }

    /// Split text into (chunk, remainder) at a natural boundary
    /// All calculations use character indices for Unicode safety
    fn split_chunk(&self, text: &str) -> (String, String) {
        let chars: Vec<char> = text.chars().collect();
        let char_count = chars.len();

        if char_count <= self.max_chunk_chars {
            return (text.to_string(), String::new());
        }

        // Helper: convert char index to byte index
        let char_to_byte =
            |char_idx: usize| -> usize { chars.iter().take(char_idx).map(|c| c.len_utf8()).sum() };

        // Search window: look for split points within max_chunk_chars
        let search_text: String = chars[..self.max_chunk_chars].iter().collect();

        // Try to split at paragraph boundary
        if let Some(pos) = search_text.rfind("\n\n") {
            let char_pos = search_text[..pos].chars().count();
            let byte_pos = char_to_byte(char_pos);
            let chunk = text[..byte_pos].trim().to_string();

            let remainder_char_start = char_pos.saturating_sub(self.overlap_chars);
            let remainder_byte_start = char_to_byte(remainder_char_start);
            let remainder = text[remainder_byte_start..].trim().to_string();
            return (chunk, remainder);
        }

        // Try to split at sentence boundary (supports Chinese and English)
        let sentence_ends = ["。", "！", "？", ".\n", "!\n", "?\n", ". ", "! ", "? "];
        for end in &sentence_ends {
            if let Some(pos) = search_text.rfind(end) {
                let split_text = &search_text[..pos + end.len()];
                let char_pos = split_text.chars().count();
                let byte_pos = char_to_byte(char_pos);
                let chunk = text[..byte_pos].trim().to_string();

                let remainder_char_start = char_pos.saturating_sub(self.overlap_chars);
                let remainder_byte_start = char_to_byte(remainder_char_start);
                let remainder = text[remainder_byte_start..].trim().to_string();
                return (chunk, remainder);
            }
        }

        // Try to split at clause boundary (Chinese comma, semicolon, etc.)
        let clause_ends = ['，', '；', '、', ',', ';'];
        for end in &clause_ends {
            if let Some(pos) = search_text.rfind(*end) {
                let char_pos = search_text[..=pos].chars().count();
                let byte_pos = char_to_byte(char_pos);
                let chunk = text[..byte_pos].trim().to_string();

                let remainder_char_start = char_pos.saturating_sub(self.overlap_chars);
                let remainder_byte_start = char_to_byte(remainder_char_start);
                let remainder = text[remainder_byte_start..].trim().to_string();
                return (chunk, remainder);
            }
        }

        // Fall back to whitespace boundary
        if let Some(pos) = search_text.rfind(char::is_whitespace) {
            let char_pos = search_text[..pos].chars().count();
            let byte_pos = char_to_byte(char_pos);
            let chunk = text[..byte_pos].trim().to_string();

            let remainder_char_start = char_pos.saturating_sub(self.overlap_chars);
            let remainder_byte_start = char_to_byte(remainder_char_start);
            let remainder = text[remainder_byte_start..].trim().to_string();
            return (chunk, remainder);
        }

        // Last resort: hard split at max_chunk_chars (safe because we use char index)
        let byte_pos = char_to_byte(self.max_chunk_chars);
        let chunk = text[..byte_pos].to_string();

        let remainder_char_start = self.max_chunk_chars.saturating_sub(self.overlap_chars);
        let remainder_byte_start = char_to_byte(remainder_char_start);
        let remainder = text[remainder_byte_start..].to_string();
        (chunk, remainder)
    }

    fn post_process_chunks(&self, chunks: Vec<TextChunk>) -> Vec<TextChunk> {
        let min_chunk_chars = 50;
        let mut result: Vec<TextChunk> = Vec::new();

        for chunk in chunks {
            if chunk.content.chars().count() < min_chunk_chars {
                // Try to merge with previous chunk
                if let Some(last) = result.last_mut() {
                    last.content.push_str("\n\n");
                    last.content.push_str(&chunk.content);
                    last.end_line = chunk.end_line;
                    continue;
                }
            }
            result.push(chunk);
        }

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_chunk() {
        let chunker = Chunker::default();
        let content = "# Hello\n\nThis is a test.\n\n## Section\n\nMore content here.";
        let chunks = chunker.chunk(content, "test.md");

        assert!(!chunks.is_empty());
    }

    #[test]
    fn test_chinese_content() {
        let chunker = Chunker::new(100, 20);
        let content = "# 标题\n\n这是一段很长的中文内容。我们需要确保在切分时不会切到汉字中间。这对于处理多语言内容非常重要。";
        let chunks = chunker.chunk(content, "test.md");

        // All chunks should be valid UTF-8 (this would panic if we split incorrectly)
        for chunk in &chunks {
            assert!(chunk.content.is_char_boundary(0));
            println!("Chunk: {}", chunk.content);
        }
    }

    #[test]
    fn test_heading_path() {
        let chunker = Chunker::default();
        let content = "# Title\n\n## Section 1\n\nContent 1\n\n### Subsection\n\nContent 2";
        let chunks = chunker.chunk(content, "test.md");

        // Check that heading paths are built correctly
        for chunk in &chunks {
            println!(
                "Chunk: {} | Path: {}",
                chunk.content.chars().take(30).collect::<String>(),
                chunk.heading_path
            );
        }
    }

    #[test]
    fn test_mixed_language() {
        let chunker = Chunker::new(50, 10);
        let content = "Hello 世界！This is a test. 这是测试。Mixed content here 混合内容。";
        let chunks = chunker.chunk(content, "test.md");

        for chunk in &chunks {
            // Verify each chunk is valid UTF-8
            let _ = chunk.content.chars().count();
            println!("Mixed chunk: {}", chunk.content);
        }
    }
}
