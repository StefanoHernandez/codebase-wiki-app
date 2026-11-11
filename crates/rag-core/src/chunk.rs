use text_splitter::{
    Characters, ChunkCapacity, ChunkConfig, CodeSplitter, MarkdownSplitter, TextSplitter,
};

use crate::files::FileSource;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    pub start_line: u32,
    pub end_line: u32,
    pub text: String,
    pub embed_text: String,
}

fn line_range(text: &str, start_byte: usize, end_byte: usize) -> (u32, u32) {
    let prefix = &text[..start_byte.min(text.len())];
    let slice = &text[start_byte.min(text.len())..end_byte.min(text.len())];
    let start = prefix.matches('\n').count() as u32 + 1;
    let end = start + slice.matches('\n').count() as u32;
    (start, end)
}

fn heading_or_first_line(text: &str, chunk: &str) -> String {
    for line in chunk.lines() {
        let t = line.trim();
        if t.starts_with('#') {
            return t.trim_start_matches('#').trim().to_string();
        }
    }
    text.lines().next().unwrap_or("").trim().to_string()
}

fn chunk_config() -> ChunkConfig<Characters> {
    ChunkConfig::new(ChunkCapacity::try_from(800..=1800).expect("range"))
}

fn code_language(ext: &str) -> Option<tree_sitter::Language> {
    match ext {
        "rs" => Some(tree_sitter_rust::LANGUAGE.into()),
        "ts" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        "tsx" => Some(tree_sitter_typescript::LANGUAGE_TSX.into()),
        "js" | "jsx" | "mjs" | "cjs" => Some(tree_sitter_javascript::LANGUAGE.into()),
        "py" => Some(tree_sitter_python::LANGUAGE.into()),
        "go" => Some(tree_sitter_go::LANGUAGE.into()),
        _ => None,
    }
}

pub fn chunk_file(rel_path: &str, text: &str, source: FileSource) -> Vec<Chunk> {
    let ext = rel_path.rsplit('.').next().unwrap_or("");
    let offsets: Vec<(usize, usize)> = {
        let pairs: Vec<(usize, &str)> = if source == FileSource::Wiki || ext == "md" {
            MarkdownSplitter::new(chunk_config())
                .chunk_indices(text)
                .collect()
        } else if let Some(lang) = code_language(ext) {
            if let Ok(splitter) = CodeSplitter::new(lang, chunk_config()) {
                splitter.chunk_indices(text).collect()
            } else {
                TextSplitter::new(chunk_config())
                    .chunk_indices(text)
                    .collect()
            }
        } else {
            TextSplitter::new(chunk_config())
                .chunk_indices(text)
                .collect()
        };
        pairs
            .iter()
            .enumerate()
            .map(|(i, (start, chunk))| {
                let end = start + chunk.len();
                if i + 1 < pairs.len() {
                    (*start, pairs[i + 1].0.min(end))
                } else {
                    (*start, end)
                }
            })
            .collect()
    };
    let mut out = Vec::new();
    for (start, end) in offsets {
        let chunk = &text[start..end.min(text.len())];
        let (start_line, end_line) = line_range(text, start, end);
        let head = heading_or_first_line(text, chunk);
        let embed_text = format!("{rel_path}\n{head}\n{chunk}");
        out.push(Chunk {
            start_line,
            end_line,
            text: chunk.to_string(),
            embed_text,
        });
    }
    out
}

pub fn filter_private_chunks(
    chunks: Vec<Chunk>,
    terms: Option<&str>,
) -> (Vec<Chunk>, u32) {
    let Some(terms) = terms else {
        return (chunks, 0);
    };
    let mut kept = Vec::new();
    let mut skipped = 0u32;
    for c in chunks {
        if wiki_core::content_has_forbidden_term(terms, &c.text)
            || wiki_core::content_has_forbidden_term(terms, &c.embed_text)
        {
            skipped += 1;
        } else {
            kept.push(c);
        }
    }
    (kept, skipped)
}

pub fn terms_hash(terms: Option<&str>) -> String {
    use sha2::{Digest, Sha256};
    let bytes = terms.unwrap_or("");
    let mut h = Sha256::new();
    h.update(bytes.as_bytes());
    format!("{:x}", h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

  #[test]
    fn rust_two_functions_two_chunks() {
        let src = format!("fn a() {{\n{}\n}}\n\nfn b() {{\n{}\n}}\n", "x".repeat(900), "y".repeat(900));
        let chunks = chunk_file("x.rs", &src, FileSource::Code);
        assert!(chunks.len() >= 2);
        assert_eq!(chunks[0].start_line, 1);
    }

    #[test]
    fn markdown_splits_on_headings() {
        let md = format!("# One\n\n{}\n\n## Two\n\n{}\n", "a".repeat(900), "b".repeat(900));
        let chunks = chunk_file("w.md", &md, FileSource::Wiki);
        assert!(chunks.len() >= 2);
    }

    #[test]
    #[cfg(unix)]
    fn unreadable_private_terms_symlink() {
        let td = tempfile::tempdir().unwrap();
        let wiki = td.path().join("wiki");
        std::fs::create_dir_all(&wiki).unwrap();
        let target = td.path().join("secret.txt");
        std::fs::write(&target, "x").unwrap();
        std::os::unix::fs::symlink(&target, wiki.join(".private-terms")).unwrap();
        assert!(wiki_core::read_private_terms(&wiki).is_err());
    }

    #[test]
    fn private_term_chunk_dropped() {
        let chunks = chunk_file("a.rs", "fn secret() {}", FileSource::Code);
        let (kept, skipped) = filter_private_chunks(chunks, Some("secret"));
        assert_eq!(skipped, 1);
        assert!(kept.is_empty());
    }
}
