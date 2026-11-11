//! SCHEMA.md helpers shared with the indexer (excluded paths, glob matching).

use regex::Regex;

/// fnmatch-style glob: `*` crosses `/`, `?` one char, `[...]` / `[!...]` classes; `<placeholder>` → `.*`.
pub fn glob_match(glob: &str, rel_path: &str) -> bool {
    let mut re = String::new();
    let mut chars = glob.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '<' => {
                while chars.next().is_some() {
                    if chars.peek() == Some(&'>') {
                        chars.next();
                        break;
                    }
                }
                re.push_str(".*");
            }
            '*' => re.push_str(".*"),
            '?' => re.push('.'),
            '[' => {
                if chars.peek() == Some(&'!') {
                    chars.next();
                    re.push_str("[^");
                } else {
                    re.push('[');
                }
                while let Some(ch) = chars.next() {
                    if ch == ']' {
                        re.push(']');
                        break;
                    }
                    if ch == '\\' || ch == '^' || ch == '-' || ch == ']' {
                        re.push('\\');
                    }
                    re.push(ch);
                }
            }
            '.' | '+' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '\\' => {
                re.push('\\');
                re.push(c);
            }
            _ => re.push(c),
        }
    }
    match Regex::new(&format!("^{re}$")) {
        Ok(pat) => pat.is_match(rel_path),
        Err(_) => false,
    }
}

fn fence_mask(lines: &[&str]) -> Vec<bool> {
    let mut mask = vec![false; lines.len()];
    let fence_re = Regex::new(r"^(\s{0,3})(`{3,}|~{3,})(.*)$").unwrap();
    let mut open: Option<(char, usize, usize)> = None;
    for (i, line) in lines.iter().enumerate() {
        let caps = fence_re.captures(line);
        if open.is_none() {
            if let Some(c) = caps {
                let indent = c.get(1).unwrap().as_str();
                if indent.len() > 3 {
                    continue;
                }
                let fence = c.get(2).unwrap().as_str();
                let rest = c.get(3).map(|m| m.as_str()).unwrap_or("");
                if fence.starts_with('`') && rest.contains('`') {
                    continue;
                }
                let ch = fence.chars().next().unwrap();
                let len = fence.len();
                open = Some((ch, len, i));
                mask[i] = true;
            }
            continue;
        }
        mask[i] = true;
        if let Some(c) = caps {
            let indent = c.get(1).unwrap().as_str();
            if indent.len() > 3 {
                continue;
            }
            let fence = c.get(2).unwrap().as_str();
            let rest = c.get(3).map(|m| m.as_str()).unwrap_or("");
            if fence.starts_with('`') && rest.contains('`') {
                continue;
            }
            if rest.trim().is_empty() {
                let ch = fence.chars().next().unwrap();
                if ch == open.unwrap().0 && fence.len() >= open.unwrap().1 {
                    open = None;
                }
            }
        }
    }
    mask
}

fn section_lines(schema_md: &str, section_keys: &[&str]) -> Vec<String> {
    let normalized = schema_md
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();
    let mask = fence_mask(&lines);
    let heading_re = Regex::new(r"^##\s+(.+)$").unwrap();
    let marker_re = Regex::new(r"^<!--\s*wiki:([a-zA-Z0-9_-]+)\s*-->$").unwrap();
    let mut sections: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    let mut current_key = String::new();
    let mut current: Vec<String> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if mask[i] {
            if !current_key.is_empty() {
                current.push((*line).to_string());
            }
            continue;
        }
        if let Some(c) = heading_re.captures(line) {
            if !current_key.is_empty() {
                sections.insert(current_key.clone(), std::mem::take(&mut current));
            }
            current_key = c.get(1).unwrap().as_str().trim().to_lowercase();
            continue;
        }
        if let Some(c) = marker_re.captures(line) {
            if !current_key.is_empty() {
                sections.insert(current_key.clone(), std::mem::take(&mut current));
            }
            current_key = c
                .get(1)
                .unwrap()
                .as_str()
                .to_lowercase()
                .replace('-', " ");
            continue;
        }
        if !current_key.is_empty() {
            current.push((*line).to_string());
        }
    }
    if !current_key.is_empty() {
        sections.insert(current_key, current);
    }
    for key in section_keys {
        if let Some(ls) = sections.get(*key) {
            return ls.clone();
        }
    }
    Vec::new()
}

fn backtick_token(text: &str) -> Option<String> {
    let t = text.trim();
    let re = Regex::new(r"^`([^`]+)`$").unwrap();
    re.captures(t).map(|c| c.get(1).unwrap().as_str().to_string())
}

fn split_table_row(line: &str) -> Vec<String> {
    line.split('|')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn is_delimiter_row(cells: &[String]) -> bool {
    cells.iter().all(|c| {
        let t = c.trim();
        !t.is_empty() && t.chars().all(|ch| ch == '-' || ch == ':' || ch == ' ')
    })
}

fn table_rows_outside_fences(lines: &[String]) -> Vec<Vec<String>> {
    let line_refs: Vec<&str> = lines.iter().map(String::as_str).collect();
    let mask = fence_mask(&line_refs);
    let mut rows = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        if mask[i] {
            i += 1;
            continue;
        }
        let cells = split_table_row(&lines[i]);
        if cells.len() >= 2 && i + 1 < lines.len() && !mask[i + 1] {
            let delim = split_table_row(&lines[i + 1]);
            if is_delimiter_row(&delim) {
                i += 2;
                while i < lines.len() && !mask[i] {
                    let row = split_table_row(&lines[i]);
                    if row.is_empty() {
                        break;
                    }
                    rows.push(row);
                    i += 1;
                }
                continue;
            }
        }
        i += 1;
    }
    rows
}

/// Reads `## Excluded paths` (or `<!-- wiki:excluded-paths -->`) like `schema-parser.ts`.
pub fn parse_excluded_globs(schema_md: &str) -> Vec<String> {
    let lines = section_lines(schema_md, &["excluded paths"]);
    if lines.is_empty() {
        return Vec::new();
    }
    let line_refs: Vec<&str> = lines.iter().map(String::as_str).collect();
    let mask = fence_mask(&line_refs);
    let list_re = Regex::new(r"^\s*[-*]\s+(.*)$").unwrap();
    let mut globs = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if mask[i] {
            continue;
        }
        if let Some(c) = list_re.captures(line) {
            if let Some(g) = backtick_token(c.get(1).unwrap().as_str()) {
                globs.push(g);
            }
        }
    }
    for row in table_rows_outside_fences(&lines) {
        for cell in row {
            if let Some(g) = backtick_token(cell.as_str()) {
                globs.push(g);
                break;
            }
        }
    }
    globs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excluded_glob_inside_fence_is_ignored() {
        let md = r#"## Excluded paths
- `docs/**`

```md
- `inside-fence/**`
```
- `keep/me/**`
"#;
        let globs = parse_excluded_globs(md);
        assert_eq!(globs, vec!["docs/**".to_string(), "keep/me/**".to_string()]);
    }

    #[test]
    fn glob_star_crosses_slashes() {
        assert!(glob_match("docs/*", "docs/a/b.md"));
    }

    #[test]
    fn glob_class_matches_digit_prefix() {
        assert!(glob_match("[0-9]*.md", "0007-x.md"));
        assert!(!glob_match("[0-9]*.md", "readme.md"));
    }
}
