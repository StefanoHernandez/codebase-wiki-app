---
type: Decision
title: 0004 - La ricerca locale copre solo il codice
description: L'indice RAG contiene solo codice e config; la wiki si legge partendo da index.md.
status: accepted
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - crates/rag-core/src/files.rs
  - crates/wiki-mcp/src/serve.rs
source_commit: 206cc3c
confidence: high
---

# 0004 - La ricerca locale copre solo il codice

## Contesto
Il 2026-11-11 il RAG è stato valutato con domande dalla risposta nota sul repo del plugin
(17 domande) e su una copia di Versal (14). Sulle domande di stato, rischi e handoff,
`search_wiki` restituiva piani vecchi, spec e template con lo stesso peso delle pagine
attuali; un agente di prova ha dovuto aprire a mano tracker e handoff. La wiki ha già una
mappa per gli agenti (Core map, `index.md`), il codice no.

## Decisione
- L'indice contiene solo sorgenti e config: esclusi la cartella della wiki, Markdown e testo
  (`.md`, `.mdx`, `.markdown`, `.rst`, `.txt`, `.adoc`), dati e log, file sopra 512 KB.
- Il server MCP espone `search_code`, `index_status`, `list_repos`; `search_wiki` è rimosso.
- Le istruzioni del server mandano stato, decisioni, rischi e handoff alla wiki da `index.md`.

## Alternative scartate
- Tenere `search_wiki` con un bonus alle pagine della wiki: ottimizzava un uso secondario e
  lasciava il rischio di informazioni superate presentate come attuali.

## Conseguenze
Routing più semplice e coerente con la regola wiki-context del plugin 0.13.1. Si perde la
ricerca a parole nella prosa fuori dalla wiki (README, `docs/`): l'agente usa grep o legge i file. T8.

## Approval
<!-- wiki:approval -->
accepted: Stefano, sessione con Claude Code ("si va benissimo ora mi convince"), 2026-11-11
