---
type: Module
title: wiki-core
description: Crate Rust per risolvere, leggere, scrivere e validare la wiki in modo sicuro.
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - crates/wiki-core/src/lib.rs
  - crates/wiki-core/src/wiki_fs.rs
  - crates/wiki-core/src/wiki_resolver.rs
  - crates/wiki-core/src/validator.rs
  - crates/wiki-core/src/watcher.rs
  - crates/wiki-core/src/git_ops.rs
source_commit: 206cc3c
confidence: high
---

# wiki-core

## Scopo
Tutto ciò che tocca i file della wiki e il repo git, usato dal backend Tauri e da `rag-core`.

## File chiave

| File | Cosa contiene |
| --- | --- |
| `wiki_resolver.rs` | trova la wiki (`.wikidir`, poi `wiki/`) con le stesse regole del plugin |
| `wiki_fs.rs` | `read_wiki_file_safe`, `write_wiki_file_safe`, `write_wiki_files_safe`, `read_repo_file_safe`, `load_wiki_snapshot`, `read_private_terms`, `content_has_forbidden_term`, `is_private_terms_name` |
| `wiki_schema.rs` | lettura di SCHEMA (Core map, Excluded paths) |
| `validator.rs` | lancia `resources/validate-wiki.py --json` e legge il report con serde |
| `watcher.rs` | watcher ricorsivo (`notify`) con debounce di ~300 ms |
| `git_ops.rs` | comandi git con validazione degli argomenti contro l'injection |
| `prompts.rs` | prompt dei workflow del plugin, solo da allow-list |

## Invarianti
- Le scritture restano dentro la wiki canonica, che a sua volta sta dentro il repo canonico.
- `.private-terms` non è mai leggibile né scrivibile dall'interfaccia (anche ADS, maiuscole,
  link simbolici); il controllo dei termini è fail-closed.
- Lo snapshot non segue cartelle simboliche che escono dalla wiki.

## Come cambiarlo in sicurezza
Aggiungi un test in `wiki_fs.rs` per ogni nuovo percorso di scrittura; `cargo test -p wiki-core`.

## Test collegati
Test unitari nei moduli; fixture TS in `tests/fixtures/` usate da `tests/fixture-validator.test.ts`.
