---
type: Engineering
title: CI, release e distribuzione
description: Come si costruiscono e pubblicano i pacchetti dell'app.
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - .github/workflows/build.yml
  - src-tauri/tauri.conf.json
  - package.json
  - Cargo.toml
source_commit: 206cc3c
confidence: high
---

# CI, release e distribuzione

## CI (`.github/workflows/build.yml`)
- Parte su push a `main` o `rewrite/**`, sui tag `v*`, sulle PR e a mano (`workflow_dispatch`).
  Un altro branch non la fa partire da solo: `gh workflow run build.yml --ref <branch>`.
- Job `test` su ubuntu-22.04: `npm ci`, `tsc`, `npm test`, test Rust.
- Build: windows-latest, macos-latest (`aarch64-apple-darwin`, [0003](../project/decisions/0003-macos-solo-apple-silicon.md)), ubuntu-24.04.
- Se `apt-get` fallisce con `Temporary failure resolving 'azure.archive.ubuntu.com'` è la rete
  del runner: si rilancia (`gh run rerun <id>`), non è un errore del codice.

## Release
1. Portare la versione in `package.json`, `package-lock.json` (2 righe), `src-tauri/tauri.conf.json`,
   i quattro `Cargo.toml` (`crates/*`, `src-tauri`) e `Cargo.lock`.
2. Commit `release: X.Y.Z` e tag annotato `vX.Y.Z`; push **solo del tag** (una sola CI). Dopo la
   pubblicazione, push di `main` con un commit che ha `[skip ci]` nel messaggio, così non riparte
   una seconda build sullo stesso codice.
3. La CI del tag crea una release **in bozza** con `.dmg`, `.app.tar.gz`, `.exe`, `.msi`,
   `.AppImage`, `.deb`, `.rpm`, le firme `.sig` e `latest.json` (dalla 0.6.0). Firma con i secret
   `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; la chiave privata sta solo
   lì e sul Mac di Stefano (`~/.tauri/codebase-wiki.key`), la pubblica in `tauri.conf.json`. Le
   build dei branch e `npm run build:app` usano `src-tauri/tauri.no-updater.conf.json`.
4. Scrivere le note e pubblicarla (`gh release edit vX.Y.Z --draft=false --latest`).

Merge su `main`, tag e pubblicazione solo con l'ok di Stefano.

## Dopo l'aggiornamento
Le app dalla 0.6.0 in poi trovano la release pubblicata come `latest` tramite
`releases/latest/download/latest.json` e propongono "Aggiorna e riavvia"; la 0.5.x va aggiornata
a mano una volta.
All'avvio l'app copia il nuovo `codebase-wiki-mcp` in `<data>/bin/`; gli agenti già collegati
vanno chiusi e riaperti per usarlo.
