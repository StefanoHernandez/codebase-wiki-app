---
type: Decision
title: 0003 - macOS solo Apple Silicon
description: I pacchetti macOS sono solo aarch64; niente build Intel o universal.
status: accepted
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - scripts/build-sidecar.mjs
  - .github/workflows/build.yml
source_commit: 206cc3c
confidence: high
---

# 0003 - macOS solo Apple Silicon

## Contesto
ONNX Runtime, usato dall'eseguibile di ricerca, non ha binari precompilati per
`x86_64-apple-darwin`.

## Decisione
La CI costruisce macOS solo per `aarch64-apple-darwin`; `scripts/build-sidecar.mjs` rifiuta i
target Intel e universal con un errore esplicito.

## Alternative scartate
Alternatives not recorded.

## Conseguenze
I Mac Intel non sono supportati.

## Approval
<!-- wiki:approval -->
accepted: Stefano, sessione con Claude Code, 2026-11-11
