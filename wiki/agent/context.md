---
type: AgentNote
title: Contesto per gli agenti
description: Obiettivi, regole non negoziabili, comandi e fatti verificati dell'app Codebase Wiki.
generated: { by: antigravity/unknown, at: 2026-11-19T10:45:00Z }
sources:
  - README.md
  - Cargo.toml
  - package.json
  - src-tauri/tauri.conf.json
  - .github/workflows/build.yml
  - wiki/index.md
  - wiki/SCHEMA.md
source_commit: 0763ea1
confidence: high
---

# Contesto per gli agenti

## Obiettivi e non-obiettivi
<!-- wiki:goals -->
- Obiettivo: un pannello desktop (Windows, macOS Apple Silicon, Linux) da cui una persona vede cosa la aspetta in una wiki del plugin Codebase Wiki LLM e fa le azioni riservate alle persone senza toccare il markdown a mano.
- Obiettivo: ogni scrittura dell'app lascia il validatore del plugin pulito e cambia solo le righe attese (più la voce di log).
- Obiettivo: ricerca locale sul **codice** del progetto, data agli agenti via MCP (`search_code`).
- Non-obiettivo: scrivere la wiki al posto degli agenti (lo fanno `/wiki-sync`, `/wiki-ingest` del plugin).
- Non-obiettivo: cercare nella wiki con il RAG: la wiki si legge partendo da `index.md` ([decisione 0004](../project/decisions/0004-rag-solo-codice.md)).
- Non-obiettivo: macOS Intel ([decisione 0003](../project/decisions/0003-macos-solo-apple-silicon.md)).

## Regole non negoziabili
<!-- wiki:rules -->
1. Mai `git add -A` o `git add .`: aggiungi i file per nome (cartelle locali non tracciate possono finire nel commit).
2. Crate Rust con versione fissata `=x.y.z`, nessun `cargo update` generale: il toolchain è rustc 1.90 (`Cargo.toml` → `rust-version`).
3. Interfaccia in italiano e inglese (testi in `src/i18n/`); codice, commit e note di release in inglese.
4. La classe `btn-human` (Cobalto `#3452dd` in chiaro, `#6e8eff` / `#3f5ef3` in scuro) è solo per azioni con autorità umana ([design](../../docs/tasks/design.md)).
5. `resources/validate-wiki.py` è una copia identica di quello del plugin: si aggiorna copiandolo, mai modificandolo.
6. Nei test non si scrivono mai le config reali `~/.claude*`, `~/.codex`, `~/.cursor` e non si lancia un vero `claude mcp add`.
7. Merge su `main`, tag e release solo con l'ok esplicito di Stefano.

## Comandi frequenti
<!-- wiki:commands -->
| Scopo | Comando | Verificato |
| --- | --- | --- |
| Test frontend | `node --test tests/*.test.ts` (`npm test`) | 2026-11-19 @0763ea1+local → 193 pass |
| Test Rust | `cargo test --workspace` | 2026-11-19 @0763ea1+local → 140 pass (14 app + 67 rag-core + 58 wiki-core + 1 wiki-mcp) |
| Clippy Rust | `cargo clippy --workspace --all-targets` | 2026-11-19 @0763ea1+local → 0 avvisi |
| Build frontend | `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build` (`npm run build`) | 2026-11-19 @0763ea1+local → ok (0 errori TS, max chunk 223.51 kB) |
| App in sviluppo | `npm run tauri dev` | ⚠️ NOT VERIFIED - non lanciato in questa sessione |
| Bundle macOS locale | `npm run build:app` (senza chiave di firma: `npx tauri build` da solo fallisce) | 2026-11-13 @224232f → `Codebase Wiki.app` 89 MB |
| Eseguibile di ricerca | `cargo build -p wiki-mcp --release --features embed` | 2026-11-11 @fe7bba6 |

## Fatti verificati
<!-- wiki:verified-facts -->
Non ricavarli di nuovo. Ricontrolla un fatto solo se la sua prova è cambiata o è segnato `⚠️ TO RE-VERIFY`.

| Fatto | Valore | Prova | Verificato |
| --- | --- | --- | --- |
| Versione | 0.8.0 | `package.json`, `Cargo.toml`, `src-tauri/tauri.conf.json` | 2026-11-18 @0763ea1 |
| Validatore incluso | plugin 0.16.0, formato 0.12.0 | `python3 resources/validate-wiki.py --version` | 2026-11-19 @0763ea1 |
| Cartella dati RAG | `<data_local_dir>/com.codebasewiki.app/rag`, sovrascrivibile con `CODEBASE_WIKI_DATA_DIR` | `crates/rag-core/src/paths.rs` (`data_dir`) | 2026-11-11 @206cc3c |
| L'indice contiene | solo codice e config: niente cartella wiki, Markdown, testo, dati e log | `crates/rag-core/src/files.rs` (`list_files`) | 2026-11-11 @206cc3c |
| Tool MCP | `search_code`, `index_status`, `list_repos` | `crates/wiki-mcp/src/serve.rs` | 2026-11-11 @206cc3c |
| CI | job `test` su ubuntu-22.04, build su windows-latest, macos-latest (aarch64), ubuntu-24.04; i tag `v*` creano una release in bozza | `.github/workflows/build.yml`; run 43073107982 verde | 2026-11-11 @206cc3c |

**Errori già corretti, da non reintrodurre:** "il RAG deve cercare anche nella wiki" → solo codice ([0004](../project/decisions/0004-rag-solo-codice.md)); "il reranker è più preciso" → sul codice ha peggiorato il primo risultato ([0005](../project/decisions/0005-reranker-facoltativo.md)).

## Da leggere prima
<!-- wiki:read-first -->
1. [Indice della wiki](../index.md)
2. [Tracker](../project/work-tracker.md)
3. [Handoff](handoff.md): la riga 1 del baton è il primo compito
4. [Architettura](../architecture.md)
