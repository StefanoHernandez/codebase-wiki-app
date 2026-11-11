# Passaggio di testimone — coordinatore e revisore (Opus su Cursor)

Leggi questo file per intero prima di fare qualsiasi cosa. Sostituisci il coordinatore precedente (Claude Opus in Claude Code), che ha pianificato, scritto i brief, fatto revisionare e integrato i task 1–6. Il tuo compito: **portare il lavoro fino alla fine**. Revisioni tu; le correzioni le applicano agenti Composer che lancia Stefano, usando i prompt che scrivi tu. Parla con Stefano in italiano, frasi brevi.

---

## 1. Il progetto in breve

**Codebase Wiki** è un'app desktop (Windows, macOS, Linux) fatta con Tauri v2, React 18, TypeScript e Vite, con il backend in Rust. Fa da **pannello di controllo per una persona** sopra le wiki prodotte dal plugin **Codebase Wiki LLM** di Stefano.

Il plugin si trova su GitHub: `StefanoHernandez/codebase-wiki-llm`, branch `main` (versione 0.12.0, tag `v0.12.0`, commit `a5f0a6d`). Va letto per capire il formato delle wiki. Nel plugin:
- gli agenti (Claude Code, Codex, Antigravity) scrivono la wiki: tracker dei lavori, decisioni, handoff, log;
- alcune azioni sono **riservate a una persona**:
  - promuovere una proposta a lavoro `T<N>`;
  - chiudere un lavoro ⚫ senza prova;
  - accettare o rifiutare una decisione `proposed`;
  - firmare `verified: human:<id>` su una pagina;
  - decidere owner e priorità.

L'app mostra cosa aspetta la persona e le fa fare queste azioni senza toccare il markdown a mano.

Le 6 sezioni:
- **Per te**: lista unica di ciò che aspetta una persona.
- **Lavori**: kanban del tracker.
- **Decisioni**: ADR da accettare o rifiutare.
- **Handoff**: il "baton" per il prossimo agente, in sola lettura.
- **Salute wiki**: controllo di struttura, livelli di fiducia, budget, rischi, log.
- **Grafo**: wiki ↔ codice, stile Obsidian.

### Del plugin leggi almeno
- `canonical/codebase/default-schema.md`: SCHEMA, Core map, convenzioni, icone di stato, budget, formato del log.
- `canonical/codebase/references/work-tracker-template.md`, `decision-template.md`, `agent-handoff-template.md`, `agent-context-template.md`.
- `canonical/codebase/maintainer.md`, sezione frontmatter (`generated`, `verified`, livelli di fiducia).
- `canonical/codebase/scripts/validate-wiki.py`: è identico a `resources/validate-wiki.py` di questo repo. È l'**arbitro** dei formati: ogni scrittura dell'app deve lasciare il validatore pulito.

### In questo repo leggi
- `docs/tasks/global-constraints.md`: formati esatti e regole di processo. È vincolante.
- `docs/tasks/design.md`: il design, vincolante. L'idea centrale è "la persona firma": l'ultramarine è riservato all'autorità umana, il resto è neutro. Font: Schibsted Grotesk per l'interfaccia, Newsreader per i documenti, JetBrains Mono solo per il codice. C'è una lista di cose da evitare.
- `docs/tasks/COMMON.md`: regole per gli agenti, inclusi i confini dei file.
- I brief: `docs/tasks/T7-decisioni-handoff.md`, `T8-salute.md`, `T9-grafo.md`, `T10-ci-readme.md`, `T12-rifiniture.md`.
- `docs/tasks/fixes-round1.md`: le correzioni già chieste dopo la prima review.
- `docs/superpowers/specs/` e `plans/` contengono la spec della **vecchia** app (server HTTP). È storia, non va seguita.

---

## 2. Stato attuale (al passaggio)

### Branch
- `main`: la vecchia app, da non toccare.
- `rewrite/tauri-v2`: la riscrittura. Contiene i task 1–6 completati e revisionati, più la base comune per i task paralleli.
- `cursor/t7-decisioni-handoff-3e1c`, `cursor/t8-salute`, `cursor/t9-grafo`, `cursor/t10-ci-readme`, `cursor/t12-rifiniture`: un agente Cursor ciascuno, tutti partiti da `rewrite/tauri-v2` @ `1a283c3`.

### Fatto e revisionato (in `rewrite/tauri-v2`)
- **T1.** Workspace Cargo (`crates/wiki-core` + `src-tauri`) e Tauri v2 vero, con React e Vite.
- **T2.** `wiki-core`:
  - resolver;
  - git ops con validazione dei commit contro l'injection;
  - porcelain `-z`;
  - fs guardato: confinamento nella root della wiki, `.private-terms` mai scrivibile né leggibile (case-insensitive, ADS, symlink), check dei termini proibiti fail-closed;
  - validator;
  - watcher `notify`.
- **T3.** Comandi Tauri:
  - ogni comando con `repo` richiede un progetto aperto dall'utente (presente nei recenti e repo git);
  - prompt dei workflow solo da allow-list;
  - `src/api.ts` è l'unico modulo che importa `@tauri-apps`.
- **T4.** Librerie TS pure in `src/lib`:
  - le colonne extra del tracker si preservano;
  - azioni umane con i formati esatti;
  - `verified` scritto **su una riga sola**;
  - fiducia, decisioni, lista attenzione.
- **T5.** Design system, Shell, `project.tsx` (stato con guardie di sequenza), palette ⌘K, Dialog, Toast, timbro.
- **T6.** Viste "Per te" e "Lavori", con la fixture `tests/fixtures/wiki-v2` e il test reale sul validatore.
- **Base comune.** `tests/helpers/fixture.ts`, `src/components/Markdown.tsx` e le dipendenze `react-markdown`, `remark-gfm` e `react-force-graph-2d`.

### In corso
Punte già revisionate (base della re-review del Passo 2):

| Branch | Head revisionato |
|---|---|
| `cursor/t7-decisioni-handoff-3e1c` | `0160f5b` |
| `cursor/t8-salute` | `711b7c5` |
| `cursor/t9-grafo` | `b1665c4` |
| `cursor/t10-ci-readme` | `6e2b8a3` |
| `cursor/t12-rifiniture` | `3f634e9` |

I 5 branch Cursor sono stati revisionati e tutti richiedono correzioni (`docs/tasks/fixes-round1.md`). Il coordinatore li ha uniti in prova in locale: nessun conflitto, `npm test` 50/50, `tsc` pulito, `npm run build` ok, `cargo test --workspace` 20 ok, zero warning. Unico avviso: chunk JS oltre 500 KB, per via del grafo.

### Problemi principali trovati nella review
- **T9 (critico):** `onEngineStop → pauseAnimation()` congela il grafo. Inoltre la ricerca filtra invece di centrare il nodo, c'è una race nel pannello sorgente, i test copiano gli helper invece di importarli, e il chip "Non verificata" è verde.
- **T7:**
  - i backtick dei comandi finiscono nella copia (in shell diventano sostituzione di comando);
  - il timbro è sovrascritto da una regola locale;
  - la riga selezionata usa l'ultramarine.
- **T8:**
  - la somma "lettura core" include anche le cartelle (archivi del log, decisioni) e non conta SCHEMA;
  - SidePanel non gestisce il focus.
- **T10:**
  - i percorsi degli artefatti puntano a `src-tauri/target`, ma la cartella `target/` è alla radice;
  - la cache Rust punta alla cartella sbagliata;
  - manca `npm run build` prima di `cargo test`.
- **T12:**
  - `forget()` incrementa `openSeq` e così blocca `loading`;
  - il bottone ultramarine disabilitato cambia ancora al passaggio del mouse.

---

## 3. Il piano fino alla fine (il tuo lavoro)

### Passo 1 — Correzioni round 1 (le applica Composer)
Stefano incolla in ogni chat Cursor la sezione di `docs/tasks/fixes-round1.md`. Ogni agente corregge sul proprio branch, aggiunge "Correzioni round 1" al proprio report (`docs/tasks/reports/T*.md`) e fa push.

Se Stefano ti chiede di farlo partire tu, dagli per ogni branch un prompt pronto da incollare: il preambolo che trovi in testa a `fixes-round1.md` più la sezione del task.

### Passo 2 — Re-review mirata di ogni correzione (la fai tu)
Per ogni branch: `git fetch`, poi `git diff <head-revisionato>..origin/cursor/<branch>`. Gli head già revisionati sono nella tabella della sezione 2.

Per ogni punto della sezione di `fixes-round1.md` dai un verdetto: **RISOLTO** o **NON RISOLTO**, con `file:riga`. Cerca anche rotture nuove introdotte dalla correzione. Problemi fuori dalla correzione vanno nella lista dei minor, non bloccano.

Se restano punti aperti: scrivi un `docs/tasks/fixes-round2.md` con solo quei punti, e Stefano li fa applicare. Massimo 3 giri per branch. Dopo il terzo decidi tu: risolvi il punto con una regola semplice scritta nel report finale, oppure rimandalo come minor motivato.

### Passo 3 — Integrazione di prova
```bash
git checkout -b integrate/round-final origin/rewrite/tauri-v2
for b in t12-rifiniture t7-decisioni-handoff-3e1c t8-salute t9-grafo t10-ci-readme; do git merge --no-ff --no-edit origin/cursor/$b; done
npm install && npm test && npx tsc --noEmit && npm run build
cargo test --workspace && cargo build --workspace
```
Su Linux, per `src-tauri` servono `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev`. L'ordine dei merge parte da T12 perché tocca lo stato condiviso. Non sono attesi conflitti: i file sono disgiunti.

Controlla anche che il `.gitignore` escluda `dist/` e `target/`, e che nessun branch abbia committato build o node_modules.

### Passo 4 — Review finale dell'intero branch (la fai tu, con calma)
Diff `origin/main..integrate/round-final`, oppure, più utile, `1a283c3..integrate/round-final` più una lettura mirata dei moduli di T1–T6. Controlla:
- **Sicurezza:**
  - confinamento dei path e `.private-terms` (`crates/wiki-core/src/wiki_fs.rs`);
  - guardia "progetto aperto" su **ogni** comando (`src-tauri/src/commands.rs`, `opened_repo`);
  - allow-list dei workflow (`crates/wiki-core/src/prompts.rs`);
  - niente rendering di HTML grezzo nel markdown (`Markdown.tsx` usa react-markdown senza `rehype-raw`: deve restare così);
  - capabilities minime (`src-tauri/capabilities/default.json`).
- **Formati del plugin:** ogni azione umana va provata con il validatore. Ci sono già test su fixture per promuovi, chiudi ⚫, accetta/rifiuta e segna rivista. Confrontali con i template del plugin.
- **Design:** confronta con `docs/tasks/design.md`:
  - l'ultramarine compare solo per l'autorità umana;
  - niente della lista "da evitare";
  - ombre solo sugli overlay;
  - monospace solo per il codice;
  - copy in italiano.
- **Coerenza tra viste:** stessa gestione degli errori "stale" (dati cambiati mentre il dialog era aperto), stessi toast e timbro, stesse regole per i bottoni disabilitati senza nome.
- **I minor ancora aperti** (sezione 5): decidi quali vanno corretti prima del merge.

Scrivi i risultati in `docs/tasks/review-finale.md`, ordinati per gravità: Critico, Importante, Minore.

### Passo 5 — Un'unica ondata di correzioni finale
Se la review finale trova qualcosa: **un solo** prompt Composer con l'elenco completo (non un agente per problema), su un branch `cursor/fix-finale` creato da `integrate/round-final`. Poi una sola re-review mirata. Quello che resta lo decidi tu e lo scrivi nel report finale.

### Passo 5b — Allineamento al formato wiki 0.12.0 del plugin
Il plugin 0.12.0 è rilasciato: `main` e tag `v0.12.0` (commit `a5f0a6d`) nel repo `StefanoHernandez/codebase-wiki-llm`. Spec: `docs/superpowers/specs/2026-11-10-format-version-design.md` nel repo del plugin. Cosa cambia per l'app:
- lo SCHEMA dichiara `format_version` nel frontmatter;
- `validate-wiki.py` stampa righe `upgrade: <path>:<riga>: <cosa>; run /wiki-init --adopt <wiki-root> with plugin <versione>`, che non cambiano mai il codice d'uscita;
- nuovi marker, tutti opzionali (il validatore li controlla solo se presenti):
  - `<!-- wiki:owners -->` nell'indice: tabella `Topic | Owner page`;
  - `<!-- wiki:next -->` nel tracker: `## Next steps`, una riga sullo stato più al massimo 5 passi con ID;
  - `<!-- wiki:risk-register -->` nella pagina rischi: tabella `ID | Risk | Severity | Trigger | Mitigation | Owner | IDs`, ID `R<n>`, severità `critical`/`high`/`medium`/`low`;
  - `<!-- wiki:approval -->` sotto `## Approval` nelle decisioni.

Un unico prompt Composer, dopo il Passo 5 (non prima: tocca gli stessi file). Lavori:
1. **A0 — Wiki non compatibili.** Copia in `resources/validate-wiki.py` quello del plugin 0.12.0, byte per byte. Lo SCHEMA senza `## Core map` (v1) → schermata "Wiki non compatibile" al posto delle sezioni, senza azioni di scrittura. Le righe `upgrade:` → banner in "Per te" e in Salute con l'elenco, più il bottone "copia prompt" `/wiki-init --adopt <wiki-root>`. Con righe `upgrade:` le azioni che scrivono la tabella Done o le decisioni restano disattivate: la struttura che scriverebbero potrebbe non esistere. Le wiki v1 non si leggono più: è una decisione di Stefano.
2. **A1 — Ordine del log.** Oggi l'app aggiunge le voci in fondo. Se lo SCHEMA `## Log format` o le regole locali del log dicono newest-first (come Versal), la voce va in cima, sotto le regole. Va scritto un test con entrambi gli ordini.
3. **A2 — `## Excluded paths` e `## Page types`.** Grafo e Salute ignorano i path esclusi dallo SCHEMA (stessa semantica glob del validatore) e usano `## Page types` per il ruolo dei nodi.
4. **A4 — Prossimi passi.** Se il tracker ha `wiki:next`, mostra il blocco in cima a Lavori e in Per te.
5. **A5 — Registro rischi.** Se la pagina rischi ha `wiki:risk-register`, Salute mostra la tabella. I rischi `critical`/`high` senza owner (`unknown`) entrano in Per te. Owner e severità restano decisioni umane: l'app li mostra e basta.

Per la verifica usa una copia della wiki Versal (`/Users/stefano/Downloads/versal-container-platform-main 2/docs`, mai l'originale). Prima dell'upgrade il validatore dà 7 righe `upgrade:`; dopo l'upgrade simulato, nessuna.

### Passo 6 — Merge in `rewrite/tauri-v2` e CI
Fai il merge in `rewrite/tauri-v2` solo con l'ok di Stefano e solo con tutto verde. Il push di `rewrite/tauri-v2` avvia la CI (`.github/workflows/build.yml`).

Verifica sul run:
- job `test` verde;
- build su macOS (universal), Windows e Ubuntu;
- 3 gruppi di artefatti caricati (`.dmg`/`.app`, `.msi`/`.exe`, `.AppImage`/`.deb`).

Se la CI fallisce, leggi il log e prepara un prompt Composer mirato.

Rischi noti per la CI:
- `Cargo.lock` tiene alcune crate compatibili con rustc 1.90 (`notify-types` 2.0.0, `tempfile` 3.23.0) e c'è `rust-version = "1.90"`. Con lo stable recente va bene. **Non** fare `cargo update` in blocco.
- Su Windows i path passano da `dunce`, ma nessuno lo ha ancora provato davvero: guarda bene i test su Windows, se li aggiungi.

### Passo 7 — Prova a mano (la fa Stefano, tu gli dai la checklist)
Nessun agente ha potuto vedere la finestra Tauri reale: macOS blocca la cattura dello schermo, e i cloud non hanno display. Dai a Stefano questa checklist da fare sul Mac con `npm run tauri dev`:
1. Aggiungi progetto → `Gioco_TD` (wiki v1: deve comparire "Wiki non compatibile" con il prompt di adopt) e `codebase-wiki-llm` (wiki v2). Compaiono nella colonna di sinistra, con il badge.
2. Per te, Lavori, Decisioni, Handoff, Salute e Grafo si aprono senza errori, anche con le scorciatoie ⌘1…6 e ⌘K.
3. In una **copia** di una wiki, mai in quella vera: promuovi una proposta, chiudi un lavoro ⚫, accetta una decisione, segna rivista una pagina. Poi `python3 resources/validate-wiki.py <wiki>` deve essere pulito, e `git diff` deve mostrare solo le righe attese più il log.
4. Modifica un file sorgente citato in `sources:` → la pagina compare in "Per te" come drift senza riavviare.
5. Grafo: hover, zoom, ricerca, filtri e "Adatta" funzionano anche dopo 10 secondi.
6. Tema chiaro e scuro, senza lampo all'avvio.

### Passo 8 — Chiusura
- Report finale a Stefano. Deve contenere:
  - cosa è stato fatto;
  - cosa non è stato verificato;
  - **tutte le decisioni prese per suo conto** (sezione 4 più le tue nuove), ognuna con "cosa costa se è sbagliata";
  - i minor rimasti.
- L'incoerenza su `verified` (lista indentata contro una riga) è risolta nel plugin 0.12.0: ora si scrive sempre su una riga, come fa l'app.
- La PR `rewrite/tauri-v2 → main` si apre solo se Stefano lo chiede. Non fare mai merge su `main` da solo.
- Il progetto successivo (fuori scope qui) è un RAG della codebase con embedding locali più un server MCP che Claude Code può interrogare insieme alla wiki. Per questo `crates/wiki-core` non deve mai dipendere da Tauri: deve poter servire anche a una futura `crates/wiki-mcp`.

---

## 4. Decisioni già prese (non riaprirle senza un motivo nuovo)
- **Architettura:** workspace Cargo con `wiki-core` (Rust puro, senza Tauri) e `src-tauri` (comandi sottili). Il parsing del markdown e le azioni umane stanno in TS puro (`src/lib`). Rust restituisce dati grezzi.
- **Azioni umane:**
  - non cambiano `source_commit` e non aggiungono `updated:`, perché un cambio di stato non è una revisione delle fonti;
  - il log è append-only: le voci si aggiungono in fondo (dal Passo 5b, nell'ordine che dicono le regole locali della wiki), nel formato `## YYYY-MM-DD · <titolo> · human` con `- What:`, `- Evidence:`, `- IDs:`.
- **⚫:**
  - `Criteria met` = `closed by <person> YYYY-MM-DD; not proven: <what>`, `Evidence` = fonte della chiusura umana;
  - la tabella Done non guadagna colonne nuove: i valori extra vengono copiati solo nelle colonne Done che esistono già (confronto case-insensitive).
- **Decisioni:** si accetta o rifiuta solo da `proposed`. La riga `proposed:` in `## Approval` si conserva; quella nuova si aggiunge sotto.
- **`verified`:** sempre su una riga. Una voce `{ by: human:<id>, at: <ISO Z>, commit: <sha> }`, più voci `[{…}, {…}]`.
- **`.private-terms`:** il controllo vale se il file esiste, indipendentemente dallo SCHEMA. Il file non si scrive né si legge mai dall'app.
- **Confinamento:** un repo è accessibile solo se è nei recenti (aperto dall'utente) ed è un repo git. Togliere un repo dai recenti ne revoca l'accesso.
- **Dati cambiati durante un dialog:** si rilegge il file attuale al momento della conferma. Se non corrisponde più, si mostra un messaggio italiano e non si scrive nulla.
- **Design:** frontend-design, non la skill "taste" (quella è per siti marketing). Vale `design.md`.
- **Repo:** l'app vive in questo repo, non nel plugin: il plugin viene clonato dai marketplace e deve restare leggero.
- **Python:** il validatore usa solo la stdlib, quindi niente venv. Se mai servisse una dipendenza Python, `.venv` nel repo.
- **Commit:** email autore = noreply GitHub. Le email private bloccano il push.

---

## 5. Minor ancora aperti (decidi tu nel Passo 4)
- **TS e build:**
  - TypeScript 7 e Vite 8 con range `^` (mitigato dal lockfile);
  - chunk JS > 500 KB: valuta `import()` dinamico della vista Grafo.
- **`src/lib`:**
  - `frontmatter.ts`: `parseMapBody` divide sulla `,` (i valori quotati con virgola si rompono); la regex della flow-list sbaglia sui valori che contengono `}`; uno scalare `generated: testo` viene perso.
  - Le tabelle riconosciute per posizione vengono riscritte con l'header inglese canonico.
- **wiki-core:**
  - il rifiuto di `:` blocca anche la lettura di file con `:` nel nome su Unix (scelta prudente);
  - il confronto del nome `.private-terms` è solo ASCII (il controllo canonico copre i file esistenti).
- **UI:**
  - i bottoni owner e priorità sono "quiet" mentre Promuovi e Chiudi sono ultramarine (il bottone di conferma è ultramarine: accettabile);
  - il mapping degli errori "riga non più aperta" dipende dal testo inglese della libreria (fragile).
- **Test:**
  - la fixture non ha colonne Phase e Priority, quindi filtro fase e "Cambia priorità" non sono testati;
  - il `source_commit` della fixture punta a un commit che non esiste.
- **Windows:** dunce, watcher e path non sono mai stati provati su una macchina Windows.
- **Attribuzione:** alcuni commit scritti da Haiku portano il trailer "Co-Authored-By: Claude Opus 5.5". È solo un'inesattezza di attribuzione.

I minor già chiusi da T12 (watcher, recenti, dunce, `rust-version`, tema all'avvio, contrasto dei toast, focus del popover, `.is-selected`) vanno solo verificati nella review di T12.

---

## 6. Come revisionare (metodo usato finora)
- Leggi **una volta** il diff completo (`git diff -U10 base..head`). Fuori dal diff guarda solo per un rischio concreto che sai nominare.
- Due verdetti per ogni task:
  1. **conformità al brief**: cosa manca, cosa è in più, cosa è stato capito male;
  2. **qualità**: separazione, errori, casi limite, test veri e non copie.
- Gravità:
  - **Critico**: rompe la funzione o la sicurezza.
  - **Importante**: il task non è affidabile finché non è corretto. Esempi: errori ingoiati, race, test che non provano nulla, regole di formato o di design violate.
  - **Minore**: rifiniture.
- Il report dell'agente è un'affermazione, non una prova. Verifica nel diff.
- Non rifare girare le suite a ogni review: le fai girare una volta nell'integrazione (Passo 3) e alla fine.
- Ogni prompt di correzione per Composer deve contenere: branch, file permessi, punti numerati con il perché, come verificare, "aggiorna il report, push, fermati".

---

## 7. Cosa NON fare
- Non scrivere mai in una wiki reale: i test lavorano su copie temporanee.
- Niente `cargo update` in blocco. Niente installazioni globali.
- Niente merge su `main`. Niente push su branch che non sono tuoi senza l'ok di Stefano.
- Non riaprire le decisioni della sezione 4 senza un fatto nuovo.
- Non far toccare a più agenti lo stesso file nello stesso giro.
