---
type: AgentNote
title: Contesto per gli agenti
description: Obiettivi, regole non negoziabili, comandi e fatti verificati dell'app Codebase Wiki.
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - README.md
  - Cargo.toml
  - package.json
  - .github/workflows/build.yml
  - wiki/index.md
  - wiki/SCHEMA.md
source_commit: 206cc3c
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
3. Testi dell'interfaccia in italiano; codice, commit e note di release in inglese.
4. La classe `btn-human` (ultramarine) è solo per azioni con autorità umana ([design](../../docs/tasks/design.md)).
5. `resources/validate-wiki.py` è una copia identica di quello del plugin: si aggiorna copiandolo, mai modificandolo.
6. Nei test non si scrivono mai le config reali `~/.claude*`, `~/.codex`, `~/.cursor` e non si lancia un vero `claude mcp add`.
7. Merge su `main`, tag e release solo con l'ok esplicito di Stefano.

## Comandi frequenti
<!-- wiki:commands -->
| Scopo | Comando | Verificato |
| --- | --- | --- |
| Test frontend | `npm test` | 2026-11-11 @fe7bba6 → 130 pass |
| Test Rust | `cargo test --workspace` | 2026-11-11 @fe7bba6 → tutti verdi |
| Build frontend | `npm run build` | 2026-11-11 @fe7bba6 |
| App in sviluppo | `npm run tauri dev` | ⚠️ NOT VERIFIED - non lanciato in questa sessione |
| Bundle macOS locale | `npx tauri build --bundles app` | 2026-11-11 @fe7bba6 → `Codebase Wiki.app` 85 MB |
| Eseguibile di ricerca | `cargo build -p wiki-mcp --release --features embed` | 2026-11-11 @fe7bba6 |

## Fatti verificati
<!-- wiki:verified-facts -->
Non ricavarli di nuovo. Ricontrolla un fatto solo se la sua prova è cambiata o è segnato `⚠️ TO RE-VERIFY`.

| Fatto | Valore | Prova | Verificato |
| --- | --- | --- | --- |
| Versione | 0.3.0 | `package.json`, `src-tauri/tauri.conf.json`, tag `v0.3.0` | 2026-11-11 @206cc3c |
| Validatore incluso | plugin 0.13.1, formato 0.12.0 | `python3 resources/validate-wiki.py --version` | 2026-11-11 @206cc3c |
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
