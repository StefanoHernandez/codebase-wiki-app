---
type: Decision
title: 0001 - App desktop Tauri v2 al posto della vecchia app con server HTTP
description: L'app è riscritta come Tauri v2 con backend Rust e frontend React.
status: accepted
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - docs/tasks/HANDOFF-OPUS.md
  - docs/superpowers/specs/2026-11-10-codebase-wiki-desktop-app-design.md
  - Cargo.toml
  - src-tauri/tauri.conf.json
source_commit: 206cc3c
confidence: medium
---

# 0001 - App desktop Tauri v2 al posto della vecchia app con server HTTP

## Contesto
La prima versione era un'app con server HTTP; `docs/tasks/HANDOFF-OPUS.md` la indica come
storia da non seguire. Serviva un'app desktop per Windows, macOS e Linux con accesso sicuro ai
file della wiki.

## Decisione
Tauri v2 con un workspace Cargo (`wiki-core`, `rag-core`, `wiki-mcp`, `src-tauri`) e frontend
React 18 + TypeScript + Vite; `src/api.ts` è l'unico modulo che importa `@tauri-apps`.

## Alternative scartate
Alternatives not recorded.

## Conseguenze
Tutto l'accesso ai file passa da comandi Rust con confinamento nella wiki
([wiki-core](../../modules/wiki-core.md)); la CI costruisce i tre sistemi
([operations](../../engineering/operations.md)).

## Approval
<!-- wiki:approval -->
Approval not recorded.
