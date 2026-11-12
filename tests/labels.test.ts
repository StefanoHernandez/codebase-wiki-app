import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldLabel, fixedValue } from '../src/lib/labels.ts';

test('labels: known plugin keys translate, case-insensitive', () => {
  assert.equal(fieldLabel('Tracker IDs'), 'ID nel tracker');
  assert.equal(fieldLabel('goal'), 'Obiettivo');
  assert.equal(fieldLabel(' Last completed step '), 'Ultimo passo completato');
  assert.equal(fieldLabel('Needed from'), 'Serve da');
  assert.equal(fieldLabel('Severity'), 'Gravità');
});

test('labels: unknown keys stay as written', () => {
  assert.equal(fieldLabel('Priorità'), 'Priorità');
  assert.equal(fieldLabel('Sprint'), 'Sprint');
});

test('labels: fixed values translate only as the whole cell', () => {
  assert.equal(fixedValue('medium'), 'media');
  assert.equal(fixedValue('High'), 'alta');
  assert.equal(fixedValue('none'), 'nessuno');
  assert.equal(fixedValue('Approval not recorded.'), 'Approvazione non registrata.');
  assert.equal(fixedValue('medium risk on T3'), 'medium risk on T3');
});

test('labels: NOT VERIFIED keeps its reason', () => {
  assert.equal(fixedValue('⚠️ NOT VERIFIED'), '⚠️ NON VERIFICATO');
  assert.equal(fixedValue('⚠️ NOT VERIFIED - tried only with 0.2.0'), '⚠️ NON VERIFICATO - tried only with 0.2.0');
  assert.equal(fixedValue('⚠️ TO RE-VERIFY'), '⚠️ DA RIVERIFICARE');
});
