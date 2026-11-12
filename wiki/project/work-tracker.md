---
type: Project
title: Tracker dei lavori
description: Unica fonte dello stato dei lavori dell'app Codebase Wiki.
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - wiki/log.md
  - wiki/agent/handoff.md
  - .github/workflows/build.yml
source_commit: 206cc3c
confidence: high
---

# Tracker dei lavori

Unica fonte dello stato. Gli ID (`T1`, `T2`, …) sono stabili e mai riusati; le altre pagine
citano gli ID senza ripeterne lo stato. Icone: vedi SCHEMA.md `## Conventions`. I lavori
aperti sotto sono stati aperti da Stefano il 2026-11-11, nella sessione con Claude Code in cui
è nata questa wiki.

## Prossimi passi
<!-- wiki:next -->

**In una riga:** 0.3.1 pubblicata il 2026-11-12 con CI verde; vista Progetti con l'attività degli agenti unita a `main` il 2026-11-12 (T10). Manca ancora la prova a mano dell'app installata e su Windows.

1. Provare l'app 0.3.1 installata dal `.dmg` (T1)
2. Provare un agente vero collegato via MCP (T5) e lo scarico della memoria (T4)
3. Adopt della copia di prova di Versal e azioni umane su una wiki 0.13 (T3)
4. Test su Windows (T2)

## Aperti
<!-- wiki:open -->

| ID | Status | Goal | Done when | Owner | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | ⚪ | Prova a mano della 0.3.1 installata dal `.dmg` | aperta dal Finder: trova Python ≥3.10 (o lo dice in Salute); Ricerca indicizza e cerca; "Collega" scrive la config; con la firma ad-hoc Gatekeeper propone "Apri comunque" e non "danneggiata" | Stefano | prova a mano | ⚠️ NOT VERIFIED - non ancora fatta |
| T2 | ⚪ | Prova su Windows | installer `.exe` funziona; azioni umane e ricerca vanno; "Collega Claude Code" trova `claude.cmd` o mostra il comando | Stefano | prova a mano su Windows | ⚠️ NOT VERIFIED - nessuna macchina Windows disponibile |
| T3 | ⚪ | Adopt della copia di prova di Versal alla 0.13.1 e prova delle azioni umane | copia adottata con `50-benchmark/results/**` in Excluded paths; promuovi, chiudi ⚫, accetta decisione, firma; `validate-wiki.py --json` senza finding nuovi e `git diff` solo righe attese + log | Claude (agente) | `python3 resources/validate-wiki.py --json versal-test/docs` | ⚠️ NOT VERIFIED - copia pronta, adopt non fatto |
| T4 | ⚪ | Verificare che il server MCP liberi i modelli dopo 5 minuti senza ricerche | in Monitoraggio Attività `codebase-wiki-mcp serve` scende da ~1–2 GB a pochi MB | unknown | Monitoraggio Attività dopo una ricerca + 6 minuti | ⚠️ NOT VERIFIED - codice in `crates/wiki-mcp/src/serve.rs` (`unload_when_idle`), mai osservato |
| T5 | ⚪ | Prova di un agente reale collegato alla 0.3.1 | una domanda dove/come usa `search_code` con una query in inglese; una su stato o rischi apre la wiki da `index.md` | Stefano | sessione Claude Code o Codex dopo il riavvio | ⚠️ NOT VERIFIED - provato solo con il server 0.2.0 |
| T6 | ⚪ | Prova di privacy del RAG | un termine di `.private-terms` messo in un file di codice non compare mai nei risultati di `search_code` | unknown | `codebase-wiki-mcp search` su repo di prova | ⚠️ NOT VERIFIED - coperto solo da test unitari (`filter_private_chunks`) |

## Proposte
<!-- wiki:proposals -->

Idee e lavori suggeriti che nessuno ha ancora approvato: senza ID né icona.

| Proposal | By | Date | Why |
| --- | --- | --- | --- |
| Firma e notarizzazione Apple dell'app macOS | claude-code/claude-opus-5-5 | 2026-11-11 | senza firma Gatekeeper avvisa o blocca chi scarica il `.dmg` |
| Plugin 0.14: controllo dei simboli citati dalla wiki che non esistono più (symbol drift) | claude-code/claude-opus-5-5 | 2026-11-11 | con tree-sitter l'app conosce già i simboli del codice |
| Ampliare le domande di valutazione del RAG oltre le 18 sul codice | claude-code/claude-opus-5-5 | 2026-11-11 | decidere sul reranker con più dati ([0005](decisions/0005-reranker-facoltativo.md)) |
| Su Windows cercare `claude.cmd` prima di `claude` | claude-code/claude-opus-5-5 | 2026-11-11 | `Command::new("claude")` può non trovare lo shim di npm (R1) |

## Chiusi
<!-- wiki:done -->

| ID | Status | Goal | Closed | Criteria met | Evidence |
| --- | --- | --- | --- | --- | --- |
| T10 | 🟢 | Vista Progetti e registro delle chiamate MCP | 2026-11-12 | test Rust e TS verdi; una chiamata `search_code` reale registrata con `agent: claude-code`; Stefano ha provato l'app con `npm run tauri dev` e ha approvato il merge su `main` | commit `6648f9f`; `npm test` 140 pass; [log](../log.md) |
| T7 | 🟢 | Release 0.3.0 con pacchetti per Windows, macOS e Linux | 2026-11-11 | CI del tag verde su test e tre build; release pubblicata con 7 pacchetti | run GitHub Actions 43073107982; [release v0.3.0](https://github.com/StefanoHernandez/codebase-wiki-app/releases/tag/v0.3.0) |
| T9 | 🟢 | Release 0.3.1 con pacchetti per Windows, macOS e Linux | 2026-11-12 | CI del tag verde su test e tre build; release pubblicata con 7 pacchetti; build macOS firmata ad-hoc | run GitHub Actions 43117157795; [release v0.3.1](https://github.com/StefanoHernandez/codebase-wiki-app/releases/tag/v0.3.1) |
| T8 | 🟢 | RAG solo sul codice, senza `search_wiki` | 2026-11-11 | indice solo codice; tool `search_wiki` rimosso; test verdi | commit fe7bba6; `cargo test --workspace` e `npm test` verdi @fe7bba6; [log](../log.md) |
