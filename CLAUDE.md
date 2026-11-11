# Codebase Wiki (app)

Leggi prima la wiki: [wiki/agent/context.md](wiki/agent/context.md), poi [wiki/index.md](wiki/index.md).

Regole non negoziabili:
1. Mai `git add -A` o `git add .`: aggiungi i file per nome.
2. Crate Rust con versione fissata `=x.y.z`; niente `cargo update` generale (rustc 1.90).
3. Interfaccia in italiano; codice, commit e note di release in inglese.
4. `btn-human` solo per azioni con autorità umana.
5. `resources/validate-wiki.py` è copia identica del plugin: si sostituisce, non si modifica.
6. Mai scrivere le config reali `~/.claude*`, `~/.codex`, `~/.cursor` nei test.
7. Merge su `main`, tag e release solo con l'ok di Stefano.

Stato dei lavori: [wiki/project/work-tracker.md](wiki/project/work-tracker.md). Per stato, decisioni e rischi leggi la wiki; per trovare codice usa `search_code` se disponibile.
