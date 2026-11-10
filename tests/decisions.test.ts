import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDecision, listDecisions } from '../src/lib/decisions.ts';

const SUPERSEDED = `---
type: Decision
title: 0002 - Use Canvas Graph
status: superseded by 0005
---

# 0002 - Use Canvas Graph

## Decision
Canvas.

## Approval
accepted: Stefano, PR review #12, 2026-11-10
proposed: codex on 2026-11-01.
`;

test('parseDecision reads number, slug, title, superseded status and approval lines', () => {
  const d = parseDecision('project/decisions/0002-use-canvas-graph.md', SUPERSEDED);
  assert.equal(d.relPath, 'project/decisions/0002-use-canvas-graph.md');
  assert.equal(d.number, '0002');
  assert.equal(d.slug, 'use-canvas-graph');
  assert.equal(d.title, '0002 - Use Canvas Graph');
  assert.equal(d.status, 'superseded');
  assert.equal(d.supersededBy, '0005');
  assert.deepEqual(d.approvalLines, ['accepted: Stefano, PR review #12, 2026-11-10', 'proposed: codex on 2026-11-01.']);
});

test('parseDecision maps plain statuses, unknown values, heading fallback and missing approval', () => {
  const proposed = parseDecision('project/decisions/0003-x.md', '---\nstatus: proposed\n---\n# Heading Title\n');
  assert.equal(proposed.status, 'proposed');
  assert.equal(proposed.title, 'Heading Title');
  assert.deepEqual(proposed.approvalLines, []);
  assert.equal(proposed.supersededBy, undefined);

  assert.equal(parseDecision('project/decisions/0004-y.md', '---\nstatus: maybe\n---\n').status, 'unknown');
  assert.equal(parseDecision('project/decisions/0004-y.md', '---\nstatus: rejected\n---\n').status, 'rejected');
});

test('parseDecision rejects paths that are not NNNN-<slug>.md', () => {
  assert.throws(() => parseDecision('project/decisions/README.md', '# x'), /decision/i);
});

test('listDecisions keeps only NNNN-*.md directly under the decisions folder, sorted by number', () => {
  const pages = [
    { relPath: 'project/decisions/0003-third.md', markdown: '---\nstatus: proposed\n---\n' },
    { relPath: 'project/decisions/0001-first.md', markdown: '---\nstatus: accepted\n---\n' },
    { relPath: 'project/decisions/README.md', markdown: '# readme' },
    { relPath: 'project/decisions/sub/0004-nested.md', markdown: '---\nstatus: accepted\n---\n' },
    { relPath: 'project/other/0005-elsewhere.md', markdown: '---\nstatus: accepted\n---\n' },
    { relPath: 'index.md', markdown: '# index' },
  ];
  const list = listDecisions(pages, 'project/decisions/');
  assert.deepEqual(
    list.map((d) => d.number),
    ['0001', '0003']
  );
  assert.equal(list[0].status, 'accepted');
});
