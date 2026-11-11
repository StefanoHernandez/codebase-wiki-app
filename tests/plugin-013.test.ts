import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSchemaMarkdown } from '../src/lib/schema-parser.ts';
import { validateHumanActor, personId, closeTrackerItemHumanUnproven } from '../src/lib/human-actions.ts';

const schemaWith = (rows: string, heading = '## Project profile') =>
  `# Schema\n\n${heading}\n\n| Setting | Value |\n| --- | --- |\n${rows}\n\n## Budgets\n`;

test('Log order: default oldest-first', () => {
  assert.equal(parseSchemaMarkdown(schemaWith('| Language | English |')).logOrder, 'oldest-first');
});

test('Log order: newest first, key with * and backticks, any case', () => {
  assert.equal(parseSchemaMarkdown(schemaWith('| **`Log Order`** | `newest first` |')).logOrder, 'newest-first');
  assert.equal(parseSchemaMarkdown(schemaWith('| log order | oldest first |')).logOrder, 'oldest-first');
});

test('Log order: translated heading with project-profile marker', () => {
  const md = schemaWith('| Log order | newest first |', '## Profilo del progetto\n<!-- wiki:project-profile -->');
  assert.equal(parseSchemaMarkdown(md).logOrder, 'newest-first');
});

test('Log order: an unknown value and a fenced example keep the default', () => {
  assert.equal(parseSchemaMarkdown(schemaWith('| Log order | sideways |')).logOrder, 'oldest-first');
  const fenced = '## Project profile\n\n```markdown\n| Setting | Value |\n| --- | --- |\n| Log order | newest first |\n```\n';
  assert.equal(parseSchemaMarkdown(fenced).logOrder, 'oldest-first');
});

test('newest-first log order puts the closure entry above the first dated entry', () => {
  const tracker = [
    '## Open',
    '| ID | Status | Goal | Done when | Owner | Next verification | Evidence |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| T1 | 🟡 | Goal | Done | stefano | `npm test` | none |',
    '',
    '## Done',
    '| ID | Status | Goal | Closed | Criteria met | Evidence |',
    '| --- | --- | --- | --- | --- | --- |',
    '',
  ].join('\n');
  const log = '# Log\n\n## 2026-11-01 · Old · human\n- What: x\n';
  const out = closeTrackerItemHumanUnproven({
    trackerMarkdown: tracker,
    logMarkdown: log,
    taskId: 'T1',
    person: 'Stefano',
    notProvenReason: 'no test yet',
    closureSource: 'chat',
    dateIso: '2026-11-11',
    logOrder: 'newest-first',
  });
  assert.ok(out.logMarkdown.indexOf('## 2026-11-11') < out.logMarkdown.indexOf('## 2026-11-01'));
});

test('validateHumanActor rejects agent and product names, process: and slashes, in Italian', () => {
  for (const name of [
    'Claude',
    'claude code',
    'claude-code',
    'Claude Opus',
    'gpt-5',
    'Gemini Pro',
    'Cursor Agent',
    'GitHub Copilot',
    'ai agent',
    'assistant',
    'process:ci',
    'stefano/laptop',
    'codex/gpt-5',
  ]) {
    assert.throws(() => validateHumanActor(name), /non è una persona|persona/, name);
  }
  assert.throws(() => validateHumanActor('  '), /nome/);
});

test('validateHumanActor accepts ordinary names', () => {
  for (const name of ['Stefano', 'Rossi, Mario', 'Ñandú Ölz', 'Claudia', 'Gemma']) {
    assert.doesNotThrow(() => validateHumanActor(name), name);
  }
});

test('personId output matches the validator ACTOR_ID', () => {
  const ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  assert.equal(personId('Rossi, Mario'), 'rossi-mario');
  assert.equal(personId('Ñandú Ölz'), 'nandu-olz');
  assert.equal(personId('  '), '');
  assert.equal(personId('._Anna'), 'anna');
  for (const name of ['Rossi, Mario', 'Ñandú Ölz', 'J. R. R. Tolkien', '_x_', '-.-a']) {
    assert.match(personId(name), ACTOR_ID, name);
  }
});

test('validateHumanActor reads names like the validator: backticks stripped, no <…> anywhere', () => {
  assert.throws(() => validateHumanActor('`unknown`'), /persona|segnaposto/);
  assert.throws(() => validateHumanActor('Mario <PM>'), /segnaposto/);
  assert.throws(() => validateHumanActor('``'), /segnaposto/);
  assert.doesNotThrow(() => validateHumanActor('Mario Rossi'));
});
