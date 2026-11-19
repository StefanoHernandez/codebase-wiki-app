---
type: Module
title: rag-core e wiki-mcp
description: Indice di ricerca sul codice e server MCP che lo offre agli agenti.
generated: { by: antigravity/unknown, at: 2026-11-19T10:45:00Z }
sources:
  - crates/rag-core/src/lib.rs
  - crates/rag-core/src/files.rs
  - crates/rag-core/src/chunk.rs
  - crates/rag-core/src/store.rs
  - crates/rag-core/src/embed.rs
  - crates/rag-core/src/catalog.rs
  - crates/rag-core/src/models.rs
  - crates/rag-core/src/harness.rs
  - crates/rag-core/src/plugin_install.rs
  - crates/rag-core/src/activity.rs
  - crates/wiki-mcp/src/main.rs
  - crates/wiki-mcp/src/run.rs
  - crates/wiki-mcp/src/serve.rs
source_commit: 0763ea1
confidence: high
---

# rag-core e wiki-mcp

## Scopo
Ricerca locale sul **codice** del progetto ([0004](../project/decisions/0004-rag-solo-codice.md)):
l'app la mostra in Ricerca, gli agenti la usano via MCP.

## File chiave

| File | Cosa contiene |
| --- | --- |
| `rag-core/files.rs` | `list_files`: `git ls-files` meno cartella wiki, prosa, dati/log, lockfile, binari, file >512 KB, `.private-terms`, symlink |
| `rag-core/chunk.rs` | divisione con tree-sitter (Rust, TS/TSX, JS, Python, Go, Java, C, C++, C#, Kotlin, Swift, PHP, Ruby, Bash, Scala, Lua) e intestazione `path › Classe › metodo`; testo semplice per il resto |
| `rag-core/store.rs` | SQLite + FTS5 + sqlite-vec; ricerca ibrida BM25 + vettori fusi con RRF (k=60); i file di test valgono la metà salvo query sui test; copie identiche contano una volta; `status_json(root)` in-process senza feature `download` |
| `rag-core/embed.rs` | embedding fastembed/ONNX (feature `embed`), reranker facoltativo |
| `rag-core/catalog.rs`, `models.rs` | catalogo curato, download con avanzamento (`feature = "download"`), modelli Hugging Face aggiunti a mano (`tested: false`), `models_list_json()` sempre disponibile in-process (cache con recovery su mutex poison) |
| `rag-core/harness.rs` | stato e scrittura delle config MCP di Codex, Cursor, Claude, con anteprima e backup |
| `rag-core/plugin_install.rs` | plugin Codebase Wiki LLM per agente: versione installata, anteprima, installazione (CLI di Claude Code e Codex; copia delle cartelle per Antigravity, Cursor e OpenCode, con `.bak` finché la copia non riesce) |
| `rag-core/activity.rs` | registro delle chiamate MCP: una riga JSON per chiamata in `<dati>/activity/<repo_id>.jsonl` (ora, agente dal `clientInfo`, tool, query, primi 3 file, durata, errore); query con un termine riservato → `[private]` / `[riservata]`; oltre 600 righe tiene le ultime 500 |
| `wiki-mcp/main.rs`, `run.rs` | CLI `index`, `search`, `status`, `models list/pull/search/add` con `--json` e separatore `--` (end-of-options per query che iniziano con `-`); `status` e `models list` delegano direttamente a `rag_core::status_json` e `rag_core::models_list_json`; `search_hits` verifica `.private-terms` su **path e testo**; tutti gli errori CLI sono in inglese |
| `wiki-mcp/serve.rs` | server MCP stdio interamente in inglese: `search_code`, `index_status`, `list_repos`; le istruzioni chiedono query in inglese con i nomi probabili; scarica i modelli dopo 5 minuti senza ricerche |

## Invarianti
- Il registro delle chiamate non cambia mai il risultato di un tool: un errore di scrittura viene ignorato.
- Un risultato con un termine riservato nel testo **o nel percorso** del file non esce mai, né nella CLI `search` (`run.rs`) né verso l'agente (`serve.rs`) né nel registro.
- Senza indice o modello il server dà un errore chiaro in inglese e non scarica né indicizza nulla.
- Termini di `.private-terms` filtrati in indicizzazione e di nuovo a ogni ricerca (testo + percorso); file illeggibile → nessun risultato.
- Un risultato con `stale: true` è cambiato dopo l'indice: va riletto dal disco.

## Verifica
`cargo test -p rag-core -p wiki-mcp` (anche con `-F embed,download`); valutazione su domande dalla risposta nota
in [testing](../engineering/testing.md).

## Rischi aperti
R3 (memoria), R4 (termini riservati) nel [registro](../project/risks.md).
