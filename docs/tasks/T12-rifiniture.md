# T12 — Rifiniture backend e stato (minor emersi nelle review)

Prima leggi `docs/tasks/COMMON.md` e `global-constraints.md`. Ogni punto è piccolo: fai un commit per gruppo, con test dove c'è logica.

## File che puoi toccare
- `crates/wiki-core/src/watcher.rs`, `crates/wiki-core/src/validator.rs`, `crates/wiki-core/Cargo.toml`, `Cargo.toml` (root, solo `rust-version`)
- `src-tauri/src/commands.rs`, `src-tauri/Cargo.toml` (solo per aggiungere `dunce`)
- `src/state/project.tsx`, `src/state/theme.ts`, `index.html` (solo per il tema all'avvio)
- `src/styles/components.css` (solo le regole citate sotto), `src/styles/views.css` (solo `.is-selected`)
- report: `docs/tasks/reports/T12.md`

## Rust — wiki-core
1. Workspace: aggiungi `rust-version = "1.90"` (in `[workspace.package]` e ereditalo nelle crate) così il resolver tiene versioni compatibili; non toccare `Cargo.lock` oltre a quello che serve.
2. `watcher.rs`: ignora `.git/`, `target/`, `node_modules/` **solo come primo componente** del percorso relativo al repo (oggi a qualsiasi profondità). Test.
3. `watcher.rs`: gli errori del watcher oggi vengono scartati in silenzio: stampali su stderr (`eprintln!`).
4. Test del watcher: cartella temporanea con nome unico (`tempfile` o pid+timestamp) e timeout più larghi (warm-up 500 ms, attesa fino a 5 s) per non essere fragile in CI.
5. `validator.rs`: il test di `run_structural_lint` oggi verifica solo che compili. Rendilo vero: wiki temporanea con un errore noto (es. pagina senza frontmatter) → almeno un finding con `wiki_rel_path` non vuoto e `raw_output` non vuoto; salta con messaggio se python3 manca.

## Rust — src-tauri/src/commands.rs
6. Lettura-modifica-scrittura dei recenti non serializzata: aggiungi un `Mutex<()>` in stato gestito tenuto durante `open_project`, `list_recent`, `remove_recent`.
7. `open_project`: calcola prima la snapshot; solo se riesce aggiorna recenti e watcher.
8. Mutex del watcher avvelenato = errore permanente: recupera con `into_inner()` del poison.
9. `find_python`: memorizza il risultato in un `OnceLock`.
10. Usa `dunce::canonicalize` al posto di `std::fs::canonicalize` (niente prefisso `\\?\` su Windows nei recenti e nella UI). Il controllo "progetto aperto" deve restare coerente (stessa funzione ovunque).
11. `remove_recent`: salva solo se qualcosa è stato rimosso.

## Frontend — stato e stile
12. `project.tsx` `reload()`: `setLoading(false)` solo se il repo è ancora quello corrente; `forget()` protetto come `open()` (stesso contatore di sequenza).
13. `project.tsx` `act()`: se una scrittura su N fallisce, ricarica comunque (`finally`) e rilancia l'errore.
14. Cambio progetto: azzera il `ref` di navigazione (usa l'API di `nav.tsx` se esiste; se serve una funzione nuova in `nav.tsx`, puoi aggiungerla: è l'unico altro file permesso).
15. Valore del provider memoizzato (`useMemo`).
16. Tema: niente lampo del tema di sistema all'avvio — applica `data-theme` salvato prima del render (script inline minimo in `index.html` che legge localStorage in try/catch).
17. `components.css`: toast di errore in tema scuro con contrasto ≥ 4.5:1 (testo scuro su `--error` o sfondo `--surface` con bordo `--error`); `.btn-human` non cambia al passaggio quando `aria-disabled="true"`.
18. `views.css`: `.is-selected` usa `outline` invece di `box-shadow` (il design ammette ombre solo per overlay).
19. Popover Impostazioni: alla chiusura il focus torna al bottone ingranaggio (se il componente è in `src/components/Shell.tsx`, puoi toccare solo quel punto e scriverlo nel report).

## Fatto quando
`cargo test --workspace`, `cargo build --workspace` (zero warning), `npm test`, `npm run build` puliti; report scritto e committato.
