---
type: Module
title: App (frontend e backend Tauri)
description: Viste, azioni umane e modifiche chirurgiche alla wiki.
generated: { by: antigravity/unknown, at: 2026-11-19T10:45:00Z }
sources:
  - src/App.tsx
  - src/main.tsx
  - src/views/index.ts
  - src/views/Progetti.tsx
  - src/components/Shell.tsx
  - src/components/ErrorBoundary.tsx
  - src/styles/tokens.css
  - src/styles/components.css
  - src/views/grafo.css
  - src/lib/overview.ts
  - src/state/project.tsx
  - src/state/rag.tsx
  - src/lib/md-edit.ts
  - src/lib/human-actions.ts
  - src/lib/attention.ts
  - src/lib/labels.ts
  - src/lib/first-run.ts
  - src/lib/dependencies.ts
  - src/lib/plugin.ts
  - src/lib/graph-history.ts
  - src/lib/rag-format.ts
  - src/lib/updates.ts
  - src/state/updates.tsx
  - src/views/Grafo.tsx
  - src/views/grafo-canvas.ts
  - src/views/Ricerca.tsx
  - src/views/SemanticRadar.tsx
  - src/api.ts
  - src-tauri/src/main.rs
  - src-tauri/src/rag_jobs.rs
  - src-tauri/src/commands/mod.rs
  - src-tauri/src/commands/rag.rs
  - src-tauri/src/commands/plugin.rs
  - src-tauri/src/commands/python.rs
source_commit: 0763ea1
confidence: high
---

# App (frontend e backend Tauri)

## Viste (`src/views/`)

Tutte le viste principali sono caricate on-demand con `React.lazy` in `src/views/index.ts` (e `Impostazioni`/`PrimiPassi` in `Shell.tsx`) e protette da `<ErrorBoundary>` + `<Suspense>` (con un `<ErrorBoundary>` di livello superiore in `App.tsx`). I font `@fontsource` importano solo i subset `latin` e `latin-ext`.

| Vista | Cosa mostra |
| --- | --- |
| Primi passi | nome, progetto con wiki, controllo struttura (Python), modello e indice, un agente con plugin e ricerca; ogni passo si spunta dallo stato reale (`lib/first-run.ts`); prima vista finché non si chiude (`firstRun.done` in localStorage), riapribile da Impostazioni |
| Progetti | tutti i progetti recenti (per te, indice, novità dall'ultima visita, ultimo agente) con caricamento leggero (`loadSnapshot(repo, { includeRepoFiles: false })` e concorrenza limitata a 3 worker) e l'attività degli agenti MCP filtrando query private (`isMaskedPrivateQuery`); prima vista all'avvio con più di un progetto |
| Per te | in testa "Novità nella wiki dall'ultima visita" (commit della wiki o voci del log lette prima che l'apertura sposti la base, `visitNews` in `state/project.tsx`); poi la lista unica di ciò che aspetta una persona (`lib/attention.ts`) |
| Lavori | kanban del tracker, Prossimi passi, promuovi / chiudi ⚫; dalla colonna `Depends on` ogni scheda dice "Pronto" o cosa aspetta (`lib/dependencies.ts`) |
| Decisioni | ADR `proposed` da accettare o rifiutare; le `accepted` il cui codice governato è cambiato dopo portano "codice cambiato" e, aperte, "È ancora valida?" con i file e "Copia il prompt di verifica" |
| Handoff | il baton per il prossimo agente, sola lettura, con avvisi di ritardo |
| Salute | in testa una risposta sola (% di pagine verificate e aggiornate; drift, mai verificate, problemi di struttura, rischi gravi senza responsabile); sotto cinque carte (Fiducia, Struttura, Dimensioni, Rischi, Log) con il numero chiave: un clic apre il dettaglio sotto, una sezione alla volta (un link a una pagina o a un rischio apre la sua). Fiducia spiega i quattro livelli; Dimensioni conta la lettura iniziale come il plugin (`lib/budgets.ts`: SCHEMA, pagine core, ultime 10 voci del log; senza CLAUDE.md/AGENTS.md) e avvisa quando la tabella Budgets di SCHEMA ha ancora i valori di prima del plugin 0.16 |
| Grafo | tre viste con lo stesso selettore Mappa · Grafo · Elenco (`LensSwitch`); si apre sulla **Mappa** (`Mappa.tsx`, `lib/treemap.ts`): le cartelle del codice come riquadri, le cartelle principali con le sottocartelle dentro (un livello), area = numero di file, colore = copertura della wiki (verde descritti, ambra in drift, grigio senza pagina) con barra delle proporzioni; clic seleziona, doppio clic o Invio entra, percorso in alto per risalire; pannello a destra con le pagine che descrivono l'area, le decisioni che la toccano, i file senza pagina e "Copia il prompt per l'agente". "Elenco" è la lente Copertura e "Grafo" il grafo dei collegamenti (su richiesta con `scheduleDraw`, zero CPU a riposo): wiki ↔ codice su canvas 2D (`Grafo.tsx`, `grafo-canvas.ts`): nodi piatti con colore tenue e forma per categoria (`--graph-cat-*` in `grafo.css`, lontani da cobalto, ambra e rosso; bersaglio per le pagine core, triangolo per contesto e handoff, disco per i temi, anello per le decisioni, rombo per tracker e rischi, quadrato per il codice; nodi `core` ingranditi `1.48×` min `7.5px`), cobalto (`--human`) solo per il nodo in primo piano, anelli di stato per drift ed errori, pan/zoom/adatta, esploratore file laterale stile Obsidian a sinistra (evidenziazione al passaggio/clic con centramento sul nodo e apertura in `PageDrawer`), illuminazione del ramo al passaggio e pillole anti-collisione; **▶ Storia** riproduce la crescita commit per commit (`lib/graph-history.ts`); lente **Copertura** (`Copertura.tsx`, `lib/coverage.ts`): per modulo (prime due cartelle) quanti file di codice sono descritti, in drift o senza pagina, con l'elenco dei file, le pagine che li descrivono e "Copia il prompt per l'agente" per documentare quelli scoperti; l'apertura di un file nel `PageDrawer` sposta l'HUD e nasconde i suggerimenti |
| Ricerca | workbench semantico (`Ricerca.tsx`, `SemanticRadar.tsx`): ricerca in evidenza, sopra i risultati del codice "Nella wiki" con le pagine che citano le parole cercate (`lib/wiki-search.ts`, in memoria, senza indice), filtri estensione dinamici (`availableExtensions` in `lib/rag-format.ts`) / no-test, chip ultime query MCP filtrati con `isMaskedPrivateQuery`, telemetria compatta, Indicizza/Annulla con conferma `<Dialog>` (`human={false}`), **mappa dei risultati** statica (centro = query, distanza = punteggio rispetto al migliore, settori parole chiave / significato / entrambi, ambra se il file è cambiato dopo l'indicizzazione) e risultati in **Lista** (il punto scelto sulla mappa evidenzia e porta in vista il risultato) con barre BM25/Vec, evidenziazione termini, copia citazione e apertura in `PageDrawer` |
| Pannello pagina | `components/PageDrawer.tsx`, aperto da Grafo, Copertura e Ricerca: livello di fiducia, fatti del frontmatter, sorgenti e pagina; se la pagina è in drift o ha segni ⚠️ da riverificare, "Copia il prompt di riverifica" prepara la richiesta per l'agente |
| Impostazioni | profilo, tema, modelli (con conferma `<Dialog>` per download, `human={false}`), collegamento degli agenti (MCP), plugin per agente (installa / aggiorna, `lib/plugin.ts`), "Controlla aggiornamenti" |
| Barra laterale e sistema visivo | tema **Carbon & Cobalt** (`styles/tokens.css`, `styles/components.css`) con icona `00_modern` cobalto (`src-tauri/icons/`, `src/assets/mark.svg`); Icon Rail sottile (`58px`, espandibile a `212px` in `cw.railExpanded`), header contestuale (`ProjectSwitcher` con `verifiedShare`, reload git e `⌘K`), `LaunchIntro` animata all'avvio una volta per sessione (`cw.introShown`, rispetta `prefers-reduced-motion`, identità dell'app) e luce che segue il cursore sulle superfici con throttling `requestAnimationFrame` |
| Banner aggiornamenti | sopra ogni vista (`components/UpdateBanner.tsx`): 5 s dopo l'avvio e ogni 24 h controlla `latest.json` (plugin updater) e i plugin indietro (`plugin_state(false)`, cache 15 minuti `LATEST_TTL` e retry 60 s `LATEST_RETRY` in `commands/plugin.rs`; il pulsante manuale passa `force: true`); testo da `lib/updates.ts`; "Aggiorna e riavvia" solo al clic; su Linux fuori da un AppImage "Scarica" apre la release; un controllo automatico fallito non mostra niente |

## Lingua

- Italiano o inglese, da Impostazioni → Lingua (Automatica segue la lingua del sistema); scelta salvata in `localStorage` (`cw.lang`).
- Testi in `src/i18n/it/<area>.ts` e `src/i18n/en/<area>.ts` (aree: common, shell, lavori, revisione, impostazioni, esplora); `t(key, vars)` e `tn` per i plurali. Le chiavi inglesi sono tipizzate sulle italiane: una chiave mancante non compila.
- Cambio lingua: `LangKeyed` rimonta la Shell; i provider sopra di essa (`ProjectProvider`) hanno `lang` fra le dipendenze dei testi calcolati.
- Backend: il comando `set_language` imposta `wiki_core::tr(it, en)` per i messaggi Rust (anche negli errori di `commands/rag.rs` e `commands/plugin.rs`); il server MCP parla sempre inglese.
- Note del catalogo dei modelli: in inglese nel CLI, tradotte nell'interfaccia per id (`impostazioni.catalog.*`).
- Non cambia con la lingua: il testo scritto nella wiki (log, `human:<id>`, `closed by …`).
- `tests/no-italian.test.ts` segnala testo italiano rimasto fuori da `src/i18n/`.

## Suggerimenti alla prima apertura

- `src/components/Guide.tsx` (mostrato solo dopo la chiusura di `LaunchIntro`) mostra un pezzo alla volta: il benvenuto alla prima apertura (saltato da chi aveva già finito i Primi passi prima della 0.7.2), poi il suggerimento della sezione aperta, poi un evidenziatore (anello e nota) sul primo pulsante presente fra firma blu, "Collega" in Impostazioni e ⌘K (dalla terza apertura).
- Cosa è stato visto e quante volte l'app si è aperta stanno in `localStorage` (`cw.hints`), regole in `src/lib/hints.ts` (test `tests/hints.test.ts`). Impostazioni → "Rivedi i suggerimenti" li riattiva.
- Testi in `shell.guide.*`, italiano e inglese. Mockup: `docs/design/mockup-onboarding-2026-11-13.html`.

## Etichette del formato
- `lib/labels.ts` traduce solo il vocabolario fisso del plugin: chiavi note (`fieldLabel`) e
  valori che occupano tutta la cella (`fixedValue`: `medium`, `none`, `⚠️ NOT VERIFIED - <motivo>`).
  Il testo scritto dagli agenti resta com'è; nei file si scrive sempre in inglese.

## Azioni umane
- `lib/md-edit.ts` trova sezione e tabella saltando i blocchi di codice, cambia **una riga**
  per ID e lascia identico tutto il resto; le righe nuove seguono le colonne reali dell'intestazione.
- `lib/human-actions.ts` produce i formati esatti del plugin (`closed by …; not proven:`,
  `verified` su una riga, `human:<id>`).
- `state/project.tsx` (`act()`) rilegge i file al momento della conferma e annulla con un
  messaggio nella lingua attiva se la riga attesa non c'è più.
- Le azioni si disattivano in base ai codici `upgrade:` del validatore (es. `done-status-missing`).

## Ricerca
`state/rag.tsx` (tramite `src/api.ts`) tiene un job di indicizzazione per repo e un download; l'indice si aggiorna
all'apertura del progetto e dopo 5 secondi di quiete del watcher, se esiste già.

## Comandi Tauri
Organizzati in `src-tauri/src/commands/{mod.rs,python.rs,rag.rs,plugin.rs}` e registrati in `src-tauri/src/main.rs`: progetto e recenti, snapshot (con `includeRepoFiles`), lettura/scrittura wiki, diff dei sorgenti, lint, prompt dei workflow, e i comandi `rag_*` / `plugin_*` (con gate `opened_repo` su tutti i comandi `repo`-scoped, stato e modelli letti in-process via `rag-core`, ricerca CLI con separatore `--`, cache 15 min per `latest_plugin_version` e arresto sidecar in `RunEvent::Exit`). Nel frontend il solo modulo autorizzato a importare `@tauri-apps/*` è `src/api.ts`.

## Test collegati
`tests/md-edit.test.ts`, `tests/human-actions.test.ts`, `tests/attention.test.ts`,
`tests/plugin-013.test.ts`, `tests/rag-format.test.ts`, `tests/edits-exact.test.ts` (include il guardrail sugli import `@tauri-apps/*`).
