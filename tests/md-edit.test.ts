import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDoc,
  renderDoc,
  fenceMask,
  findSection,
  findTable,
  setCells,
  StaleError,
} from '../src/lib/md-edit.ts';
import {
  promoteProposalToOpen,
  closeTrackerItemHumanUnproven,
  updateOpenRowField,
  acceptDecisionHuman,
  markPageReviewed,
  personId,
} from '../src/lib/human-actions.ts';
import { parseTrackerMarkdown } from '../src/lib/markdown-tables.ts';

const LOG = `---
title: Log
---
# Log
`;

function promoteKey(tracker: string, proposal = 'Add graph filter', by = 'stefano', date = '2026-11-10') {
  return promoteProposalToOpen({
    trackerMarkdown: tracker,
    logMarkdown: LOG,
    proposalText: proposal,
    proposalBy: by,
    proposalDate: date,
    person: 'Stefano',
    owner: 'Mario',
    doneWhen: 'Done',
    nextVerification: 'npm test',
    dateIso: '2026-11-10',
  }).trackerMarkdown;
}

test('regression 1: promote keeps translated proposals header and extra column', () => {
  const before = `---
title: Tracker
---
# Tracker

## Proposte
<!-- wiki:proposals -->

| Idea | Di | Data | Motivo | Priorità |
| --- | --- | --- | --- | --- |
| Nuova feature | stefano | 2026-11-10 | Perché | alta |

## Open
<!-- wiki:open -->

| ID | Status | Goal | Done when | Owner | Next verification | Evidence | Extra |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | 🟡 | Keep | ok | a | b | c | x |
`;
  const after = promoteKey(before, 'Nuova feature', 'stefano', '2026-11-10');
  assert.match(after, /\| Idea \| Di \| Data \| Motivo \| Priorità \|/);
  assert.equal(parseTrackerMarkdown(after).proposals.length, 0);
  assert.match(after, /\| T2 \| ⚪ \| Nuova feature \|/);
  assert.match(after, /\| Extra \|/);
});

test('regression 2a: editing T2 leaves T1 line with escaped pipe in backticks unchanged', () => {
  const before = `---
title: Tracker
---
# Tracker

## Open
<!-- wiki:open -->

| ID | Status | Goal | Done when | Owner | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 🟡 | Goal | ok | stefano | x | \`cmd \\| tail\` |
| T2 | ⚪ | Other | ok | old | x | e |
`;
  const res = updateOpenRowField({ trackerMarkdown: before, id: 'T2', field: 'owner', value: 'Mario' });
  assert.equal(
    res.trackerMarkdown.split('\n').find((l) => l.includes('T1'))!.trim(),
    before.split('\n').find((l) => l.includes('T1'))!.trim(),
  );
});

test('regression 2b: unescaped pipe on T1 blocks edit; T2 still edits', () => {
  const before = `---
title: Tracker
---
# Tracker

## Open
<!-- wiki:open -->

| ID | Status | Goal | Done when | Owner | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 🟡 | bad | ok | stefano | x | broken | extra |
| T2 | ⚪ | Other | ok | old | x | e |
`;
  const ok = updateOpenRowField({ trackerMarkdown: before, id: 'T2', field: 'owner', value: 'Mario' });
  assert.match(ok.trackerMarkdown, /T2.*Mario/);
  assert.throws(
    () => updateOpenRowField({ trackerMarkdown: before, id: 'T1', field: 'owner', value: 'X' }),
  );
});

test('regression 3: fenced example above real Open is untouched; promote hits real table', () => {
  const before = `---
title: Tracker
---
# Tracker

## Open
<!-- wiki:open -->

\`\`\`markdown
| ID | Status | Goal | Done when | Owner | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| FAKE | ⚪ | Example | - | - | - | - |
\`\`\`

| ID | Status | Goal | Done when | Owner | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 🟡 | Real | ok | stefano | x | e |

## Proposals
<!-- wiki:proposals -->

| Proposal | By | Date | Why |
| --- | --- | --- | --- |
| Ship it | stefano | 2026-11-10 | yes |
`;
  const after = promoteKey(before, 'Ship it', 'stefano', '2026-11-10');
  assert.match(after, /```markdown[\s\S]*\| FAKE \|/);
  assert.match(after, /^\| T2 \| ⚪ \| Ship it \|/m);
  assert.doesNotMatch(after.replace(/```[\s\S]*?```/g, ''), /\| FAKE \|/);
});

test('regression 4: Approvazione + wiki marker: accept appends, no duplicate section', () => {
  const decision = `---
type: Decision
title: D1
status: proposed
---

# D1

## Approvazione
<!-- wiki:approval -->
proposed: codex on 2026-11-09.
`;
  const res = acceptDecisionHuman({
    decisionMarkdown: decision,
    logMarkdown: LOG,
    person: 'Stefano',
    whereContext: 'review',
    dateIso: '2026-11-10',
  });
  const approvalHeadings = res.decisionMarkdown
    .split('\n')
    .filter((l) => l.startsWith('## ') && /approval|approvazione/i.test(l));
  assert.equal(approvalHeadings.length, 1);
  assert.match(res.decisionMarkdown, /accepted: Stefano, review, 2026-11-10/);
});

test('regression 5: custom delimiter alignment survives field edit', () => {
  const before = `---
title: Tracker
---
# Tracker

## Open
<!-- wiki:open -->

| ID | Status | Goal |
| :--- | ---: | :--- |
| T1 | 🟡 | Build |
`;
  const res = updateOpenRowField({ trackerMarkdown: before, id: 'T1', field: 'goal', value: 'Ship' });
  const delim = res.trackerMarkdown.split('\n').find((l) => l.includes(':---'))!;
  assert.equal(delim.trim(), '| :--- | ---: | :--- |');
});

test('regression 6: personId from name with comma and space', () => {
  assert.equal(personId('Rossi, Mario'), 'rossi-mario');
  const page = `---
title: X
---
# X
`;
  const res = markPageReviewed({
    pageMarkdown: page,
    logMarkdown: '',
    person: 'Rossi, Mario',
    atIso: '2026-11-10T12:00:00Z',
    commit: '',
  });
  assert.match(res.pageMarkdown, /human:rossi-mario/);
});

test('regression 7: CRLF and BOM preserved through promote', () => {
  const body =
    '---\r\ntitle: Tracker\r\n---\r\n\r\n# Tracker\r\n\r\n## Open\r\n<!-- wiki:open -->\r\n\r\n' +
    '| ID | Status | Goal | Done when | Owner | Next verification | Evidence |\r\n' +
    '| --- | --- | --- | --- | --- | --- | --- |\r\n' +
    '| T1 | 🟡 | G | ok | a | b | c |\r\n\r\n' +
    '## Proposals\r\n<!-- wiki:proposals -->\r\n\r\n' +
    '| Proposal | By | Date | Why |\r\n| --- | --- | --- | --- |\r\n' +
    '| P | stefano | 2026-11-10 | w |\r\n';
  const before = '\uFEFF' + body;
  const after = promoteProposalToOpen({
    trackerMarkdown: before,
    logMarkdown: '',
    proposalText: 'P',
    proposalBy: 'stefano',
    proposalDate: '2026-11-10',
    person: 'Stefano',
    owner: 'o',
    doneWhen: 'd',
    nextVerification: 'n',
    dateIso: '2026-11-10',
  }).trackerMarkdown;
  assert.ok(after.startsWith('\uFEFF'));
  assert.ok(after.includes('\r\n'));
  const doc = parseDoc(after);
  assert.equal(doc.eol, '\r\n');
  assert.equal(doc.bom, true);
  assert.equal(doc.finalNewline, true);
});

test('md-edit: parseDoc and renderDoc round-trip', () => {
  const text = '\uFEFFline1\nline2\n';
  const doc = parseDoc(text);
  assert.equal(renderDoc(doc), text);
});

test('md-edit: fenceMask and findTable skip fenced tables', () => {
  const md = `# T

## Open
<!-- wiki:open -->

\`\`\`
| H1 | H2 |
| --- | --- |
| inner | row |
\`\`\`

| A | B |
| --- | --- |
| 1 | 2 |
`;
  const doc = parseDoc(md);
  const section = findSection(doc, 'open', ['Open'])!;
  const table = findTable(doc, section)!;
  assert.deepEqual(table.header, ['A', 'B']);
});

test('StaleError is thrown for duplicate proposal keys', () => {
  const tracker = `---
title: T
---
# T
## Proposals
<!-- wiki:proposals -->
| Proposal | By | Date | Why |
| --- | --- | --- | --- |
| Dup | a | 2026-11-10 | w |
| Dup | a | 2026-11-10 | w |
## Open
<!-- wiki:open -->
| ID | Status | Goal | Done when | Owner | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
`;
  assert.throws(
    () =>
      promoteProposalToOpen({
        trackerMarkdown: tracker,
        logMarkdown: '',
        proposalText: 'Dup',
        proposalBy: 'a',
        proposalDate: '2026-11-10',
        person: 'S',
        owner: 'o',
        doneWhen: 'd',
        nextVerification: 'n',
        dateIso: '2026-11-10',
      }),
    StaleError,
  );
});

test('setCells only escapes changed cells', () => {
  const doc = parseDoc('| a | `b|c` |\n');
  const next = setCells(doc, 0, ['a', 'new|val']);
  assert.match(renderDoc(next), /new\\|val/);
});
