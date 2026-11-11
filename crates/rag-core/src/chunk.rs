use text_splitter::{
    Characters, ChunkCapacity, ChunkConfig, ChunkSizer, CodeSplitter, MarkdownSplitter, TextSplitter,
};

use crate::files::FileSource;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    pub start_line: u32,
    pub end_line: u32,
    pub text: String,
    /// `header\nbody`: what gets embedded and what BM25 indexes.
    pub embed_text: String,
}

/// Chunk sizes in the sizer's unit: model tokens in production, characters in `chunk_file`.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub min: usize,
    pub max: usize,
    /// Pieces smaller than this (a lone signature, a closing brace) merge into a neighbour.
    pub tiny: usize,
}

/// Budget for a 512-token embedding model: body ≤ 360 + a merged tiny piece ≤ 32, header
/// ≤ ~70 (path + 80-char breadcrumb), prefix and special tokens ~10.
pub const TOKEN_LIMITS: Limits = Limits { min: 96, max: 360, tiny: 32 };
const CHAR_LIMITS: Limits = Limits { min: 800, max: 1800, tiny: 80 };
const CRUMB_MAX_CHARS: usize = 80;
const CRUMB_SEP: &str = " › ";

fn line_range(text: &str, start_byte: usize, end_byte: usize) -> (u32, u32) {
    let prefix = &text[..start_byte.min(text.len())];
    let slice = &text[start_byte.min(text.len())..end_byte.min(text.len())];
    let start = prefix.matches('\n').count() as u32 + 1;
    let end = start + slice.trim_end().matches('\n').count() as u32;
    (start, end)
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

/// Headings in force at byte `at`: `Decisioni › 0003 › Motivazione`. Fenced code is skipped.
fn markdown_breadcrumb(text: &str, at: usize) -> Vec<String> {
    let mut stack: Vec<(usize, String)> = Vec::new();
    let mut fenced = false;
    let mut pos = 0;
    for line in text.split_inclusive('\n') {
        if pos > at {
            break;
        }
        pos += line.len();
        let t = line.trim();
        if t.starts_with("```") || t.starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        let level = t.bytes().take_while(|b| *b == b'#').count();
        if fenced || level == 0 || level > 6 || t.as_bytes().get(level) != Some(&b' ') {
            continue;
        }
        stack.retain(|(l, _)| *l < level);
        stack.push((level, t[level..].trim().to_string()));
    }
    stack.into_iter().map(|(_, title)| title).collect()
}

fn symbol_name(node: tree_sitter::Node, src: &str) -> Option<String> {
    const KINDS: [&str; 10] =
        ["function", "method", "class", "impl", "trait", "struct", "enum", "interface", "mod_item", "type_spec"];
    let kind = node.kind();
    if !KINDS.iter().any(|k| kind.contains(k)) {
        return None;
    }
    let name = node
        .child_by_field_name("name")
        .or_else(|| (kind == "impl_item").then(|| node.child_by_field_name("type")).flatten())?;
    let s = src.get(name.byte_range())?;
    Some(s.chars().take(40).collect())
}

/// The widest node starting where `n` starts (`line_comment`, not its `///` marker token).
fn widest_at_start(mut n: tree_sitter::Node<'_>) -> tree_sitter::Node<'_> {
    while let Some(p) = n.parent().filter(|p| p.start_byte() == n.start_byte() && p.parent().is_some()) {
        n = p;
    }
    n
}

/// Symbols enclosing the chunk's first code byte, outermost first: `Store › search`.
/// Leading doc comments, attributes and decorators are skipped: they sit outside the item.
fn code_symbols(tree: &tree_sitter::Tree, src: &str, mut at: usize, end: usize) -> Vec<String> {
    let mut found = tree.root_node().descendant_for_byte_range(at, at);
    while let Some(n) = found.map(widest_at_start) {
        let k = n.kind();
        let leading = k.contains("comment") || k == "attribute_item" || k == "decorator";
        if !leading || n.end_byte() >= end {
            break;
        }
        at = n.end_byte() + src[n.end_byte()..end].len() - src[n.end_byte()..end].trim_start().len();
        found = tree.root_node().descendant_for_byte_range(at, at);
    }
    let Some(mut node) = found else {
        return Vec::new();
    };
    let mut names = Vec::new();
    loop {
        if let Some(n) = symbol_name(node, src) {
            names.push(n);
        }
        match node.parent() {
            Some(p) => node = p,
            None => break,
        }
    }
    names.reverse();
    names
}

/// `path` or `path › a › b`; the breadcrumb keeps its innermost parts within CRUMB_MAX_CHARS.
fn header(rel_path: &str, crumb: &[String]) -> String {
    let mut parts: Vec<&str> = Vec::new();
    let mut len = 0;
    for p in crumb.iter().rev() {
        if len + p.chars().count() > CRUMB_MAX_CHARS && !parts.is_empty() {
            break;
        }
        len += p.chars().count() + CRUMB_SEP.len();
        parts.push(p);
    }
    parts.reverse();
    if parts.is_empty() {
        rel_path.to_string()
    } else {
        format!("{rel_path}{CRUMB_SEP}{}", parts.join(CRUMB_SEP))
    }
}

/// Character-sized chunks (no model at hand: tests, tools without the `embed` feature).
pub fn chunk_file(rel_path: &str, text: &str, source: FileSource) -> Vec<Chunk> {
    chunk_file_with(rel_path, text, source, &Characters, CHAR_LIMITS)
}

/// Chunks sized with the embedding model's tokenizer, so no chunk is cut at the model's limit.
#[cfg(feature = "embed")]
pub fn chunk_file_tokens(rel_path: &str, text: &str, source: FileSource, tok: &tokenizers::Tokenizer) -> Vec<Chunk> {
    chunk_file_with(rel_path, text, source, tok, TOKEN_LIMITS)
}

/// Structure-aware split (tree-sitter for code, headings for Markdown), tiny pieces merged into
/// a neighbour, and a `path › symbols` or `path › headings` header for embedding and BM25.
pub fn chunk_file_with<S: ChunkSizer>(rel_path: &str, text: &str, source: FileSource, sizer: &S, limits: Limits) -> Vec<Chunk> {
    let ext = rel_path.rsplit('.').next().unwrap_or("");
    let markdown = source == FileSource::Wiki || ext == "md";
    let lang = if markdown { None } else { code_language(ext) };
    let config = || ChunkConfig::new(ChunkCapacity::try_from(limits.min..=limits.max).expect("range")).with_sizer(sizer);

    let pieces: Vec<(usize, &str)> = if markdown {
        MarkdownSplitter::new(config()).chunk_indices(text).collect()
    } else if let Some(splitter) = lang.clone().and_then(|l| CodeSplitter::new(l, config()).ok()) {
        splitter.chunk_indices(text).collect()
    } else {
        TextSplitter::new(config()).chunk_indices(text).collect()
    };
    // Spans run to the next piece's start, so the whitespace between pieces is kept.
    let mut spans: Vec<(usize, usize)> = pieces.iter().map(|(s, p)| (*s, s + p.len())).collect();
    for i in 0..spans.len().saturating_sub(1) {
        spans[i].1 = spans[i + 1].0;
    }

    let mut merged: Vec<(usize, usize)> = Vec::new();
    let mut i = 0;
    while i < spans.len() {
        let (s, e) = spans[i];
        let tiny = sizer.size(text[s..e].trim()) < limits.tiny;
        if tiny && i + 1 < spans.len() {
            spans[i + 1].0 = s;
        } else if tiny && !merged.is_empty() {
            merged.last_mut().expect("non-empty").1 = e;
        } else {
            merged.push((s, e));
        }
        i += 1;
    }

    let tree = lang.and_then(|l| {
        let mut parser = tree_sitter::Parser::new();
        parser.set_language(&l).ok()?;
        parser.parse(text, None)
    });
    merged
        .into_iter()
        .filter(|(s, e)| !text[*s..*e].trim().is_empty())
        .map(|(start, end)| {
            let body = &text[start..end];
            let crumb = if markdown {
                markdown_breadcrumb(text, start)
            } else if let Some(tree) = &tree {
                code_symbols(tree, text, start + (body.len() - body.trim_start().len()), end)
            } else {
                Vec::new()
            };
            let (start_line, end_line) = line_range(text, start, end);
            let body = body.trim_end();
            Chunk {
                start_line,
                end_line,
                text: body.to_string(),
                embed_text: format!("{}\n{body}", header(rel_path, &crumb)),
            }
        })
        .collect()
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
    fn markdown_header_carries_heading_path() {
        let md = format!("# Decisioni\n\n## 0003 Runtime\n\n### Motivazione\n\n{}\n", "parola ".repeat(300));
        let chunks = chunk_file("docs/adr.md", &md, FileSource::Wiki);
        let last = chunks.last().unwrap();
        assert!(
            last.embed_text.starts_with("docs/adr.md › Decisioni › 0003 Runtime › Motivazione\n"),
            "{}",
            last.embed_text.lines().next().unwrap()
        );
    }

    #[test]
    fn python_header_names_enclosing_symbols_and_tiny_signature_merges() {
        let body: String = (0..60).map(|i| format!("        x{i} = compute({i}, 'a long enough argument')\n")).collect();
        let src = format!("class Pilot:\n    def run(self):\n{body}");
        let chunks = chunk_file("bench/pilot.py", &src, FileSource::Code);
        assert!(chunks.iter().all(|c| c.text.trim().lines().count() > 1), "no one-line chunk");
        assert!(chunks.iter().any(|c| c.embed_text.starts_with("bench/pilot.py › Pilot › run\n")));
        assert_eq!(chunks[0].start_line, 1);
        assert_eq!(chunks.last().unwrap().end_line, 62);
    }

    #[test]
    fn rust_doc_comment_does_not_hide_the_method_name() {
        let body: String = (0..40).map(|i| format!("        let v{i} = self.load({i});\n")).collect();
        let src = format!("struct Store;\n\nimpl Store {{\n    /// Opens the index.\n    #[inline]\n    pub fn open_writer(&self) {{\n{body}    }}\n}}\n");
        let mut parser = tree_sitter::Parser::new();
        parser.set_language(&code_language("rs").unwrap()).unwrap();
        let tree = parser.parse(&src, None).unwrap();
        let at = src.find("/// Opens").unwrap();
        assert_eq!(code_symbols(&tree, &src, at, src.len()), ["Store", "open_writer"]);
    }

    #[test]
    fn spans_cover_the_whole_file_without_gaps() {
        let src = format!("fn a() {{\n{}\n}}\n\nfn b() {{\n{}\n}}\n", "x".repeat(900), "y".repeat(900));
        let chunks = chunk_file("x.rs", &src, FileSource::Code);
        for w in chunks.windows(2) {
            assert!(w[1].start_line <= w[0].end_line + 2, "{:?} then {:?}", (w[0].start_line, w[0].end_line), (w[1].start_line, w[1].end_line));
        }
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
