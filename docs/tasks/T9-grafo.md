# T9 — Vista "Grafo" + pannello pagina/sorgente

Prima leggi `docs/tasks/COMMON.md`, `global-constraints.md`, `design.md`.

## File che puoi toccare
- `src/views/Grafo.tsx` (oggi placeholder)
- nuovi: `src/views/grafo.css`, `src/components/PageDrawer.tsx`, `src/components/page-drawer.css`
- nuovo test (se aggiungi logica pura, es. colori/filtri): `tests/grafo.test.ts`
- report: `docs/tasks/reports/T9.md`
`react-force-graph-2d` è già installato (non toccare package.json).

## A. `src/components/PageDrawer.tsx`
Pannello a destra (Esc chiude, bottone chiudi). Due modalità:
- **pagina wiki**: `<Markdown>` della pagina, fatti del frontmatter, chip del livello di fiducia, elenco `sources` come chip → apre la modalità sorgente.
- **file sorgente**: `readSourceFile(repo, relPath)` in un `<pre>` monospace con numeri di riga; se la pagina da cui arrivi ha `source_commit`, scheda "Diff da <sha>" con `sourceDiff(repo, relPath, sha)`: righe `+` verdi (`--ok`), `-` rosse (`--error`), `@@` attenuate.

## B. `src/views/Grafo.tsx`
- Costruisci il grafo con `buildWikiCodeGraph` (leggi tipi di input/output in `src/types/wiki.ts` e i test in `tests/graph-builder.test.ts`) dai dati della snapshot (pagine, file del repo, file cambiati per pagina, finding del lint se presenti, Core map).
- `react-force-graph-2d` stile Obsidian: nodi piccoli e rotondi; etichette al passaggio del mouse e quando lo zoom supera una soglia; link curvi e tenui; al passaggio evidenzia i vicini e attenua il resto; colore per categoria letto una volta dai token CSS con `getComputedStyle` (funziona in chiaro e scuro, rileggi al cambio tema); anello arancio (`--drift`) = drift, rosso (`--error`) = finding. Canvas dimensionato sul contenitore con `ResizeObserver`.
- Barra strumenti in alto a sinistra: ricerca (centra il nodo), interruttori "File sorgente", "Solo drift", "Locale (1 salto)" sul nodo selezionato (usa `filterWikiGraph`), "Adatta" (zoomToFit).
- Clic su un nodo → `PageDrawer` (pagina o sorgente).
- Prestazioni: fluido con ~300 nodi; ferma la simulazione quando si stabilizza (`cooldownTicks`).

## Fatto quando
`npm test` e `npm run build` puliti; report scritto e committato (scrivi cosa non hai potuto vedere a schermo).
