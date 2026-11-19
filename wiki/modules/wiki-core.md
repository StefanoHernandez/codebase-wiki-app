---
type: Module
title: wiki-core
description: Crate Rust per risolvere, leggere, scrivere e validare la wiki in modo sicuro.
generated: { by: antigravity/unknown, at: 2026-11-19T10:45:00Z }
sources:
  - crates/wiki-core/src/lib.rs
  - crates/wiki-core/src/wiki_fs.rs
  - crates/wiki-core/src/wiki_schema.rs
  - crates/wiki-core/src/wiki_resolver.rs
  - crates/wiki-core/src/validator.rs
  - crates/wiki-core/src/watcher.rs
  - crates/wiki-core/src/git_ops.rs
source_commit: 0763ea1
confidence: high
---

# wiki-core

## Scopo
Tutto ciò che tocca i file della wiki e il repo git, usato dal backend Tauri e da `rag-core`.

## File chiave

| File | Cosa contiene |
| --- | --- |
| `wiki_resolver.rs` | trova la wiki (`.wikidir`, poi `wiki/`) con le stesse regole del plugin |
| `wiki_fs.rs` | `read_wiki_file_safe`, `write_wiki_file_safe`, `write_wiki_files_safe`, `read_repo_file_safe`, `collect_repo_files`, `load_wiki_snapshot`, `load_wiki_snapshot_opts`, `read_private_terms`, `content_has_forbidden_term`, `is_private_terms_name` |
| `wiki_schema.rs` | lettura di `SCHEMA.md` (`parse_core_map_role`, Core map, Excluded paths) |
| `validator.rs` | lancia `resources/validate-wiki.py --json` e legge il report con serde |
| `watcher.rs` | watcher ricorsivo (`notify`) con debounce di ~300 ms; `watch_repo_reporting` passa anche gli errori, che l'app mostra come banner |
| `git_ops.rs` | comandi git con validazione degli argomenti contro l'injection; `file_history` (file aggiunti e modificati per commit, per la Storia del Grafo) |
| `prompts.rs` | prompt dei workflow del plugin, solo da allow-list |

## Invarianti
- Le scritture restano dentro la wiki canonica, che a sua volta sta dentro il repo canonico.
- `.private-terms` non è mai leggibile né scrivibile dall'interfaccia (anche ADS, maiuscole,
  link simbolici); il controllo dei termini è fail-closed. Un `:` nel nome di un file è rifiutato
  solo su Windows (flussi NTFS).
- Lo snapshot non segue cartelle simboliche che escono dalla wiki.
- `collect_repo_files` usa `git ls-files -z --cached --others --exclude-standard` con fallback ricorsivo che salta symlink, directory nascoste/di build (`node_modules`, `target`, `dist`, `build`, `venv`, `__pycache__`, `vendor`), file di lock, asset binari e `.private-terms`.
- `load_wiki_snapshot` / `load_wiki_snapshot_opts` risolvono il percorso del file `handoff` dalla `## Core map` di `SCHEMA.md` (con fallback `agent/handoff.md`) e consentono di saltare la raccolta dei file del repo (`include_repo_files: false`) nei caricamenti leggeri.

## Come cambiarlo in sicurezza
Aggiungi un test in `wiki_fs.rs` per ogni nuovo percorso di scrittura; `cargo test -p wiki-core`.

## Test collegati
Test unitari nei moduli; fixture TS in `tests/fixtures/` usate da `tests/fixture-validator.test.ts`.
