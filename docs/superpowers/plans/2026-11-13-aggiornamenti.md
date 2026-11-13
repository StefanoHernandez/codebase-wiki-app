# App And Plugin Updates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the app checks for a new app release and outdated plugins, shows one banner, and updates itself after a click.

**Architecture:** the JS updater plugin does check/download/install; a pure `lib/updates.ts` turns the check results into banner text; `state/updates.tsx` schedules checks; Rust adds the two plugins, an `updater_supported` and an `open_release_page` command (fixed URL). CI signs only on tags.

**Tech Stack:** Tauri 2.12 plugins updater 2.14.1 / process 2.4.0, React, node:test.

**Spec:** `docs/superpowers/specs/2026-11-13-aggiornamenti-design.md`

## Global Constraints

- Crates and npm packages pinned exactly (`=2.14.1`, `=2.4.0`, npm `2.14.1`, `2.4.0`); rustc 1.90.
- Endpoint `https://github.com/StefanoHernandez/codebase-wiki-app/releases/latest/download/latest.json`; release page `https://github.com/StefanoHernandez/codebase-wiki-app/releases/latest`.
- UI copy Italian; nothing installs without a click; automatic check failures are silent.
- Private key never in the repo; branch and local builds pass `--config '{"bundle":{"createUpdaterArtifacts":false}}'`.

## Review Focus

1. Automatic check offline → no banner, no error toast; manual check offline → message.
2. Linux `.deb` (no `APPIMAGE`) → "Scarica", never `downloadAndInstall`.
3. "Più tardi" hides the banner until the next check, not forever.
4. Plugin rows `unknown`/`missing` never produce a plugin line.
5. A local `npx tauri build` without the key still succeeds with the config override.

---

### Task 1: `lib/updates.ts` (pure)

**Produces:** `type AppCheck = { kind: 'available'; version: string } | { kind: 'none' } | { kind: 'error'; message: string }`; `updateBanner(app: AppCheck, plugins: PluginRow[], opts: { manual: boolean; canInstall: boolean }) -> { title: string | null; pluginLine: string | null; action: 'install' | 'download' | null; error: string | null } | null`.

- [ ] Tests `tests/updates.test.ts`: app available + canInstall → title `Codebase Wiki 0.6.1 disponibile`, action `install`; canInstall false → `download`; plugin outdated Claude + Codex → `Plugin da aggiornare: Claude Code 0.14.0 → 0.14.1, Codex 0.11.0 → 0.14.1`; missing/unknown ignored; none + no plugin → null; error automatic → null (or plugin-only banner); error manual → `Impossibile controllare: <msg>`; none manual → title `Codebase Wiki è aggiornata`.
- [ ] Implement, `node --test tests/updates.test.ts` PASS.

### Task 2: Rust, config, CI

- [ ] `src-tauri/Cargo.toml` add both crates; `main.rs` register `tauri_plugin_updater::Builder::new().build()`, `tauri_plugin_process::init()`; commands `updater_supported() -> bool` (false on Linux without `APPIMAGE`), `open_release_page()` (`open` / `xdg-open` / `explorer`, fixed URL, `no_window_command`).
- [ ] `tauri.conf.json`: `createUpdaterArtifacts: true`, `plugins.updater { pubkey, endpoints }`; capability `updater:default`, `process:allow-restart`.
- [ ] `build.yml`: tag step env `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; branch step args add the config override; `package.json` script `build:app` with the override for local builds.
- [ ] `cargo build -p codebase-wiki-app`, clippy 0 warnings.

### Task 3: state, banner, Impostazioni

- [ ] `state/updates.tsx`: provider; check 5 s after start, then every 24 h; `checkNow()` manual; `install()` with progress then `relaunch()`; `dismiss()`.
- [ ] `components/UpdateBanner.tsx` at the top of `<main>` in `Shell.tsx`; buttons Aggiorna e riavvia / Scarica / Novità / Vai (→ impostazioni) / Più tardi.
- [ ] Impostazioni: group "Aggiornamenti" with app version and "Controlla aggiornamenti".
- [ ] `npm test`, `npm run build`, `cargo test --workspace --features wiki-mcp/embed`; local build with the override.
