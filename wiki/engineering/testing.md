---
type: Engineering
title: Test
description: Suite di test, fixture e valutazione della ricerca.
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T18:45:00Z }
sources:
  - package.json
  - tests/helpers/fixture.ts
  - tests/fixture-validator.test.ts
  - crates/rag-core/src/chunk.rs
  - .github/workflows/build.yml
source_commit: 206cc3c
confidence: high
---

# Test

## Suite

| Suite | Comando | Ultimo risultato |
| --- | --- | --- |
| Frontend (node:test) | `npm test` | 165 pass, 2026-11-13 @c73e9bd |
| Rust | `cargo test --workspace --features wiki-mcp/embed` | 122 pass, 2026-11-13 @c73e9bd |
| Rust con embedding | `cargo test -p rag-core -F embed,download` | verde, 2026-11-11 @9d32c1c |
| Tipi | `npx tsc --noEmit` | in CI |

La CI ([operations](operations.md)) lancia tipi, `npm test` e i test Rust prima delle build.

## Fixture
`tests/helpers/fixture.ts` crea repo git temporanei (`makeTempRepo`) e lancia il validatore
vero (`runValidator`); `tests/fixtures/wiki-v2` è una wiki di esempio. I test Rust usano
`tempfile` e non toccano mai le config reali degli agenti.

## Valutazione della ricerca
Il 2026-11-11 la ricerca è stata misurata con domande dalla risposta nota (file atteso come
regex) e uno script che calcola hit@1, hit@5 e MRR lanciando `codebase-wiki-mcp search --json`.
Script e domande sono rimasti nello scratchpad di quella sessione: non sono nel repo.
Risultati e conclusioni: [0004](../project/decisions/0004-rag-solo-codice.md),
[0005](../project/decisions/0005-reranker-facoltativo.md).
> ⚠️ NOT VERIFIED - lo script non è versionato; per ripetere la misura va riscritto o aggiunto al repo.
