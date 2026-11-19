---
type: AgentNote
title: Passaggio di consegne
description: Stato del lavoro e prossimo compito per l'agente che riprende l'app Codebase Wiki.
generated: { by: antigravity/unknown, at: 2026-11-19T10:56:00Z }
sources:
  - wiki/SCHEMA.md
  - wiki/log.md
  - wiki/project/work-tracker.md
  - crates/wiki-mcp/src/serve.rs
source_commit: 0fd018d
confidence: high
---

# Passaggio di consegne

## Stato del lavoro
<!-- wiki:state -->

- Tracker IDs: T1, T2, T3, T4, T5, T6
- Goal: nessun sottoprogetto aperto; 0.8.1 pronta per la pubblicazione (`v0.8.1`), restano le prove a mano e sul campo (T1–T6)
- Last completed step: release 0.8.1 (correzioni IPC/RAG/UI, 0 avvisi Clippy, `LaunchIntro` preservata e provata in `tauri dev`)
- Current branch: `main`
- Last commit: `release: 0.8.1`
- Worktree: clean dopo i commit

## Baton per il prossimo agente
<!-- wiki:baton -->

| Order | Task | Start files | Done when | Verification command | Notes / blockers |
| --- | --- | --- | --- | --- | --- |
| 1 | T3 - adopt della copia della wiki di prova sul campo e prova delle azioni umane | `resources/validate-wiki.py`, `src/lib/md-edit.ts` | see T3 | `python3 resources/validate-wiki.py --json field-test/docs` | la copia sta nello scratchpad di una sessione: se non c'è più, rifarla dallo zip in `~/Downloads` senza toccare gli originali |
| 2 | T4 - osservare lo scarico dei modelli del server MCP | `crates/wiki-mcp/src/serve.rs` | see T4 | Monitoraggio Attività | serve un server avviato dall'eseguibile locale |

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
| `cargo test --workspace` | repo | pass @0763ea1+local | 140 pass (14 app + 67 rag-core + 58 wiki-core + 1 wiki-mcp), 0 warning |
| `cargo clippy --workspace --all-targets` | repo | pass @0763ea1+local | 0 warning |
| `node --test tests/*.test.ts` | repo | pass @0763ea1+local | 193 pass, 0 fail |
| `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build` | repo | pass @0763ea1+local | 0 errori TS, Vite ok, chunk JS max 223.51 kB |
| `npm run build:app` | repo | pass @224232f | `Codebase Wiki.app` 89 MB; `npx tauri build` senza override ora fallisce per la chiave di firma mancante |
| CI tag `v0.8.0` | GitHub Actions | pass | run 44376939392 → test e 3 build success |

## Da non rifare
<!-- wiki:do-not-redo -->

- Valutazione del RAG su plugin e wiki di prova sul campo, e decisione di cercare solo nel codice: [0004](../project/decisions/0004-rag-solo-codice.md), [log](../log.md).
- Misura del reranker e di 4 modelli di embedding sul codice: [0005](../project/decisions/0005-reranker-facoltativo.md).
- Prove di ranking su 58 domande (identificatori spezzati, CodeRankEmbed scartati; test penalizzati e query in inglese tenuti): [log](../log.md).
- Pulizia dei branch vecchi e della cartella annidata `codebase-wiki-app/`: [log](../log.md).

## Traccia delle prove
<!-- wiki:evidence-trail -->

- `log`: [log.md](../log.md), voci fino al 2026-11-19 (archivio 0.3–0.6 in [log/releases-0.3-0.6.md](../log/releases-0.3-0.6.md))
- `tracker`: T1–T6 aperti; T7–T13 chiusi
- `decisions`: [0004](../project/decisions/0004-rag-solo-codice.md), [0005](../project/decisions/0005-reranker-facoltativo.md)
