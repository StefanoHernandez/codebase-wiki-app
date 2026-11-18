import test from 'node:test';
import assert from 'node:assert/strict';
import { coreRead, lastLogEntriesBytes } from '../src/lib/budgets.ts';

const entry = (d: string) => `## ${d} · x · agent\n- What: y`;

test('lastLogEntriesBytes keeps the newest entries in either order', () => {
  const dates = Array.from({ length: 12 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
  const oldestFirst = `# Log\n\n${dates.map(entry).join('\n\n')}`;
  const newestFirst = `# Log\n\n${[...dates].reverse().map(entry).join('\n\n')}`;
  const ten = dates.slice(2).reduce((sum, d) => sum + new TextEncoder().encode(entry(d)).length + 1, 0);
  assert.equal(lastLogEntriesBytes(oldestFirst), ten);
  assert.equal(lastLogEntriesBytes(newestFirst), ten);
});

test('coreRead counts SCHEMA, core pages and the log tail, not directories or other pages', () => {
  const page = (relPath: string, sizeBytes: number, markdown = '') => ({ relPath, sizeBytes, markdown });
  const log = `${entry('2026-01-01')}\n${entry('2026-01-02')}`;
  const r = coreRead(
    [page('SCHEMA.md', 10), page('index.md', 20), page('topic.md', 999), page('log.md', 5000, log)],
    { index: 'index.md', log: 'log.md', decisions: 'decisions/' },
  );
  assert.deepEqual(r.items.map((i) => i.path), ['SCHEMA.md', 'index.md', 'log.md']);
  assert.equal(r.total, 30 + 2 * (new TextEncoder().encode(entry('2026-01-01')).length + 1));
});
