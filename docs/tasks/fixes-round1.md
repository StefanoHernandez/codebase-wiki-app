# Correzioni round 1 (da incollare nella chat Cursor di ogni agente)

Regole uguali a prima: stesso branch, solo i file già tuoi (eccezioni indicate), test prima dove c'è logica, `npm test` + `npm run build` (e cargo se tocchi Rust) puliti, commit, aggiungi in fondo al tuo report una sezione "Correzioni round 1" con cosa hai cambiato e l'output dei comandi, push del tuo branch, poi fermati.

## T7 — cursor/t7-decisioni-handoff-3e1c
1. (Importante) Handoff: i comandi e i percorsi arrivano dal markdown con i backtick (`` `npm test` ``). Copiati in un terminale, i backtick fanno eseguire il comando due volte (sostituzione di comando). Togli i backtick esterni sia nel testo mostrato sia in quello copiato (comando di verifica, file di partenza, valori di "Stato corrente"). Se una cella mescola codice e testo, rendi in monospace solo le parti tra backtick.
2. (Importante) `decisioni.css`: elimina la regola locale `.decisioni-row.stamp`, i suoi keyframes e il blocco reduced-motion collegato. Va usato il timbro condiviso (`useStamp` gestisce già reduced-motion). La riga selezionata non deve usare `--human-wash`, perché l'ultramarine è riservato all'autorità umana: usa `--surface-sunk` oppure un bordo sinistro `--rule`.
3. Già che ci sei:
   - ordina le righe del baton per `order` numerico;
   - etichette in italiano: "Fonti" e "Affidabilità" al posto di "Sources" e "Confidence";
   - le decisioni con stato `unknown` vanno in un gruppo "Altro";
   - un link a una pagina che non è una decisione non deve essere bloccato in silenzio: rendilo come testo normale, senza azione.

## T8 — cursor/t8-salute
1. (Importante) "Lettura core": escludi le voci della Core map che finiscono con `/` (cartelle `decisions/`, `log/`) e aggiungi `SCHEMA.md`. Il totale diventa: SCHEMA + index, context, handoff, tracker, risks, troubleshooting, glossary + `log.md`. Aggiorna il tooltip.
2. (Importante) `SidePanel` accessibile:
   - all'apertura il focus va sul bottone Chiudi;
   - alla chiusura torna all'elemento che l'aveva aperto;
   - Esc non deve chiudere il pannello se è aperto un `<dialog>` nativo (`document.querySelector('dialog[open]')`).
3. Già che ci sei:
   - `var(--font-mono)` → `var(--font-code)` in `salute.css`;
   - nel test, la seconda asserzione deve controllare l'intera riga `/^verified: \[\{[^\n]*\}, \{[^\n]*\}\]$/m` e che `commit` sia uguale all'HEAD;
   - `at` senza millisecondi (`.replace(/\.\d{3}Z$/, 'Z')`);
   - con schema mancante usa i budget di default (20/60/30 KB) invece di nascondere la sezione;
   - `log.md` va escluso dal controllo per-pagina (ha il suo budget);
   - le righe dei finding cliccabili hanno `role="button"`;
   - sposta lo stile inline `marginTop` in `salute.css`.

## T9 — cursor/t9-grafo
1. (Critico) Togli `onEngineStop={() => …pauseAnimation()}`. Ferma il loop di render: dopo circa 120 tick hover, zoom, filtri, tema e "Adatta" non funzionano più. `cooldownTicks` basta.
2. (Importante) La ricerca deve centrare il nodo, non filtrare:
   - non passare `searchQuery` a `filterWikiGraph`;
   - cerca il nodo dentro gli oggetti di `graphData.nodes` (quelli che force-graph aggiorna con x/y) e centra con `centerAt` + `zoom`;
   - se il nodo non esiste, mostra un messaggio breve.
3. (Importante) `PageDrawer` / `SourcePanel`: aggiungi una guardia contro le risposte vecchie (flag `cancelled` nel cleanup dell'effect o id di richiesta) per `readSourceFile` e `sourceDiff`. Le due chiamate possono partire in parallelo.
4. (Importante) I test devono provare il codice vero:
   - sposta gli helper puri (`diffLineKind`, `neighborIds`, eventuali altri) in `src/views/grafo-helpers.ts` (file nuovo, permesso);
   - importali sia dai componenti sia da `tests/grafo.test.ts`;
   - togli le copie dal test e togli il test che duplica `graph-builder.test.ts`.
5. (Importante) Chip di fiducia: "Non verificata" non deve essere verde. Usa uno stile neutro o attenuato; `badge-ok` solo per "Confermata da agente".
6. Già che ci sei:
   - leggi la font family una volta in `refreshTokens` (non a ogni frame);
   - colore dei link attenuati preso da un token (va bene anche in tema scuro);
   - `<Fragment key>` al posto di `<span style={{display:'contents'}}>` dentro `<dl>`;
   - colori delle categorie su toni grafite/terra lontani dall'ultramarine, con varianti per il tema scuro;
   - `.source-chip` a 13px;
   - se il nodo selezionato sparisce dal filtro, azzera la selezione e mostra "Il nodo selezionato non è visibile con questi filtri".

## T10 — cursor/t10-ci-readme
1. (Importante) Il workspace Cargo ha la cartella `target/` alla radice del repo, non in `src-tauri/target/`:
   - correggi i percorsi degli artefatti: `target/release/bundle/**`, e su macOS `target/universal-apple-darwin/release/bundle/**`;
   - aggiungi `if-no-files-found: error`.
2. (Importante) `Swatinem/rust-cache`: togli `workspaces: src-tauri`; il default `. -> target` è quello giusto.
3. (Importante) Nel job `test` esegui `npm run build` prima di `cargo test --workspace`: `tauri::generate_context!` richiede `dist/` (`frontendDist`).
4. Togli o correggi nel README la frase vaga "o usa quello passato dalla CLI Tauri, se configurato" (controlla `src-tauri/src/main.rs`).

## T12 — cursor/t12-rifiniture
1. (Importante) `project.tsx`, blocco del caricamento:
   - `forget()` non deve incrementare `openSeq`: legge solo il valore corrente (`const seq = openSeq.current`);
   - quando `forget` toglie il progetto corrente, chiama `setLoading(false)`.
   - Test o verifica ragionata nel report per due casi: forget durante open, e forget(current) durante reload.
2. (Importante) `components.css`: `.btn:hover:not(:disabled)` cambia ancora il bordo di `.btn-human[aria-disabled='true']`. Aggiungi `:not([aria-disabled='true'])` anche alla regola `.btn:hover`.
3. Già che ci sei:
   - `RECENTS_LOCK` recupera dal poison con `unwrap_or_else(PoisonError::into_inner)`;
   - togli il parametro `_app` inutilizzato;
   - in `act()` usa un flag booleano per rilanciare l'errore (anche valori falsy);
   - il test di `is_opened` usa `dunce::canonicalize`;
   - `with_recent` deduplica confrontando i percorsi normalizzati con dunce, per non avere doppioni dopo l'aggiornamento su Windows;
   - aggiungi un commento in `nav.tsx` che spiega che il singleton presuppone un solo NavProvider.
