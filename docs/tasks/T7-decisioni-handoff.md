# T7 — Viste "Decisioni" e "Handoff"

Prima leggi `docs/tasks/COMMON.md`, `global-constraints.md`, `design.md`.

## File che puoi toccare
- `src/views/Decisioni.tsx`, `src/views/Handoff.tsx` (oggi placeholder)
- nuovi: `src/views/decisioni.css`, `src/views/handoff.css`, `src/components/DecisionDialogs.tsx`
- `useSigned` in `TrackerDialogs.tsx` è specifico del tracker e **non** va modificato: crea un tuo hook piccolo in `DecisionDialogs.tsx` sullo stesso schema (controllo campi, busy, errore nel dialog). Puoi importare `localIsoDate` e `SIGN_HINT` da `TrackerDialogs.tsx`.
- nuovo test: `tests/decisions-fixture.test.ts`
- report: `docs/tasks/reports/T7.md`

## A. Test (prima)
`tests/decisions-fixture.test.ts` con gli helper di `tests/helpers/fixture.ts`: copia la fixture in un repo temporaneo, applica `acceptDecisionHuman` a `project/decisions/0001-use-tauri.md` (persona "Stefano", dove "riunione 2026-11-10"), scrive decisione + log, esegue il validatore → exit 0. Verifica: `status: accepted`; la sezione `## Approval` conserva la riga `proposed:` e aggiunge la riga `accepted:`; il log ha 1 voce in più. Secondo test: `rejectDecisionHuman` su una copia → `status: rejected`, validatore pulito. Terzo: accettare una decisione già `accepted` lancia errore.

## B. `src/views/Decisioni.tsx`
- Due pannelli: a sinistra elenco raggruppato per stato (In attesa = `proposed` per primo, Accettate, Rifiutate, Superate), ogni riga NNNN + titolo + chip di stato; a destra la decisione selezionata resa con `<Markdown>` (prop `pagePath`, `onOpenPage` che seleziona la decisione se il link punta a un'altra decisione) più i fatti del frontmatter (stato, sources, confidence).
- Per le decisioni `proposed`: bottoni **Accetta decisione** e **Rifiuta decisione** (stile ultramarine `btn-human`) → `Dialog` con campo "Dove è stata decisa" (messaggio, riunione, PR…). Al conferma: rileggi il markdown **attuale** dalla snapshot (non quello di quando hai aperto il dialog), chiama `acceptDecisionHuman` / `rejectDecisionHuman`, poi `act()` con decisione + log. Se la libreria segnala che lo stato non è più `proposed`, mostra nel dialog "La decisione non è più in attesa. Ricarica." Toast "Decisione accettata" / "Decisione rifiutata", timbro sulla riga.
- Disabilitato con tooltip se manca `actor`.
- Selezione da "Per te": `useNav()` porta `ref` = percorso della decisione.

## C. `src/views/Handoff.tsx` (sola lettura: la pagina la scrivono gli agenti)
- Scheda in alto sulla freschezza: `snapshot.gitState.handoffCommitsBehind` commit dietro HEAD; se ≥ 5 avviso "Handoff da aggiornare" e bottone **Copia prompt /wiki-sync** (`workflowPrompt(repo, 'wiki-sync')` + `copyText`, toast "Prompt copiato").
- Sezioni da `parseHandoffMarkdown`: Stato corrente (elenco), Baton per il prossimo agente (tabella ordinata: ordine, task con chip dell'ID tracker che porta a Lavori con `go('lavori', id)`, file di partenza, fatto quando, comando di verifica in monospace con bottone copia), Blocchi, Rischi noti, Non rifare, Comandi già eseguiti. Se la pagina dice `No open work.` → stato vuoto "Nessun lavoro aperto".

## Fatto quando
`npm test` e `npm run build` puliti; report scritto e committato.
