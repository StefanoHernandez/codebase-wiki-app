---
title: Log
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - wiki/project/work-tracker.md
  - .github/workflows/build.yml
source_commit: 206cc3c
confidence: high
---

# Log

## 2026-11-11 · RAG valutato e ristretto al codice · agent
- What: valutazione del RAG con domande dalla risposta nota su repo del plugin e copia di Versal; corretti indice della wiki ignorata da git, copie generate duplicate, file di dati e log indicizzati; poi indice e server MCP solo sul codice (`search_wiki` rimosso), modelli liberati dopo 5 minuti, reranker non più presentato come più preciso. Tree-sitter esteso a Java, C, C++, C#, Kotlin, Swift, PHP, Ruby, Bash, Scala, Lua.
- Evidence: `cargo test --workspace` → verde; `npm test` → 130 pass @fe7bba6; misure in [0004](project/decisions/0004-rag-solo-codice.md) e [0005](project/decisions/0005-reranker-facoltativo.md)
- IDs: T8

## 2026-11-11 · Release 0.3.0 · agent
- What: versione 0.3.0, tag `v0.3.0`, release pubblicata con 7 pacchetti; eliminata la bozza della 0.2.0 (il tag resta). La CI della 0.2.0 era fallita per un errore DNS del runner, rilanciata e verde.
- Evidence: run GitHub Actions 43073107982 → test e tre build success @206cc3c
- IDs: T7

## 2026-11-11 · Pulizia del repo e nascita della wiki · agent
- What: su richiesta di Stefano, la cartella annidata non tracciata `codebase-wiki-app/` (clone indietro di 89 commit, nessun commit non pushato, una modifica locale a `src-tauri/Cargo.toml`) spostata nel Cestino; eliminati i branch `app/hardening`, `feat/more-languages`, `feat/rag-mcp`, `integrate/cursor-wave`, `rewrite/tauri-v2` (era a `2d33cec`, 5 commit di documenti di handoff superati) e i remoti `feat/more-languages`, `feat/rag-mcp`; creata questa wiki con `/wiki-init` del plugin 0.13.1.
- Evidence: `git branch -a` → solo `main` e `origin/main` @206cc3c
- IDs: none
