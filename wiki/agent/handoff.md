---
type: AgentNote
title: Passaggio di consegne
description: Stato del lavoro e prossimo compito per l'agente che riprende l'app Codebase Wiki.
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - wiki/SCHEMA.md
  - wiki/log.md
  - wiki/project/work-tracker.md
  - crates/wiki-mcp/src/serve.rs
source_commit: 206cc3c
confidence: high
---

# Passaggio di consegne

## Stato del lavoro
<!-- wiki:state -->

- Tracker IDs: T1, T3, T4, T5
- Goal: prossimo sottoprogetto (identità: icona e palette; poi seconda passata di UI, primo avvio guidato, tracker con dipendenze)
- Last completed step: vista Progetti e registro delle chiamate MCP uniti a `main` (T10)
- Current branch: `main`
- Last commit: merge di `feat/progetti` su `main` (sopra `6648f9f`)
- Worktree: clean

## Baton per il prossimo agente
<!-- wiki:baton -->

| Order | Task | Start files | Done when | Verification command | Notes / blockers |
| --- | --- | --- | --- | --- | --- |
| 1 | T3 - adopt della copia di prova di Versal e prova delle azioni umane | `resources/validate-wiki.py`, `src/lib/md-edit.ts` | see T3 | `python3 resources/validate-wiki.py --json versal-test/docs` | la copia sta nello scratchpad di una sessione: se non c'è più, rifarla dallo zip in `~/Downloads` senza toccare gli originali |
| 2 | T4 - osservare lo scarico dei modelli del server MCP | `crates/wiki-mcp/src/serve.rs` | see T4 | Monitoraggio Attività | serve un server avviato dall'eseguibile 0.3.1 |

## Blocchi
<!-- wiki:blockers -->

| Blocker | Type | Needed from | Current workaround |
| --- | --- | --- | --- |
| Nessuna macchina Windows | esterno | Stefano | T2 rimandato |

## Rischi noti
<!-- wiki:risks -->

| Risk | Impact | Mitigation | Evidence |
| --- | --- | --- | --- |
| R1 Windows mai provato | azioni o "Collega" rotti su Windows | T2 | [rischi](../project/risks.md) |
| R3 memoria del server MCP | Mac da 8 GB in swap | scarico dopo 5 minuti (T4) | [rischi](../project/risks.md) |

## Comandi già eseguiti
<!-- wiki:commands-run -->

| Command | Directory | Result | Evidence / notes |
| --- | --- | --- | --- |
| `npm test` | repo | pass @47eaee0 | 140 test |
| `cargo test --workspace` | repo | pass @47eaee0 | tutti verdi; `cargo test -p wiki-mcp --features embed` 2 test |
| `npm run tauri build -- --bundles app` | repo | pass @9a19fdd | `Codebase Wiki.app` 85 MB, `Signature=adhoc`, `codesign --verify --deep --strict` ok |
| CI tag `v0.3.1` | GitHub Actions | pass @979d5a7 | run 43117157795 |

## Da non rifare
<!-- wiki:do-not-redo -->

- Valutazione del RAG su plugin e Versal, e decisione di cercare solo nel codice: [0004](../project/decisions/0004-rag-solo-codice.md), [log](../log.md).
- Misura del reranker e di 4 modelli di embedding sul codice: [0005](../project/decisions/0005-reranker-facoltativo.md).
- Prove di ranking su 58 domande (identificatori spezzati, CodeRankEmbed scartati; test penalizzati e query in inglese tenuti): [log](../log.md).
- Pulizia dei branch vecchi e della cartella annidata `codebase-wiki-app/`: [log](../log.md).

## Traccia delle prove
<!-- wiki:evidence-trail -->

- `log`: [log.md](../log.md), voci del 2026-11-11
- `tracker`: T1, T3, T4, T5, T6 aperti; T9, T10 chiusi
- `decisions`: [0004](../project/decisions/0004-rag-solo-codice.md), [0005](../project/decisions/0005-reranker-facoltativo.md)
