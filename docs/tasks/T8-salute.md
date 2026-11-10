# T8 — Vista "Salute wiki" + azione "Segna come rivista"

Prima leggi `docs/tasks/COMMON.md`, `global-constraints.md`, `design.md`.

## File che puoi toccare
- `src/views/Salute.tsx` (oggi placeholder)
- nuovi: `src/views/salute.css`, `src/components/ReviewDialog.tsx`, `src/components/SidePanel.tsx` (pannello laterale semplice: titolo, chiudi con Esc e bottone, contenuto)
- nuovo test: `tests/review-fixture.test.ts`
- report: `docs/tasks/reports/T8.md`
- `useSigned` in `TrackerDialogs.tsx` è specifico del tracker e **non** va modificato: crea un tuo hook piccolo in `ReviewDialog.tsx` sullo stesso schema. Puoi importare `localIsoDate` e `SIGN_HINT` da `TrackerDialogs.tsx`.

## A. Test (prima)
`tests/review-fixture.test.ts` con gli helper di `tests/helpers/fixture.ts`: in un repo temporaneo applica `markPageReviewed` a una pagina della fixture (es. `agent/context.md`, persona "Stefano", `at` ISO con `Z`, commit = HEAD corto del repo temporaneo), scrive pagina + log, validatore → exit 0. Verifica che il frontmatter abbia **una sola riga** `verified: { by: human:stefano, … }`. Ripeti una seconda volta → una riga `verified: [{…}, {…}]`, validatore ancora pulito.

## B. `src/views/Salute.tsx` — pannelli (schede o sezioni una sotto l'altra)
1. **Struttura** — bottone "Esegui controllo" (`runLint()` dal contesto; spinner; se l'errore è "Python 3 not found" mostra "Python 3 non trovato: installalo per usare il controllo di struttura."). Tabella dei finding: file, riga, messaggio; clic → apre la pagina nel `SidePanel` resa con `<Markdown>`. Mostra quando è stato eseguito l'ultimo controllo.
2. **Fiducia** — tabella delle pagine: percorso, tipo, chip del livello (Non verificata / Confermata da agente / Rivista da persona / Verificata ma superata), numero sources, sorgenti cambiati (drift), dimensione. Filtri per livello e "solo drift". Azione di riga **Segna come rivista** (ultramarine) → `ReviewDialog` che mostra persona (`actor`) e SHA di HEAD; al conferma rilegge la pagina attuale, `markPageReviewed` + log via `act()`, toast "Pagina segnata come rivista", timbro sulla riga. Disabilitato se manca `actor`.
3. **Budget** — dai budget dello schema: pagine oltre il limite, totale "lettura core" (somma delle pagine core della Core map + `log.md`; spiega l'approssimazione in un tooltip), dimensione log; barre valore/limite.
4. **Rischi** — `project/risks.md` (percorso `risks` della Core map) reso con `<Markdown>`.
5. **Log recente** — ultime 10 voci del log (spezzate sui titoli `## `), più recenti prima.

## Fatto quando
`npm test` e `npm run build` puliti; report scritto e committato.
