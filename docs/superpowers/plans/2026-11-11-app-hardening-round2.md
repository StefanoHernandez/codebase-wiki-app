# App hardening — round 2 fixes (after review)

> **For the implementer (Cursor):**
> - Branch `app/hardening`. Same Global constraints and Decisions as `2026-11-11-app-hardening.md`.
> - Tests first, one commit per group (A, B, C, D), push after each.
> - Never `git add -A` (nested `codebase-wiki-app/` folder).
> - Still no A7.

Review result: **fix first.**
- Translated Open/Done headers lose data (critical).
- CRLF decisions and block-style `verified:` get corrupted.
- The CI artifact paths are still wrong.
- `choose_python` stops at the first bad candidate.

No path writes outside the wiki.

**Python for the tests on macOS:** `/usr/bin/python3` is 3.9, and the validator needs 3.10+. Seven tests fail if a 3.10+ `python3` is not first on PATH; see C4.

## Group A — data loss (commit `fix: translated headers, CRLF, verified block, fence-aware reads`)

1. **Critical — translated Open/Done headers** (`src/lib/human-actions.ts` ~233-347).
   - Problem: `OPEN_KEYS`/`DONE_KEYS` and `openRowFromCells` look columns up by English name only. Promote on `| ID | Stato | Obiettivo | … |` writes an empty row and deletes the proposal. Close writes a broken Done row and deletes the Open row.
   - Fix: when the section is found by marker and the header is not the English one, map the documented columns **by index**: `OPEN_COLUMNS[i]` and `DONE_COLUMNS[i]` give the keys, and any columns beyond those are extras, kept. Delete the duplicated `if (!namedOpen)` / `else` branches.
   - Tests: translated Open (promote, update field, close) and translated Done (close). Each checks the cell values written and that other lines are byte-identical.
2. **CRLF decision files** (`human-actions.ts` ~503 via `src/lib/frontmatter.ts` `updateFrontmatterFields`).
   - Problem: accept/reject converts the whole file to LF.
   - Fix: `parseDoc`, then replace or insert the single `status:` line inside the frontmatter, then `renderDoc`.
   - Test: a CRLF decision stays CRLF, and only the status line and the Approval line change.
3. **Block-style `verified:`** (`human-actions.ts` ~558-566 `setVerifiedFrontmatter`).
   - Problem: with `verified:` followed by `- by: …` at column 0, the old lines stay behind and the YAML becomes invalid. Existing entries are also re-rendered, which drops keys and quoting.
   - Fix: keep the existing text of the entries and append only the new one.
     - A one-line flow value `{…}` or `[{…}, …]` becomes `[<old entries verbatim>, {new}]`.
     - A block value (continuation lines that match `^\s*-\s` or `^\s+`) is converted to one flow line only if every entry parses; otherwise throw an Italian error asking to fix the frontmatter by hand.
   - Tests: block style with the dash at column 0, block style indented, existing flow value with a quoted value.
4. **The read side is not fence-aware** (`src/lib/markdown-tables.ts` `findSectionLines`/`extractTableFromLines` ~53-84, 187-200).
   - Problem: with a fenced example above the real table, the UI lists the example rows, and the actions take `openHeader`/`doneHeader` from this parser.
   - Fix: rebuild `parseTrackerMarkdown` (and the handoff parser, if it uses the same helpers) on `md-edit` `findSection`/`findTable`. Make the actions use `TableLoc.header`.
   - Test: regression case 3 also checks the parsed rows.
5. **The regression tests don't check byte-identity** (`tests/md-edit.test.ts`).
   - Every regression test calls `assertUnchangedLines(before, after, touchedLines)`.
   - Case 1 checks that the extra column and its values survive.
   - Case 2b checks the "non protetta" message.
   - Case 3 checks that the fenced block is byte-equal.
   - Case 7 adds a BOM-only file and a CRLF decision.

## Group B — atomic batch writes (commit `fix: batch writes check everything before renaming`)

6. **Temp files and partial batches** (`crates/wiki-core/src/wiki_fs.rs` ~219, `src/lib/apply-edits.ts` ~56-63).
   - Problem: a failed write or rename leaves `.<name>.tmp-<pid>` behind, and a content file can be written without its log entry.
   - Fix: replace the per-file write with one command `write_wiki_files(repo, files: [{ rel_path, content, expected_sha256 }])`. In order:
     1. Validate every file (confinement, `.private-terms`, forbidden terms) before touching the disk.
     2. Write every temp file and `sync_all` it.
     3. Just before renaming, re-read each target. If its sha256 differs from `expected_sha256` (the hash of the text `act()` read), abort. This closes the read-to-write race.
     4. Rename in the order given, log last.

     On any error, remove every temp file and rename nothing that has not been renamed yet.
   - `act()` passes the sha256 of each file it read. `write_wiki_file` stays for single writes, built on the same function.
   - Rust tests:
     - a forbidden term in the second file means the first file is not written;
     - a changed target means abort and no temp file is left;
     - a successful batch leaves no temp file.
7. **Falsy throws** (`src/state/project.tsx` ~271). Add `let threw = false`, set it in `catch`, then `if (threw) throw failed`. This was T12.3, still open.

## Group C — Python and CI (commit `fix: python chooser skips bad candidates, CI artifact paths`)

8. **`choose_python`** (`src-tauri/src/commands.rs` ~253).
   - Fix: change `let (major, minor) = version(path)?;` to `let Some((major, minor)) = version(path) else { continue };`.
   - Tests: a failing candidate followed by a valid one; a settings path that does not exist followed by a valid one.
9. **CI artifact paths** (`.github/workflows/build.yml` ~134-135). Use `target/release/bundle/**` and `target/universal-apple-darwin/release/bundle/**`. This was T10.1, still open.
10. **Python in the tests** (`tests/helpers/fixture.ts` `runValidator`). Pick the interpreter in this order: env `PYTHON`, then the first of `python3.13`, `python3.12`, `python3.11`, `python3.10`, `python3` whose version is ≥3.10. If none is found, fail with a clear message. `npm test` then works on a Mac where `/usr/bin` comes first.

## Group D — minor (commit `fix: review minors`)

11. **Oldest-first log** (`human-actions.ts` ~121). Use `parseDoc`/`renderDoc` as the newest-first branch does, so the EOL is kept and the end of the file is not rewritten. Test: CRLF log.
12. **Promote with an unescaped `|`.** Promote runs `assertRowWidth` on the proposal row, which gives the named "| non protetta" error.
13. **Salute** (`src/views/Salute.tsx` ~69, 260).
    - Use the default budgets (20/60/30 KB) when SCHEMA has none (T8.3).
    - `tests/review-fixture.test.ts` asserts the full two-entry line `/^verified: \[\{[^\n]*\}, \{[^\n]*\}\]$/m` and that `commit` equals HEAD.
14. **Snapshot** (`wiki_fs.rs` ~479-488).
    - Skip any file whose canonical path has a `.private-terms` component, including a symlinked `x.md` that points at it.
    - An unreadable page is listed with an error flag, instead of `unwrap_or_default()`.
15. **Handoff lag.**
    - `src/lib/handoff-lag.ts`: the baton ID regex also accepts `T1:` and `T1 —`.
    - `TrackerDialogs.tsx` ~109: "Copia prompt /wiki-sync" uses a neutral button, not `btn-human` (ultramarine is reserved to human authority).
16. **`findTable`** (`src/lib/md-edit.ts` ~139-146). Stop at the first non-blank line that is not a table row, so a second table in the section is not merged.
17. **`fenceMask`** (`md-edit.ts` ~48). Accept at most 3 spaces of indentation before the fence. A backtick fence whose info string contains a backtick is not a fence.
18. **`schema-parser.ts` ~19-22.** Do not join lines across a fence: split the section at fences and parse each part on its own.

## Done when

- `PYTHON=/opt/homebrew/bin/python3 npm test`, `npm run build` and `cargo test --workspace` are green. `npm test` is also green without `PYTHON` on a Mac with Homebrew Python.
- The GitHub build workflow on `app/hardening` uploads three artifact groups (link the run in the final message).
- Final message: commits, test totals, CI link, anything skipped and why.
