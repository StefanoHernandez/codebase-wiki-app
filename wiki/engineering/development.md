---
type: Engineering
title: Sviluppo
description: Requisiti, comandi e convenzioni per lavorare sull'app.
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - README.md
  - package.json
  - Cargo.toml
  - scripts/build-sidecar.mjs
  - src-tauri/tauri.conf.json
source_commit: 206cc3c
confidence: high
---

# Sviluppo

## Requisiti
Node.js ≥ 22, Rust stable con rustc ≥ 1.90, Python ≥ 3.10 (solo per il validatore, stdlib),
Git; su Linux le librerie WebKitGTK elencate nel README. Il progetto non ha dipendenze Python
da installare: nessuna `.venv` necessaria.

## Comandi

| Scopo | Comando |
| --- | --- |
| Dipendenze | `npm ci` |
| App in sviluppo | `npm run tauri dev` |
| Build frontend | `npm run build` |
| Eseguibile di ricerca per l'app | `node scripts/build-sidecar.mjs` (in dev: `--if-missing`) |
| Bundle macOS locale | `npm run build:app` (senza artefatti di aggiornamento: la chiave sta solo nei secret della CI) |

Se la build del frontend fallisce su un import mancante (es. un font), `node_modules` è
vecchio: `npm ci`.

## Sidecar
`scripts/build-sidecar.mjs` compila `codebase-wiki-mcp` con `--features embed` e lo copia in
`src-tauri/binaries/codebase-wiki-mcp-<triple>`, dove `externalBin` di Tauri lo prende.
All'avvio l'app lo copia in `<data>/bin/` per dare agli agenti un percorso stabile; gli agenti
già collegati usano il vecchio finché non vengono riavviati (banner in Ricerca).

## Icona
Sorgente unica `src-tauri/icons/src/icon.svg`: "00_modern" di Alessandro Cianfaglione (anello pieno su
gradiente oltremare, lettere già in tracciati), messa sulla griglia macOS (824 px dentro 1024). L'anello
pieno si legge anche a 16–32 px, quindi non serve più una versione piccola. Per rigenerare:
`npx tauri icon src-tauri/icons/src/icon.svg -o <tmp>` e copiare in `src-tauri/icons/` i file che già
ci sono (non `android/` e `ios/`). `src/assets/mark.svg` è l'originale a tutto quadro, usato come favicon.
Dopo l'installazione macOS può mostrare la vecchia icona: `lsregister -f` sull'app e `killall Dock`.

## Convenzioni
Le regole non negoziabili stanno nel [contesto per gli agenti](../agent/context.md#regole-non-negoziabili).
Regole per gli agenti e confini dei file storici: `docs/tasks/COMMON.md`, `docs/tasks/global-constraints.md`.
