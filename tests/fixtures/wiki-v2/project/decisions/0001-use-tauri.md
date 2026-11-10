---
type: Decision
title: 0001 - Use Tauri v2 for the desktop app
description: Desktop shell choice for the control panel
status: proposed
generated: { by: claude-code/claude-opus, at: 2026-11-08T09:00:00Z }
sources:
  - README.md
source_commit: 3f36e87
confidence: medium
---

# 0001 - Use Tauri v2 for the desktop app

## Context
The control panel must run on Windows, macOS and Linux with a small footprint.

## Decision
Build the desktop app with Tauri v2, a Rust core and a React front end.

## Alternatives rejected
- Electron: larger runtime than needed for a file-based tool.

## Consequences
The file logic lives in Rust crates that a later MCP server can reuse. See T1.

## Approval
proposed: stefano, 2026-11-09
