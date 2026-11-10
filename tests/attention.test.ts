import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAttention, type AttentionInput } from '../src/lib/attention.ts';
import { parseTrackerMarkdown } from '../src/lib/markdown-tables.ts';
import type { Decision } from '../src/types/wiki.ts';

const TRACKER_MD = `# Tracker

## Open
<!-- wiki:open -->

| ID | Status | Goal | Done when | Owner | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 🔴 | Blocked thing | Tests pass | stefano | \`node --test\` | none |
| T2 | 🟡 | Running thing | Tests pass | mario | \`node --test\` | none |

## Proposals
<!-- wiki:proposals -->

| Proposal | By | Date | Why |
| --- | --- | --- | --- |
| Add filter | stefano | 2026-11-10 | Debugging |

## Done
<!-- wiki:done -->

| ID | Status | Goal | Closed | Criteria met | Evidence |
| --- | --- | --- | --- | --- | --- |
`;

const PROPOSED: Decision = {
  relPath: 'project/decisions/0003-x.md',
  number: '0003',
  slug: 'x',
  title: '0003 - X',
  status: 'proposed',
  approvalLines: ['proposed: codex on 2026-11-10.'],
};

function input(overrides: Partial<AttentionInput> = {}): AttentionInput {
  return {
    tracker: parseTrackerMarkdown(TRACKER_MD),
    decisions: [PROPOSED],
    handoffCommitsBehind: 7,
    pages: [
      {
        relPath: 'architecture.md',
        markdown: '# Arch\n> ⚠️ TO RE-VERIFY\nx\n> ⚠️ TO RE-VERIFY\n',
        changedSources: ['src/engine.ts'],
      },
    ],
    lintFindings: [{ relPath: 'index.md', line: 4, message: 'broken link' }],
    ...overrides,
  };
}

test('computeAttention lists every kind in the documented order', () => {
  const items = computeAttention(input());
  assert.deepEqual(
    items.map((i) => i.kind),
    ['decision-proposed', 'proposal', 'blocked-task', 'handoff-stale', 'page-drift', 'reverify', 'lint-error']
  );
});

test('computeAttention builds titles, details and navigation targets for each kind', () => {
  const items = computeAttention(input());
  const byKind = (kind: string) => items.find((i) => i.kind === kind)!;

  assert.equal(byKind('decision-proposed').title, 'Decision proposed: 0003 - X');
  assert.deepEqual(byKind('decision-proposed').target, { view: 'decisioni', ref: '0003' });

  assert.equal(byKind('proposal').title, 'Proposal: Add filter');
  assert.equal(byKind('proposal').detail, 'stefano · 2026-11-10');
  assert.deepEqual(byKind('proposal').target, { view: 'lavori', ref: 'Add filter' });

  assert.equal(items.filter((i) => i.kind === 'blocked-task').length, 1, 'only 🔴 open rows are blocked');
  assert.equal(byKind('blocked-task').title, 'T1 blocked: Blocked thing');
  assert.deepEqual(byKind('blocked-task').target, { view: 'lavori', ref: 'T1' });

  assert.equal(byKind('handoff-stale').detail, '7 commits behind HEAD');
  assert.deepEqual(byKind('handoff-stale').target, { view: 'handoff' });

  assert.equal(byKind('page-drift').title, 'Drift: architecture.md');
  assert.deepEqual(byKind('page-drift').target, { view: 'salute', ref: 'architecture.md' });

  assert.equal(items.filter((i) => i.kind === 'reverify').length, 1, 'one item per page');
  assert.equal(byKind('reverify').detail, '2 marked ⚠️ TO RE-VERIFY');

  assert.equal(byKind('lint-error').title, 'Lint error: index.md:4');
  assert.equal(byKind('lint-error').detail, 'broken link');
});

test('computeAttention applies thresholds and skips empty inputs', () => {
  const fresh = computeAttention(input({ handoffCommitsBehind: 4 }));
  assert.equal(fresh.some((i) => i.kind === 'handoff-stale'), false);
  assert.equal(computeAttention(input({ handoffCommitsBehind: null })).some((i) => i.kind === 'handoff-stale'), false);

  const quiet = computeAttention({
    tracker: null,
    decisions: [{ ...PROPOSED, status: 'accepted' }],
    handoffCommitsBehind: null,
    pages: [{ relPath: 'a.md', markdown: '# A', changedSources: [] }],
    lintFindings: [],
  });
  assert.deepEqual(quiet, []);
});

test('computeAttention emits one page-drift item per drifting page', () => {
  const items = computeAttention(
    input({
      pages: [
        { relPath: 'a.md', markdown: '# A', changedSources: ['src/a.ts', 'src/b.ts'] },
        { relPath: 'b.md', markdown: '# B', changedSources: ['src/c.ts'] },
        { relPath: 'c.md', markdown: '# C', changedSources: [] },
      ],
    })
  );
  const drift = items.filter((i) => i.kind === 'page-drift');
  assert.deepEqual(
    drift.map((i) => i.title),
    ['Drift: a.md', 'Drift: b.md']
  );
  assert.equal(drift[0].detail, '2 source file(s) changed: src/a.ts, src/b.ts');
});
