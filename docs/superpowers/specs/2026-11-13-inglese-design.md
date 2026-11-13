# English interface — design

Date: 2026-11-13. Status: requested by Stefano ("voglio anche l'inglese"), spec to review.

## Goal

The app speaks Italian or English. Success: on a Mac set to English, a fresh install opens in
English (sidebar "For you", "Work", "Settings"; dialogs, banners, errors and dates in English);
Settings → Language switches to Italian and back without a restart; nothing written into a wiki
changes with the language.

Out of scope: languages other than these two, translating wiki content, right-to-left layouts,
translating the plugin.

## 1. What changes language and what does not

| Part | Behaviour |
| --- | --- |
| UI text (views, dialogs, banners, toasts, command palette, empty states) | follows the chosen language |
| Messages from the Tauri backend shown to the person (~34: Python not found, write refused, …) | follow the chosen language |
| Dates and relative times ("2 ore fa" / "2 hours ago") | `Intl` with `it-IT` or `en-GB` |
| Plugin vocabulary (`labels.ts`: field names, statuses, `NOT VERIFIED`, …) | Italian labels in Italian; the plugin's own English terms in English |
| Text written into the wiki (`closed by …; not proven:`, `human:<id>`, log entries) | unchanged: already the plugin's English formats |
| Messages of the MCP server to agents (~11, `crates/wiki-mcp`) | English always: agents read them and answer the person in the person's language |
| Commit messages, code, release notes | English, as today |

Rule 3 of the project becomes: "Interfaccia in italiano e inglese; codice, commit e note di release in inglese."

## 2. Choosing the language

- Settings → Profilo e aspetto gets **Lingua / Language**: Automatica (system), Italiano, English.
- Automatic: `navigator.language` starting with `it` → Italian, anything else → English.
- Stored like the theme (localStorage, per Mac). The backend gets it through a `set_language`
  command at start and on change, kept in a process-wide setting.
- Switching re-renders at once; no restart.

## 3. Code

- `src/i18n/it.ts` and `src/i18n/en.ts`: one flat object each, keys grouped by view
  (`perTe.title`, `settings.language`, …). `en.ts` is typed `Record<keyof typeof it, string>` so a
  missing English string is a type error, and `npm run build` fails on it.
- `src/i18n/index.tsx`: `LanguageProvider`, `useT()` returning `t(key, vars?)` with `{name}`
  placeholders; plurals by passing the count and picking `key.one` / `key.other`. No new npm
  dependency (two languages, ~350 strings: a dictionary is enough).
- Dates: one `formatDate` / `formatRelative` in `src/lib/dates.ts` taking the locale; every view
  uses it (today some views call `toLocale…('it-IT')` directly).
- Rust: user-facing messages move to `src-tauri/src/messages.rs` as a `match` on a message id
  returning Italian or English from the stored language. Error variants keep their data (paths,
  versions) and format it into the chosen text.
- `crates/wiki-mcp`: the 11 messages become English.
- `labels.ts`: `fieldLabel`/`fixedValue` return the plugin term unchanged in English.

## 4. Tests

- TS: every key of `it` exists in `en` (also enforced by the type); `t` fills placeholders and
  picks `one`/`other`; `labels.ts` returns plugin terms in English and Italian labels in Italian;
  `formatRelative` in both locales.
- Rust: each message id has a non-empty Italian and English text.
- By hand: switch language in Settings on every view, light and dark.

## Risks

- Strings missed in the move stay Italian: a test greps `src/` for Italian words outside
  `src/i18n/` (allow-list for comments and test fixtures).
- Longer English labels could overflow the sidebar or buttons: checked by hand at 960 px width.
- Translations are mine; Stefano or Alessandro reviews the English once.
