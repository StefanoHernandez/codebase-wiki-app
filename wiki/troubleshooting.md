---
type: Engineering
title: Problemi noti
description: Problemi non ovvi già risolti e come riconoscerli.
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - .github/workflows/build.yml
  - package.json
  - crates/wiki-mcp/src/serve.rs
source_commit: 206cc3c
confidence: high
---

# Problemi noti

## La build del frontend fallisce su un import non risolto (es. `@fontsource/...`)
- **Cause:** `node_modules` installato prima che cambiassero le dipendenze.
- **Fix:** `npm ci`.
- **Workaround:** none
- **Verification:** `npm ci && npm run build` → `✓ built`, 2026-11-11 @4272c84
- **Limits:** none known
- **Related:** [sviluppo](engineering/development.md)

## Il job `test` della CI fallisce su `apt-get` con `Temporary failure resolving 'azure.archive.ubuntu.com'`
- **Cause:** rete DNS del runner GitHub, non il codice.
- **Fix:** none yet
- **Workaround:** `gh run rerun <id>`
- **Verification:** run 43042151396 (tag v0.2.0) rilanciato → tutti i job success, 2026-11-11
- **Limits:** none known
- **Related:** [CI e release](engineering/operations.md)

## Gli agenti usano ancora il vecchio server MCP dopo un aggiornamento
- **Cause:** ogni agente avvia il suo processo `codebase-wiki-mcp serve` e lo tiene finché la sessione è aperta.
- **Fix:** chiudere e riaprire gli agenti collegati (l'app lo segnala in Ricerca).
- **Workaround:** none
- **Verification:** ⚠️ NOT VERIFIED - osservato con `ps` il 2026-11-11, nessun comando di prova dedicato
- **Limits:** none known
- **Related:** [rag-core e wiki-mcp](modules/rag-mcp.md)
