---
type: Decision
title: 0005 - Reranker facoltativo, non presentato come più preciso
description: Il reranker resta un modello facoltativo; l'app non lo raccomanda.
status: accepted
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - crates/rag-core/src/embed.rs
  - src/views/Impostazioni.tsx
source_commit: 206cc3c
confidence: medium
---

# 0005 - Reranker facoltativo, non presentato come più preciso

## Contesto
Misura del 2026-11-11 sulle sole domande di codice (12 sul plugin, 6 su Versal), con
`multilingual-e5-small`:

| Repo | Con reranker hit@1 / MRR | Senza hit@1 / MRR |
| --- | --- | --- |
| plugin | 0,67 / 0,79 | 0,83 / 0,88 |
| Versal | 0,67 / 0,75 | 0,67 / 0,75 |

Con il reranker il processo di ricerca arriva a ~1,2 GB contro qualche centinaio di MB.
Il campione è piccolo: è un'indicazione, non una prova.

## Decisione
Il reranker resta scaricabile e si attiva quando è installato, ma Impostazioni non lo descrive
più come "più preciso" e dice quanta memoria usa.

## Alternative scartate
Alternatives not recorded.

## Conseguenze
Da riconsiderare con più domande di valutazione (proposta nel [tracker](../work-tracker.md)).

## Approval
<!-- wiki:approval -->
accepted: Stefano, sessione con Claude Code (piano RAG solo codice), 2026-11-11
