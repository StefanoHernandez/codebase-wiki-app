import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, visibleAt } from '../src/lib/graph-history.ts';
import type { GraphHistory } from '../src/lib/graph-history.ts';

const nodes = [
  { id: 'wiki:index.md', kind: 'wiki' as const, path: 'index.md' },
  { id: 'wiki:log.md', kind: 'wiki' as const, path: 'log.md' },
  { id: 'source:src', kind: 'source' as const, path: 'src' },
  { id: 'wiki:new.md', kind: 'wiki' as const, path: 'new.md' },
];
const c = (sha: string, added: string[], modified: string[] = []) => ({
  sha, date: `2026-11-0${sha}T10:00:00Z`, subject: `c${sha}`, added, modified,
});

test('nodes are born at their first commit and pulse on later ones', () => {
  const history: GraphHistory = {
    truncated: false,
    commits: [
      c('1', ['wiki/index.md']),
      c('2', ['README.md']), // touches no node: no frame
      c('3', ['src/a.rs', 'wiki/log.md']),
      c('4', [], ['wiki/index.md', 'src/a.rs']),
    ],
  };
  const t = buildTimeline(history, nodes, 'wiki');
  assert.deepEqual(t.frames.map((f) => f.sha), ['1', '3', '4']);
  assert.equal(t.birth.get('wiki:index.md'), 0);
  assert.equal(t.birth.get('wiki:log.md'), 1);
  assert.equal(t.birth.get('source:src'), 1, 'directory source is born with its first file');
  assert.deepEqual([...t.frames[1].born].sort(), ['source:src', 'wiki:log.md']);
  assert.deepEqual([...t.frames[2].touched].sort(), ['source:src', 'wiki:index.md']);
  assert.deepEqual([...t.frames[2].born], ['wiki:new.md'], 'only the never-committed page');
});

test('a node git never saw appears in the last frame; with truncated history, in the first', () => {
  const commits = [c('1', ['wiki/index.md']), c('2', ['wiki/log.md'])];
  const full = buildTimeline({ truncated: false, commits }, nodes, 'wiki');
  assert.equal(full.birth.get('wiki:new.md'), 1);
  const cut = buildTimeline({ truncated: true, commits }, nodes, 'wiki');
  assert.equal(cut.birth.get('wiki:new.md'), 0);
});

test('wiki at the repo root maps paths without a prefix', () => {
  const t = buildTimeline({ truncated: false, commits: [c('1', ['index.md'])] }, nodes.slice(0, 1), '.');
  assert.equal(t.birth.get('wiki:index.md'), 0);
});

test('no commits gives no frames', () => {
  assert.equal(buildTimeline({ truncated: false, commits: [] }, nodes, 'wiki').frames.length, 0);
});

test('edges show only when both ends are born', () => {
  const birth = new Map([['a', 0], ['b', 2]]);
  const out = visibleAt(
    { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ source: 'a', target: 'b' }] },
    birth,
    1
  );
  assert.deepEqual(out.nodes.map((n) => n.id), ['a']);
  assert.equal(out.edges.length, 0);
  assert.equal(visibleAt({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ source: 'a', target: 'b' }] }, birth, 2).edges.length, 1);
});
