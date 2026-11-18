import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWikiCodeGraph } from '../src/lib/graph-builder.ts';
import { computeCoverage, moduleOf } from '../src/lib/coverage.ts';

const page = (title: string, sources: string[]) =>
  `---\ntitle: ${title}\nsources:\n${sources.map((s) => `  - ${s}`).join('\n')}\n---\n# ${title}`;

test('moduleOf groups by the first two folders', () => {
  assert.equal(moduleOf('README.md'), '.');
  assert.equal(moduleOf('src/main.ts'), 'src');
  assert.equal(moduleOf('src/views/Grafo.tsx'), 'src/views');
  assert.equal(moduleOf('src/views/deep/x.ts'), 'src/views');
});

test('computeCoverage marks files described, in drift or not described', () => {
  const graph = buildWikiCodeGraph({
    wikiRoot: 'wiki',
    pages: [
      { wikiRelPath: 'a.md', sizeBytes: 1, content: page('A', ['src/core/']) },
      { wikiRelPath: 'b.md', sizeBytes: 1, content: page('B', ['src/core/x.ts']) },
    ],
    repoFiles: ['src/core/x.ts', 'src/core/y.ts', 'src/ui/z.ts', 'wiki/a.md', 'wiki/.private-terms'],
    changedFilesByPage: { 'b.md': ['src/core/x.ts'] },
    dirtyRepoFiles: [],
    lintFindings: [],
  });
  const mods = computeCoverage(['src/core/x.ts', 'src/core/y.ts', 'src/ui/z.ts', 'wiki/a.md', 'a/.private-terms'], graph, 'wiki');
  assert.deepEqual(mods.map((m) => m.dir), ['src/ui', 'src/core']);
  const core = mods.find((m) => m.dir === 'src/core')!;
  assert.deepEqual([core.verified, core.drifted, core.uncovered], [1, 1, 0]);
  assert.deepEqual(core.files.find((f) => f.path === 'src/core/x.ts'), {
    path: 'src/core/x.ts',
    pages: ['a.md', 'b.md'],
    drift: true,
  });
  const ui = mods.find((m) => m.dir === 'src/ui')!;
  assert.deepEqual([ui.verified, ui.drifted, ui.uncovered], [0, 0, 1]);
});
