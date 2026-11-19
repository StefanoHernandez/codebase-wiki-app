---
title: Log
generated: { by: antigravity/unknown, at: 2026-11-19T10:45:00Z }
sources:
  - wiki/project/work-tracker.md
  - .github/workflows/build.yml
source_commit: 0763ea1
confidence: high
---

# Log

- Archivio: [Release 0.3–0.6](log/releases-0.3-0.6.md)

## 2026-11-13 · Icona "00_modern" e barra laterale "Notte" · agent
- What: nuova icona dell'app dalla proposta "00_modern" di Alessandro Cianfaglione (anello pieno, gradiente oltremare), unica sorgente per tutte le taglie. Stefano ha scelto la direzione B "Notte" fra tre mockup (`docs/design/mockup-ui-2026-11-13.html`, chiaro e scuro): barra laterale blu notte in entrambi i temi, anello di salute attorno al progetto (pagine con verifica ancora valida), blu delle azioni umane più scuro nel tema chiaro. Branch `feat/notte`, non ancora rilasciato.
- Evidence: `npm test` → 172 pass (1 nuovo su `verifiedShare`); `npm run build:app` ok, app installata in Applicazioni; barra laterale vista nel browser in chiaro e scuro senza progetto; anello con un progetto aperto da verificare a mano
- IDs: none

## 2026-11-13 · Contenuto in soft neumorphism (direzione D2) · agent
- What: dopo un secondo mockup (`docs/design/mockup-neumorphism-2026-11-13.html`, con anteprima in inglese) Stefano ha scelto D2: barra laterale "Notte" e contenuto morbido. Fondo grigio-azzurro (`#e4e8f1` chiaro, `#1d2130` scuro), superfici in rilievo e campi premuti con le ombre `--neu-hi`/`--neu-lo`; sezione attiva e progetto "premuti" nel blu della barra.
- Evidence: `npm test` → 172 pass; Primi passi e Impostazioni viste nel browser in chiaro e scuro; `npm run build:app` ok, app installata in Applicazioni; viste con un progetto aperto da verificare a mano
- IDs: none

## 2026-11-13 · Interfaccia in inglese · agent
- What: su richiesta di Stefano l'app parla italiano o inglese (Impostazioni → Lingua, automatica dalla lingua del Mac), senza riavvio. Circa 610 testi spostati in `src/i18n/` per sei aree, date con `locale()`, messaggi del backend con `tr`, note del catalogo dei modelli tradotte per id; il testo scritto nella wiki resta invariato. Regola 3 di `CLAUDE.md` aggiornata. Branch `feat/notte`, non ancora rilasciato.
- Evidence: `npm test` → 177 pass (compreso `no-italian.test.ts`); `cargo test --workspace --features wiki-mcp/embed` → verde; Primi passi e Impostazioni viste nel browser in inglese e in italiano, cambio lingua dal vivo; viste con un progetto aperto e revisione dei testi inglesi da fare a mano
- IDs: none

## 2026-11-13 · Release 0.7.0 · agent
- What: versione 0.7.0 (barra laterale "Notte", contenuto morbido, icona "00_modern" di Alessandro Cianfaglione, interfaccia in inglese), tag `v0.7.0`, release pubblicata come `latest` con 7 pacchetti e `latest.json` firmato. README riscritto in inglese e aggiunto il file `LICENSE` (MIT).
- Evidence: run GitHub Actions 43442705225 → test e tre build success; `latest.json` con `darwin-aarch64`, `windows-x86_64`, `linux-x86_64`; aggiornamento da 0.6.0 non ancora provato (T13)
- IDs: T13

## 2026-11-13 · Aggiornamento del plugin per Claude Code e Antigravity · agent
- What: con il plugin già installato l'app lanciava `claude plugin install`, che risponde "already installed" e lascia la versione vecchia: ora lancia `claude plugin update` (anche nel comando da copiare a mano). Antigravity ignora una cartella del plugin collegata con un symlink (`agy plugin list` non la mostra): l'app la conta come non installata e l'installazione la sostituisce con una copia, senza toccare la cartella collegata. Codex (`plugin add`) e OpenCode/Cursor (copia delle skill) aggiornavano già. Messaggio del server MCP "repo non risolto" ora in inglese.
- Evidence: prove con configurazioni isolate nello scratchpad: Claude 0.14.0 → resta 0.14.0 con `install`, 0.14.1 con `update`; Codex 0.14.0 → 0.14.1 con `plugin add`; `agy plugin list` vuoto con symlink, 0.14.1 con copia; `cargo test --workspace --features wiki-mcp/embed` → 127 pass; `npm test` → 177 pass
- IDs: none

## 2026-11-13 · Release 0.7.1 · agent
- What: versione 0.7.1 con l'aggiornamento del plugin per Claude Code (`plugin update`) e per Antigravity (cartella collegata sostituita da una copia), validatore del plugin 0.15.0 e il messaggio MCP in inglese; tag `v0.7.1`, release pubblicata come `latest`. Ringraziamento ad Alessandro Cianfaglione per ascolto, consigli e idee in `CONTRIBUTORS.md` e nel README.
- Evidence: run GitHub Actions 43449986524 → test e tre build success; `latest.json` con `darwin-aarch64`, `windows-x86_64`, `linux-x86_64`
- IDs: none

## 2026-11-13 · Aggiornamento automatico provato; pulsanti pieni leggibili · agent
- What: Stefano ha aggiornato la sua app dalla 0.7.0 alla 0.7.1 dal banner (T13 chiuso). Due difetti trovati nella prova: il pulsante "Aggiorna e riavvia" era senza testo, perché la regola `.btn` del contenuto morbido copriva lo sfondo di `.btn-strong` e `.btn-human` lasciando il testo chiaro; e il banner restava in cima mentre il pulsante "Controlla aggiornamenti" è in fondo alle Impostazioni. Corretti: sfondi ripristinati e banner principale fisso in alto. Non ancora rilasciati.
- Evidence: Info.plist dell'app installata → 0.7.1; nel browser con backend finto `getComputedStyle` → "Aggiorna e riavvia" testo `rgb(228,232,241)` su `rgb(22,25,34)` (chiaro) e `rgb(29,33,48)` su `rgb(232,234,240)` (scuro), "Firma la chiusura" bianco su `rgb(35,56,159)`; banner a 12 px dall'alto dopo lo scorrimento
- IDs: T13

## 2026-11-13 · Suggerimenti alla prima apertura · agent
- What: su richiesta di Stefano, dopo il mockup approvato: benvenuto alla prima apertura, un suggerimento per sezione la prima volta, un evidenziatore sul primo pulsante di firma, su "Collega" e su ⌘K; uno alla volta, chiusi non tornano, "Rivedi i suggerimenti" in Impostazioni. Testi in italiano e inglese. Non ancora rilasciati.
- Evidence: `npm test` → 182 pass (5 in `tests/hints.test.ts`); nel browser con backend finto: benvenuto, suggerimento di Impostazioni, anello su "Collega" e su ⌘K (nota rivolta in su vicino al bordo), ripristino e benvenuto in inglese; viste con un progetto aperto (firma blu in Lavori) da provare a mano
- IDs: none

## 2026-11-15 · Release 0.7.2 · agent
- What: versione 0.7.2 con i suggerimenti alla prima apertura, i pulsanti pieni leggibili, il banner fisso in alto e il validatore del plugin 0.15.1; tag `v0.7.2`, release pubblicata come `latest`. La build macOS del tag era stata annullata da GitHub (nessun runner macOS arm64 libero) e rilanciata con `gh run rerun --failed`.
- Evidence: run GitHub Actions 43461020112 → test e tre build success (macOS al secondo tentativo); `latest.json` con `darwin-aarch64`, `windows-x86_64`, `linux-x86_64`
- IDs: none

## 2026-11-16 · Tema salvia e menta · agent
- What: scartata la palette "Pietra" (commit annullati, release 0.7.3 fermata prima della pubblicazione: build annullate, tag rimosso). Stefano ha scelto salvia (`#6a8d73`) e menta (`#e4ffe1`) per il chiaro e "Menta nel buio" per lo scuro (barra `#1f2a23`, fondo `#111513`, testo e pulsanti di firma menta). `--human` diventa salvia scura `#4f7459` in chiaro e menta in scuro. Colori di stato invariati: il verde "aggiornato" si distingue poco dal tema.
- Evidence: `src/styles/tokens.css`; app provata in `tauri dev` @afddb5e
- IDs: none

## 2026-11-16 · Release 0.7.3 · agent
- What: versione 0.7.3 con il tema salvia e menta ("Menta nel buio" in scuro) e il badge "ok" con spunta e contorno; tag `v0.7.3`, release pubblicata come `latest`.
- Evidence: run GitHub Actions 43885911566 → test e tre build success; 14 file nella release, `latest.json` incluso
- IDs: none

## 2026-11-16 · Icona salvia e menta, release 0.7.4 · agent
- What: icona ricolorata come il tema (fondo salvia, anello e lettere menta, stesso disegno di Alessandro Cianfaglione), file rigenerati con `tauri icon`; badge del README e pagine wiki sui colori aggiornati. Versione 0.7.4, tag `v0.7.4`, release pubblicata come `latest`.
- Evidence: run GitHub Actions 43890727962 → test e tre build success; 14 file nella release
- IDs: none

## 2026-11-16 · Runtime Visual C++ su Windows, release 0.7.5 · agent
- What: provata l'app in una VM Windows 11 pulita (quickemu): il sidecar non partiva (exit `-1073741515`, DLL mancante) perché ONNX Runtime richiede il runtime Visual C++. La build Windows ora installa `msvcp140.dll`, `vcruntime140.dll`, `vcruntime140_1.dll` accanto agli exe e l'app le copia in `<data>/bin`; suggerimento della lingua e esempio del percorso di Python non parlano più del Mac. In VM l'indicizzazione è veloce: la lentezza segnalata da Alessandro non si riproduce. Versione 0.7.5, release pubblicata come `latest` (build macOS annullata da GitHub e rilanciata).
- Evidence: run GitHub Actions 43909529781 → test e tre build success; 14 file nella release; prova in VM di Stefano con la build CI @74c0024
- IDs: none

## 2026-11-17 · AppImage e git di sistema, release 0.7.6 · agent
- What: dall'AppImage Linux il plugin risultava "Ultima versione non disponibile": il `LD_LIBRARY_PATH` del runtime AppImage faceva caricare a `git` la libcrypto inclusa, più vecchia, e `git-remote-https` falliva. `no_window_command` toglie `LD_LIBRARY_PATH` ai processi figli quando l'app gira in un AppImage. Versione 0.7.6, release pubblicata come `latest`.
- Evidence: errore riprodotto con l'ambiente del processo AppImage; `cargo test -p wiki-core` 46 passed; run GitHub Actions 44049376540 → test e tre build success; 14 file nella release
- IDs: none

## 2026-11-18 · Correzione di riservatezza: riferimenti alla wiki di prova sul campo · agent
- What: su richiesta di Stefano, i riferimenti al progetto usato come wiki di prova sul campo e un percorso locale del Mac sono sostituiti con diciture generiche nei file attuali (wiki, spec, piani, task); nessun cambio di contenuto, la storia git non è riscritta. Le voci di log e le decisioni toccate cambiano solo in quelle parole. `Sensitive data` passa a `yes`: `wiki/.private-terms` è locale e ignorato da git, e l'hook pre-commit blocca i termini (`=termine` vale a parola intera, come nel plugin 0.16.0).
- Evidence: `sh .git/hooks/pre-commit --all` → exit 0 @ff59bf9+local
- IDs: none

## 2026-11-18 · Allineamento al plugin 0.16.0, release 0.7.7 · agent
- What: termini privati a parola intera (`=termine`) in scrittura della wiki, indice di ricerca e server MCP, con piegatura delle maiuscole che non apre falle (İ, segno Kelvin) e occorrenze sovrapposte; l'indice si ricostruisce una volta per il nuovo criterio. Validator del plugin 0.16.0 e budget di default 30/100/30 KB. Versione 0.7.7, release pubblicata come `latest`.
- Evidence: run GitHub Actions 44315200732 → test e tre build success; `latest.json` con darwin-aarch64, windows-x86_64, linux-x86_64 @6384ff4
- IDs: none

## 2026-11-18 · Integrazione UI Precision Studio 3D (Carbon & Cobalt) · agent
- What: integrata nell'app la nuova interfaccia **Precision Studio 3D** approvata nel mockup (`docs/design/mockup-precision-2026-11-18.html`): palette **Carbon & Cobalt** (`tokens.css`, `components.css`, `markdown.css`, `decisioni.css`, `README.md`) con icona `00_modern` ripristinata (`src-tauri/icons/`, `src/assets/mark.svg`); Icon Rail sottile (`58px` espandibile a `212px`), header contestuale e `LaunchIntro` (`Shell.tsx`); vista **Grafo** (`Grafo.tsx`, `grafo-3d.ts`, `grafo.css`) su canvas custom 3D Orbit / 2D Piatto + `▶ Storia 3D` verso il Cervello 3D; vista **Ricerca** (`Ricerca.tsx`, `SemanticRadar.tsx`, `ricerca.css`) con ricerca in evidenza, filtri rapidi, chip ultime query MCP, Radar semantico 3D interattivo e risultati **Stack 3D** / **Lista** con `PageDrawer`.
- Evidence: `node --test tests/*.test.ts` → 182 passed; `tsc --noEmit && vite build` → ok; `detect.mjs --json src` → `[]`; `cargo test --workspace` → 12 + 65 + 56 passed @710a24c+local
- IDs: none

## 2026-11-18 · Correzioni UI post-prova live: Grafo, badge Rail, HealthRing · agent
- What: corretti i dettagli segnalati da Stefano durante la prova live: `PageDrawer` portato a `z-index: 30` con spostamento HUD e nascondimento `.grafo-hover-hint` su `has-drawer`; badge notifiche della Rail collassata spostati nell'angolo con `99+` senza coprire l'icona; `HealthRing` allineato sul monogramma `30x30`; colori categorie Grafo ad alto contrasto; nodi wiki resi come documenti e sorgenti come badge estensione (`.rs`, `.tsx`, ecc.); `▶ Storia 3D` trasformata in viaggio su strada prospettica 3D verso il Cervello finale (`grafo-3d.ts`, `Grafo.tsx`).
- Evidence: `node --test tests/*.test.ts` → 182 passed; `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build` → ok; `detect.mjs --json src` → `[]` @710a24c+local
- IDs: none

## 2026-11-18 · Nodi colorati, hub core ingranditi ed explorer file nel Grafo · agent
- What: su feedback di Stefano ripristinati nel Grafo i nodi 3D colorati (sfere lucide per pagine wiki e cubi per sorgenti, mantenendo la palette ad alto contrasto); nodi `core` ingranditi (`1.48×`, min `7.5px`) con alone più visibile; aggiunto pannello laterale stile Obsidian a sinistra (`.grafo-explorer` richiudibile con gruppi per categoria, hover per illuminare il ramo, clic per selezionare e ruotare la camera 3D sul nodo, pulsante `↗` per aprire `PageDrawer`). Aggiunte chiavi bilingui `esplora.grafo.explorer` e `esplora.grafo.openFile`.
- Evidence: `node --test tests/*.test.ts` → 182 passed; `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build` → ok; `detect.mjs --json src` → `[]` @710a24c+local
- IDs: none

## 2026-11-18 · Grafo riportato in 2D con Storia e palette sobria · agent
- What: su richiesta di Stefano rimossa la vista 3D dal Grafo (`Grafo.tsx`, `grafo-3d.ts`), mantenendo il canvas 2D interattivo (pan/zoom/Fit), i nodi colorati con la nuova palette senza viola/neon, i nodi `core` ingranditi, l'esploratore file a sinistra (clic per evidenziare e centrare in 2D) e **▶ Storia** commit per commit (`esplora.ts`).
- Evidence: `node --test tests/*.test.ts` → 182 passed; `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build` → ok; `detect.mjs --json src` → `[]` @710a24c+local
- IDs: none

## 2026-11-18 · App per l'umano: mappa del codice, copertura, Salute a carte · agent
- What: Grafo con tre viste (Mappa a riquadri per cartella colorata dalla copertura della wiki, predefinita; Grafo dei collegamenti con nodi piatti, colori tenui e forme per categoria; Elenco per modulo); prompt per l'agente (documentare file scoperti, riverificare una pagina, verificare una decisione accettata il cui codice è cambiato); Per te con le novità dall'ultima visita; Salute con risposta in testa, cinque carte e livelli di fiducia spiegati, lettura iniziale contata come il plugin (ultime 10 voci del log); Ricerca con mappa dei risultati statica, lista predefinita e pagine della wiki sopra il codice; tolti inclinazione delle card e pila 3D. Branch `feat/human-app`.
- Evidence: `node --test tests/*.test.ts` → 190 passed; `npm run build` → ok; viste provate da Stefano in `tauri dev`, 2026-11-18
- IDs: none

## 2026-11-18 · Release 0.8.0 · agent
- What: `feat/human-app` portato su `main` (fast-forward) e rilasciato come 0.8.0: tema Carbon & Cobalt e "app per l'umano" (Grafo con Mappa / Grafo / Elenco, copertura, prompt per l'agente, Per te con novità, Salute a carte, Ricerca con pagine della wiki, Decisioni con codice cambiato). Release pubblicata come `latest`.
- Evidence: run GitHub Actions 44376939392 → test e tre build success; release con i file delle tre piattaforme
- IDs: none

## 2026-11-19 · Revisione completa e correzioni sicurezza, prestazioni e qualità · agent
- What: su richiesta di Stefano, revisione completa del codebase post-0.8.0 e correzione dei problemi emersi senza toccare il comportamento atteso di `LaunchIntro` (animazione d'avvio mantenuta come identità dell'app). In `wiki-core`: percorso `handoff` letto da `SCHEMA.md` (`parse_core_map_role`), `collect_repo_files` git-aware con fallback filtrato e `load_wiki_snapshot_opts` con `repo_files` opzionale. In `rag-core` / `wiki-mcp`: `status_json` e `models_list_json` sempre disponibili in-process, recovery da mutex poison su `CUSTOM_CACHE`, supporto `--` nel parser CLI, verifica `.private-terms` su path e testo anche in `run.rs`, messaggi CLI/MCP interamente in inglese. In `src-tauri`: `commands.rs` suddiviso in `commands/{mod,python,rag,plugin}.rs`, gate `opened_repo` esteso a tutti i comandi `rag_*`, arresto sidecar in `RagJobs::shutdown()` su `RunEvent::Exit`, cache TTL 15 min (+ `force`) su `latest_plugin_version` e messaggi localizzati via `tr`. Nel frontend: `@tauri-apps/*` centralizzato in `src/api.ts` con test guardrail, `ErrorBoundary` globale e per vista, viste lazy (`React.lazy` + `<Suspense>`), subset `@fontsource` solo `latin`/`latin-ext`, rimossa `react-force-graph-2d`, `Progetti` più leggera (`includeRepoFiles: false`, 3 worker), filtri estensione dinamici in `Ricerca`, filtro `[riservata]`/`[private]` condiviso, `<Dialog>` al posto di `window.confirm`, `Grafo` 2D on-demand (`grafo-canvas.ts`), spotlight throttled via rAF. Tolti i 6 avvisi Clippy residui; aggiornate le pagine della wiki e archiviate le voci 0.3–0.6 in [releases-0.3-0.6.md](log/releases-0.3-0.6.md).
- Evidence: `cargo test --workspace` → 140 pass (14 app + 67 rag-core + 58 wiki-core + 1 wiki-mcp); `cargo clippy --workspace --all-targets` → 0 avvisi; `node --test tests/*.test.ts` → 193 pass; `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build` → ok (chunk JS max 223.51 kB); `python3 resources/validate-wiki.py --json wiki` → exit 0; `sh .git/hooks/pre-commit --all` → exit 0 @0763ea1+local
- IDs: none
