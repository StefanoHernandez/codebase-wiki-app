---
type: Module
title: App (frontend e backend Tauri)
description: Viste, azioni umane e modifiche chirurgiche alla wiki.
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - src/views/index.ts
  - src/views/Progetti.tsx
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
  - src/lib/updates.ts
  - src/state/updates.tsx
  - src/views/Grafo.tsx
  - src/api.ts
  - src-tauri/src/commands.rs
source_commit: 206cc3c
confidence: high
---

# App (frontend e backend Tauri)

## Viste (`src/views/`)

| Vista | Cosa mostra |
| --- | --- |
| Primi passi | nome, progetto con wiki, controllo struttura (Python), modello e indice, un agente con plugin e ricerca; ogni passo si spunta dallo stato reale (`lib/first-run.ts`); prima vista finché non si chiude (`firstRun.done` in localStorage), riapribile da Impostazioni |
| Progetti | tutti i progetti recenti (per te, indice, novità dall'ultima visita, ultimo agente) e l'attività degli agenti MCP; prima vista all'avvio con più di un progetto |
| Per te | lista unica di ciò che aspetta una persona (`lib/attention.ts`) |
| Lavori | kanban del tracker, Prossimi passi, promuovi / chiudi ⚫; dalla colonna `Depends on` ogni scheda dice "Pronto" o cosa aspetta (`lib/dependencies.ts`) |
| Decisioni | ADR `proposed` da accettare o rifiutare |
| Handoff | il baton per il prossimo agente, sola lettura, con avvisi di ritardo |
| Salute | validatore, livelli di fiducia, budget, rischi, log |
| Grafo | wiki ↔ codice, filtri e drift; **Storia** riproduce la crescita commit per commit (`lib/graph-history.ts`: un nodo nasce al primo commit che tocca il suo file e pulsa a ogni modifica; un link compare quando esistono i due capi, approssimazione; storia dal comando `graph_history`, ultimi 2000 commit) |
| Ricerca | stato dell'indice, Indicizza/Annulla, prova di `search_code` |
| Impostazioni | profilo, tema, modelli, collegamento degli agenti (MCP), plugin per agente (installa / aggiorna, `lib/plugin.ts`), "Controlla aggiornamenti" |
| Barra laterale "Notte" e contenuto morbido | blu notte dell'icona in entrambi i temi; il contenuto è in soft neumorphism (sezione in fondo a `styles/components.css`: pannelli, schede e pulsanti in rilievo con `--raise`, campi e selettori premuti con `--press`; menu e dialoghi restano galleggianti) (`--side-*` in `styles/tokens.css`); in alto il progetto con un anello che si riempie con le pagine la cui verifica vale ancora (`verifiedShare` in `lib/trust.ts`), branch, commit e "modificato" |
| Banner aggiornamenti | sopra ogni vista (`components/UpdateBanner.tsx`): 5 s dopo l'avvio e ogni 24 h controlla `latest.json` (plugin updater) e i plugin indietro (`plugin_state`); testo da `lib/updates.ts`; "Aggiorna e riavvia" solo al clic; su Linux fuori da un AppImage "Scarica" apre la release; un controllo automatico fallito non mostra niente |

## Lingua

- Italiano o inglese, da Impostazioni → Lingua (Automatica segue la lingua del Mac); scelta salvata in `localStorage` (`cw.lang`).
- Testi in `src/i18n/it/<area>.ts` e `src/i18n/en/<area>.ts` (aree: common, shell, lavori, revisione, impostazioni, esplora); `t(key, vars)` e `tn` per i plurali. Le chiavi inglesi sono tipizzate sulle italiane: una chiave mancante non compila.
- Cambio lingua: `LangKeyed` rimonta la Shell; i provider sopra di essa (`ProjectProvider`) hanno `lang` fra le dipendenze dei testi calcolati.
- Backend: il comando `set_language` imposta `wiki_core::tr(it, en)` per i messaggi Rust; il server MCP parla sempre inglese.
- Note del catalogo dei modelli: in inglese nel CLI, tradotte nell'interfaccia per id (`impostazioni.catalog.*`).
- Non cambia con la lingua: il testo scritto nella wiki (log, `human:<id>`, `closed by …`).
- `tests/no-italian.test.ts` segnala testo italiano rimasto fuori da `src/i18n/`.

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
  messaggio in italiano se la riga attesa non c'è più.
- Le azioni si disattivano in base ai codici `upgrade:` del validatore (es. `done-status-missing`).

## Ricerca
`state/rag.tsx` tiene un job di indicizzazione per repo e un download; l'indice si aggiorna
all'apertura del progetto e dopo 5 secondi di quiete del watcher, se esiste già.

## Comandi Tauri
Registrati in `src-tauri/src/main.rs`: progetto e recenti, snapshot, lettura/scrittura wiki,
diff dei sorgenti, lint, prompt dei workflow, e i comandi `rag_*` (stato, indicizza, modelli,
anteprima di ricerca, collegamento degli agenti).

## Test collegati
`tests/md-edit.test.ts`, `tests/human-actions.test.ts`, `tests/attention.test.ts`,
`tests/plugin-013.test.ts`, `tests/rag-format.test.ts`.
