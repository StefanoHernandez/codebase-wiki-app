# Codebase Wiki

Applicazione desktop **Tauri v2** + React: pannello di controllo per una persona sulle wiki generate dal plugin [Codebase Wiki LLM](https://github.com/StefanoHernandez/codebase-wiki-llm). Apri un repository Git, scegli la wiki (`.wikidir` o `wiki/`) e lavora su tracker, decisioni e salute strutturale senza uscire dall’app.

## Viste

- **Per te** — ciò che richiede la tua attenzione (revisioni, drift, handoff stale).
- **Lavori** — tracker `Open` / `Proposals` / `Done` con azioni umane (promuovi, chiudi).
- **Decisioni** — ADR in `project/decisions/` con accetta / rifiuta da `proposed`.
- **Handoff** — stato e baton per il prossimo agente.
- **Salute** — lint strutturale (`validate-wiki.py`) e budget di lettura.
- **Grafo** — pagine wiki e sorgenti collegate, drift e filtri.

## Requisiti

- **Node.js** ≥ 22
- **Rust** (toolchain stable) e **Cargo**
- **Python 3.10 o più recente** — per il controllo strutturale (`resources/validate-wiki.py`, copia identica di quello del plugin Codebase Wiki LLM 0.13.0, solo stdlib). L’app cerca, in ordine: il percorso indicato nelle impostazioni, `python3.13`…`python3.10`, `python3` e `python` nel PATH, poi `/opt/homebrew/bin`, `/usr/local/bin`, `~/.pyenv/shims` e, su Windows, `py -3`. Su macOS, aperta dal Finder, non usa il `python3` di sistema se è più vecchio della 3.10. Senza Python l’app funziona ma non controlla la struttura: lo dice in Salute.
- **Plugin Codebase Wiki LLM** nell’agente che usi (Claude Code, Codex, Antigravity): i bottoni «Copia prompt» copiano il comando del plugin (`/wiki-sync`, `/wiki-init --adopt <wiki>`), da incollare nell’agente.
- **Wiki in formato 0.12.0 o più recente.** Una wiki v1 (senza `## Core map`) si apre in sola lettura con la schermata «Wiki non compatibile» e il prompt per aggiornarla.
- **Git**
- **Linux (build desktop):** `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`, `libgtk-3-dev`

## Sviluppo

```bash
npm install
npm run tauri dev
```

All’avvio l’app chiede il repository (o usa quello passato dalla CLI Tauri, se configurato).

## Test e build

```bash
npm test
npx tsc --noEmit
cargo test --workspace
npm run build          # solo frontend (Vite)
npm run tauri build    # bundle desktop (.dmg, .msi, .deb, .AppImage, …)
```

La CI multipiattaforma è in `.github/workflows/build.yml` (test su Ubuntu, build su macOS universal, Windows e Linux).

## Formati delle azioni umane

Allineati al plugin e a `docs/tasks/global-constraints.md`:

| Azione | Regola |
|--------|--------|
| Chiudere un task **⚫** | In `Criteria met`: `closed by <persona> YYYY-MM-DD; not proven: <cosa>`; in `Evidence` la fonte della chiusura umana. |
| Decisione **accettata / rifiutata** | Solo se `status: proposed` nel frontmatter; in `## Approval` si aggiunge la riga accettata/rifiutata (la riga `proposed` resta). |
| **`verified:`** nel frontmatter | Una riga: `{ by, at }` o lista; attore umano `human:<id>`; timestamp ISO 8601 con `Z`; opzionale `commit: <sha>`. |

Ogni azione umana aggiorna i file wiki nella root configurata e appende una voce a `log.md` (`## YYYY-MM-DD · <titolo> · human` con `What`, `Evidence`, `IDs`).

## Licenza

MIT
