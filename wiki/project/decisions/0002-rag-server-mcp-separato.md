---
type: Decision
title: 0002 - Ricerca locale come server MCP separato, indice fuori dal repo
description: Il RAG gira nell'eseguibile codebase-wiki-mcp; l'indice vive nella cartella dati dell'app.
status: accepted
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - docs/superpowers/plans/2026-11-11-rag-mcp.md
  - crates/wiki-mcp/src/serve.rs
  - crates/rag-core/src/paths.rs
source_commit: 206cc3c
confidence: high
---

# 0002 - Ricerca locale come server MCP separato, indice fuori dal repo

## Contesto
Gli agenti (Claude Code, Codex, Cursor, Antigravity) devono poter cercare nel codice anche con
l'app chiusa, e il plugin deve restare usabile senza l'app.

## Decisione
- Server MCP stdio standalone (`codebase-wiki-mcp serve`), distribuito come sidecar dell'app e
  copiato in `<data>/bin` per un percorso stabile nelle config degli agenti.
- Embedding in-process con ONNX (fastembed), catalogo curato di modelli più ricerca su Hugging Face.
- Indice SQLite + sqlite-vec in `<data_local_dir>/com.codebasewiki.app/rag/indexes/`, mai nel repo.
- Un solo processo scrive l'indice (l'eseguibile lanciato dall'app); il server legge soltanto.

## Alternative scartate
Alternatives not recorded.

## Conseguenze
L'app non include ONNX; l'eseguibile pesa ~74 MB. Dettagli in [rag-core e wiki-mcp](../../modules/rag-mcp.md).

## Approval
<!-- wiki:approval -->
accepted: Stefano, sessione di pianificazione con Claude Code (piano `docs/superpowers/plans/2026-11-11-rag-mcp.md`), 2026-11-11
