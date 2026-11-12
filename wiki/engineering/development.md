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
| Bundle macOS locale | `npx tauri build --bundles app` |

Se la build del frontend fallisce su un import mancante (es. un font), `node_modules` è
vecchio: `npm ci`.

## Sidecar
`scripts/build-sidecar.mjs` compila `codebase-wiki-mcp` con `--features embed` e lo copia in
`src-tauri/binaries/codebase-wiki-mcp-<triple>`, dove `externalBin` di Tauri lo prende.
All'avvio l'app lo copia in `<data>/bin/` per dare agli agenti un percorso stabile; gli agenti
già collegati usano il vecchio finché non vengono riavviati (banner in Ricerca).

## Icona
Sorgenti in `src-tauri/icons/src/`: `icon.svg` (timbro "cw" con doppio anello, per le taglie grandi) e
`icon-small.svg` (anello pieno, per 16–32 px). Le lettere sono tracciati del font Newsreader, quindi
non serve il font per generarle. Per rigenerare: `npx tauri icon src-tauri/icons/src/icon.svg -o <tmp>`
e `npx tauri icon src-tauri/icons/src/icon-small.svg -o <tmp-small>`; copiare in `src-tauri/icons/`
i file esistenti dal primo, poi `32x32.png`, `Square30x30Logo.png`, `Square44x44Logo.png` e
`icon.ico` dal secondo (le cartelle `android/` e `ios/` non servono). `src/assets/mark.svg` è la
copia di `icon-small.svg` usata nella barra laterale e come favicon.

## Convenzioni
Le regole non negoziabili stanno nel [contesto per gli agenti](../agent/context.md#regole-non-negoziabili).
Regole per gli agenti e confini dei file storici: `docs/tasks/COMMON.md`, `docs/tasks/global-constraints.md`.
