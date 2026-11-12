# Tracker dependencies — design

Date: 2026-11-12. Status: approved in chat, spec to review.

## Goal

Make the tracker say which open work can start now. A person opening Lavori sees, on each card,
either "Pronto" or what the task still waits for; agents writing `## Next steps` and the handoff
baton put ready work first. Success: on the Versal wiki, T28–T30 (which depend on T17) show
"Aspetta T17", T24 waits for T23 and the external `TRR`, T31 shows its external condition, and the validator catches a dependency on an
ID that does not exist.

Out of scope: a dependency graph or timeline view, a "only ready" filter in Lavori, checking the
handoff baton for tasks that are not ready, dependencies between proposals.

## 1. Format (plugin `codebase-wiki-llm`)

The optional `Depends on` column of the tracker tables (already allowed by
`references/work-tracker-template.md`, already used by the Versal wiki) gets a defined meaning.

- The cell is a comma-separated list. An item that matches `T[1-9]\d*` is a dependency on that
  tracker task; any other item is an **external condition** in free text (e.g. `distribution
  received`). An empty cell or `—` means no dependencies.
- The header is the literal `Depends on` (case-insensitive), also in tables with translated
  headers: like IDs and status icons it is fixed vocabulary. It follows the documented columns,
  as every extra column does.
- A task dependency is **satisfied** when that ID is in the Done table, with 🟢 or ⚫. An external
  condition is never satisfied by itself: whoever verifies it removes it from the cell.
- An open task is **ready** when every item in its cell is satisfied (so: no external condition
  left and every listed ID done).
- The column may appear in the Done table too (history); its IDs are checked for existence only.

### Validator (`scripts/validate-wiki.py`)

New findings, all errors, only when the column exists:

| Case | Message |
| --- | --- |
| an item `T<n>` that is neither an Open nor a Done ID | `depends on unknown tracker ID T<n>` |
| an open row that lists its own ID | `task depends on itself` |
| a cycle among open rows (T1 → T2 → T1) | `dependency cycle: T1 → T2 → T1` (reported once, on the first row of the cycle in table order) |

Free-text items are accepted without checks. Checks run only when the tracker IDs are readable
(the existing `open_readable and ids_readable` guard). `FORMAT_VERSION` stays `0.12.0`: the change
adds meaning to an optional column, existing wikis stay valid and get no `upgrade:` line. The
plugin release becomes 0.14.0.

### Agent rules

- `references/work-tracker-template.md`, Rules: one bullet defining the cell, satisfaction and
  readiness as above; agents add a dependency when work order matters, never invent one.
- `/wiki-sync` (`## Next steps`) and the handoff template (baton): ready tasks come first; a step
  on a task that is not ready names what it waits for ("T29 — waits for T17").

### Plugin tests

Fixture wikis under the plugin's test suite (`scripts/run-tests.sh`): unknown ID, self
dependency, two-task cycle, external text accepted, column in Done accepted, a tracker without
the column unchanged. The Versal tracker shape (English header, `T17` and free text) validates
clean.

## 2. App (`codebase-wiki-app`)

- `resources/validate-wiki.py` is replaced with the 0.14.0 copy, byte for byte (rule 5).
- **Parser** (`src/lib/markdown-tables.ts`, `src/types/wiki.ts`): `TrackerOpenRow` and
  `TrackerDoneRow` gain `dependsOn: { ids: string[]; external: string[] }`, read from the header
  `depends on` (case-insensitive, trimmed). The column stays in `extra` too, so writes that
  rebuild a row keep it untouched; views skip it when listing extra columns.
- **`src/lib/dependencies.ts`** (new, pure):
  `taskReadiness(tracker: TrackerData): Map<string, { ready: boolean; waitingOn: string[]; external: string[] }>`
  for every open row. `waitingOn` keeps the cell order and holds IDs not in Done (unknown IDs
  included: the validator reports them, the card still shows them as waited for).
- **Lavori** (`src/views/Lavori.tsx`): each open card shows a line under the title.
  - ready and the row had dependencies → "Pronto" (ok tone);
  - not ready → "Aspetta T3, T5 · distribution received"; each ID is a button that selects that
    card (`nav.go('lavori', id)`, the existing scroll-to-ref);
  - no dependencies → nothing.
  - The `Depends on` column is not repeated among the extra key/value lines.
- **Labels** (`src/lib/labels.ts`): `depends on` → "Dipende da", for any place that still shows
  the header.

### App tests (node:test)

- parser: header in English and in mixed case, cell with IDs and text, `—`, empty cell, column
  absent;
- `taskReadiness`: done 🟢 and ⚫ satisfy, open does not, external keeps a task waiting, unknown ID
  waits, row without column has no entry in `waitingOn`.

## 3. Order and release

1. Plugin branch, tests green, release 0.14.0 — merge and tag only with Stefano's ok.
2. App branch: validator copy, parser, readiness, Lavori — merge only with Stefano's ok.

## Risks

- A wiki that used `Depends on` for something else (e.g. a sentence that mentions an ID that no
  longer exists) gets new errors. Mitigation: the message names the ID; the fix is one cell.
  Only Versal is known to use the column, and its IDs all exist.
- An agent may write dependencies that are really a sequence preference. The rule says to add one
  only when work order matters; a person can delete it.
