import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { wikiCompat, adoptPrompt } from '../src/lib/wiki-compat.ts';
import type { LintReport, LintUpgrade } from '../src/types/snapshot.ts';

const up = (code: string, wikiRelPath: string | null = 'SCHEMA.md'): LintUpgrade => ({
  wikiRelPath,
  line: 1,
  code,
  message: code,
  fix: code === 'format-version-newer' ? 'update-plugin' : 'adopt',
});

const report = (upgrades: LintUpgrade[], error: string | null = null): LintReport => ({
  exitCode: error ? 2 : 0,
  error,
  findings: [],
  upgrades,
  infos: [],
  rawOutput: '',
});

test('null report blocks nothing', () => {
  const c = wikiCompat(null);
  assert.equal(c.incompatible, false);
  assert.equal(c.pluginOutdated, false);
  assert.equal(c.closeBlocked, false);
  assert.deepEqual(c.banner, []);
  assert.equal(c.decisionBlocked.size, 0);
  assert.equal(c.validatorUnavailable, null);
});

test('core-map-missing makes the wiki incompatible and stays out of the banner', () => {
  const c = wikiCompat(report([up('core-map-missing'), up('format-version-missing')]));
  assert.equal(c.incompatible, true);
  assert.deepEqual(c.banner.map((u) => u.code), ['format-version-missing']);
});

test('format-version-newer flags the plugin as outdated', () => {
  const c = wikiCompat(report([up('format-version-newer')]));
  assert.equal(c.pluginOutdated, true);
  assert.equal(c.incompatible, false);
});

test('done-status-missing blocks close; decision codes block their files only', () => {
  const c = wikiCompat(
    report([
      up('done-status-missing', 'project/work-tracker.md'),
      up('decision-status-missing', 'project/decisions/0001-a.md'),
      up('decision-status-invalid', 'project/decisions/0002-b.md'),
      up('decision-approval-missing', 'project/decisions/0003-c.md'),
      up('schema-section-missing'),
    ]),
  );
  assert.equal(c.closeBlocked, true);
  assert.deepEqual(
    [...c.decisionBlocked].sort(),
    ['project/decisions/0001-a.md', 'project/decisions/0002-b.md', 'project/decisions/0003-c.md'],
  );
  assert.equal(c.banner.length, 5);
});

test('validator error is reported as unavailable', () => {
  assert.equal(wikiCompat(report([], 'requires Python 3.10+')).validatorUnavailable, 'requires Python 3.10+');
});

test('captured 0.13 JSON fixture: one banner upgrade, nothing blocked', () => {
  const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/validator-0.13.json', import.meta.url), 'utf8'));
  const c = wikiCompat(report(raw.upgrades.map((u: { path: string }) => ({ ...u, wikiRelPath: u.path }))));
  assert.deepEqual(c.banner.map((u) => u.code), ['format-version-missing']);
  assert.equal(c.closeBlocked || c.incompatible || c.pluginOutdated, false);
});

test('adopt prompt names the wiki root', () => {
  assert.equal(adoptPrompt('wiki'), '/wiki-init --adopt wiki');
});

test('a v1 SCHEMA (no Core map) is incompatible before any lint, and blocks writes', () => {
  const c = wikiCompat(null, { hasCoreMap: false });
  assert.equal(c.incompatible, true);
  assert.match(c.writesBlocked ?? '', /formato vecchio/);
  assert.equal(wikiCompat(null, { hasCoreMap: true }).writesBlocked, null);
});

test('a wiki newer than the plugin blocks writes and keeps update-plugin out of the adopt banner', () => {
  const c = wikiCompat(report([up('format-version-newer')]), { hasCoreMap: true });
  assert.equal(c.pluginOutdated, true);
  assert.deepEqual(c.banner, []);
  assert.match(c.writesBlocked ?? '', /aggiorna il plugin/);
});
