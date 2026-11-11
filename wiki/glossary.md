---
type: Glossary
title: Glossario
description: Termini del progetto.
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - README.md
  - crates/rag-core/src/store.rs
source_commit: 206cc3c
confidence: high
---

# Glossario

| Termine | Significato |
| --- | --- |
| Azione umana | promuovere, chiudere ⚫, accettare/rifiutare una decisione, firmare `verified`: solo una persona |
| Baton | tabella dell'handoff con il prossimo compito per un agente |
| Core map | tabella in `SCHEMA.md` che dice dove sta ogni pagina principale della wiki |
| hit@1, hit@5, MRR | misure della ricerca: file giusto primo, nei primi 5, posizione media inversa |
| MCP | Model Context Protocol: come gli agenti chiamano `codebase-wiki-mcp serve` |
| RAG | ricerca locale sul codice (parole chiave + significato) |
| Reranker | modello facoltativo che riordina i candidati della ricerca |
| RRF | Reciprocal Rank Fusion: fonde la classifica per parole chiave e quella per vettori |
| Sidecar | eseguibile `codebase-wiki-mcp` distribuito con l'app e lanciato da lei |
| Stale | risultato di ricerca su un file cambiato dopo l'indice |
