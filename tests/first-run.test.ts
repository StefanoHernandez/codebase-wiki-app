import test from 'node:test';
import assert from 'node:assert/strict';
import { firstRunSteps, type FirstRunState } from '../src/lib/first-run.ts';

const empty: FirstRunState = { name: false, project: 'none', lint: 'pending', search: 'no-model', agent: false };
const ids = (s: FirstRunState) => firstRunSteps(s).steps.filter((x) => x.done).map((x) => x.id);

test('first-run: nothing done starts at the name', () => {
  const r = firstRunSteps(empty);
  assert.deepEqual(r.steps.map((s) => s.id), ['nome', 'progetto', 'struttura', 'ricerca', 'agente']);
  assert.deepEqual(ids(empty), []);
  assert.equal(r.current, 'nome');
  assert.equal(r.allDone, false);
});

test('first-run: a folder without a wiki keeps the project step open', () => {
  const s: FirstRunState = { ...empty, name: true, project: 'no-wiki' };
  assert.equal(firstRunSteps(s).current, 'progetto');
  assert.equal(firstRunSteps({ ...s, project: 'incompatible' }).current, 'progetto');
});

test('first-run: steps tick independently, current is the first open one', () => {
  const s: FirstRunState = { ...empty, name: true, project: 'ok', agent: true, search: 'no-index' };
  assert.deepEqual(ids(s), ['nome', 'progetto', 'agente']);
  assert.equal(firstRunSteps(s).current, 'struttura');
});

test('first-run: everything done', () => {
  const r = firstRunSteps({ name: true, project: 'ok', lint: 'ok', search: 'ok', agent: true });
  assert.equal(r.current, null);
  assert.equal(r.allDone, true);
});
