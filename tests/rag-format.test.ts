import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availableExtensions,
  formatIndexState,
  isMaskedPrivateQuery,
  parseIndexStatus,
  reduceRagProgress,
  shouldAutoIndex,
} from '../src/lib/rag-format.ts';

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

test('parseIndexStatus reads the sidecar snake_case JSON', () => {
  const s = parseIndexStatus({
    model: 'e5', indexed: true, indexed_model: 'e5', head: 'b', indexed_head: 'a',
    changed_since_index: 2, files: 3, chunks: 9, error: null, stale_install: true,
  });
  assert.equal(s.indexedHead, 'a');
  assert.equal(s.changedSinceIndex, 2);
  assert.equal(s.staleInstall, true);
  assert.equal(shouldAutoIndex(s, false, false, true), true);
  assert.equal(parseIndexStatus({ indexed: false, error: 'Nessun indice' }).error, 'Nessun indice');
});

test('isMaskedPrivateQuery recognizes Italian and English markers', () => {
  assert.equal(isMaskedPrivateQuery('[riservata]'), true);
  assert.equal(isMaskedPrivateQuery('[private]'), true);
  assert.equal(isMaskedPrivateQuery(' [riservata] '), true);
  assert.equal(isMaskedPrivateQuery('where is watcher'), false);
  assert.equal(isMaskedPrivateQuery(null), false);
  assert.equal(isMaskedPrivateQuery(undefined), false);
});

test('availableExtensions ranks extensions from hits or repoFiles excluding wiki and prose', () => {
  const repoFiles = [
    'wiki/index.md',
    'README.md',
    'notes.txt',
    '.gitignore',
    'app/a.py',
    'app/b.py',
    'app/c.py',
    'cmd/main.go',
    'cmd/run.go',
    'pkg/x.ts',
    'pkg/y.tsx',
    'cfg/a.json',
    'cfg/b.yaml',
    'cfg/c.toml',
  ];
  // From repoFiles when hits are absent: excludes wiki/*, md/txt, dotfiles; sorted by frequency then name, capped at 5.
  assert.deepEqual(availableExtensions(null, repoFiles, 'wiki'), ['py', 'go', 'json', 'toml', 'ts']);

  // From active hits when present: reflects hit extensions only.
  const hits = [{ path: 'src/a.rs' }, { path: 'src/b.tsx' }, { path: 'src/c.rs' }];
  assert.deepEqual(availableExtensions(hits, repoFiles, 'wiki'), ['rs', 'tsx']);

  // Empty inputs yield [].
  assert.deepEqual(availableExtensions([], [], 'wiki'), []);
});
