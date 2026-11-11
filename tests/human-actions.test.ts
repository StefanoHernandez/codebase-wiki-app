import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseTrackerMarkdown, parseHandoffMarkdown, computeNextTrackerId } from '../src/lib/markdown-tables.ts';
import { parseFrontmatter } from '../src/lib/frontmatter.ts';
import {
  promoteProposalToOpen,
  closeTrackerItemHumanUnproven,
  acceptDecisionHuman,
  rejectDecisionHuman,
  updateOpenRowField,
  markPageReviewed,
  appendLogEntry,
} from '../src/lib/human-actions.ts';
import { todayLocal } from '../src/lib/dates.ts';
import { resolvePythonForValidator } from './helpers/fixture.ts';

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

const PHASE_TRACKER = `---
type: Project
title: Work Tracker
source_commit: a1b2c3d
updated: 2026-11-01
---

# Work Tracker

## Open
<!-- wiki:open -->

| ID | Phase | Status | Goal | Done when | Owner | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | Core | 🟡 | Build parser | Tests pass | stefano | \`node --test\` | \`tests/parsers.test.ts\` |

## Proposals
<!-- wiki:proposals -->

| Proposal | By | Date | Why |
| --- | --- | --- | --- |
| Add graph filter | stefano | 2026-11-10 | Faster debugging |

## Done
<!-- wiki:done -->

| ID | Status | Goal | Closed | Criteria met | Evidence |
| --- | --- | --- | --- | --- | --- |
`;

test('promoteProposalToOpen assigns next never-reused T<N>, sets owner and evidence, and appends a human log entry', () => {
  const res = promoteProposalToOpen({
    trackerMarkdown: SAMPLE_TRACKER,
    logMarkdown: SAMPLE_LOG,
    proposalText: 'Add graph filter',
    proposalBy: 'stefano',
    proposalDate: '2026-11-10',
    person: 'Stefano',
    owner: 'Mario',
    doneWhen: 'Filter toggles source nodes',
    nextVerification: 'node --test',
    dateIso: '2026-11-10',
  });
  assert.equal(res.assignedId, 'T8');
  const parsed = parseTrackerMarkdown(res.trackerMarkdown);
  assert.equal(parsed.proposals.length, 0);
  assert.equal(parsed.open.length, 2);
  assert.equal(parsed.open[1].id, 'T8');
  assert.equal(parsed.open[1].status, '⚪');
  assert.equal(parsed.open[1].owner, 'Mario');
  assert.equal(parsed.open[1].evidence, 'promoted by Stefano 2026-11-10');
  assert.deepEqual(parsed.open[1].extra, {});
  assert.doesNotMatch(res.trackerMarkdown, /^updated:/m);
  assert.match(res.trackerMarkdown, /^source_commit: a1b2c3d$/m);
  assert.equal(
    res.logMarkdown.slice(SAMPLE_LOG.trimEnd().length),
    '\n\n## 2026-11-10 · Promote proposal to T8 · human\n- What: Stefano promoted proposal "Add graph filter" to T8\n- Evidence: promoted by Stefano 2026-11-10\n- IDs: T8\n'
  );
});

test('extra tracker columns such as Phase survive promote and close', () => {
  const promoted = promoteProposalToOpen({
    trackerMarkdown: PHASE_TRACKER,
    logMarkdown: SAMPLE_LOG,
    proposalText: 'Add graph filter',
    proposalBy: 'stefano',
    proposalDate: '2026-11-10',
    person: 'Stefano',
    owner: 'Mario',
    doneWhen: 'Filter works',
    nextVerification: 'node --test',
    dateIso: '2026-11-10',
  });
  const afterPromote = parseTrackerMarkdown(promoted.trackerMarkdown);
  assert.equal(afterPromote.open[0].extra.Phase, 'Core');
  assert.equal(afterPromote.open[1].id, 'T8');

  const closed = closeTrackerItemHumanUnproven({
    trackerMarkdown: promoted.trackerMarkdown,
    logMarkdown: promoted.logMarkdown,
    taskId: 'T1',
    person: 'Stefano',
    notProvenReason: 'superseded',
    closureSource: 'chat',
    dateIso: '2026-11-10',
  });
  const afterClose = parseTrackerMarkdown(closed.trackerMarkdown);
  // Done has no Phase column: the header is not extended and the value is not copied.
  assert.equal(afterClose.doneHeader.includes('Phase'), false);
  assert.match(closed.trackerMarkdown, /^\| ID \| Status \| Goal \| Closed \| Criteria met \| Evidence \|$/m);
  assert.equal(afterClose.done.find((r) => r.id === 'T1')!.extra.Phase, undefined);
  // The promoted T8 row has no Phase value: new rows get empty extra columns.
  assert.equal(afterClose.open[0].id, 'T8');
  assert.equal(afterClose.open[0].extra.Phase, '');
});

test('close copies Open extra values only into existing Done columns, matching case-insensitively', () => {
  const doneWithPhase = PHASE_TRACKER.replace(
    '| ID | Status | Goal | Closed | Criteria met | Evidence |\n| --- | --- | --- | --- | --- | --- |',
    '| ID | Status | Goal | Closed | Criteria met | Evidence | phase |\n| --- | --- | --- | --- | --- | --- | --- |'
  );
  assert.notEqual(doneWithPhase, PHASE_TRACKER);
  const res = closeTrackerItemHumanUnproven({
    trackerMarkdown: doneWithPhase,
    logMarkdown: SAMPLE_LOG,
    taskId: 'T1',
    person: 'Stefano',
    notProvenReason: 'superseded',
    closureSource: 'chat',
    dateIso: '2026-11-10',
  });
  const parsed = parseTrackerMarkdown(res.trackerMarkdown);
  assert.deepEqual(parsed.doneHeader, ['ID', 'Status', 'Goal', 'Closed', 'Criteria met', 'Evidence', 'phase']);
  assert.equal(parsed.done.find((r) => r.id === 'T1')!.extra.phase, 'Core');
  assert.match(res.trackerMarkdown, /^\| T1 \| ⚫ \| Build parser \| 2026-11-10 \| .* \| chat \| Core \|$/m);
});

test('closeTrackerItemHumanUnproven enforces human authority and records closure source', () => {
  const base = {
    trackerMarkdown: SAMPLE_TRACKER,
    logMarkdown: SAMPLE_LOG,
    taskId: 'T1',
    notProvenReason: 'superseded by direct parser',
    closureSource: 'team meeting 2026-11-10',
    dateIso: '2026-11-10',
  };
  assert.throws(() => closeTrackerItemHumanUnproven({ ...base, person: 'coding agent' }), /human/i);
  assert.throws(() => closeTrackerItemHumanUnproven({ ...base, person: 'Stefano', closureSource: ' ' }), /closure/i);

  const res = closeTrackerItemHumanUnproven({ ...base, person: 'Stefano' });
  const parsed = parseTrackerMarkdown(res.trackerMarkdown);
  assert.equal(parsed.open.length, 0);
  assert.equal(parsed.done.length, 2);
  const closedRow = parsed.done.find((r) => r.id === 'T1')!;
  assert.equal(closedRow.status, '⚫');
  assert.equal(closedRow.closed, '2026-11-10');
  assert.equal(closedRow.criteriaMet, 'closed by Stefano 2026-11-10; not proven: superseded by direct parser');
  assert.equal(closedRow.evidence, 'team meeting 2026-11-10');
  assert.doesNotMatch(res.trackerMarkdown, /^updated:/m);
  assert.match(res.logMarkdown, /\n## 2026-11-10 · Close T1 without proof · human\n- What: Stefano closed T1 without proof: superseded by direct parser\n- Evidence: team meeting 2026-11-10\n- IDs: T1\n$/);
});

const DECISION_PROPOSED = `---
type: Decision
title: 0002 - Use Canvas Graph
status: proposed
source_commit: a1b2c3d
confidence: high
generated: { by: codex/gpt-5, at: 2026-11-10T09:00:00Z }
sources:
  - README.md
---

# 0002 - Use Canvas Graph

## Decision
Use HTML5 2D Canvas force graph.

## Approval
proposed: codex on 2026-11-10.
`;

test('acceptDecisionHuman and rejectDecisionHuman append approval lines and keep the proposed line', () => {
  const accepted = acceptDecisionHuman({
    decisionMarkdown: DECISION_PROPOSED,
    logMarkdown: SAMPLE_LOG,
    person: 'Stefano',
    whereContext: 'PR review #12',
    dateIso: '2026-11-10',
  });
  assert.match(accepted.decisionMarkdown, /^status: accepted$/m);
  assert.match(accepted.decisionMarkdown, /^source_commit: a1b2c3d$/m);
  const approvalStart = accepted.decisionMarkdown.indexOf('## Approval');
  const approval = accepted.decisionMarkdown.slice(approvalStart);
  assert.ok(approval.indexOf('proposed: codex on 2026-11-10.') < approval.indexOf('accepted: Stefano, PR review #12, 2026-11-10'));
  assert.match(accepted.logMarkdown, /\n## 2026-11-10 · Accept decision 0002 - Use Canvas Graph · human\n- What: Stefano accepted decision 0002 - Use Canvas Graph\n- Evidence: PR review #12\n- IDs: none\n$/);

  const rejected = rejectDecisionHuman({
    decisionMarkdown: DECISION_PROPOSED,
    logMarkdown: SAMPLE_LOG,
    person: 'Stefano',
    whereContext: 'meeting',
    dateIso: '2026-11-10',
  });
  assert.match(rejected.decisionMarkdown, /^status: rejected$/m);
  assert.match(rejected.decisionMarkdown, /^rejected: Stefano, meeting, 2026-11-10$/m);
  assert.match(rejected.logMarkdown, /## 2026-11-10 · Reject decision 0002 - Use Canvas Graph · human/);
});

test('accept and reject only work from proposed status', () => {
  const accepted = acceptDecisionHuman({
    decisionMarkdown: DECISION_PROPOSED,
    logMarkdown: SAMPLE_LOG,
    person: 'Stefano',
    whereContext: 'PR review #12',
    dateIso: '2026-11-10',
  });
  assert.throws(
    () => acceptDecisionHuman({ decisionMarkdown: accepted.decisionMarkdown, logMarkdown: SAMPLE_LOG, person: 'Stefano', whereContext: 'x', dateIso: '2026-11-11' }),
    /proposed/
  );
  assert.throws(
    () => rejectDecisionHuman({ decisionMarkdown: accepted.decisionMarkdown, logMarkdown: SAMPLE_LOG, person: 'Stefano', whereContext: 'x', dateIso: '2026-11-11' }),
    /proposed/
  );
});

test('updateOpenRowField changes owner or an extra column and rejects unknown ids and columns', () => {
  const byOwner = updateOpenRowField({ trackerMarkdown: PHASE_TRACKER, id: 'T1', field: 'owner', value: 'Mario' });
  assert.equal(parseTrackerMarkdown(byOwner.trackerMarkdown).open[0].owner, 'Mario');

  const byPhase = updateOpenRowField({ trackerMarkdown: PHASE_TRACKER, id: 'T1', field: 'Phase', value: 'Next' });
  const parsed = parseTrackerMarkdown(byPhase.trackerMarkdown);
  assert.equal(parsed.open[0].extra.Phase, 'Next');
  assert.equal(parsed.open[0].owner, 'stefano');

  assert.throws(() => updateOpenRowField({ trackerMarkdown: PHASE_TRACKER, id: 'T9', field: 'owner', value: 'x' }), /StaleError|file è cambiato|T9/);
  assert.throws(() => updateOpenRowField({ trackerMarkdown: PHASE_TRACKER, id: 'T1', field: 'Priority', value: 'x' }), /Priority/);
});

test('markPageReviewed adds a human verified entry, keeps earlier entries, and logs the review', () => {
  const page = `---
title: Auth
updated: 2026-11-01
verified: { by: claude-code/opus, at: 2026-11-01T00:00:00Z }
source_commit: a1b2c3d
confidence: high
---

# Auth
`;
  const res = markPageReviewed({
    pageMarkdown: page,
    logMarkdown: SAMPLE_LOG,
    person: 'Mario Rossi',
    atIso: '2026-11-10T12:00:00Z',
    commit: 'b2c3d4e',
  });
  const parsed = parseFrontmatter(res.pageMarkdown);
  assert.deepEqual(parsed.verified, [
    { by: 'claude-code/opus', at: '2026-11-01T00:00:00Z' },
    { by: 'human:mario-rossi', at: '2026-11-10T12:00:00Z', commit: 'b2c3d4e' },
  ]);
  assert.match(
    res.pageMarkdown,
    /^verified: \[\{ by: claude-code\/opus, at: 2026-11-01T00:00:00Z \}, \{ by: human:mario-rossi, at: 2026-11-10T12:00:00Z, commit: b2c3d4e \}\]$/m
  );
  assert.equal(parsed.fields.updated, '2026-11-01');
  assert.equal(parsed.fields.source_commit, 'a1b2c3d');
  assert.match(
    res.logMarkdown,
    new RegExp(
      `\\n## ${todayLocal()} · Mark page reviewed · human\\n- What: Mario Rossi marked page "Auth" reviewed\\n- Evidence: commit b2c3d4e\\n- IDs: none\\n$`,
    ),
  );
});

test('markPageReviewed writes one verified line for a single entry and keeps a flow list on one line', () => {
  const bare = '---\ntitle: Bare\nupdated: 2026-11-01\nsource_commit: a1b2c3d\n---\n# Bare\n';
  const single = markPageReviewed({ pageMarkdown: bare, logMarkdown: '', person: 'Stefano', atIso: '2026-11-10T12:00:00Z', commit: 'b2c3d4e' });
  assert.match(single.pageMarkdown, /^verified: \{ by: human:stefano, at: 2026-11-10T12:00:00Z, commit: b2c3d4e \}$/m);

  const flow = `---
title: Flow
updated: 2026-11-01
verified: [{ by: claude-code/opus, at: 2026-11-01T00:00:00Z }, { by: human:stefano, at: 2026-11-02T00:00:00Z, commit: abc1234 }]
source_commit: a1b2c3d
---
# Flow
`;
  const res = markPageReviewed({ pageMarkdown: flow, logMarkdown: '', person: 'Mario Rossi', atIso: '2026-11-10T12:00:00Z', commit: 'b2c3d4e' });
  const parsed = parseFrontmatter(res.pageMarkdown);
  assert.equal(parsed.verified.length, 3);
  assert.deepEqual(parsed.verified[1], { by: 'human:stefano', at: '2026-11-02T00:00:00Z', commit: 'abc1234' });
  assert.equal(res.pageMarkdown.match(/^verified:/gm)!.length, 1);
  assert.match(
    res.pageMarkdown,
    /^verified: \[\{ by: claude-code\/opus, at: 2026-11-01T00:00:00Z \}, \{ by: human:stefano, at: 2026-11-02T00:00:00Z, commit: abc1234 \}, \{ by: human:mario-rossi, at: 2026-11-10T12:00:00Z, commit: b2c3d4e \}\]$/m
  );
});

test('appendLogEntry appends exactly one blank-line-separated entry at the end of the log', () => {
  const log = appendLogEntry({
    logMarkdown: '# Log\n',
    date: '2026-11-10',
    title: 'Something',
    what: 'Stefano did it',
    evidence: 'chat',
    ids: ['T2', 'T3'],
  });
  assert.equal(log, '# Log\n\n## 2026-11-10 · Something · human\n- What: Stefano did it\n- Evidence: chat\n- IDs: T2, T3\n');
});

test('appendLogEntry oldest-first preserves CRLF and final newline', () => {
  const before = '# Log\r\n\r\n## 2026-11-01 · Old · human\r\n- What: x\r\n- Evidence: y\r\n- IDs: none\r\n';
  const log = appendLogEntry({
    logMarkdown: before,
    date: '2026-11-10',
    title: 'Fresh',
    what: 'new',
    evidence: 'chat',
    ids: ['T1'],
    order: 'oldest-first',
  });
  assert.equal(log, `${before}\r\n## 2026-11-10 · Fresh · human\r\n- What: new\r\n- Evidence: chat\r\n- IDs: T1\r\n`);
});

test('appendLogEntry newest-first inserts above first dated heading outside fences', () => {
  const log = appendLogEntry({
    logMarkdown: `# Log

## Rules
- Be brief

\`\`\`
## 2099-01-01 · Example · human
\`\`\`

## 2026-11-01 · Old · human
- What: old
- Evidence: x
- IDs: none

`,
    date: '2026-11-10',
    title: 'Fresh',
    what: 'new entry',
    evidence: 'test',
    ids: [],
    order: 'newest-first',
  });
  const idxNew = log.indexOf('2026-11-10 · Fresh');
  const idxOld = log.indexOf('2026-11-01 · Old');
  const idxRules = log.indexOf('## Rules');
  assert.ok(idxRules < idxNew && idxNew < idxOld);
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

test('integration: mutated wiki files pass validate-wiki.py exit code 0', () => {
  const tempDir = fs.mkdtempSync(path.join('/tmp', 'wiki-test-'));
  try {
    // Initialize git repo in tempDir so validate-wiki.py resolves repo root
    execFileSync('git', ['init', tempDir]);
    const wikiDir = path.join(tempDir, 'wiki');
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.mkdirSync(path.join(wikiDir, 'project'), { recursive: true });
    fs.mkdirSync(path.join(wikiDir, 'project', 'decisions'), { recursive: true });
    fs.mkdirSync(path.join(wikiDir, 'agent'), { recursive: true });

    // Create dummy README.md for repo-relative sources
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test Repo\n');

    // Create SCHEMA.md with Core map
    const schemaContent = `---
type: Schema
title: Wiki Schema
confidence: high
updated: 2026-11-10
---

# Wiki Schema

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
`;
    fs.writeFileSync(path.join(wikiDir, 'SCHEMA.md'), schemaContent);

    // Create other required core pages
    fs.writeFileSync(
      path.join(wikiDir, 'index.md'),
      `---
type: Overview
title: Wiki Index
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# Wiki Index
Welcome to the wiki.
`
    );

    fs.writeFileSync(
      path.join(wikiDir, 'project', 'risks.md'),
      `---
type: Project
title: Risks
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# Risks
None.
`
    );

    fs.writeFileSync(
      path.join(wikiDir, 'agent', 'context.md'),
      `---
type: AgentNote
title: Agent Context
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# Context

## Goals And Non-Goals
<!-- wiki:goals -->
Goals.

## Non-Negotiable Rules
<!-- wiki:rules -->
Rules.

## Frequent Commands
<!-- wiki:commands -->
Commands.

## Verified Facts
<!-- wiki:verified-facts -->
Facts.

## Read First
<!-- wiki:read-first -->
Read.
`
    );

    fs.writeFileSync(
      path.join(wikiDir, 'troubleshooting.md'),
      `---
type: Guide
title: Troubleshooting
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# Troubleshooting
`
    );

    fs.writeFileSync(
      path.join(wikiDir, 'glossary.md'),
      `---
type: Reference
title: Glossary
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# Glossary
`
    );

    // Initial files
    let trackerMd = `---
type: Project
title: Work Tracker
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# Work Tracker

## Open
<!-- wiki:open -->

| ID | Status | Goal | Done when | Owner | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 🟡 | Build parser | Tests pass | stefano | \`node --test\` | \`README.md\` |

## Proposals
<!-- wiki:proposals -->

| Proposal | By | Date | Why |
| --- | --- | --- | --- |
| Add graph filter | stefano | 2026-11-10 | Faster debugging |

## Done
<!-- wiki:done -->

| ID | Status | Goal | Closed | Criteria met | Evidence |
| --- | --- | --- | --- | --- | --- |
| T4 | 🟢 | Initial setup | 2026-11-09 | \`git status\` clean | commit a1b2c3d |
`;

    let logMd = `---
title: Wiki Log
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# Log

## 2026-11-09 · Archive old task · human
- What: Closed legacy task
- Evidence: manual review @a1b2c3d
- IDs: T7
`;

    let decisionMd = `---
type: Decision
title: 0002 - Use Canvas Graph
status: proposed
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# 0002 - Use Canvas Graph

## Context
Rendering.

## Decision
Canvas.

## Alternatives rejected
- WebGL

## Consequences
Fast.

## Approval
proposed: codex on 2026-11-10.
`;

    // 1. Promote proposal to open (T8)
    const res1 = promoteProposalToOpen({
      trackerMarkdown: trackerMd,
      logMarkdown: logMd,
      proposalText: 'Add graph filter',
    proposalBy: 'stefano',
    proposalDate: '2026-11-10',
      person: 'Stefano',
      owner: 'Stefano',
      doneWhen: 'Filter toggles source nodes',
      nextVerification: 'node --test',
      dateIso: '2026-11-10',
    });
    trackerMd = res1.trackerMarkdown;
    logMd = res1.logMarkdown;

    // 2. Close T1 without proof (human unproven)
    const res2 = closeTrackerItemHumanUnproven({
      trackerMarkdown: trackerMd,
      logMarkdown: logMd,
      taskId: 'T1',
      person: 'Stefano',
      notProvenReason: 'superseded by direct parser',
      closureSource: 'chat',
      dateIso: '2026-11-10',
    });
    trackerMd = res2.trackerMarkdown;
    logMd = res2.logMarkdown;

    // 3. Approve decision
    const res3 = acceptDecisionHuman({
      decisionMarkdown: decisionMd,
      logMarkdown: logMd,
      person: 'Stefano',
      whereContext: 'Codebase Wiki Desktop App',
      dateIso: '2026-11-10',
    });
    decisionMd = res3.decisionMarkdown;
    logMd = res3.logMarkdown;

    // Handoff referencing open task T8
    const handoffMd = `---
type: AgentNote
title: Agent Handoff
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# Agent Handoff

## Current Work State
<!-- wiki:state -->
- Tracker IDs: T8
- Goal: Filter
- Current branch: \`main\`

## Baton For Next Coding Agent
<!-- wiki:baton -->
| Order | Task | Start files | Done when | Verification command | Notes / blockers |
| --- | --- | --- | --- | --- | --- |
| 1 | T8 - Filter toggles | \`README.md\` | Tests pass | \`node --test\` | none |

## Blockers
<!-- wiki:blockers -->
| Blocker | Type | Needed from | Current workaround |
| --- | --- | --- | --- |
| none | external | none | none |

## Known Risks
<!-- wiki:risks -->
None.

## Commands Already Run
<!-- wiki:commands-run -->
None.

## Do Not Redo
<!-- wiki:do-not-redo -->
None.

## Evidence Trail
<!-- wiki:evidence-trail -->
None.
`;

    fs.writeFileSync(path.join(wikiDir, 'project', 'work-tracker.md'), trackerMd);
    fs.writeFileSync(path.join(wikiDir, 'log.md'), logMd);
    fs.writeFileSync(path.join(wikiDir, 'project', 'decisions', '0002-canvas.md'), decisionMd);
    fs.writeFileSync(path.join(wikiDir, 'agent', 'handoff.md'), handoffMd);

    // Validate using validate-wiki.py
    const validatorScript = path.resolve(process.cwd(), 'resources', 'validate-wiki.py');
    const result = execFileSync(resolvePythonForValidator(), [validatorScript, wikiDir], { encoding: 'utf-8' });
    assert.match(result, /wiki structural validation passed/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
