---
type: Project
title: Rischi
description: Cosa può andare storto nell'app Codebase Wiki e cosa lo segnalerebbe.
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - wiki/project/work-tracker.md
  - src-tauri/src/commands.rs
  - crates/wiki-mcp/src/serve.rs
  - crates/rag-core/src/files.rs
  - resources/validate-wiki.py
source_commit: 206cc3c
confidence: medium
---

# Rischi

La gravità usa parole, non icone di stato. Gravità e owner sono proposte dell'agente che ha
scritto la pagina il 2026-11-11: le decide una persona.

## Registro
<!-- wiki:risk-register -->

| ID | Risk | Severity | Trigger | Mitigation | Owner | IDs |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | L'app non è mai stata provata su Windows | high | si assume che i percorsi e i processi funzionino come su macOS; lo smentirebbe un errore in "Collega Claude Code" (`Command::new("claude")` senza `claude.cmd`) o nelle scritture; la prima prova (2026-11-13) l'ha smentita: ogni `git`/Python apriva una console | `wiki_core::no_window_command` per ogni processo figlio (no-op fuori da Windows); prova manuale | Stefano | T2 |
| R2 | L'app macOS non è firmata né notarizzata | medium | si assume che chi scarica sappia aprirla con tasto destro → Apri; lo smentirebbe un utente bloccato da Gatekeeper | firma ad-hoc nella build (0.3.1): Gatekeeper chiede "Apri comunque" invece di "app danneggiata"; notarizzazione esclusa perché a pagamento | Stefano | T1 |
| R3 | Il server MCP occupa 1–2 GB con i modelli caricati | medium | si assume che lo scarico dopo 5 minuti funzioni; lo smentirebbe un processo `serve` ancora sopra 1 GB dopo 6 minuti senza ricerche | `unload_when_idle` in `crates/wiki-mcp/src/serve.rs` | unknown | T4 |
| R4 | Un termine riservato finisce nei risultati della ricerca | high | si assume che il filtro fail-closed su `.private-terms` copra indice e risultati; lo smentirebbe un termine visibile in `search_code` | filtro in indicizzazione e alla ricerca; `.private-terms` illeggibile blocca tutto | unknown | T6 |
| R5 | Il validatore incluso diverge da quello del plugin | medium | si assume che `resources/validate-wiki.py` sia identico al plugin installato; lo smentirebbe un risultato diverso tra Salute e `/wiki-lint` | aggiornarlo copiandolo a ogni release del plugin | Stefano | none |
| R6 | Aperta dal Finder, l'app non trova `claude` o Python nel PATH | medium | si assume che i percorsi cercati coprano le installazioni comuni; lo smentirebbe "Collega" che mostra solo il comando, o Salute senza Python | ricerca di Python su più percorsi; comando da copiare come ripiego | unknown | T1 |
| R7 | Si perde la chiave di firma degli aggiornamenti | high | si assume che `~/.tauri/codebase-wiki.key` e la sua password restino disponibili; lo smentirebbe un tag che non riesce a firmare o una chiave cancellata | copia della chiave e della password in un posto sicuro fuori dal Mac; senza, chi ha l'app deve reinstallarla a mano con una chiave nuova | Stefano | T13 |

## Dettagli

### R4 — Termini riservati
Il controllo è fail-closed: se `.private-terms` non si legge, l'indicizzazione si ferma e la
ricerca non restituisce nulla. I pezzi con un termine vengono scartati e il termine non finisce
nei log. Oggi è coperto da test unitari, non da una prova end-to-end.
