---
title: Log
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - wiki/project/work-tracker.md
  - .github/workflows/build.yml
source_commit: 206cc3c
confidence: high
---

# Log

## 2026-11-11 · RAG valutato e ristretto al codice · agent
- What: valutazione del RAG con domande dalla risposta nota su repo del plugin e copia della wiki di prova sul campo; corretti indice della wiki ignorata da git, copie generate duplicate, file di dati e log indicizzati; poi indice e server MCP solo sul codice (`search_wiki` rimosso), modelli liberati dopo 5 minuti, reranker non più presentato come più preciso. Tree-sitter esteso a Java, C, C++, C#, Kotlin, Swift, PHP, Ruby, Bash, Scala, Lua.
- Evidence: `cargo test --workspace` → verde; `npm test` → 130 pass @fe7bba6; misure in [0004](project/decisions/0004-rag-solo-codice.md) e [0005](project/decisions/0005-reranker-facoltativo.md)
- IDs: T8

## 2026-11-11 · Release 0.3.0 · agent
- What: versione 0.3.0, tag `v0.3.0`, release pubblicata con 7 pacchetti; eliminata la bozza della 0.2.0 (il tag resta). La CI della 0.2.0 era fallita per un errore DNS del runner, rilanciata e verde.
- Evidence: run GitHub Actions 43073107982 → test e tre build success @206cc3c
- IDs: T7

## 2026-11-11 · Pulizia del repo e nascita della wiki · agent
- What: su richiesta di Stefano, la cartella annidata non tracciata `codebase-wiki-app/` (clone indietro di 89 commit, nessun commit non pushato, una modifica locale a `src-tauri/Cargo.toml`) spostata nel Cestino; eliminati i branch `app/hardening`, `feat/more-languages`, `feat/rag-mcp`, `integrate/cursor-wave`, `rewrite/tauri-v2` (era a `2d33cec`, 5 commit di documenti di handoff superati) e i remoti `feat/more-languages`, `feat/rag-mcp`; creata questa wiki con `/wiki-init` del plugin 0.13.1.
- Evidence: `git branch -a` → solo `main` e `origin/main` @206cc3c
- IDs: none

## 2026-11-11 · Confronto modelli di embedding e reranker · agent
- What: 34 domande di codice (app 16, plugin 12, wiki di prova sul campo 6) con quattro modelli di embedding, ciascuno senza e con reranker. Il reranker abbassa hit@1 con tutti i modelli; `multilingual-e5-small` resta il predefinito. Su richiesta di Stefano il reranker è stato disinstallato dal suo Mac (cartella nel Cestino).
- Evidence: script di valutazione locale con `codebase-wiki-mcp search --json` 0.3.0 → tabella in [0005](project/decisions/0005-reranker-facoltativo.md) @99f7caf
- IDs: none

## 2026-11-11 · Ricerca nel codice: query in inglese e test in fondo · agent
- What: test allargato a 58 domande di codice. Le istruzioni MCP chiedono all'agente query in inglese con i nomi probabili di file e simboli; i file di test valgono la metà nel ranking, salvo query che parlano di test. Provate e scartate: parole camelCase spezzate per BM25 (36/58 contro 37/58) e CodeRankEmbed int8 (45/58 con query in inglese contro 43/58 di e5-small, ma 37/58 contro 41/58 in italiano e indicizzazione 3,5 volte più lenta).
- Evidence: con `multilingual-e5-small`, domande originali → hit@1 37/58, MRR 0,70; query in inglese + test penalizzati → hit@1 43/58, hit@5 0,98, MRR 0,85; `cargo test --workspace` → verde
- IDs: none

## 2026-11-11 · Correzioni di interfaccia e firma ad-hoc per la 0.3.1 · agent
- What: revisione della UI dagli screenshot di Stefano. Testi aggiornati (la wiki non è indicizzata, note dei modelli provati, "1 collegato"); Markdown inline reso in Per te e Lavori; il blu pieno resta al bottone di conferma che firma, nelle liste diventa un bordo; "Copia prompt /wiki-sync" non è più blu; numero di decisione non ripetuto; messaggio dell'handoff indietro più chiaro; righe di pagine da ricontrollare cliccabili; spaziatura e bottone disattivato in Ricerca. Firma ad-hoc del pacchetto macOS e versione 0.3.1.
- Evidence: `npm test` → 130 pass; `cargo test --workspace` → verde; `npm run tauri build -- --bundles app` → `codesign --verify --deep --strict` ok
- IDs: T1

## 2026-11-12 · Release 0.3.1 · agent
- What: tag `v0.3.1`, CI verde, release pubblicata con 7 pacchetti su richiesta di Stefano.
- Evidence: run GitHub Actions 43117157795 → test e tre build success @979d5a7
- IDs: T9

## 2026-11-12 · Vista Progetti e registro delle chiamate MCP · agent
- What: nuova vista Progetti (tutti i progetti recenti con per te, indice, novità dall'ultima visita, ultimo agente; attività degli agenti; agenti configurati). Il server MCP scrive una riga per chiamata in `activity/<repo_id>.jsonl` nella cartella dati, con la query mascherata se contiene un termine riservato. Spec e piano in `docs/superpowers/`. Branch `feat/progetti`, non unito.
- Evidence: `npm test` → 140 pass; `cargo test --workspace` → verde; chiamata stdio al server → riga con `agent: test-agent` @47eaee0
- IDs: T10

## 2026-11-12 · Vista Progetti unita a main · agent
- What: dopo la prova a mano con `npm run tauri dev` Stefano ha approvato il merge di `feat/progetti` su `main`; il server MCP installato nella cartella dati è stato sostituito con quello nuovo che registra le chiamate.
- Evidence: chiamata `search_code` reale → riga in `activity/` con `agent: claude-code` e `top: src/lib/graph-builder.ts`
- IDs: T10

## 2026-11-12 · Icona e logotipo "timbro cw" · agent
- What: icona provvisoria sostituita dal timbro "cw" (Newsreader su oltremare, doppio anello; variante ad anello pieno per 16–32 px); logotipo "Codebase Wiki" in cima alla barra laterale e favicon. Scelta di Stefano tra tre direzioni (pagina firmata, timbro cw, pagina ↔ codice).
- Evidence: `npm run build` ok; `npm test` → 140 pass; PNG 256 e 32 px controllati a occhio
- IDs: none

## 2026-11-12 · Secondo giro interfaccia: etichette, contatori, legenda · agent
- What: chiavi e valori fissi del formato del plugin in italiano a schermo (Handoff, Lavori, Decisioni, pannello pagina) tramite `lib/labels.ts`; i contatori della barra laterale dicono cosa contano (tooltip e testo per lettori di schermo, calcolo spostato in `lib/attention.ts`); legenda del grafo richiudibile, chiusa di default, stato ricordato.
- Evidence: `npm test` → 145 pass; `npm run build` ok; viste non controllate a schermo dall'agente
- IDs: none

## 2026-11-12 · Primi passi guidati · agent
- What: nuova vista Primi passi per chi installa l'app da zero: cinque passi (nome, progetto con wiki o prompt /wiki-init, Python per il validatore, modello e indice, agente collegato) che si spuntano dallo stato reale; il collegamento agli agenti resta in Impostazioni con anteprima e conferma. All'avvio si apre finché non è chiusa o saltata; "Rivedi i primi passi" in Impostazioni la riapre.
- Evidence: `npm test` → 149 pass; `npm run build` ok; vista non controllata a schermo dall'agente
- IDs: none

## 2026-11-12 · Dipendenze tra lavori nel tracker · agent
- What: la colonna `Depends on` del tracker ha un significato (plugin 0.14.0, branch `feat/tracker-deps` non ancora unito): ID che il lavoro aspetta e condizioni esterne in testo libero; il validatore segnala ID inesistenti, dipendenze da sé e cicli. L'app copia il validatore 0.14.0, legge la colonna e in Lavori mostra "Pronto" o "Aspetta T5 · TRR".
- Evidence: plugin `bash scripts/run-tests.sh` → exit 0 (10 casi nuovi), copia della wiki di prova sul campo identica a 0.13.1 salvo la versione; app `npm test` → 152 pass, `npm run build` ok; viste non controllate a schermo dall'agente
- IDs: none

## 2026-11-13 · Correzioni rimandate: dipendenze, Progetti, registro MCP · agent
- What: validatore (plugin, branch `feat/tracker-deps`): un ID duplicato non nasconde più un ciclo, solo cifre ASCII negli ID, regola "never invent one", test per riga malformata e cicli sovrapposti. App: i link "Aspetta Tn" raggiungono anche schede filtrate per fase o già selezionate; un'apertura fallita da Progetti non porta più a Per te; le novità dopo un'archiviazione del log usano la data dell'ultima visita; l'attività degli agenti legge tutto il registro, non 200 righe; "niente per te", testo vuoto sotto filtro, tempi relativi aggiornati ogni minuto; scorciatoie: Progetti ⌘0, Per te ⌘1…; il registro `_global` non riporta più il nome del repo richiesto quando non si risolve. Test del validatore Rust allineato a 0.14.0.
- Evidence: plugin `bash scripts/run-tests.sh` → exit 0; app `npm test` → 154 pass, `cargo test --workspace --features wiki-mcp/embed` → 104 pass, `npm run build` ok
- IDs: none

## 2026-11-13 · Problemi vecchi delle prime revisioni · agent
- What: dei 38 problemi minori rimandati durante la riscrittura, 26 erano già risolti e 1 superato; corretti ora: frontmatter (virgole tra virgolette e `}` dentro i valori, `generated` come testo o a blocco), errori del watcher mostrati come banner invece che solo su stderr, `:` nei nomi dei file accettato fuori da Windows (`.private-terms::$DATA` resta rifiutato), test del validatore più stretti e test sulle colonne Phase/Priority/Depends on dopo promuovi e chiudi ⚫. Lasciati: versioni `^` in package.json, percorso `../..` in un test, confronto ASCII sul nome `.private-terms`, percorsi `\\?\` del watcher su Windows (non verificabile su macOS).
- Evidence: `npm test` → 157 pass; `cargo test --workspace --features wiki-mcp/embed` → 105 pass; `npm run build` ok; banner del watcher non provato con un errore reale
- IDs: none

## 2026-11-13 · Ultimi problemi a basso rischio · agent
- What: dipendenze npm fissate alla versione esatta del lockfile (come le crate Rust); test del validatore senza `../..`; il nome `.private-terms` confrontato in minuscolo Unicode; tolti i tre avvisi di clippy (contatore di ciclo, `while let` → `for`, campo `tool_router` mai letto). Resta non verificabile qui solo il prefisso `\\?\` del watcher su Windows.
- Evidence: `npm ci --dry-run` ok; `npm test` → 157 pass; `cargo test --workspace --features wiki-mcp/embed` → 105 pass; `cargo clippy --workspace` → 0 avvisi; `codebase-wiki-mcp serve` elenca ancora `search_code`, `index_status`, `list_repos`
- IDs: none

## 2026-11-13 · Release 0.4.0 e plugin 0.14.0 · agent
- What: app 0.4.0 pubblicata (Progetti, primi passi, dipendenze nel tracker, icona, secondo giro UI, correzioni) con i 7 pacchetti; plugin codebase-wiki-llm 0.14.0 su `main` con tag. Per risparmiare minuti di CI si pusha prima solo il tag e poi `main` con `[skip ci]`; le build Linux e Windows sono state rilanciate a repo reso pubblico da Stefano. Il marketplace `stefano-wiki` di Claude Code ora segue `main` del plugin (prima `dev`, fermo alla 0.13.0).
- Evidence: CI tag app https://github.com/StefanoHernandez/codebase-wiki-app/actions/runs/43395240820 verde (test + 3 build); CI tag plugin https://github.com/StefanoHernandez/codebase-wiki-llm/actions/runs/43395066612 verde (4 job); `.dmg` installato in Applicazioni, versione 0.4.0, firma ad-hoc valida
- IDs: none

## 2026-11-13 · Plugin installabile dall'app · agent
- What: Impostazioni ha la sezione "Plugin Codebase Wiki LLM": per Claude Code, Codex, Antigravity, Cursor e OpenCode mostra la versione installata contro l'ultimo tag del plugin e la installa o aggiorna dopo un'anteprima (comandi delle CLI; copia di cartelle da un checkout del tag in `<data>/plugin-src`). Cursor e OpenCode ricevono solo le skill, senza hook. Primi passi chiede plugin e ricerca sullo stesso agente. CLI Codex del Mac di Stefano riparata (reinstallata la 0.169.0 con npm), comandi verificati su quella.
- Evidence: `cargo test --workspace --features wiki-mcp/embed` → 118 pass (13 nuovi in `plugin_install`); `npm test` → 159 pass; `npm run build` ok; installazione reale non ancora provata a mano
- IDs: none

## 2026-11-13 · Plugin dall'app: prova reale e CLI su Windows · agent
- What: Stefano ha provato sul suo Mac l'installazione da Impostazioni con Codex: plugin aggiornato da 0.11.0 e ricerca (MCP) collegata. Su Windows l'app ora trova `claude` e `codex` anche come `.exe`/`.cmd`/`.bat`, usa la cartella utente di sistema (`USERPROFILE`) al posto di `HOME` e cerca in `%APPDATA%\npm`; anche "Collega Claude Code" (MCP) prova `claude.cmd`; i comandi delle CLI non aprono più una finestra di console.
- Evidence: prova a mano di Stefano (Codex, macOS); `cargo test -p codebase-wiki-app program_names` → pass; `cargo test -p rag-core plugin_install` → 14 pass; `cargo clippy --workspace --features wiki-mcp/embed` → 0 avvisi; codice `cfg(windows)` non compilato qui, comportamento su Windows non provato (T2)
- IDs: T2, T11, T12

## 2026-11-13 · Storia del grafo · agent
- What: il Grafo ha il pulsante "▶ Storia" che riproduce la crescita della wiki e dei file di codice commit per commit (circa 15 secondi in tutto), con slider, data e messaggio del commit; le pagine nate hanno un alone, quelle modificate un anello. Un link compare quando esistono entrambe le pagine (non dal commit che l'ha aggiunto). I nodi tengono la posizione tra un fotogramma e l'altro e quando cambiano i filtri. Richiesto da Stefano sul modello del timelapse dei grafi di Obsidian.
- Evidence: `npm test` → 165 pass (5 in `tests/graph-history.test.ts`); `cargo test --workspace --features wiki-mcp/embed` → 122 pass (2 su `file_history`); provato a mano da Stefano sull'app installata
- IDs: T11

## 2026-11-13 · Release 0.5.0 · agent
- What: app 0.5.0 pubblicata come Latest: installazione del plugin per agente, Storia del grafo, grafo a tutta altezza, CLI di Claude Code e Codex trovate su Windows. Stesso flusso della 0.4.0: push del solo tag, poi `main` con `[skip ci]`. Aggiornati anche i conteggi dei test e la versione del validatore in architettura.
- Evidence: CI del tag https://github.com/StefanoHernandez/codebase-wiki-app/actions/runs/43411334416 verde (test + build macOS, Windows, Linux: il codice `cfg(windows)` compila); release https://github.com/StefanoHernandez/codebase-wiki-app/releases/tag/v0.5.0 con 7 pacchetti
- IDs: T11

## 2026-11-13 · Release 0.5.1: note dei modelli e plugin 0.14.1 · agent
- What: le note del catalogo dei modelli dicevano ancora "adatto a wiki in italiano" e riportavano risultati delle prove; ora dicono lingua e velocità, utili per un indice che copre solo il codice. Plugin codebase-wiki-llm 0.14.1: la regola di contesto non nomina più `search_wiki` (tolto dal server MCP con la [0004](project/decisions/0004-rag-solo-codice.md)) e lascia alla wiki stato, decisioni, rischi e perché. L'app include il validatore 0.14.1.
- Evidence: plugin `bash scripts/run-tests.sh` → exit 0, CI del tag https://github.com/StefanoHernandez/codebase-wiki-llm/actions/runs/43415192161 verde; app `npm test` → 165 pass, `cargo test --workspace --features wiki-mcp/embed` → 122 pass, CI del tag https://github.com/StefanoHernandez/codebase-wiki-app/actions/runs/43415453676 verde, release https://github.com/StefanoHernandez/codebase-wiki-app/releases/tag/v0.5.1 con 7 pacchetti
- IDs: T12

## 2026-11-13 · Prima prova su Windows: console e apertura lenta · agent
- What: sulla 0.5.1 installata su Windows ogni `git`, Python e `claude --version` apriva una finestra di console (`CREATE_NO_WINDOW` c'era solo per il sidecar) e l'apertura di un progetto restava senza risposta: circa 66 processi `git` in fila e l'errore non mostrato in Primi passi. Sul branch `fix/windows-console`: `wiki_core::no_window_command` per ogni processo figlio (no-op su macOS e Linux), un controllo per `source_commit` invece che per pagina, caricamento ed errore nel passo del progetto di Primi passi.
- Evidence: `recent.json` vuoto dopo la prova; 20 `git rev-parse` → 5,2 s su quella macchina; `npm test` → 157 pass, 8 fail nei test del validatore (Python dei test non trovato su Windows, `|` in una riga). ⚠️ NOT VERIFIED - Rust non compilato: nessun toolchain Rust su quella macchina
- IDs: T2

## 2026-11-13 · Un git diff per commit nello snapshot · agent
- What: `load_wiki_snapshot` fa un solo `git diff --no-renames` per ogni `source_commit` diverso e assegna i file alle pagine in Rust con la regola di git (percorso uguale o cartella che lo contiene); le fonti con glob, `:(magic)`, `.` o `..` tengono il proprio `git diff`. Sulla wiki di questo repo da circa 32 a circa 15 processi `git` per caricamento. Con `--no-renames` un file spostato compare col nome vecchio e col nuovo.
- Evidence: script con git vero → la regola dà lo stesso risultato del pathspec di git in 9 casi su 9 (modifiche, cancellazioni, rinomine, spazi e accenti); test Rust nuovi in `git_ops.rs` e `lib.rs`. ⚠️ NOT VERIFIED - Rust non compilato in locale (nessun toolchain), lo verifica la CI della PR
- IDs: T2
## 2026-11-13 · Aggiornamenti dell'app e del plugin; PR #5 e #6 unite · agent
- What: l'app controlla all'avvio e ogni 24 ore se c'è una release nuova (`tauri-plugin-updater` 2.14.1, `latest.json` della release `latest`) e se un agente ha il plugin indietro; un banner propone "Aggiorna e riavvia" (o "Scarica" su Linux fuori da un AppImage) e porta a Impostazioni → Plugin, senza installare niente da solo. La CI firma gli aggiornamenti solo sui tag. Unite le PR #5 e #6 di Alessandro Cianfaglione (@cianf4): niente console su Windows per i processi figli; un solo controllo e un solo `git diff` per `source_commit` all'apertura (da circa 66 a circa 15 processi `git` sulla wiki di questo repo). Aggiunti `CONTRIBUTORS.md` e la sezione Contributi nel README.
- Evidence: `npm test` → 171 pass (6 in `tests/updates.test.ts`); `cargo test --workspace --features wiki-mcp/embed` → 125 pass dopo le PR #5 e #6; clippy 0 avvisi; `npm run build:app` ok e app avviata 10 s senza errori; aggiornamento reale non provato (T13)
- IDs: T2, T13

## 2026-11-13 · Release 0.6.0 · agent
- What: app 0.6.0 pubblicata come Latest: aggiornamenti dall'app, PR #5 e #6 di Alessandro Cianfaglione per Windows, `CONTRIBUTORS.md`. Prima esecuzione della CI fallita alla creazione della release (`Resource not accessible by integration`, il commit del tag cambiava `build.yml`): bozza creata a mano con `gh release create --draft`, job rilanciati. `latest.json` ha darwin-aarch64, windows-x86_64 e linux-x86_64 (più le voci `-deb`, `-rpm`, `-nsis`, `-msi`, `-appimage`), ognuna con la firma.
- Evidence: CI del tag https://github.com/StefanoHernandez/codebase-wiki-app/actions/runs/43424572413 verde dopo il rilancio; release https://github.com/StefanoHernandez/codebase-wiki-app/releases/tag/v0.6.0 con 14 file e `latest.json`; `releases/latest/download/latest.json` → HTTP 200
- IDs: T13

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
