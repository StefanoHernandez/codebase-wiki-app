---
type: Module
title: rag-core e wiki-mcp
description: Indice di ricerca sul codice e server MCP che lo offre agli agenti.
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - crates/rag-core/src/files.rs
  - crates/rag-core/src/chunk.rs
  - crates/rag-core/src/store.rs
  - crates/rag-core/src/embed.rs
  - crates/rag-core/src/catalog.rs
  - crates/rag-core/src/harness.rs
  - crates/rag-core/src/plugin_install.rs
  - crates/rag-core/src/activity.rs
  - crates/wiki-mcp/src/main.rs
  - crates/wiki-mcp/src/run.rs
  - crates/wiki-mcp/src/serve.rs
source_commit: 206cc3c
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
| `rag-core/store.rs` | SQLite + FTS5 + sqlite-vec; ricerca ibrida BM25 + vettori fusi con RRF (k=60); i file di test valgono la metà salvo query sui test; copie identiche contano una volta |
| `rag-core/embed.rs` | embedding fastembed/ONNX (feature `embed`), reranker facoltativo |
| `rag-core/catalog.rs`, `models.rs` | catalogo curato, download con avanzamento, modelli Hugging Face aggiunti a mano (`tested: false`) |
| `rag-core/harness.rs` | stato e scrittura delle config MCP di Codex, Cursor, Claude, con anteprima e backup |
| `rag-core/plugin_install.rs` | plugin Codebase Wiki LLM per agente: versione installata, anteprima, installazione (CLI di Claude Code e Codex; copia delle cartelle per Antigravity, Cursor e OpenCode, con `.bak` finché la copia non riesce) |
| `rag-core/activity.rs` | registro delle chiamate MCP: una riga JSON per chiamata in `<dati>/activity/<repo_id>.jsonl` (ora, agente dal `clientInfo`, tool, query, primi 3 file, durata, errore); query con un termine riservato → `[riservata]`; oltre 600 righe tiene le ultime 500 |
| `wiki-mcp/run.rs` | CLI `index`, `search`, `status`, `models list/pull/search/add` con `--json` |
| `wiki-mcp/serve.rs` | server MCP stdio: `search_code`, `index_status`, `list_repos`; le istruzioni chiedono query in inglese con i nomi probabili; scarica i modelli dopo 5 minuti senza ricerche |

## Invarianti
- Il registro delle chiamate non cambia mai il risultato di un tool: un errore di scrittura viene ignorato.
- Un risultato con un termine riservato nel testo **o nel percorso** del file non esce mai, né verso l'agente né nel registro.
- Senza indice o modello il server dà un errore chiaro e non scarica né indicizza nulla.
- Termini di `.private-terms` filtrati in indicizzazione e di nuovo a ogni ricerca; file illeggibile → nessun risultato.
- Un risultato con `stale: true` è cambiato dopo l'indice: va riletto dal disco.

## Verifica
`cargo test -p rag-core` (anche `-F embed,download`); valutazione su domande dalla risposta nota
in [testing](../engineering/testing.md).

## Rischi aperti
R3 (memoria), R4 (termini riservati) nel [registro](../project/risks.md).
