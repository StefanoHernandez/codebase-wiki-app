---
title: Wiki di Codebase Wiki (app)
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - wiki/SCHEMA.md
  - wiki/project/work-tracker.md
  - README.md
source_commit: 206cc3c
confidence: high
---

# Wiki di Codebase Wiki (app)

App desktop Tauri v2 che fa da pannello di controllo per una persona sulle wiki del plugin
Codebase Wiki LLM, con ricerca locale sul codice offerta agli agenti via MCP. Ci lavorano
Stefano e gli agenti (Claude Code, Cursor).

## Indice

### Progetto
- [Tracker dei lavori](project/work-tracker.md) — unica fonte dello stato dei lavori
- [Log](log.md) — cosa è stato fatto, quando, con quali prove
- [Decisioni](project/decisions/) — decisioni prese e perché
- [Rischi](project/risks.md) — cosa può andare storto e cosa lo segnalerebbe

### Ingegneria
- [Architettura](architecture.md) — componenti, confini, flusso dei dati e invarianti
- [wiki-core](modules/wiki-core.md) — lettura, scrittura e validazione sicure della wiki
- [rag-core e wiki-mcp](modules/rag-mcp.md) — indice di ricerca sul codice e server MCP
- [App](modules/app.md) — viste, azioni umane e modifiche chirurgiche alla wiki
- [Sviluppo](engineering/development.md) — requisiti, comandi e convenzioni
- [Test](engineering/testing.md) — suite, fixture e valutazione della ricerca
- [CI, release e distribuzione](engineering/operations.md) — come si costruiscono e pubblicano i pacchetti

### Trasversali
- [Schema](SCHEMA.md) · [contesto per gli agenti](agent/context.md) · [handoff](agent/handoff.md)
- [Problemi noti](troubleshooting.md) · [glossario](glossary.md)

Storia del progetto (piani, spec e brief di lavoro, non mantenuti): `docs/superpowers/`, `docs/tasks/`.

## A che punto siamo

Lo stato è solo nel [tracker](project/work-tracker.md), con i prossimi passi; cosa è stato
fatto e quando nel [log](log.md).

## Come è organizzata questa wiki
<!-- wiki:owners -->

| Topic | Owner page |
| --- | --- |
| Stato dei lavori, prossimi passi | [tracker](project/work-tracker.md) |
| Cosa è stato fatto, quando | [log](log.md) |
| Decisioni e perché | [decisioni](project/decisions/) |
| Rischi | [rischi](project/risks.md) |
| Prossimo compito per un agente | [handoff](agent/handoff.md) |
| Fatti verificati | [contesto per gli agenti](agent/context.md) |
| Architettura | [architettura](architecture.md) |
| Moduli | [wiki-core](modules/wiki-core.md) |
| Sviluppo | [sviluppo](engineering/development.md) |
| Test | [test](engineering/testing.md) |
| Operations | [CI e release](engineering/operations.md) |
