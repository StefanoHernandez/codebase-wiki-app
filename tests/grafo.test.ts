import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLineKind, neighborIds } from '../src/views/grafo-helpers.ts';
import {
  computeViewport,
  GraphSimulation,
  screenToWorld,
  worldToScreen,
} from '../src/lib/graph-physics.ts';
import type { GraphEdge, GraphNode, GraphNodeCategory } from '../src/types/wiki.ts';

function makeNode(id: string, category: GraphNodeCategory, degree = 1): GraphNode {
  return {
    id,
    label: id,
    path: id,
    kind: category === 'source' ? 'source' : 'wiki',
    category,
    hasDrift: false,
    driftFiles: [],
    hasLintError: false,
    lintCount: 0,
    needsReverify: false,
    isOrphan: false,
    sizeBytes: 100,
    degree,
  };
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

test('GraphSimulation warms up with wide Obsidian-like spread and no stacked nodes', () => {
  const nodes: GraphNode[] = [makeNode('wiki:index', 'core', 12)];
  const edges: GraphEdge[] = [];
  for (let i = 0; i < 12; i++) {
    const id = i < 4 ? `wiki:topic-${i}` : `src:file-${i}`;
    nodes.push(makeNode(id, i < 4 ? 'topic' : 'source', 1));
    edges.push({
      id: `e-${i}`,
      source: 'wiki:index',
      target: id,
      kind: i < 4 ? 'markdown-link' : 'source-link',
    });
  }

  const sim = new GraphSimulation(nodes, edges);
  assert.equal(sim.isActive(), false);

  const hub = sim.getPosition('wiki:index')!;
  let sumDist = 0;
  for (let i = 1; i < nodes.length; i++) {
    const p = sim.getPosition(nodes[i].id)!;
    sumDist += Math.hypot(p.x2 - hub.x2, p.y2 - hub.y2);
  }
  const avgDist = sumDist / (nodes.length - 1);
  assert.ok(avgDist > 95, `expected average spoke distance > 95, got ${avgDist}`);

  let minPairDist = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const a = sim.getPosition(nodes[i].id)!;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = sim.getPosition(nodes[j].id)!;
      const d = Math.hypot(b.x2 - a.x2, b.y2 - a.y2);
      if (d < minPairDist) minPairDist = d;
    }
  }
  assert.ok(minPairDist > 20, `expected minimum pairwise distance > 20, got ${minPairDist}`);
});

test('dragging a hub pulls connected branch nodes along while disconnected island stays put', () => {
  const nodes: GraphNode[] = [
    makeNode('wiki:branch', 'topic', 4),
    makeNode('wiki:leaf-1', 'topic', 1),
    makeNode('wiki:leaf-2', 'topic', 1),
    makeNode('src:leaf-3', 'source', 1),
    makeNode('wiki:island-a', 'decision', 1),
    makeNode('wiki:island-b', 'decision', 1),
  ];
  const edges: GraphEdge[] = [
    { id: 'e1', source: 'wiki:branch', target: 'wiki:leaf-1', kind: 'markdown-link' },
    { id: 'e2', source: 'wiki:branch', target: 'wiki:leaf-2', kind: 'markdown-link' },
    { id: 'e3', source: 'wiki:branch', target: 'src:leaf-3', kind: 'source-link' },
    { id: 'e4', source: 'wiki:island-a', target: 'wiki:island-b', kind: 'markdown-link' },
  ];

  const sim = new GraphSimulation(nodes, edges);
  const startBranch = sim.getPosition('wiki:branch')!;
  const startLeaf1 = sim.getPosition('wiki:leaf-1')!;
  const startLeaf2 = sim.getPosition('wiki:leaf-2')!;
  const startLeaf3 = sim.getPosition('src:leaf-3')!;
  const startIsland = sim.getPosition('wiki:island-a')!;

  const dx = 300;
  const dy = 150;
  sim.pinNode('wiki:branch', startBranch.x2, startBranch.y2);
  for (let i = 1; i <= 45; i++) {
    const u = Math.min(1, i / 30);
    sim.movePinnedNode('wiki:branch', startBranch.x2 + dx * u, startBranch.y2 + dy * u);
    sim.step();
  }

  const movedBranch = sim.getPosition('wiki:branch')!;
  const movedLeaf1 = sim.getPosition('wiki:leaf-1')!;
  const movedLeaf2 = sim.getPosition('wiki:leaf-2')!;
  const movedLeaf3 = sim.getPosition('src:leaf-3')!;
  const endIsland = sim.getPosition('wiki:island-a')!;

  const d1 = Math.hypot(movedLeaf1.x2 - startLeaf1.x2, movedLeaf1.y2 - startLeaf1.y2);
  const d2 = Math.hypot(movedLeaf2.x2 - startLeaf2.x2, movedLeaf2.y2 - startLeaf2.y2);
  const d3 = Math.hypot(movedLeaf3.x2 - startLeaf3.x2, movedLeaf3.y2 - startLeaf3.y2);
  assert.ok(d1 > 70, `wiki:leaf-1 should move with dragged branch (got ${d1})`);
  assert.ok(d2 > 70, `wiki:leaf-2 should move with dragged branch (got ${d2})`);
  assert.ok(d3 > 70, `src:leaf-3 should move with dragged branch (got ${d3})`);

  for (const [label, leaf] of [
    ['leaf-1', movedLeaf1],
    ['leaf-2', movedLeaf2],
    ['leaf-3', movedLeaf3],
  ] as const) {
    const distToHub = Math.hypot(leaf.x2 - movedBranch.x2, leaf.y2 - movedBranch.y2);
    assert.ok(distToHub < 230, `${label} stayed attached to moved hub (dist=${distToHub})`);
  }

  const avgDx =
    (movedLeaf1.x2 - startLeaf1.x2 + (movedLeaf2.x2 - startLeaf2.x2) + (movedLeaf3.x2 - startLeaf3.x2)) / 3;
  const avgDy =
    (movedLeaf1.y2 - startLeaf1.y2 + (movedLeaf2.y2 - startLeaf2.y2) + (movedLeaf3.y2 - startLeaf3.y2)) / 3;
  assert.ok(avgDx > 60, `expected branch centroid +x > 60, got ${avgDx}`);
  assert.ok(avgDy > 50, `expected branch centroid +y > 50, got ${avgDy}`);

  const islandDrift = Math.hypot(endIsland.x2 - startIsland.x2, endIsland.y2 - startIsland.y2);
  assert.ok(islandDrift < 35, `disconnected island drifted too much (${islandDrift})`);
  assert.ok((d1 + d2 + d3) / 3 > islandDrift * 3, 'connected branch should move far more than island');
});

test('unpinNode settles smoothly back to idle within 120 ticks', () => {
  const nodes: GraphNode[] = [
    makeNode('wiki:a', 'core', 2),
    makeNode('wiki:b', 'topic', 1),
    makeNode('wiki:c', 'topic', 1),
  ];
  const edges: GraphEdge[] = [
    { id: 'e1', source: 'wiki:a', target: 'wiki:b', kind: 'markdown-link' },
    { id: 'e2', source: 'wiki:a', target: 'wiki:c', kind: 'markdown-link' },
  ];

  const sim = new GraphSimulation(nodes, edges);
  const startA = sim.getPosition('wiki:a')!;
  sim.pinNode('wiki:a', startA.x2 + 120, startA.y2 - 80);
  assert.equal(sim.isActive(), true);
  sim.unpinNode('wiki:a');
  assert.equal(sim.isActive(), true);

  let ticks = 0;
  while (sim.step() && ticks < 120) {
    ticks++;
  }
  assert.equal(sim.isActive(), false, `expected idle within 120 ticks, stopped at ${ticks}`);
  assert.ok(ticks < 120);
});

test('worldToScreen and screenToWorld round-trip accurately with insets, pan, and zoom', () => {
  const vp = computeViewport(1400, 900, true, true, 42.5, -18.25, 1.35);
  const pt = { wx: 123.45, wy: -267.89 };
  const screen = worldToScreen(pt.wx, pt.wy, vp);
  const world = screenToWorld(screen.sx, screen.sy, vp);
  assert.ok(Math.abs(world.wx - pt.wx) < 1e-9);
  assert.ok(Math.abs(world.wy - pt.wy) < 1e-9);
});
