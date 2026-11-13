import test from 'node:test';
import assert from 'node:assert/strict';
import { agentReady, pluginBlocked, pluginStateText, type PluginRow } from '../src/lib/plugin.ts';

const row = (p: Partial<PluginRow>): PluginRow => ({
  id: 'claude', installed: null, latest: '0.14.0', status: 'missing', skillsOnly: false, agentFound: true, error: null, manual: [], ...p,
});

test('plugin: state text', () => {
  assert.equal(pluginStateText(row({ agentFound: false })), 'agente non trovato');
  assert.equal(pluginStateText(row({})), 'non installato');
  assert.equal(pluginStateText(row({ status: 'outdated', installed: '0.13.0' })), '0.13.0 → 0.14.0');
  assert.equal(pluginStateText(row({ status: 'current', installed: '0.14.0' })), '0.14.0 ✓');
  assert.equal(pluginStateText(row({ status: 'unknown', installed: '0.14.0', latest: null })), '0.14.0');
  assert.equal(pluginStateText(row({ error: 'spawn ENOENT' })), 'CLI non funzionante');
});

test('plugin: an agent is ready with plugin and search on the same agent', () => {
  const mcp = [{ id: 'claude', status: 'connected' }, { id: 'cursor', status: 'absent' }];
  assert.equal(agentReady(mcp, [row({ id: 'cursor', status: 'current', installed: '0.14.0' })]), false);
  assert.equal(agentReady(mcp, [row({ id: 'claude', status: 'outdated', installed: '0.13.0' })]), true);
  assert.equal(agentReady(mcp, [row({ id: 'claude' })]), false);
});

test('plugin: folder agents need the latest version to install', () => {
  assert.equal(pluginBlocked(row({ id: 'cursor', skillsOnly: true, latest: null })), 'serve la connessione per scaricare il plugin');
  assert.equal(pluginBlocked(row({ id: 'antigravity', latest: null })), 'serve la connessione per scaricare il plugin');
  assert.equal(pluginBlocked(row({ id: 'claude', latest: null })), null);
  assert.equal(pluginBlocked(row({ id: 'cursor', skillsOnly: true })), null);
});
