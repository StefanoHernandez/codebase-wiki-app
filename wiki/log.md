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
- What: valutazione del RAG con domande dalla risposta nota su repo del plugin e copia di Versal; corretti indice della wiki ignorata da git, copie generate duplicate, file di dati e log indicizzati; poi indice e server MCP solo sul codice (`search_wiki` rimosso), modelli liberati dopo 5 minuti, reranker non più presentato come più preciso. Tree-sitter esteso a Java, C, C++, C#, Kotlin, Swift, PHP, Ruby, Bash, Scala, Lua.
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
- What: 34 domande di codice (app 16, plugin 12, Versal 6) con quattro modelli di embedding, ciascuno senza e con reranker. Il reranker abbassa hit@1 con tutti i modelli; `multilingual-e5-small` resta il predefinito. Su richiesta di Stefano il reranker è stato disinstallato dal suo Mac (cartella nel Cestino).
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
- Evidence: plugin `bash scripts/run-tests.sh` → exit 0 (10 casi nuovi), copia della wiki Versal identica a 0.13.1 salvo la versione; app `npm test` → 152 pass, `npm run build` ok; viste non controllate a schermo dall'agente
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
