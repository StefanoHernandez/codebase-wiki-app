import test from 'node:test';
import assert from 'node:assert/strict';
import { filterWikiGraph, buildWikiCodeGraph } from '../src/lib/graph-builder.ts';
import type { GraphEdge } from '../src/types/wiki.ts';

/** Mirrors PageDrawer diffLineKind (tests cannot import .tsx). */
function diffLineKind(line: string): 'add' | 'del' | 'hunk' | 'ctx' {
  if (line.startsWith('+++') || line.startsWith('---')) return 'ctx';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}

/** Mirrors Grafo neighborIds (tests cannot import .tsx). */
function neighborIds(nodeId: string, edges: GraphEdge[]): Set<string> {
  const out = new Set<string>([nodeId]);
  for (const e of edges) {
    if (e.source === nodeId) out.add(e.target);
    if (e.target === nodeId) out.add(e.source);
  }
  return out;
}

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

test('grafo filters: local 1-hop and drift-only work on built graph', () => {
  const pages = [
    {
      wikiRelPath: 'index.md',
      sizeBytes: 100,
      content: `---\ntitle: Index\nsources:\n  - README.md\n---\n# Index\n[Arch](arch.md)`,
    },
    {
      wikiRelPath: 'arch.md',
      sizeBytes: 100,
      content: `---\ntitle: Arch\nsources:\n  - src/x.ts\n---\n# Arch`,
    },
  ];
  const graph = buildWikiCodeGraph({
    wikiRoot: 'wiki',
    pages,
    repoFiles: ['README.md', 'src/x.ts'],
    changedFilesByPage: { 'arch.md': ['src/x.ts'] },
    dirtyRepoFiles: ['src/x.ts'],
    lintFindings: [],
  });
  const local = filterWikiGraph(graph, {
    includeCodeSources: false,
    onlyDriftOrErrors: false,
    searchQuery: '',
    focusNodeId: 'wiki:arch.md',
    localGraphHops: 1,
  });
  assert.deepEqual(local.nodes.map((n) => n.id).sort(), ['wiki:arch.md', 'wiki:index.md'].sort());
  const driftOnly = filterWikiGraph(graph, {
    includeCodeSources: true,
    onlyDriftOrErrors: true,
    searchQuery: '',
  });
  assert.ok(driftOnly.nodes.some((n) => n.id === 'wiki:arch.md'));
  assert.ok(driftOnly.nodes.some((n) => n.id === 'source:src/x.ts'));
});
