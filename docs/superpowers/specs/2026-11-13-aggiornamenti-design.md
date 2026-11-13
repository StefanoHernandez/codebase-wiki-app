# App and plugin updates — design

Date: 2026-11-13. Status: approved in chat (option 1: check and ask), spec to review.

## Goal

A person with the app installed learns, without looking, that a new app release or a newer
Codebase Wiki LLM plugin exists, and updates either with one confirmed click. Success: with
0.6.0 installed on a Mac, publishing 0.6.1 makes 0.6.0 show "Codebase Wiki 0.6.1
disponibile" at the next start; "Aggiorna e riavvia" installs it and the app comes back as
0.6.1. With the plugin at 0.14.0 on Claude Code and tag v0.14.1 published, the same banner
says so and leads to Impostazioni → Plugin.

Out of scope: silent or background installs, Apple notarization, updating the plugin without
the existing preview, release channels (beta), hosting releases outside GitHub.

## 1. App updates

- Crates `tauri-plugin-updater = "=2.14.1"` and `tauri-plugin-process = "=2.4.0"` (both
  `rust-version` 1.90); npm `@tauri-apps/plugin-updater` `2.14.1`,
  `@tauri-apps/plugin-process` `2.4.0`, pinned exactly.
- `tauri.conf.json`: `bundle.createUpdaterArtifacts: true`; `plugins.updater.pubkey` = the
  public key; `plugins.updater.endpoints` =
  `https://github.com/StefanoHernandez/codebase-wiki-app/releases/latest/download/latest.json`.
  The app repo stays public (Stefano, 2026-11-13).
- Capabilities: `updater:default`, `process:allow-restart`.
- When: at start (a few seconds after the window opens), then every 24 h while open, and on
  "Controlla aggiornamenti" in Impostazioni. An automatic check that fails (offline, GitHub
  down, no `latest.json` yet) shows nothing; the manual one says "Impossibile controllare: …".
- Shown: a banner like the watcher's — "Codebase Wiki X.Y.Z disponibile", link "Novità"
  (release page), buttons **Aggiorna e riavvia** and **Più tardi** (hides it until the next
  check). During the update: download progress, then install and relaunch. A failed download
  or a bad signature stops with the error; the installed app is untouched.
- Linux outside an AppImage (`.deb`/`.rpm`, no `APPIMAGE` environment variable): the
  updater is not used; the check compares `latest.json` `version` with the app version and
  the banner offers **Scarica**, which opens the release page.

## 2. Plugin notice

- The same check calls the existing `plugin_state` command. Rows with status `outdated`
  add a line to the banner: "Plugin da aggiornare: Claude Code 0.14.0 → 0.14.1" (agents
  joined with commas), button **Vai** → Impostazioni → Plugin, where install keeps its
  preview and confirmation. Agents without the plugin are not reported (Primi passi covers
  them). An unknown latest version (offline) reports nothing.

## 3. CI and keys

- Once, by Stefano: `npx tauri signer generate -w ~/.tauri/codebase-wiki.key` (password
  set), secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in the
  app repo; the public key goes in `tauri.conf.json`. The private key never enters the repo.
  Losing it means installed apps stop receiving updates until reinstalled by hand.
- `tauri.conf.json` keeps `createUpdaterArtifacts: true`; a build without the private key
  fails, so branch CI builds and local builds pass
  `--config '{"bundle":{"createUpdaterArtifacts":false}}'`. Only the tag job in `build.yml`
  gets both secrets and uploads the `.sig` files and `latest.json` to the draft release
  (`tauri-action` does it, no extra job).
- Publishing the draft makes it `latest`, which is what the endpoint follows.

## 4. Code

- `src/lib/updates.ts` (pure): `updateBanner(app, plugins) -> Banner | null` from the app
  check result (`{ available: version } | none | error`) and plugin rows; text and buttons.
- `src/state/updates.tsx`: runs the checks (start, 24 h, manual) and holds the banner.
- `src/components/UpdateBanner.tsx` in `Shell.tsx`; "Controlla aggiornamenti" and the app
  version in Impostazioni.
- `src-tauri/src/main.rs`: register both plugins.

## 5. Tests

- TS: `updateBanner` — app only, plugin only, both, none, offline (error → null for
  automatic), Linux fallback (Scarica), several outdated agents listed.
- Build: `npm run build`, `cargo test --workspace --features wiki-mcp/embed`, clippy.
- By hand, once: install 0.6.0 from its `.dmg`, publish 0.6.1, start 0.6.0 → banner →
  update → app reports 0.6.1. Windows stays under T2.

## Risks

- The first release with the updater is installed by hand; 0.5.x never updates itself.
- macOS ad-hoc signature: the updater replaces the bundle in place; whether Gatekeeper asks
  again is checked in the manual test.
- A lost private key or password: no updates until a manual reinstall with a new key.
