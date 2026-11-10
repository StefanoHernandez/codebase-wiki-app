# T10 — CI multipiattaforma + README

Prima leggi `docs/tasks/COMMON.md` e `global-constraints.md`.

## File che puoi toccare
- nuovo: `.github/workflows/build.yml`
- `README.md` (riscrittura)
- `resources/run-human-action.mjs` (da cancellare, vedi sotto)
- report: `docs/tasks/reports/T10.md`

## A. `.github/workflows/build.yml`
- Trigger: push su `main` e `rewrite/**`, pull_request, workflow_dispatch, tag `v*`.
- Job `test` (ubuntu-22.04): checkout, setup-node (Node 24, cache npm), `npm ci`, `npm test`, `npx tsc --noEmit`, toolchain Rust stable, pacchetti Linux per Tauri (`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev`), `cargo test --workspace`, python3 disponibile (serve ai test del validatore). Cache `Swatinem/rust-cache@v2`.
- Job `build` (needs: test), matrice: `macos-latest` (universal: `--target universal-apple-darwin`, aggiungi entrambi i target Rust), `windows-latest`, `ubuntu-22.04`. Usa `tauri-apps/tauri-action@v0`. Sui tag crea una release bozza; altrimenti carica gli artefatti con `actions/upload-artifact@v4` (`.dmg`/`.app`, `.msi`/`.exe`, `.AppImage`/`.deb`).
- Niente secret di firma: lascia un commento dove andrebbe la firma (macOS notarization, Windows code signing).
- Nota: `Cargo.lock` tiene `notify-types` 2.0.0 per rustc 1.90; la CI usa stable, va bene così. Non aggiornare il lock.

## B. README.md (italiano, conciso)
- Cos'è: pannello di controllo per le wiki di Codebase Wiki LLM; una riga per sezione (Per te, Lavori, Decisioni, Handoff, Salute, Grafo).
- Requisiti: Node ≥ 22, Rust stable, Python 3 (solo per il controllo di struttura), Git; pacchetti di sistema Linux.
- Sviluppo: `npm install`, `npm run tauri dev`. Test: `npm test`, `cargo test --workspace`. Build: `npm run tauri build`.
- Formati delle azioni umane esattamente come in `global-constraints.md` (⚫: `closed by <person> YYYY-MM-DD; not proven: <what>`; decisioni accettate/rifiutate solo da `proposed`; `verified` su una riga).
- Togli ogni riferimento al vecchio server HTTP, `--headless`, `build-ui.ts`.

## C. Pulizia
`resources/run-human-action.mjs` è un bundle generato dal vecchio script di build e non è più usato: verifica con una ricerca nel repo che nessuno lo importi o lo citi (escluso questo brief), poi cancellalo.

## Fatto quando
- Workflow valido: prova `npx --yes @action-validator/cli .github/workflows/build.yml` oppure `actionlint` se c'è; se nessuno dei due gira, scrivilo nel report.
- Comandi del README verificati in locale dove possibile (`npm test`, `cargo test --workspace`, `npm run build`).
- Report scritto e committato.
