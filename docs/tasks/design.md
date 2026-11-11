# Design plan (binding for Tasks 5–9) — from frontend-design skill

Subject: control panel over a codebase wiki that AI agents write and a person governs. Audience: a developer/lead who owns several repos. Primary job: see at a glance what waits for a human decision, and sign it.

## Concept: "the human signs"
The wiki is a register written mostly by agents. The person's job is to authorise. **One bold choice:** a single ink colour — ultramarine — is reserved exclusively for human authority: buttons that perform a human action, items awaiting a person, and the record of things a person signed (approved by, closed by, reviewed by). Everything agents produced stays graphite/neutral. If ultramarine appears, a person is involved. Nothing else is decorated.

## Colour tokens
Light:
- `--ground` #F2F4F3 (cool mineral grey; not cream)
- `--surface` #FFFFFF, `--surface-sunk` #E8ECEA
- `--ink` #1B2220 (green-black, not #111), `--ink-muted` #5F6A66, `--rule` #D5DBD8
- `--human` #2B45D4 (ultramarine ink) / `--human-wash` #E6EAFB
- `--drift` #B4540A (amber-orange, matches drift ring), `--error` #B42318, `--ok` #2F7D4F
Dark:
- `--ground` #141917, `--surface` #1B2120, `--surface-sunk` #101413, `--ink` #E3E8E6, `--ink-muted` #95A09B, `--rule` #2C3532, `--human` #8A9BFF, `--human-wash` #1F2547, `--drift` #E08A3C, `--error` #F07167, `--ok` #5BBF85
Status icons (🟢⚫🟡⚪🔴) are shown as the plugin's emoji next to Italian text, never recoloured.

## Type (bundled with @fontsource, offline)
- UI: **Schibsted Grotesk** (400/500/700). Scale (px): 12.5, 14 (base), 16, 20, 26. Line-height 1.45 base, 1.2 headings. Sentence case everywhere.
- Reading rendered wiki pages (Decisioni, PageDrawer, Rischi): **Newsreader** 17px/1.6, max 72ch — documents read like documents.
- Code only (commands, paths, SHAs, file content, diffs): **JetBrains Mono** 13px. Never for labels.

## Layout
```
┌────┬──────────────┬──────────────────────────────────────────┐
│ GT │ Per te    3  │ Gioco_TD   main @a1b2c3d  modificato  ⟳  │
│ CW │ Lavori       │──────────────────────────────────────────│
│ +  │ Decisioni 1  │ content (left aligned, max 1100px)       │
│    │ Handoff   !  │                                          │
│    │ Salute       │                                          │
│ ⚙  │ Grafo        │                                          │
└────┴──────────────┴──────────────────────────────────────────┘
```
- Project rail 64px: monogram tiles (two letters of folder name), count badge in `--human` when items await a person. Section nav 200px with counts. Content left-aligned.
- "Per te" and lists are **rows separated by rules**, not card grids. Kanban (Lavori) is the only place with cards, because cards there are movable things in columns.
- Radius by hierarchy: panels 10px, controls 6px, chips 999px. One shadow only, for overlays (dialog, palette, drawer).
- Grafo: full-bleed in content area, toolbar floating top-left.

## Motion
One orchestrated moment only: when a human action succeeds, the affected row gets a short ultramarine "stamp" (wash fills left→right 300ms, then the row settles into its new place). Otherwise motion only answers actions (dialog open, drawer slide, palette). No entrance animations, no hover lifts on every card. `prefers-reduced-motion` → no motion.

## Avoid (explicit)
All-caps eyebrow labels; monospace for small labels; meta strings joined with " · "; "→" appended to buttons; identical rounded cards everywhere; gradient washes; acid-green or terracotta accents.

## Copy (Italian, plain, active)
Buttons say the action: "Promuovi a lavoro", "Chiudi senza prova", "Accetta decisione", "Rifiuta decisione", "Segna come rivista", "Copia prompt /wiki-sync". The toast repeats the verb ("Decisione accettata"). Empty states direct: "Niente che aspetti te." / "Questa cartella non ha una wiki. Avvia /wiki-init in Claude Code o Codex." Errors say what happened and what to do, no apologies.

## Revision 2026-11-11: "Strumento"
Feedback: colours too dull, wasted space (two left columns), notices too loud, typography unconvincing. Changes (the ultramarine rule above still holds):
- **Layout:** one 236px sidebar. Top: project switcher (monogram, name, branch @sha, "modificato"; menu with other projects, reload, forget, add). Then sections with 16px stroke icons and counts; bottom: Comandi and Impostazioni. No content header: the space goes to the view.
- **Colour:** cold slate instead of green-grey. Light ground #F3F4F7 / ink #161922; dark ground #13151B / surface #1A1D25 / ink #E8EAF0. Ultramarine #2B45D4 / #8C9CFF. Status tones get a wash (`--drift-wash`, `--error-wash`, `--ok-wash`) for chips; the waiting count is a filled ultramarine pill.
- **Type:** IBM Plex Sans 400/500/600 (UI), IBM Plex Mono (code), Newsreader stays for rendered pages. Scale 11.5 / 12.5 / 13.5 (base) / 15 / 18 / 22, headings 600.
- **Density:** controls 28px, rows 8px padding, table cells 7px.
- **Notices:** one line with a 3px left mark; details in `<details>`, action button on the same line.
