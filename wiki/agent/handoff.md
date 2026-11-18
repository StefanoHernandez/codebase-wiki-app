---
type: AgentNote
title: Passaggio di consegne
description: Stato del lavoro e prossimo compito per l'agente che riprende l'app Codebase Wiki.
generated: { by: antigravity/unknown, at: 2026-11-18T16:33:02Z }
sources:
  - wiki/SCHEMA.md
  - wiki/log.md
  - wiki/project/work-tracker.md
  - crates/wiki-mcp/src/serve.rs
source_commit: 5be5d53
confidence: high
---

# Passaggio di consegne

## Stato del lavoro
<!-- wiki:state -->

- Tracker IDs: T1, T2, T3, T4, T5, T13
- Goal: nessun sottoprogetto aperto; restano le prove a mano (T1–T5; T13 ora provabile: una 0.6.0 installata deve proporre la 0.7.0)
- Last completed step: redesign Carbon & Cobalt e "app per l'umano" (Grafo con Mappa / Grafo / Elenco, copertura, prompt per l'agente, Per te con novità, Salute a carte, Ricerca con pagine della wiki, Decisioni con codice cambiato), provati da Stefano in `tauri dev`; committati sul branch `feat/human-app`, non ancora su `main` né rilasciati
- Current branch: `feat/human-app`
- Last commit: `feat: app for the human: code map, coverage, health cards, wiki search`
- Worktree: clean dopo i commit

## Baton per il prossimo agente
<!-- wiki:baton -->

| Order | Task | Start files | Done when | Verification command | Notes / blockers |
| --- | --- | --- | --- | --- | --- |
| 1 | T3 - adopt della copia della wiki di prova sul campo e prova delle azioni umane | `resources/validate-wiki.py`, `src/lib/md-edit.ts` | see T3 | `python3 resources/validate-wiki.py --json field-test/docs` | la copia sta nello scratchpad di una sessione: se non c'è più, rifarla dallo zip in `~/Downloads` senza toccare gli originali |
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
| `node --test tests/*.test.ts` | repo | pass @710a24c+local | 182 test pass |
| `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build` | repo | pass @710a24c+local | 0 errori TS, Vite built; `detect.mjs --json src` → `[]` |
| `cargo test --workspace` | repo | pass @710a24c+local | 12 + 65 + 56 pass |
| `npm run build:app` | repo | pass @224232f | `Codebase Wiki.app` 89 MB; `npx tauri build` senza override ora fallisce per la chiave di firma mancante |
| CI tag `v0.6.0` | GitHub Actions | pass @80aa12f dopo il rilancio | run 43424572413 |

## Da non rifare
<!-- wiki:do-not-redo -->

- Valutazione del RAG su plugin e wiki di prova sul campo, e decisione di cercare solo nel codice: [0004](../project/decisions/0004-rag-solo-codice.md), [log](../log.md).
- Misura del reranker e di 4 modelli di embedding sul codice: [0005](../project/decisions/0005-reranker-facoltativo.md).
- Prove di ranking su 58 domande (identificatori spezzati, CodeRankEmbed scartati; test penalizzati e query in inglese tenuti): [log](../log.md).
- Pulizia dei branch vecchi e della cartella annidata `codebase-wiki-app/`: [log](../log.md).

## Traccia delle prove
<!-- wiki:evidence-trail -->

- `log`: [log.md](../log.md), voci fino al 2026-11-18
- `tracker`: T1–T6, T13 aperti; T9–T12 chiusi
- `decisions`: [0004](../project/decisions/0004-rag-solo-codice.md), [0005](../project/decisions/0005-reranker-facoltativo.md)
