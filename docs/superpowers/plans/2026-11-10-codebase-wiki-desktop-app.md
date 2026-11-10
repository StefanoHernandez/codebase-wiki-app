# Codebase Wiki Desktop App (`codebase-wiki-app`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `codebase-wiki-app`, a cross-platform Obsidian-style desktop application dedicated to **Codebase Wiki LLM** featuring a live "Wiki ↔ Code" force-directed graph, a Schema-aware Markdown workbench, deterministic human actions for Tracker/Decisions, live `validate-wiki.py` linting, and a background CLI Agent Runner.

**Architecture:** A Rust backend (`src-tauri/`) implements wiki root resolution (`resolve-wiki-root` parity), Git drift detection, guardrailed filesystem reads/writes, `.private-terms` protection, `validate-wiki.py` execution, live filesystem watching, and CLI agent spawning (`claude`/`codex`), exposed via both Tauri v2 configuration and a local loopback JSON/SSE server that launches in a dedicated desktop app window. A modular TypeScript frontend (`src/`) provides pure, unit-tested parsers/mutators/graph builders (`src/lib/`) and an Obsidian-styled dark UI with an HTML5 Canvas 2D force-directed graph (`src/ui/`).

**Tech Stack:** Rust (`rustc`/`cargo` with offline-cached `serde = "=1.0.229"`, `serde_json = "=1.0.154"`, `regex = "=1.13.1"`, `sha2 = "=0.10.9"`), TypeScript (Node.js 26 native TypeScript + `node:test`), HTML5 Canvas 2D Force-Graph, Python 3.10+ (`resources/validate-wiki.py`).

**Spec:** `docs/superpowers/specs/2026-11-10-codebase-wiki-desktop-app-design.md`

## Global Constraints

- **Offline Sandbox Compatibility:** All builds and tests MUST run offline inside the sandbox without network calls (`node --test` for TypeScript tests; `cargo test --offline` and `cargo build --offline` for Rust using exact cached versions: `serde = { version = "=1.0.229", features = ["derive"] }`, `serde_json = "=1.0.154"`, `regex = "=1.13.1"`, `sha2 = "=0.10.9"`).
- **Wiki-Only Write Guardrail:** Every write operation MUST verify that the resolved target path is strictly inside `<repo>/<wiki-root>/` (or `<repo>/.wikidir` during initialization). Writing to repository source files outside the wiki root or to `.private-terms` MUST be rejected with an error.
- **`resolve-wiki-root` Parity:** `.wikidir` parsing MUST strip NUL (`\0`), CR (`\r`), and UTF-8/UTF-16 BOM bytes (`\xEF\xBB\xBF`, `\xFE\xFF`, `\xFF\xFE`), read the first non-whitespace line, reject case-insensitively `.git`, `.github`, `.claude`, `.codex`, `.agents`, `.agent`, `.gemini`, `.opencode`, `.obsidian`, `.vscode`, `node_modules`, `.wikidir`, and validate against `^\.?[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9_-])?$`.
- **Human Authority Invariants:** Closing an Open tracker row with ⚫ MUST require a non-empty human `<person>` (rejecting `agent`, `coding agent`, `ai` case-insensitively and `<...>` placeholders) and `<notProvenReason>`, formatting `Criteria met` as `closed by <person> YYYY-MM-DD; not proven: <notProvenReason>`. Proposals MUST NOT contain `T\d+` IDs or status icons (`🟢`, `⚫`, `🟡`, `⚪`, `🔴`).
- **Confidentiality (`.private-terms`):** `<wiki-root>/.private-terms` MUST never appear as a graph node or sidebar file, and when `SCHEMA.md` has `Sensitive data` set to `yes`, saving a wiki file containing any non-empty term listed in `.private-terms` MUST be blocked.

## Review Focus

1. **BOM and Windows CRLF in `.wikidir` and Wiki Pages:** `.wikidir` or Markdown files containing UTF-8 BOM (`\uFEFF`) or `\r\n` line endings must parse cleanly without corrupting frontmatter keys, table cells, or the resolved wiki folder name.
2. **Path Traversal via `write_wiki_file` or `read_repo_file`:** Relative paths containing `..` (e.g. `../src/main.rs`) or targeting `.private-terms` must be rejected before reading or writing.
3. **Tracker ID Allocation Across Open, Done, and Log:** Promoting a proposal to `Open` must inspect existing `T<N>` IDs across `Open`, `Done`, and `log.md` so a previously closed or archived ID is never reused.
4. **Reserved Agent Names in Human Closure / Decision Approval:** Passing `agent`, `AI`, `coding agent`, `unknown`, or `<person>` as the human author for ⚫ closure or decision approval must throw a validation error.
5. **Translated Headings with `<!-- wiki:... -->` Markers:** `work-tracker.md` and `agent/handoff.md` with translated `## ...` headings must still be parsed and updated accurately via their `<!-- wiki:open -->`, `<!-- wiki:proposals -->`, `<!-- wiki:done -->`, and `<!-- wiki:baton -->` markers.

---

### Task 1: Project Scaffolding & Core TypeScript Domain Parsers (`frontmatter.ts`, `schema-parser.ts`)

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/types/wiki.ts`
- Create: `src/lib/frontmatter.ts`
- Create: `src/lib/schema-parser.ts`
- Test: `tests/parsers.test.ts`

**Interfaces:**
- Consumes: none (foundational types and parsers)
- Produces:
  - `src/types/wiki.ts`:
    - `export type ConfidenceLevel = 'high' | 'medium' | 'low';`
    - `export type CoreRole = 'index' | 'log' | 'log-archive' | 'tracker' | 'decisions' | 'risks' | 'context' | 'handoff' | 'troubleshooting' | 'glossary';`
    - `export interface ParsedFrontmatter { fields: Record<string, string>; sources: string[]; hasFrontmatter: boolean; bodyOffsetLine: number; body: string; }`
    - `export interface SchemaConfig { language: string; projectDivision: string; sensitiveData: boolean; agentEntryFile: string; coreMap: Record<string, string>; budgets: { singlePageBytes: number; coreReadBytes: number; logBytes: number }; topics: Array<{ name: string; path: string; description: string }>; excludedGlobs: string[]; }`
  - `src/lib/frontmatter.ts`:
    - `export function parseFrontmatter(markdown: string): ParsedFrontmatter`
    - `export function updateFrontmatterFields(markdown: string, updates: Record<string, string>, newSources?: string[]): string`
    - `export function extractMarkdownLinks(markdownBody: string): string[]`
  - `src/lib/schema-parser.ts`:
    - `export const DEFAULT_CORE_MAP: Record<CoreRole, string>`
    - `export function parseSchemaMarkdown(markdown: string): SchemaConfig`

- [ ] **Step 1: Write the failing test in `tests/parsers.test.ts`**

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, updateFrontmatterFields, extractMarkdownLinks } from '../src/lib/frontmatter.ts';
import { parseSchemaMarkdown } from '../src/lib/schema-parser.ts';

test('parseFrontmatter handles UTF-8 BOM, CRLF, scalar fields, and indented sources list', () => {
  const raw = '\uFEFF---\r\ntype: Module\r\ntitle: "Auth Service"\r\ngenerated: { by: codex/gpt-5, at: 2026-11-10T09:00:00Z }\r\nsources:\r\n  - src/auth.ts\r\n  - "src/session.ts"\r\nsource_commit: a1b2c3d\r\nconfidence: high\r\n---\r\n\r\n# Auth Service\r\nBody text.';
  const parsed = parseFrontmatter(raw);
  assert.equal(parsed.hasFrontmatter, true);
  assert.equal(parsed.fields.type, 'Module');
  assert.equal(parsed.fields.title, 'Auth Service');
  assert.deepEqual(parsed.sources, ['src/auth.ts', 'src/session.ts']);
  assert.equal(parsed.fields.source_commit, 'a1b2c3d');
  assert.equal(parsed.fields.confidence, 'high');
  assert.match(parsed.body, /# Auth Service/);
});

test('updateFrontmatterFields updates scalar fields and preserves sources and body', () => {
  const raw = '---\ntype: Decision\ntitle: 0001 - Stack\nstatus: proposed\nsources:\n  - README.md\nsource_commit: 1234567\nconfidence: high\n---\n\n# 0001 - Stack\n';
  const updated = updateFrontmatterFields(raw, { status: 'accepted', source_commit: '89abcdef' });
  const reparsed = parseFrontmatter(updated);
  assert.equal(reparsed.fields.status, 'accepted');
  assert.equal(reparsed.fields.source_commit, '89abcdef');
  assert.deepEqual(reparsed.sources, ['README.md']);
  assert.match(reparsed.body, /# 0001 - Stack/);
});

test('extractMarkdownLinks ignores fenced code blocks, inline code, and external URLs', () => {
  const md = [
    'See [Tracker](project/work-tracker.md#open) and [Arch](./architecture.md "Title").',
    'Ignore `[inline](ignored.md)` and [ext](https://example.com/a.md).',
    '```markdown',
    '[fenced](should-ignore.md)',
    '```',
    '[ref]: agent/handoff.md'
  ].join('\n');
  const links = extractMarkdownLinks(md);
  assert.deepEqual(links, ['project/work-tracker.md', './architecture.md', 'agent/handoff.md']);
});

test('parseSchemaMarkdown parses Project profile, Core map, Budgets, Topics, and Excluded paths', () => {
  const schemaMd = `---
type: Schema
title: Wiki Schema
confidence: high
---
# Wiki Schema

## Project profile
| Setting | Value |
| --- | --- |
| Language | Italian |
| Project division | releases |
| Sensitive data | yes |
| Agent entry file | AGENTS.md |

## Core map
| Role | Path |
| --- | --- |
| index | \`index.md\` |
| log | \`log.md\` |
| log-archive | \`log/\` |
| tracker | \`project/work-tracker.md\` |
| decisions | \`project/decisions/\` |
| risks | \`project/risks.md\` |
| context | \`agent/context.md\` |
| handoff | \`agent/handoff.md\` |
| troubleshooting | \`troubleshooting.md\` |
| glossary | \`glossary.md\` |

## Budgets
| Budget | Default |
| --- | --- |
| Single page | 25 KB |
| Core read at a new context | 70 KB |
| log | 35 KB |

## Topics
| Topic | Path | What belongs there |
| --- | --- | --- |
| architecture | \`architecture.md\` | system boundaries |

## Excluded paths
- \`reports/**\`
`;
  const config = parseSchemaMarkdown(schemaMd);
  assert.equal(config.language, 'Italian');
  assert.equal(config.projectDivision, 'releases');
  assert.equal(config.sensitiveData, true);
  assert.equal(config.agentEntryFile, 'AGENTS.md');
  assert.equal(config.coreMap.tracker, 'project/work-tracker.md');
  assert.equal(config.coreMap.decisions, 'project/decisions/');
  assert.equal(config.budgets.singlePageBytes, 25 * 1024);
  assert.equal(config.budgets.coreReadBytes, 70 * 1024);
  assert.equal(config.budgets.logBytes, 35 * 1024);
  assert.equal(config.topics.length, 1);
  assert.equal(config.topics[0].name, 'architecture');
  assert.equal(config.topics[0].path, 'architecture.md');
  assert.deepEqual(config.excludedGlobs, ['reports/**']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/parsers.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../src/lib/frontmatter.ts`

- [ ] **Step 3: Create `.gitignore`, `package.json`, `tsconfig.json`, `src/types/wiki.ts`, `src/lib/frontmatter.ts`, and `src/lib/schema-parser.ts`**

Implement `parseFrontmatter`, `updateFrontmatterFields`, `extractMarkdownLinks` (matching `validate-wiki.py`'s unfenced/inline/reference link rules and BOM/CRLF handling), and `parseSchemaMarkdown` (with defaults `20 * 1024`, `60 * 1024`, `30 * 1024` bytes and `DEFAULT_CORE_MAP`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/parsers.test.ts`
Expected: PASS (4 tests passing)

- [ ] **Step 5: Commit**

```bash
git add .gitignore package.json tsconfig.json resources/ docs/ src/types/wiki.ts src/lib/frontmatter.ts src/lib/schema-parser.ts tests/parsers.test.ts
git commit -m "feat: add core wiki types, frontmatter parser, and schema parser"
```

---

### Task 2: Tracker, Decisions, Handoff & Human-Authorized Mutations (`markdown-tables.ts`, `human-actions.ts`)

**Files:**
- Create: `src/lib/markdown-tables.ts`
- Create: `src/lib/human-actions.ts`
- Modify: `src/types/wiki.ts`
- Test: `tests/human-actions.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter`, `updateFrontmatterFields` from `src/lib/frontmatter.ts`
- Produces:
  - `src/types/wiki.ts`:
    - `export interface TrackerOpenRow { id: string; status: '🟡' | '⚪' | '🔴'; goal: string; doneWhen: string; owner: string; nextVerification: string; evidence: string; }`
    - `export interface TrackerProposalRow { proposal: string; by: string; date: string; why: string; }`
    - `export interface TrackerDoneRow { id: string; status: '🟢' | '⚫'; goal: string; closed: string; criteriaMet: string; evidence: string; }`
    - `export interface TrackerData { open: TrackerOpenRow[]; proposals: TrackerProposalRow[]; done: TrackerDoneRow[]; }`
    - `export interface BatonRow { order: string; task: string; startFiles: string; doneWhen: string; verificationCommand: string; notes: string; }`
    - `export interface HandoffData { stateBullets: Record<string, string>; baton: BatonRow[]; noOpenWork: boolean; blockers: Array<Record<string, string>>; }`
  - `src/lib/markdown-tables.ts`:
    - `export function parseTrackerMarkdown(markdown: string): TrackerData`
    - `export function parseHandoffMarkdown(markdown: string): HandoffData`
    - `export function computeNextTrackerId(trackerMarkdown: string, logMarkdown: string): string`
  - `src/lib/human-actions.ts`:
    - `export function promoteProposalToOpen(params: { trackerMarkdown: string; logMarkdown: string; proposalIndex: number; person: string; owner: string; doneWhen: string; nextVerification: string; dateIso: string; shortSha: string; }): { trackerMarkdown: string; logMarkdown: string; assignedId: string }`
    - `export function closeTrackerItemHumanUnproven(params: { trackerMarkdown: string; logMarkdown: string; taskId: string; person: string; notProvenReason: string; dateIso: string; shortSha: string; }): { trackerMarkdown: string; logMarkdown: string }`
    - `export function approveDecisionHuman(params: { decisionMarkdown: string; logMarkdown: string; person: string; whereContext: string; dateIso: string; shortSha: string; }): { decisionMarkdown: string; logMarkdown: string }`

- [ ] **Step 1: Write the failing test in `tests/human-actions.test.ts`**

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrackerMarkdown, parseHandoffMarkdown, computeNextTrackerId } from '../src/lib/markdown-tables.ts';
import { promoteProposalToOpen, closeTrackerItemHumanUnproven, approveDecisionHuman } from '../src/lib/human-actions.ts';

const SAMPLE_TRACKER = `---
type: Project
title: Work Tracker
description: Status tracker
generated: { by: codex/gpt-5, at: 2026-11-10T09:00:00Z }
sources:
  - wiki/log.md
source_commit: a1b2c3d
confidence: high
---

# Work Tracker

## Compiti Aperti
<!-- wiki:open -->

| ID | Status | Goal | Done when | Owner | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 🟡 | Build parser | Tests pass | stefano | \`node --test\` | \`tests/parsers.test.ts\` |

## Proposte
<!-- wiki:proposals -->

| Proposal | By | Date | Why |
| --- | --- | --- | --- |
| Add graph filter | stefano | 2026-11-10 | Faster debugging |

## Completati
<!-- wiki:done -->

| ID | Status | Goal | Closed | Criteria met | Evidence |
| --- | --- | --- | --- | --- | --- |
| T4 | 🟢 | Initial setup | 2026-11-09 | \`git status\` clean | commit a1b2c3d |
`;

const SAMPLE_LOG = `---
title: Wiki Log
sources:
  - README.md
source_commit: a1b2c3d
confidence: high
generated: { by: codex/gpt-5, at: 2026-11-10T09:00:00Z }
---

# Log

## 2026-11-09 · Archive old task · human
- What: Closed legacy task
- Evidence: manual review @a1b2c3d
- IDs: T7
`;

test('parseTrackerMarkdown supports translated headings via wiki markers and computeNextTrackerId scans Open, Done, and Log', () => {
  const data = parseTrackerMarkdown(SAMPLE_TRACKER);
  assert.equal(data.open.length, 1);
  assert.equal(data.open[0].id, 'T1');
  assert.equal(data.proposals.length, 1);
  assert.equal(data.proposals[0].proposal, 'Add graph filter');
  assert.equal(data.done.length, 1);
  assert.equal(data.done[0].id, 'T4');

  const nextId = computeNextTrackerId(SAMPLE_TRACKER, SAMPLE_LOG);
  assert.equal(nextId, 'T8');
});

test('promoteProposalToOpen assigns next never-reused T<N>, adds Open row with ⚪, removes proposal, and appends human log', () => {
  const res = promoteProposalToOpen({
    trackerMarkdown: SAMPLE_TRACKER,
    logMarkdown: SAMPLE_LOG,
    proposalIndex: 0,
    person: 'Stefano',
    owner: 'Stefano',
    doneWhen: 'Filter toggles source nodes',
    nextVerification: 'node --test',
    dateIso: '2026-11-10',
    shortSha: 'b2c3d4e',
  });
  assert.equal(res.assignedId, 'T8');
  const parsed = parseTrackerMarkdown(res.trackerMarkdown);
  assert.equal(parsed.proposals.length, 0);
  assert.equal(parsed.open.length, 2);
  assert.equal(parsed.open[1].id, 'T8');
  assert.equal(parsed.open[1].status, '⚪');
  assert.match(res.logMarkdown, /## 2026-11-10 · Promote proposal to T8 · human/);
});

test('closeTrackerItemHumanUnproven enforces human authority and formats ⚫ row to match validate-wiki.py', () => {
  assert.throws(() => {
    closeTrackerItemHumanUnproven({
      trackerMarkdown: SAMPLE_TRACKER,
      logMarkdown: SAMPLE_LOG,
      taskId: 'T1',
      person: 'coding agent',
      notProvenReason: 'skipped',
      dateIso: '2026-11-10',
      shortSha: 'b2c3d4e',
    });
  }, /human/i);

  const res = closeTrackerItemHumanUnproven({
    trackerMarkdown: SAMPLE_TRACKER,
    logMarkdown: SAMPLE_LOG,
    taskId: 'T1',
    person: 'Stefano',
    notProvenReason: 'superseded by direct parser',
    dateIso: '2026-11-10',
    shortSha: 'b2c3d4e',
  });
  const parsed = parseTrackerMarkdown(res.trackerMarkdown);
  assert.equal(parsed.open.length, 0);
  assert.equal(parsed.done.length, 2);
  const closedRow = parsed.done.find((r) => r.id === 'T1')!;
  assert.equal(closedRow.status, '⚫');
  assert.equal(closedRow.closed, '2026-11-10');
  assert.equal(closedRow.criteriaMet, 'closed by Stefano 2026-11-10; not proven: superseded by direct parser');
  assert.match(res.logMarkdown, /## 2026-11-10 · Close T1 without proof · human/);
});

test('approveDecisionHuman updates status to accepted, rewrites ## Approval, and appends human log', () => {
  const decisionMd = `---
type: Decision
title: 0002 - Use Canvas Graph
description: Render graph in 2D canvas
status: proposed
generated: { by: codex/gpt-5, at: 2026-11-10T09:00:00Z }
sources:
  - README.md
source_commit: a1b2c3d
confidence: high
---

# 0002 - Use Canvas Graph

## Context
Need smooth rendering on Linux Wayland.

## Decision
Use HTML5 2D Canvas force graph.

## Alternatives rejected
- WebGL: Wayland driver glitches.

## Consequences
Fast rendering.

## Approval
proposed: codex on 2026-11-10.
`;

  const res = approveDecisionHuman({
    decisionMarkdown: decisionMd,
    logMarkdown: SAMPLE_LOG,
    person: 'Stefano',
    whereContext: 'Codebase Wiki Desktop App',
    dateIso: '2026-11-10',
    shortSha: 'b2c3d4e',
  });
  assert.match(res.decisionMarkdown, /status: accepted/);
  assert.match(res.decisionMarkdown, /accepted: approved by Stefano \(Codebase Wiki Desktop App\) on 2026-11-10/);
  assert.match(res.logMarkdown, /## 2026-11-10 · Approve decision 0002 - Use Canvas Graph · human/);
});

test('parseHandoffMarkdown parses state bullets, baton rows, and blockers', () => {
  const handoffMd = `---
type: AgentNote
title: Agent Handoff
sources:
  - wiki/SCHEMA.md
source_commit: a1b2c3d
confidence: high
generated: { by: codex/gpt-5, at: 2026-11-10T09:00:00Z }
---
# Agent Handoff

## Current Work State
<!-- wiki:state -->
- Tracker IDs: T1
- Goal: Build app
- Current branch: \`main\`

## Baton For Next Coding Agent
<!-- wiki:baton -->
| Order | Task | Start files | Done when | Verification command | Notes / blockers |
| --- | --- | --- | --- | --- | --- |
| 1 | T1 - Implement parser | \`src/lib/frontmatter.ts\` | Tests pass | \`node --test\` | none |

## Blockers
<!-- wiki:blockers -->
| Blocker | Type | Needed from | Current workaround |
| --- | --- | --- | --- |
| none | external | none | none |
`;
  const parsed = parseHandoffMarkdown(handoffMd);
  assert.equal(parsed.stateBullets['Tracker IDs'], 'T1');
  assert.equal(parsed.baton.length, 1);
  assert.equal(parsed.baton[0].task, 'T1 - Implement parser');
  assert.equal(parsed.noOpenWork, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/human-actions.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: Implement `src/lib/markdown-tables.ts` and `src/lib/human-actions.ts`**

Ensure `validateHumanActor(person)` rejects empty strings, strings matching `/^<.*>$/`, and case-insensitive `agent`, `coding agent`, `ai`, `unknown`, `pending`, `todo`, `tbd`, `n/a`, `na`, `none`. Ensure table serialization outputs clean pipe-delimited rows that pass `resources/validate-wiki.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/human-actions.test.ts`
Expected: PASS (5 tests passing)

- [ ] **Step 5: Commit**

```bash
git add src/types/wiki.ts src/lib/markdown-tables.ts src/lib/human-actions.ts tests/human-actions.test.ts
git commit -m "feat: add tracker/handoff table parsers and human-authorized mutations"
```

---

### Task 3: Interactive "Wiki ↔ Code" Graph Builder & Filter Engine (`graph-builder.ts`)

**Files:**
- Create: `src/lib/graph-builder.ts`
- Modify: `src/types/wiki.ts`
- Test: `tests/graph-builder.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter`, `extractMarkdownLinks` from `src/lib/frontmatter.ts`; `parseSchemaMarkdown` from `src/lib/schema-parser.ts`
- Produces:
  - `src/types/wiki.ts`:
    - `export type GraphNodeCategory = 'core' | 'decision' | 'tracker' | 'agent' | 'topic' | 'source';`
    - `export interface GraphNode { id: string; label: string; path: string; kind: 'wiki' | 'source'; category: GraphNodeCategory; role?: string; confidence?: string; sourceCommit?: string; hasDrift: boolean; driftFiles: string[]; hasLintError: boolean; lintCount: number; needsReverify: boolean; isOrphan: boolean; sizeBytes: number; degree: number; }`
    - `export interface GraphEdge { id: string; source: string; target: string; kind: 'markdown-link' | 'source-link'; }`
    - `export interface WikiGraph { nodes: GraphNode[]; edges: GraphEdge[]; backlinks: Record<string, string[]>; uncoveredRepoFiles: string[]; }`
    - `export interface GraphFilterOptions { includeCodeSources: boolean; onlyDriftOrErrors: boolean; searchQuery: string; focusNodeId?: string; localGraphHops?: number; }`
  - `src/lib/graph-builder.ts`:
    - `export function buildWikiCodeGraph(input: { wikiRoot: string; pages: Array<{ wikiRelPath: string; content: string; sizeBytes: number }>; repoFiles: string[]; changedFilesByPage: Record<string, string[]>; dirtyRepoFiles: string[]; lintFindings: Array<{ wikiRelPath: string; line: number; message: string }>; }): WikiGraph`
    - `export function filterWikiGraph(graph: WikiGraph, options: GraphFilterOptions): { nodes: GraphNode[]; edges: GraphEdge[] }`

- [ ] **Step 1: Write the failing test in `tests/graph-builder.test.ts`**

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWikiCodeGraph, filterWikiGraph } from '../src/lib/graph-builder.ts';

test('buildWikiCodeGraph creates wiki nodes, source nodes, markdown/source edges, drift overlays, and uncovered files', () => {
  const pages = [
    {
      wikiRelPath: 'SCHEMA.md',
      sizeBytes: 500,
      content: `---\ntype: Schema\ntitle: Schema\nconfidence: high\ngenerated: { by: codex/gpt-5, at: 2026-11-10T00:00:00Z }\n---\n# Schema\n## Core map\n| Role | Path |\n| --- | --- |\n| index | \`index.md\` |\n| tracker | \`project/work-tracker.md\` |\n| decisions | \`project/decisions/\` |\n| context | \`agent/context.md\` |\n| handoff | \`agent/handoff.md\` |\n| log | \`log.md\` |\n| log-archive | \`log/\` |\n| risks | \`project/risks.md\` |\n| troubleshooting | \`troubleshooting.md\` |\n| glossary | \`glossary.md\` |\n`
    },
    {
      wikiRelPath: 'index.md',
      sizeBytes: 400,
      content: `---\ntitle: Index\nconfidence: high\nsources:\n  - README.md\nsource_commit: a1b2c3d\ngenerated: { by: codex/gpt-5, at: 2026-11-10T00:00:00Z }\n---\n# Index\nSee [Arch](architecture.md) and [Decision](project/decisions/0001-init.md).`
    },
    {
      wikiRelPath: 'architecture.md',
      sizeBytes: 800,
      content: `---\ntype: Engineering\ntitle: Architecture\nconfidence: medium\nsources:\n  - src/engine.ts:10\nsource_commit: a1b2c3d\ngenerated: { by: codex/gpt-5, at: 2026-11-10T00:00:00Z }\n---\n# Architecture\n> ⚠️ TO RE-VERIFY\nDetails.`
    },
    {
      wikiRelPath: 'project/decisions/0001-init.md',
      sizeBytes: 600,
      content: `---\ntype: Decision\ntitle: 0001 - Init\nstatus: accepted\nconfidence: high\nsources:\n  - src/engine.ts\nsource_commit: a1b2c3d\ngenerated: { by: codex/gpt-5, at: 2026-11-10T00:00:00Z }\n---\n# 0001`
    },
    {
      wikiRelPath: 'orphan.md',
      sizeBytes: 300,
      content: `---\ntype: Engineering\ntitle: Orphan\nconfidence: low\nsources:\n  - README.md\nsource_commit: a1b2c3d\ngenerated: { by: codex/gpt-5, at: 2026-11-10T00:00:00Z }\n---\n# Orphan`
    }
  ];

  const graph = buildWikiCodeGraph({
    wikiRoot: 'wiki',
    pages,
    repoFiles: ['README.md', 'src/engine.ts', 'src/unmapped.ts'],
    changedFilesByPage: { 'architecture.md': ['src/engine.ts'] },
    dirtyRepoFiles: ['src/engine.ts'],
    lintFindings: [{ wikiRelPath: 'orphan.md', line: 1, message: 'broken link' }],
  });

  const archNode = graph.nodes.find((n) => n.id === 'wiki:architecture.md')!;
  assert.equal(archNode.category, 'topic');
  assert.equal(archNode.hasDrift, true);
  assert.equal(archNode.needsReverify, true);
  assert.deepEqual(archNode.driftFiles, ['src/engine.ts']);

  const decNode = graph.nodes.find((n) => n.id === 'wiki:project/decisions/0001-init.md')!;
  assert.equal(decNode.category, 'decision');
  assert.equal(decNode.hasDrift, true); // src/engine.ts is in dirtyRepoFiles

  const orphanNode = graph.nodes.find((n) => n.id === 'wiki:orphan.md')!;
  assert.equal(orphanNode.isOrphan, true);
  assert.equal(orphanNode.hasLintError, true);

  const srcNode = graph.nodes.find((n) => n.id === 'source:src/engine.ts')!;
  assert.equal(srcNode.kind, 'source');
  assert.equal(srcNode.hasDrift, true);

  assert.deepEqual(graph.backlinks['architecture.md'], ['index.md']);
  assert.deepEqual(graph.uncoveredRepoFiles, ['src/unmapped.ts']);

  // Filter: 1-hop local graph around wiki:architecture.md without code sources
  const localWikiOnly = filterWikiGraph(graph, {
    includeCodeSources: false,
    onlyDriftOrErrors: false,
    searchQuery: '',
    focusNodeId: 'wiki:architecture.md',
    localGraphHops: 1,
  });
  assert.deepEqual(
    localWikiOnly.nodes.map((n) => n.id).sort(),
    ['wiki:architecture.md', 'wiki:index.md']
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/graph-builder.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: Implement `src/lib/graph-builder.ts` and update `src/types/wiki.ts`**

Ensure `sources:` entries strip `:line(:col)` and `#anchor` suffixes when matching repository paths, exclude `.private-terms` and `SCHEMA.md` from orphan flagging, and compute 1-hop / N-hop BFS neighborhoods for `localGraphHops`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/graph-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/wiki.ts src/lib/graph-builder.ts tests/graph-builder.test.ts
git commit -m "feat: add Wiki-Code graph builder and local-graph filter engine"
```

---

### Task 4: Rust Backend Core — Wiki Root Resolver, Git Drift Engine, Validator & Guardrailed File Ops (`src-tauri/`)

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/wiki_resolver.rs`
- Create: `src-tauri/src/git_ops.rs`
- Create: `src-tauri/src/validator.rs`
- Create: `src-tauri/src/wiki_fs.rs`
- Create: `src-tauri/src/agent_runner.rs`

**Interfaces:**
- Consumes: `resources/validate-wiki.py`, `resources/default-schema.md`, `resources/workflows/*.md`
- Produces (in `src-tauri/src/lib.rs` and submodules):
  - `wiki_resolver::resolve_wiki_root(repo_path: &Path) -> WikiResolution` (`wiki_root: Option<String>`, `warning: Option<String>`, `is_initialized: bool`)
  - `git_ops::inspect_git_state(repo_path: &Path, handoff_rel_path: Option<&str>) -> GitState` (`head_sha`, `branch`, `is_dirty`, `dirty_files`, `handoff_commits_behind`)
  - `git_ops::changed_files_since_commit(repo_path: &Path, source_commit: &str, sources: &[String]) -> Vec<String>`
  - `git_ops::file_diff_since_commit(repo_path: &Path, source_commit: &str, rel_path: &str) -> String`
  - `validator::run_structural_lint(repo_path: &Path, wiki_root: &str, validator_script: &Path) -> LintReport`
  - `wiki_fs::load_wiki_snapshot(repo_path: &Path, wiki_root: &str, validator_script: &Path) -> Result<WikiSnapshot, String>`
  - `wiki_fs::read_repo_file_safe(repo_path: &Path, rel_path: &str, source_commit: Option<&str>) -> Result<RepoFilePayload, String>`
  - `wiki_fs::write_wiki_file_safe(repo_path: &Path, wiki_root: &str, wiki_rel_path: &str, content: &str, sensitive_data: bool) -> Result<(), String>`
  - `wiki_fs::initialize_new_wiki(repo_path: &Path, req: &InitWikiRequest, default_schema_path: &Path) -> Result<String, String>`
  - `agent_runner::build_workflow_prompt(workflow: &str, target: Option<&str>, workflow_dir: &Path) -> Result<String, String>`

- [ ] **Step 1: Create `src-tauri/Cargo.toml` with offline-cached dependencies and write unit tests in the Rust modules**

In `src-tauri/Cargo.toml`:
```toml
[package]
name = "codebase-wiki-app"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "=1.0.229", features = ["derive"] }
serde_json = "=1.0.154"
regex = "=1.13.1"
sha2 = "=0.10.9"
```

Include unit tests in `src-tauri/src/lib.rs` (or submodules) covering:
1. `resolve_wiki_root` with UTF-8 BOM + CRLF in `.wikidir`, reserved names (`.git`, `.obsidian`, `node_modules`), missing target directory, and fallback to `wiki/SCHEMA.md`.
2. `write_wiki_file_safe` rejecting path traversal (`../outside.md`), rejecting `.private-terms` modification, and blocking writes containing a forbidden term from `<wiki-root>/.private-terms` when `sensitive_data == true`.
3. `initialize_new_wiki` creating `<wiki-root>/SCHEMA.md`, `index.md`, `log.md`, `project/work-tracker.md`, `project/risks.md`, `agent/context.md`, `agent/handoff.md`, `troubleshooting.md`, `glossary.md`, and `.wikidir` (when folder != `wiki`) such that `run_structural_lint` returns `exit_code == 0` and zero findings!

- [ ] **Step 2: Run `cargo test --offline` to verify tests compile and pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --offline`
Expected: PASS (all Rust unit and integration tests passing with zero warnings/errors)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/
git commit -m "feat(backend): add Rust wiki resolver, git drift ops, guardrailed fs, and validator runner"
```

---

### Task 5: Desktop Application Server, Native Window Launcher & Obsidian-Style Frontend UI (`src-tauri/src/main.rs`, `src/ui/`, `index.html`)

**Files:**
- Create: `src-tauri/src/main.rs`
- Create: `index.html`
- Create: `src/ui/styles.css`
- Create: `src/ui/graph-canvas.ts`
- Create: `src/ui/app-controller.ts`
- Create: `scripts/build-ui.ts`
- Create: `tests/e2e-server.test.ts`

**Interfaces:**
- Consumes: Rust library crate `codebase_wiki_app` (`src-tauri/src/lib.rs`) and TypeScript modules in `src/lib/`
- Produces:
  - `src-tauri/src/main.rs`:
    - CLI flags: `--repo <path>`, `--port <port>`, `--headless` (runs HTTP/JSON/SSE server without spawning GUI window for tests/headless usage; without `--headless`, opens a native standalone desktop window via `chromium --app=http://127.0.0.1:<port>` / `brave --app=...` / `xdg-open`).
    - HTTP JSON API endpoints:
      - `GET /api/state` -> returns current `WikiSnapshot` (or uninitialized repo state)
      - `POST /api/open-repo` `{ "repoPath": "..." }` -> switches active repository and returns `WikiSnapshot`
      - `POST /api/read-file` `{ "relPath": "...", "sourceCommit": "..." }` -> returns `RepoFilePayload` (content + git diff)
      - `POST /api/write-wiki-file` `{ "wikiRelPath": "...", "content": "..." }` -> writes wiki page, runs `validate-wiki.py`, returns updated `WikiSnapshot`
      - `POST /api/human-action` `{ "action": "promote-proposal" | "close-unproven" | "approve-decision", ... }` -> executes deterministic mutation and returns updated `WikiSnapshot`
      - `POST /api/init-wiki` (`InitWikiRequest`) -> initializes a valid v2 Codebase Wiki and returns `WikiSnapshot`
      - `POST /api/agent-prompt` `{ "workflow": "sync" | "ingest" | "lint" | "init", "target": "..." }` -> returns formatted workflow prompt and optional background CLI execution output (`claude` / `codex`)
      - `GET /api/events` -> Server-Sent Events (SSE) stream emitting `fs-changed` whenever `<wiki-root>` or `.git/HEAD` changes on disk.
  - `scripts/build-ui.ts`:
    - Bundles/transpiles `src/ui/app-controller.ts` and its `src/lib/*` imports into `dist/app.js` using Node 26 native TypeScript stripping (`amaro` / module bundler script) so `index.html` runs directly in any browser/webview with zero external build tools required.
  - `index.html`, `src/ui/styles.css`, `src/ui/graph-canvas.ts`, `src/ui/app-controller.ts`:
    - Obsidian-inspired dark interface with:
      1. **TopBar**: Repo path switcher, Git branch & short SHA badge, Drift counter badge, Lint status pill, `+ Init Wiki` button, and `Run Agent (/wiki-sync, /wiki-ingest, /wiki-lint)` button.
      2. **Schema-Aware Left Sidebar**: Core Map pages, Decisions (`project/decisions/`), Topics (`SCHEMA.md`), Uncovered Repo Files list, and Core Read Budget meter (`KB / 60 KB`).
      3. **Main View Tabs**:
         - **Graph + Split Editor View** (Obsidian 2D Force-Graph Canvas with role colors, orange drift ring, red lint ring, Code Sources toggle, Drift filter, Local Graph 1-hop toggle + side-by-side Markdown Editor/Preview & Frontmatter/Sources Inspector).
         - **Work Tracker Board** (`Open`, `Proposals`, `Done` tables + 1-click **"Promote to Open"** and **"Close (⚫ Human)"** modals).
         - **Decisions ADR Panel** (Decision cards with status badges + 1-click **"Approve Decision (Human)"** modal for `proposed` decisions).
         - **Agent Baton & Handoff View** (`Current Work State`, `Baton For Next Coding Agent` table, staleness warning banner if `>= 5` commits behind).
         - **Live Structural Lint Panel** (`validate-wiki.py` findings list; clicking a finding opens the file in the editor).
      4. **Read-Only Code Source & Git Diff Drawer**: Opens when clicking any `sources:` chip or source graph node.

- [ ] **Step 1: Write `scripts/build-ui.ts`, `index.html`, `src/ui/styles.css`, `src/ui/graph-canvas.ts`, `src/ui/app-controller.ts`, and `src-tauri/src/main.rs`**

Ensure `node scripts/build-ui.ts` compiles `dist/app.js`, `dist/styles.css`, and `dist/index.html` cleanly using only Node 26 built-in modules, and `cargo build --manifest-path src-tauri/Cargo.toml --offline` builds the `codebase-wiki-app` binary.

- [ ] **Step 2: Write end-to-end integration test in `tests/e2e-server.test.ts`**

Test spawning `src-tauri/target/debug/codebase-wiki-app --repo <temp-git-repo> --port <ephemeral-port> --headless`:
1. Verify `/api/state` initially reports `isInitialized: false`.
2. `POST /api/init-wiki` initializes `.wiki` (or `wiki`), creates all Core map files, and passes `validate-wiki.py` (`lintReport.exitCode === 0`).
3. `POST /api/human-action` promotes a proposal to `T2` and closes it as `⚫` by human `Stefano`, verifying `validate-wiki.py` still passes with `exitCode === 0`.
4. Modify a tracked source file in `<temp-git-repo>` and verify `/api/state` detects Git drift on the referencing wiki page.
5. Verify `GET /` serves the compiled `index.html` and `GET /app.js` serves the bundled frontend.

- [ ] **Step 3: Run all frontend and backend tests**

Run: `node scripts/build-ui.ts && cargo build --manifest-path src-tauri/Cargo.toml --offline && node --test tests/*.test.ts && cargo test --manifest-path src-tauri/Cargo.toml --offline`
Expected: PASS (all unit tests, Rust tests, and E2E server tests passing)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/main.rs index.html src/ui/ scripts/build-ui.ts dist/ tests/e2e-server.test.ts
git commit -m "feat(app): add native desktop server, Obsidian canvas graph UI, and E2E tests"
```
