---
type: Decision
title: 0005 - Reranker facoltativo, non presentato come più preciso
description: Il reranker resta un modello facoltativo che l'app non raccomanda; misurato su 4 modelli, abbassa sempre il primo risultato.
status: accepted
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T21:30:00Z }
sources:
  - crates/rag-core/src/embed.rs
  - crates/rag-core/src/catalog.rs
  - src/views/Impostazioni.tsx
source_commit: 99f7caf
confidence: medium
---

# 0005 - Reranker facoltativo, non presentato come più preciso

## Contesto
Prima misura del 2026-11-11 con `multilingual-e5-small`, sulle sole domande di codice
(12 sul plugin, 6 su Versal):

| Repo | Con reranker hit@1 / MRR | Senza hit@1 / MRR |
| --- | --- | --- |
| plugin | 0,67 / 0,79 | 0,83 / 0,88 |
| Versal | 0,67 / 0,75 | 0,67 / 0,75 |

Seconda misura, lo stesso giorno: 34 domande di codice dalla risposta nota (16 sull'app,
in parte in italiano; 12 sul plugin; 6 su Versal), quattro modelli di embedding, ciascuno
senza e con `jina-reranker-v2-base-multilingual` (pool 20). Stesso binario 0.3.0,
indici separati per modello.

| Modello | Reranker | hit@1 | hit@5 | MRR | Indicizzazione app |
| --- | --- | --- | --- | --- | --- |
| multilingual-e5-small | no | 25/34 (0,74) | 0,85 | 0,79 | 44 s |
| multilingual-e5-small | sì | 21/34 (0,62) | 0,88 | 0,73 | |
| bge-small-en-v1.5 | no | 23/34 (0,68) | 0,88 | 0,76 | 42 s |
| bge-small-en-v1.5 | sì | 21/34 (0,62) | 0,88 | 0,74 | |
| multilingual-e5-base | no | 24/34 (0,71) | 0,82 | 0,75 | 115 s |
| multilingual-e5-base | sì | 22/34 (0,65) | 0,91 | 0,76 | |
| jina-embeddings-v2-base-code | no | 24/34 (0,71) | 0,91 | 0,79 | 134 s |
| jina-embeddings-v2-base-code | sì | 21/34 (0,62) | 0,88 | 0,74 | |

Il reranker toglie da 2 a 4 risposte giuste al primo posto con ogni modello; l'MRR scende in
tre casi su quattro. Con il reranker il processo di ricerca arriva a ~1,2 GB contro qualche
centinaio di MB. Tra i modelli di embedding le differenze stanno entro 1-2 domande, cioè nel
rumore con 34 domande; gli errori rimasti sono quasi tutti un file vicino al posto di quello
giusto.

## Decisione
Il reranker resta nel catalogo e si attiva quando è installato, ma non è raccomandato:
Impostazioni non lo descrive come "più preciso" e dice quanta memoria usa.
`multilingual-e5-small` resta il modello predefinito. Sul Mac di Stefano il reranker è stato
disinstallato (cartella spostata nel Cestino il 2026-11-11).

## Alternative scartate
- Modello di embedding più grande (`multilingual-e5-base`, `jina-embeddings-v2-base-code`)
  come predefinito: nessun guadagno chiaro sul primo risultato, indicizzazione 2,5-3 volte
  più lenta.
- `bge-small-en-v1.5` come predefinito: peggiore sulle domande in italiano.

## Conseguenze
Per migliorare il primo risultato serve lavorare sul ranking (per esempio dare peso ai nomi
di file e simboli), non sul modello. Il campione resta piccolo: da rifare con più domande
(proposta nel [tracker](../work-tracker.md)).

## Approval
<!-- wiki:approval -->
accepted: Stefano, sessione con Claude Code (piano RAG solo codice), 2026-11-11
