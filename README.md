# Codebase Wiki App

Un'applicazione desktop cross-platform in stile **Obsidian** dedicata esclusivamente a **Codebase Wiki LLM** (`wiki/` o cartella configurata in `.wikidir`).

## Caratteristiche principali

1. **Grafo Interattivo 2D ("Wiki ↔ Code") su HTML5 Canvas**
   - Visualizza le pagine Markdown della wiki (colorate in base al ruolo definito nella tabella `Core map` di `SCHEMA.md`) e i file sorgente del repository collegati tramite `sources:` nel frontmatter YAML.
   - Anelli di **Git Drift** arancioni in tempo reale quando un file sorgente tracciato in `sources:` è cambiato rispetto al `source_commit:` della pagina (o nel working tree).
   - Anelli rossi di errore strutturale (`validate-wiki.py`) sui nodi con findings.
   - Filtri rapidi: **Code Sources** (mostra/nasconde i file sorgente), **Drift Only** (isola pagine disallineate), **Local (1-hop)** (grafo locale centrato sul nodo attivo) e ricerca istantanea.

2. **Sidebar Schema-Aware & Core Read Budget Meter**
   - Risoluzione automatica della root wiki tramite `.wikidir` (con gestione UTF-8 BOM, CRLF e validazione strict dei path) o fallback su `wiki/`.
   - **Core Read Budget Meter** live (`<= 60 KB` di default da `SCHEMA.md`) che calcola il peso complessivo delle pagine core caricate dagli agenti AI all'avvio sessione.
   - Navigazione per **Core Map**, **Decisions (ADR)**, **Topics** e lista dei **File Repository Non Coperti** (`Uncovered Files`).

3. **Split-Pane Markdown Workbench & Code/Diff Drawer**
   - Editor Markdown con salvataggio (`Ctrl+S` / `Cmd+S`), anteprima live con tabelle e link interni navigabili, e barra **Frontmatter & Sources Inspector**.
   - Guardrail automatici di scrittura: confinamento dei path nella cartella wiki e blocco immediato dei termini vietati elencati in `<wiki>/.private-terms`.
   - Cliccando su un chip `sources:` o su un nodo codice nel grafo si apre il **Code & Git Diff Drawer** a sola lettura con l'intero file sorgente e il `git diff <source_commit>..HEAD -- <file>` evidenziato.

4. **Dashboard Operative con Azioni Umane Deterministiche**
   - **Work Tracker (`project/work-tracker.md`)**: tabelle `Open`, `Proposals` e `Done`. Azioni riservate all'autorità umana:
     - **Promote Proposal**: assegna il prossimo ID monotono mai riutilizzato `T<N>` (scansionando `Open`, `Done` e `log.md`), sposta la proposta in `Open` con stato `⚪` e registra l'operazione in `log.md`.
     - **Close Unproven (`⚫`)**: chiude un task come non provato/annullato formattando `Criteria met` come `not proven (<motivo>) — closed by human: <Nome>` (conforme a `validate-wiki.py`).
   - **Decisions (`project/decisions/*.md`)**: griglia visuale degli ADR con approvazione umana 1-click (`status: proposed` → `status: accepted`, aggiornamento sezione `## Approval` e riga in `log.md`).
   - **Agent Baton (`agent/handoff.md`)**: stato corrente, tabella ordinata del Baton per il prossimo agente e banner di allerta se `source_commit` di `handoff.md` è indietro di `>= 5` commit rispetto a `HEAD`.
   - **Live Structural Lint**: esecuzione integrata di `resources/validate-wiki.py` con tabella cliccabile dei finding per file e riga.

5. **Wizard `/wiki-init` & Agent Runner (`claude` / `codex`)**
   - **Wizard Grafico `/wiki-init`**: inizializza una nuova wiki completa (o personalizzata tramite `.wikidir`), genera `SCHEMA.md`, `index.md`, `log.md`, `project/work-tracker.md`, `project/decisions/`, `project/risks.md`, `agent/context.md`, `agent/handoff.md`, `troubleshooting.md`, `glossary.md`, `.private-terms` (opzionale), `.gitattributes` (`merge=union` per `log.md`) e aggiorna il file di ingresso dell'agente (`CLAUDE.md` / `AGENTS.md`).
   - **Agent Runner**: genera e copia negli appunti i prompt contestualizzati per `/wiki-sync`, `/wiki-ingest`, `/wiki-lint`, `/wiki-init` oppure invoca direttamente le CLI `claude` o `codex` in background.

---

## Requisiti

- **Node.js** `>= 22.6` (testato con Node `v26` con supporto nativo TypeScript)
- **Rust / Cargo** (`rustc >= 1.80`)
- **Python 3** (per l'esecuzione del validatore canonico `resources/validate-wiki.py`)
- **Git**

---

## Compilazione ed Esecuzione

### 1. Compilare il bundle UI e il binario nativo

```bash
node scripts/build-ui.ts
cargo build --manifest-path src-tauri/Cargo.toml --offline
```

### 2. Avviare l'applicazione Desktop su un repository Git

```bash
./src-tauri/target/debug/codebase-wiki-app --repo /percorso/al/tuo/repo
```

Opzioni CLI disponibili:
- `--repo <path>`: percorso del repository Git da aprire all'avvio (default: directory corrente `.`).
- `--port <port>`: porta locale del server (default: `4317`).
- `--headless`: avvia il server locale senza aprire automaticamente la finestra desktop nativa (`chromium --app=...` / `xdg-open`).

---

## Eseguire i Test

Suite di test completa (Unit test TypeScript, test di integrazione `validate-wiki.py`, test E2E del server e unit test Rust):

```bash
node scripts/build-ui.ts
node --test tests/*.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --offline
```
