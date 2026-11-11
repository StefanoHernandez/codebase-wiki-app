import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLineKind, neighborIds } from '../src/views/grafo-helpers.ts';
import type { GraphEdge } from '../src/types/wiki.ts';

test('diffLineKind classifies git diff lines', () => {
  assert.equal(diffLineKind('@@ -1,3 +1,4 @@'), 'hunk');
  assert.equal(diffLineKind('+added'), 'add');
  assert.equal(diffLineKind('-removed'), 'del');
  assert.equal(diffLineKind(' context'), 'ctx');
});

test('neighborIds includes endpoints and adjacent nodes', () => {
  const edges: GraphEdge[] = [
    { id: 'a', source: 'wiki:a', target: 'wiki:b', kind: 'markdown-link' },
    { id: 'b', source: 'wiki:b', target: 'source:x', kind: 'source-link' },
  ];
  const n = neighborIds('wiki:b', edges);
  assert.deepEqual([...n].sort(), ['source:x', 'wiki:a', 'wiki:b'].sort());
});
