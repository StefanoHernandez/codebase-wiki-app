import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRow, countLogEntries, lastUseByAgent, lastUseOfHarness, newLogEntries, relativeTime, type RowInput } from '../src/lib/overview.ts';
import type { ActivityLine } from '../src/types/snapshot.ts';

const LOG = `# Log

## 2026-11-10 · First · agent
text
## 2026-11-11 · Second · agent
## Notes
## 2026-11-12 · Third · agent
`;

const act = (repo: string, ts: number, agent = 'claude-code'): ActivityLine => ({
  ts, repo, agent, tool: 'search_code', query: 'q', top: [], ms: 1, error: null,
});

const base: RowInput = { attention: [], log: null, git: { branch: 'main', headSha: 'abcdef123' }, status: null, news: null, activity: [], error: null };
const recent = { path: '/a', name: 'a' };

test('overview: counts dated log entries only', () => {
    assert.equal(countLogEntries(LOG), 3);
  });

test('overview: takes new entries from the end or the top', () => {
    assert.deepEqual(newLogEntries(LOG, 2, 'oldest-first'), ['2026-11-12 · Third · agent']);
    assert.deepEqual(newLogEntries(LOG, 2, 'newest-first'), ['2026-11-10 · First · agent']);
    assert.deepEqual(newLogEntries(LOG, null, 'oldest-first'), []);
    assert.deepEqual(newLogEntries(LOG, 5, 'oldest-first'), []);
  });

test('overview: formats relative time', () => {
    const now = 1_000_000_000;
    assert.equal(relativeTime(now - 30_000, now), 'ora');
    assert.equal(relativeTime(now - 5 * 60_000, now), '5 min fa');
    assert.equal(relativeTime(now - 3 * 3_600_000, now), '3 h fa');
    assert.equal(relativeTime(now - 3 * 86_400_000, now), '3 g fa');
  });

test('overview: uses commits as news when git has them', () => {
    const row = buildRow(recent, { ...base, news: { commits: ['a', 'b'], lastSeenLogEntries: 0, lastSeenAt: 1 } });
    assert.deepEqual(row.news, ['a', 'b']);
    assert.equal(row.head, 'abcdef1');
  });

test('overview: falls back to log entries without commits', () => {
    const row = buildRow(recent, {
      ...base,
      news: { commits: null, lastSeenLogEntries: 2, lastSeenAt: 1 },
      log: { markdown: LOG, order: 'oldest-first' },
    });
    assert.deepEqual(row.news, ['2026-11-12 · Third · agent']);
  });

test('overview: takes the last agent of this repo only', () => {
    const row = buildRow(recent, { ...base, activity: [act('/b', 9), act('/a', 5, 'codex'), act('/a', 3)] });
    assert.deepEqual(row.lastAgent, { agent: 'codex', ts: 5 });
  });

test('overview: keeps name and error on a failed row', () => {
    const row = buildRow(recent, { ...base, git: null, error: 'boom' });
    assert.equal(row.name, 'a');
    assert.equal(row.error, 'boom');
    assert.equal(row.index, 'errore');
  });

test('overview: reads index state', () => {
    assert.equal(buildRow(recent, { ...base, status: { indexed: true, changedSinceIndex: 4 } }).index, 'indietro');
    assert.equal(buildRow(recent, { ...base, status: { indexed: true, changedSinceIndex: 0 } }).index, 'aggiornato');
    assert.equal(buildRow(recent, { ...base, status: { indexed: false } }).index, 'assente');
  });

test('overview: keeps the newest use per agent', () => {
    assert.equal(lastUseByAgent([act('/a', 3), act('/b', 7), act('/a', 2, 'codex')]).get('claude-code'), 7);
  });

test('overview: maps harness ids to MCP client names', () => {
  const uses = new Map([['claude-code', 5], ['claude-ai', 9], ['codex-mcp-client', 7]]);
  assert.equal(lastUseOfHarness('claude', uses), 5);
  assert.equal(lastUseOfHarness('claude-desktop', uses), 9);
  assert.equal(lastUseOfHarness('codex', uses), 7);
  assert.equal(lastUseOfHarness('cursor', uses), null);
});
