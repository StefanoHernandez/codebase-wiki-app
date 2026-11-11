import assert from 'node:assert/strict';
import test from 'node:test';
import { formatIndexState, reduceRagProgress } from '../src/lib/rag-format.ts';

test('formatIndexState formats counters and shas', () => {
  const s = formatIndexState({
    model: 'multilingual-e5-small',
    files: 10,
    chunks: 100,
    indexedHead: 'abc1234567',
    head: 'def8901234',
    changedSinceIndex: 2,
  });
  assert.match(s, /multilingual-e5-small/);
  assert.match(s, /10 file/);
  assert.match(s, /@abc123/);
});

test('reduceRagProgress parses phase and progress lines', () => {
  let p = reduceRagProgress(null, '{"event":"phase","phase":"wiki","total":50}');
  assert.deepEqual(p, { phase: 'wiki', done: 0, total: 50 });
  p = reduceRagProgress(p, '{"event":"progress","phase":"wiki","done":12,"total":50}');
  assert.deepEqual(p, { phase: 'wiki', done: 12, total: 50 });
});
