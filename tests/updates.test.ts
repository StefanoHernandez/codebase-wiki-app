import test from 'node:test';
import assert from 'node:assert/strict';
import { updateBanner } from '../src/lib/updates.ts';
import type { PluginRow } from '../src/lib/plugin.ts';

const row = (id: string, status: PluginRow['status'], installed: string | null, latest: string | null): PluginRow => ({
  id, status, installed, latest, skillsOnly: false, agentFound: true, error: null, manual: [],
});
const auto = { manual: false, canInstall: true };

test('new app version with installer support offers install', () => {
  const b = updateBanner({ kind: 'available', version: '0.6.1' }, [], auto);
  assert.equal(b?.title, 'Codebase Wiki 0.6.1 disponibile');
  assert.equal(b?.action, 'install');
  assert.equal(b?.pluginLine, null);
});

test('without installer support (Linux .deb) offers download', () => {
  const b = updateBanner({ kind: 'available', version: '0.6.1' }, [], { manual: false, canInstall: false });
  assert.equal(b?.action, 'download');
});

test('outdated plugins are listed; missing and unknown are not', () => {
  const b = updateBanner({ kind: 'none' }, [
    row('claude', 'outdated', '0.14.0', '0.14.1'),
    row('codex', 'outdated', '0.11.0', '0.14.1'),
    row('cursor', 'missing', null, '0.14.1'),
    row('opencode', 'unknown', '0.13.0', null),
  ], auto);
  assert.equal(b?.title, null);
  assert.equal(b?.action, null);
  assert.equal(b?.pluginLine, 'Plugin da aggiornare: Claude Code 0.14.0 → 0.14.1, Codex 0.11.0 → 0.14.1');
});

test('nothing new on an automatic check shows nothing', () => {
  assert.equal(updateBanner({ kind: 'none' }, [row('claude', 'current', '0.14.1', '0.14.1')], auto), null);
});

test('a failed automatic check is silent, but outdated plugins still show', () => {
  const err = { kind: 'error' as const, message: 'offline' };
  assert.equal(updateBanner(err, [], auto), null);
  const b = updateBanner(err, [row('claude', 'outdated', '0.14.0', '0.14.1')], auto);
  assert.equal(b?.error, null);
  assert.ok(b?.pluginLine);
});

test('a manual check reports errors and up-to-date', () => {
  const manual = { manual: true, canInstall: true };
  assert.equal(updateBanner({ kind: 'error', message: 'offline' }, [], manual)?.error, 'Impossibile controllare: offline');
  assert.equal(updateBanner({ kind: 'none' }, [], manual)?.title, 'Codebase Wiki è aggiornata');
});
