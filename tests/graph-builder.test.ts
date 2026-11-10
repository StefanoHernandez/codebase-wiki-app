import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWikiCodeGraph, filterWikiGraph } from '../src/lib/graph-builder.ts';

test('buildWikiCodeGraph creates wiki nodes, source nodes, markdown/source edges, drift overlays, and uncovered files', () => {
  const pages = [
    {
      wikiRelPath: 'SCHEMA.md',
      sizeBytes: 500,
      content: `---\ntype: Schema\ntitle: Schema\nconfidence: high\ngenerated: { by: codex/gpt-5, at: 2026-11-10T00:00:00Z }\n---\n# Schema\n## Core map\n| Role | Path |\n| --- | --- |\n| index | \`index.md\` |\n| tracker | \`project/work-tracker.md\` |\n| decisions | \`project/decisions/\` |\n| context | \`agent/context.md\` |\n| handoff | \`agent/handoff.md\` |\n| log | \`log.md\` |\n| log-archive | \`log/\` |\n| risks | \`project/risks.md\` |\n| troubleshooting | \`troubleshooting.md\` |\n| glossary | \`glossary.md\` |\n`
    },
    {
      wikiRelPath: 'index.md',
      sizeBytes: 400,
      content: `---\ntitle: Index\nconfidence: high\nsources:\n  - README.md\nsource_commit: a1b2c3d\ngenerated: { by: codex/gpt-5, at: 2026-11-10T00:00:00Z }\n---\n# Index\nSee [Arch](architecture.md) and [Decision](project/decisions/0001-init.md).`
    },
    {
      wikiRelPath: 'architecture.md',
      sizeBytes: 800,
      content: `---\ntype: Engineering\ntitle: Architecture\nconfidence: medium\nsources:\n  - src/engine.ts:10\nsource_commit: a1b2c3d\ngenerated: { by: codex/gpt-5, at: 2026-11-10T00:00:00Z }\n---\n# Architecture\n> ⚠️ TO RE-VERIFY\nDetails.`
    },
    {
      wikiRelPath: 'project/decisions/0001-init.md',
      sizeBytes: 600,
      content: `---\ntype: Decision\ntitle: 0001 - Init\nstatus: accepted\nconfidence: high\nsources:\n  - src/engine.ts\nsource_commit: a1b2c3d\ngenerated: { by: codex/gpt-5, at: 2026-11-10T00:00:00Z }\n---\n# 0001`
    },
    {
      wikiRelPath: 'orphan.md',
      sizeBytes: 300,
      content: `---\ntype: Engineering\ntitle: Orphan\nconfidence: low\nsources:\n  - README.md\nsource_commit: a1b2c3d\ngenerated: { by: codex/gpt-5, at: 2026-11-10T00:00:00Z }\n---\n# Orphan`
    }
  ];

  const graph = buildWikiCodeGraph({
    wikiRoot: 'wiki',
    pages,
    repoFiles: ['README.md', 'src/engine.ts', 'src/unmapped.ts'],
    changedFilesByPage: { 'architecture.md': ['src/engine.ts'] },
    dirtyRepoFiles: ['src/engine.ts'],
    lintFindings: [{ wikiRelPath: 'orphan.md', line: 1, message: 'broken link' }],
  });

  const archNode = graph.nodes.find((n) => n.id === 'wiki:architecture.md')!;
  assert.equal(archNode.category, 'topic');
  assert.equal(archNode.hasDrift, true);
  assert.equal(archNode.needsReverify, true);
  assert.deepEqual(archNode.driftFiles, ['src/engine.ts']);

  const decNode = graph.nodes.find((n) => n.id === 'wiki:project/decisions/0001-init.md')!;
  assert.equal(decNode.category, 'decision');
  assert.equal(decNode.hasDrift, true); // src/engine.ts is in dirtyRepoFiles

  const orphanNode = graph.nodes.find((n) => n.id === 'wiki:orphan.md')!;
  assert.equal(orphanNode.isOrphan, true);
  assert.equal(orphanNode.hasLintError, true);

  const srcNode = graph.nodes.find((n) => n.id === 'source:src/engine.ts')!;
  assert.equal(srcNode.kind, 'source');
  assert.equal(srcNode.hasDrift, true);

  assert.deepEqual(graph.backlinks['architecture.md'], ['index.md']);
  assert.deepEqual(graph.uncoveredRepoFiles, ['src/unmapped.ts']);

  // Filter: 1-hop local graph around wiki:architecture.md without code sources
  const localWikiOnly = filterWikiGraph(graph, {
    includeCodeSources: false,
    onlyDriftOrErrors: false,
    searchQuery: '',
    focusNodeId: 'wiki:architecture.md',
    localGraphHops: 1,
  });
  assert.deepEqual(
    localWikiOnly.nodes.map((n) => n.id).sort(),
    ['wiki:architecture.md', 'wiki:index.md']
  );
});

test('never includes .private-terms as wiki node, source node, edge, or uncovered file', () => {
  const pages = [
    {
      wikiRelPath: 'index.md',
      sizeBytes: 250,
      content: `---\ntitle: Home\nsources:\n  - .private-terms\n  - secrets/.private-terms\n  - src/safe.ts\n---\n# Home\nLink to [.private-terms](.private-terms).`
    },
    {
      wikiRelPath: '.private-terms',
      sizeBytes: 100,
      content: `SECRET_KEY\nAPI_TOKEN`
    },
    {
      wikiRelPath: 'nested/.private-terms',
      sizeBytes: 50,
      content: `PASSWORD`
    }
  ];

  const graph = buildWikiCodeGraph({
    wikiRoot: 'wiki',
    pages,
    repoFiles: [
      '.private-terms',
      'secrets/.private-terms',
      'src/safe.ts',
      'src/extra.ts',
      'wiki/.private-terms'
    ],
    changedFilesByPage: { '.private-terms': ['.private-terms'] },
    dirtyRepoFiles: ['.private-terms', 'secrets/.private-terms'],
    lintFindings: [{ wikiRelPath: '.private-terms', line: 1, message: 'lint error' }]
  });

  const nodeIds = graph.nodes.map((n) => n.id);
  for (const id of nodeIds) {
    assert.equal(id.includes('.private-terms'), false, `Node ${id} should not contain .private-terms`);
  }

  const edgeEndpoints = graph.edges.flatMap((e) => [e.source, e.target]);
  for (const ep of edgeEndpoints) {
    assert.equal(ep.includes('.private-terms'), false, `Edge endpoint ${ep} should not contain .private-terms`);
  }

  assert.equal(graph.uncoveredRepoFiles.includes('.private-terms'), false);
  assert.equal(graph.uncoveredRepoFiles.includes('secrets/.private-terms'), false);
  assert.equal(graph.uncoveredRepoFiles.includes('wiki/.private-terms'), false);
  assert.deepEqual(graph.uncoveredRepoFiles, ['src/extra.ts']);
});

test('supports directory-level sources: coverage and dirty repo files matching', () => {
  const pages = [
    {
      wikiRelPath: 'index.md',
      sizeBytes: 300,
      content: `---\ntitle: Index\nsources:\n  - src/api/\n  - src/models\n---\n# Index`
    }
  ];

  const graph = buildWikiCodeGraph({
    wikiRoot: 'wiki',
    pages,
    repoFiles: [
      'src/api/routes.ts',
      'src/api/v1/auth.ts',
      'src/models/user.ts',
      'src/models_extra/flag.ts',
      'src/unrelated.ts'
    ],
    changedFilesByPage: {},
    dirtyRepoFiles: ['src/api/routes.ts', 'src/models/user.ts'],
    lintFindings: []
  });

  const indexNode = graph.nodes.find((n) => n.id === 'wiki:index.md')!;
  assert.equal(indexNode.hasDrift, true);
  assert.deepEqual(indexNode.driftFiles.sort(), ['src/api/routes.ts', 'src/models/user.ts']);

  // src/api/ covers src/api/routes.ts and src/api/v1/auth.ts
  // src/models covers src/models/user.ts
  // src/models_extra/flag.ts and src/unrelated.ts are uncovered
  assert.deepEqual(graph.uncoveredRepoFiles.sort(), [
    'src/models_extra/flag.ts',
    'src/unrelated.ts'
  ]);
});

test('filterWikiGraph handles onlyDriftOrErrors, searchQuery, and localGraphHops with code sources', () => {
  const pages = [
    {
      wikiRelPath: 'index.md',
      sizeBytes: 200,
      content: `---\ntitle: Overview\n---\n# Overview\n[Go Arch](arch.md)\n[Go Clean](clean.md)`
    },
    {
      wikiRelPath: 'arch.md',
      sizeBytes: 400,
      content: `---\ntitle: Architecture Design\nsources:\n  - src/engine.ts\n---\n# Architecture\n> ⚠️ NOT VERIFIED\n[Sub](sub.md)`
    },
    {
      wikiRelPath: 'clean.md',
      sizeBytes: 150,
      content: `---\ntitle: Clean Topic\n---\n# Clean`
    },
    {
      wikiRelPath: 'sub.md',
      sizeBytes: 100,
      content: `---\ntitle: Sub Detail\n---\n# Sub`
    }
  ];

  const graph = buildWikiCodeGraph({
    wikiRoot: 'wiki',
    pages,
    repoFiles: ['src/engine.ts'],
    changedFilesByPage: {},
    dirtyRepoFiles: [],
    lintFindings: [{ wikiRelPath: 'clean.md', line: 1, message: 'trailing space' }]
  });

  // 1. onlyDriftOrErrors filter
  // arch.md has needsReverify = true (NOT VERIFIED)
  // clean.md has hasLintError = true
  // index.md and sub.md are clean
  const errorOnly = filterWikiGraph(graph, {
    includeCodeSources: false,
    onlyDriftOrErrors: true,
    searchQuery: '',
  });
  assert.deepEqual(
    errorOnly.nodes.map((n) => n.id).sort(),
    ['wiki:arch.md', 'wiki:clean.md']
  );

  // 2. searchQuery filter
  const searchArch = filterWikiGraph(graph, {
    includeCodeSources: false,
    onlyDriftOrErrors: false,
    searchQuery: 'architecture',
  });
  assert.deepEqual(searchArch.nodes.map((n) => n.id), ['wiki:arch.md']);

  // 3. Combined onlyDriftOrErrors and searchQuery
  const searchClean = filterWikiGraph(graph, {
    includeCodeSources: false,
    onlyDriftOrErrors: true,
    searchQuery: 'clean',
  });
  assert.deepEqual(searchClean.nodes.map((n) => n.id), ['wiki:clean.md']);

  // 4. includeCodeSources = true with 1-hop BFS around arch.md
  // Should include index.md (incoming link), sub.md (outgoing link), and source:src/engine.ts
  const localWithSources = filterWikiGraph(graph, {
    includeCodeSources: true,
    onlyDriftOrErrors: false,
    searchQuery: '',
    focusNodeId: 'wiki:arch.md',
    localGraphHops: 1,
  });
  assert.deepEqual(
    localWithSources.nodes.map((n) => n.id).sort(),
    ['source:src/engine.ts', 'wiki:arch.md', 'wiki:index.md', 'wiki:sub.md']
  );
  assert.equal(localWithSources.edges.length, 3);
});
