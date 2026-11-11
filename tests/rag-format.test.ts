import assert from 'node:assert/strict';
import test from 'node:test';
import { formatIndexState, reduceRagProgress, shouldAutoIndex } from '../src/lib/rag-format.ts';

test('formatIndexState formats counters and shas', () => {
  const s = formatIndexState({
    model: 'multilingual-e5-small',
    indexed: true,
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

test('formatIndexState shows error when not indexed', () => {
  const s = formatIndexState({ indexed: false, error: 'Nessun indice' });
  assert.equal(s, 'Nessun indice');
});

test('reduceRagProgress parses phase and progress lines', () => {
  let r = reduceRagProgress(null, '{"event":"phase","phase":"wiki","total":50}');
  assert.deepEqual(r.progress, { phase: 'wiki', done: 0, total: 50 });
  r = reduceRagProgress(r.progress, '{"event":"progress","phase":"wiki","done":12,"total":50}');
  assert.deepEqual(r.progress, { phase: 'wiki', done: 12, total: 50 });
});

test('reduceRagProgress handles exit and error', () => {
  const exit = reduceRagProgress(null, '{"event":"exit","code":0}');
  assert.equal(exit.done, true);
  assert.equal(exit.error, null);
  const err = reduceRagProgress(null, '{"event":"error","message":"fallito"}');
  assert.equal(err.error, 'fallito');
  assert.equal(err.done, true);
});

test('shouldAutoIndex table', () => {
  const base = { indexed: true, changedSinceIndex: 0, head: 'a', indexedHead: 'a' };
  assert.equal(shouldAutoIndex(base, false, false, true), false);
  assert.equal(shouldAutoIndex({ ...base, changedSinceIndex: 3 }, false, false, true), true);
  assert.equal(shouldAutoIndex({ ...base, head: 'b' }, false, false, true), true);
  assert.equal(shouldAutoIndex({ indexed: false }, false, false, true), false);
  assert.equal(shouldAutoIndex(base, true, false, true), false);
  assert.equal(shouldAutoIndex(base, false, true, true), false);
  assert.equal(shouldAutoIndex(base, false, false, false), false);
});
