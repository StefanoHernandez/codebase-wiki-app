# Regole comuni per gli agenti (leggere prima del brief)

Progetto: **Codebase Wiki** — app desktop Tauri v2 + React 18 + TypeScript (Vite) che fa da pannello di controllo per una persona sopra le wiki del plugin Codebase Wiki LLM. Backend Rust in `crates/wiki-core` (logica pura) e `src-tauri` (comandi). Frontend in `src/`.

Leggi anche, in questa cartella: `global-constraints.md` (formati del plugin, regole di processo) e `design.md` (design vincolante: token, font, colore ultramarine solo per azioni umane, copy italiano, lista "da evitare").

## Dove lavori
- Parti dal branch **`rewrite/tauri-v2`** (non da `main`). Crea il tuo branch `cursor/<task>` (il nome esatto è nel prompt) e lavora solo lì.
- Puoi fare push **solo** del tuo branch. Se apri una pull request, la base deve essere `rewrite/tauri-v2`, mai `main`. Non fare merge, rebase o push su altri branch.
- Primo comando: `npm install` (dipendenze locali al progetto, niente installazioni globali).
- Rust: non eseguire `cargo update` in blocco (il lock è tenuto compatibile con rustc 1.90). Se serve una crate nuova scegli una versione compatibile.
- Linux: per compilare `src-tauri` servono i pacchetti di sistema (`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev`). Se puoi installarli con apt fallo; se no, esegui almeno `cargo test -p wiki-core` e scrivi nel report cosa non hai potuto compilare.
- Python: `resources/validate-wiki.py` usa solo la stdlib, non serve un venv (serve `python3`).

## Confini dei file (importante: 5 agenti lavorano in parallelo)
- Tocca **solo** i file elencati nel tuo brief alla voce "File che puoi toccare". Se ti serve modificare altro, fermati e scrivilo nel report come blocco.
- Mai toccare: `package.json`, `package-lock.json`, `src/main.tsx`, `src/styles/*.css` (esistenti), `src/lib/*`, `src/state/*`, `src/api.ts`, `src/components/Markdown.tsx` — salvo che il tuo brief li elenchi esplicitamente.
- CSS della tua vista: crea un file tuo `src/views/<nome>.css` e importalo dal file `.tsx` della vista (`import './<nome>.css'`). Riusa le classi e i token già esistenti in `src/styles/`.
- Test nuovi: un file tuo `tests/<nome>.test.ts`. Per le prove sul validatore usa gli helper in `tests/helpers/fixture.ts` (`makeTempRepo`, `runValidator`, `read`, `logEntries`) e la fixture `tests/fixtures/wiki-v2/`. Non modificare la fixture né `tests/fixture-validator.test.ts`.
- Mai scrivere in wiki reali: i test scrivono solo in cartelle temporanee.

## Mattoni già pronti (leggili prima di scrivere codice)
- `src/state/project.tsx` → `useProject()`: snapshot, schema, tracker, handoff, decisions, pages (frontmatter + trust tier), attention, lint + `runLint()`, `actor` (nome persona, già trim), `actorError`, `act(writes)` che scrive i file e ricarica, `reload()`.
- `src/state/nav.tsx` → `useNav()` con `go(section, ref)`.
- `src/components/`: `Dialog` (modale nativa), `Empty`, `Toast`, `TrackerDialogs.tsx` (contiene `useSigned`: controllo campi, busy, errore nel dialog, errori "stale"), `stamp.ts` (`useStamp()` per l'animazione timbro dopo un'azione umana), `Markdown.tsx` (rende una pagina wiki; prop `markdown`, `pagePath`, `onOpenPage`).
- `src/lib/`: `human-actions.ts` (promote, close ⚫, accept/reject decision, updateOpenRowField, markPageReviewed, appendLogEntry), `decisions.ts`, `trust.ts`, `attention.ts`, `markdown-tables.ts` (parseTrackerMarkdown, parseHandoffMarkdown), `schema-parser.ts`, `graph-builder.ts`.
- `src/api.ts` (unico modulo che importa `@tauri-apps`): `readSourceFile`, `sourceDiff`, `runLint`, `workflowPrompt`, `copyText`, ecc.
- Viste esistenti da usare come esempio di stile: `src/views/PerTe.tsx`, `src/views/Lavori.tsx`.

## Qualità
- TDD dove c'è logica (scrivi il test, vedilo fallire, poi implementa).
- Prima di ogni commit: `npm test` e `npm run build` puliti; se tocchi Rust anche `cargo test --workspace` e `cargo build --workspace` senza warning.
- Commit piccoli, messaggi conventional (`feat(ui): …`), ultima riga del messaggio: `Co-Authored-By: Cursor Agent <noreply@cursor.com>`.
- Copy UI in italiano, frasi brevi, verbo che dice l'azione (vedi `design.md`).

## Alla fine
Scrivi il report in `docs/tasks/reports/<TASK>.md` (es. `T7.md`), committalo e fai push del tuo branch:
- stato: FATTO | FATTO CON DUBBI | BLOCCATO
- cosa hai fatto, file cambiati
- comandi eseguiti con l'output essenziale (test, build)
- cosa non hai potuto verificare (es. aspetto visivo nella finestra Tauri)
- dubbi o blocchi
Poi fermati: la revisione e il merge li fa il coordinatore.
