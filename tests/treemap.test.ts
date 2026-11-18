import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, squarify } from '../src/lib/treemap.ts';

const f = (path: string, pages: string[] = [], drift = false) => ({ path, pages, drift });

test('buildTree nests folders, keeps a folder own files in one loose child, counts statuses', () => {
  const root = buildTree([f('README.md'), f('src/a.ts', ['p.md']), f('src/lib/b.ts', ['p.md'], true), f('src/lib/c.ts')]);
  assert.deepEqual([root.verified, root.drifted, root.uncovered], [1, 1, 2]);
  const src = root.children.find((c) => c.path === 'src')!;
  assert.deepEqual(src.children.map((c) => [c.kind, c.path]), [['folder', 'src/lib'], ['loose', 'src']]);
  const lib = src.children[0];
  assert.deepEqual(lib.children.map((c) => c.name), ['b.ts', 'c.ts']);
  assert.deepEqual(root.children.map((c) => c.kind), ['folder', 'loose']);
});

test('squarify fills the rectangle with areas proportional to the values', () => {
  const rect = { x: 0, y: 0, w: 600, h: 400 };
  const values = [6, 6, 4, 3, 2, 2, 1];
  const out = squarify(values, rect);
  const total = values.reduce((s, v) => s + v, 0);
  out.forEach((r, i) => {
    assert.ok(Math.abs(r.w * r.h - (values[i] / total) * 240000) < 1e-6);
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 600 + 1e-9 && r.y + r.h <= 400 + 1e-9);
  });
});
