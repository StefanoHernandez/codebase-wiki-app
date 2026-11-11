import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDoc,
  renderDoc,
  fenceMask,
  findSection,
  findTable,
  setCells,
  changedLineIndices,
  assertUnchangedLines,
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

function lineIndex(doc: string, needle: string | RegExp): number {
  const lines = parseDoc(doc).lines;
  const idx = lines.findIndex((l) =>
    typeof needle === 'string' ? l.includes(needle) : needle.test(l),
  );
  assert.ok(idx >= 0, `line not found: ${String(needle)}`);
  return idx;
}

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
  assert.match(after, /\| T1 \| 🟡 \| Keep \| ok \| a \| b \| c \| x \|/);
  const proposalLine = lineIndex(before, 'Nuova feature');
  const openInsert = lineIndex(after, '| T2 |');
  assertUnchangedLines(before, after, new Set(changedLineIndices(before, after).concat([proposalLine, openInsert])));
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
  const t1 = lineIndex(before, 'T1');
  const t2 = lineIndex(before, '| T2 |');
  assertUnchangedLines(before, res.trackerMarkdown, new Set([t2]));
  assert.equal(
    res.trackerMarkdown.split('\n').find((l) => l.includes('T1'))!.trim(),
    before.split('\n').find((l) => l.includes('T1'))!.trim(),
  );
  assert.match(res.trackerMarkdown, /T2.*Mario/);
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
  const t2 = lineIndex(before, '| T2 |');
  assertUnchangedLines(before, ok.trackerMarkdown, new Set([t2]));
  assert.throws(
    () => updateOpenRowField({ trackerMarkdown: before, id: 'T1', field: 'owner', value: 'X' }),
    /non protetta/,
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
  const parsed = parseTrackerMarkdown(after);
  assert.equal(parsed.open.length, 2);
  assert.deepEqual(
    parsed.open.map((r) => r.id),
    ['T1', 'T2'],
  );
  const fenceLines = parseDoc(before)
    .lines.map((l, i) => (/^```/.test(l.trim()) || l.includes('| FAKE |') ? i : -1))
    .filter((i) => i >= 0);
  const allowed = new Set([...changedLineIndices(before, after), ...fenceLines]);
  assertUnchangedLines(before, after, allowed);
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
  const statusLine = lineIndex(decision, 'status: proposed');
  const approvalAppend = lineIndex(res.decisionMarkdown, 'accepted: Stefano');
  assertUnchangedLines(decision, res.decisionMarkdown, new Set([statusLine, approvalAppend]));
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
  const goalLine = lineIndex(before, '| T1 |');
  assertUnchangedLines(before, res.trackerMarkdown, new Set([goalLine]));
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
  assertUnchangedLines(before, after, new Set(changedLineIndices(before, after)));

  const decisionBody =
    '---\r\ntype: Decision\r\ntitle: D\r\nstatus: proposed\r\n---\r\n\r\n# D\r\n\r\n## Approval\r\nproposed: x.\r\n';
  const decisionBefore = '\uFEFF' + decisionBody;
  const decisionRes = acceptDecisionHuman({
    decisionMarkdown: decisionBefore,
    logMarkdown: '',
    person: 'Stefano',
    whereContext: 'review',
    dateIso: '2026-11-10',
  });
  assert.ok(decisionRes.decisionMarkdown.startsWith('\uFEFF'));
  assert.ok(decisionRes.decisionMarkdown.includes('\r\n'));
  assert.equal(parseDoc(decisionRes.decisionMarkdown).eol, '\r\n');
});

test('translated Open headers: promote, update field, and close preserve cells', () => {
  const before = `---
title: Tracker
---
# Tracker

## Proposte
<!-- wiki:proposals -->

| Proposta | Da | Data | Perche |
| --- | --- | --- | --- |
| Nuova | stefano | 2026-11-10 | sì |

## Aperti
<!-- wiki:open -->

| ID | Stato | Obiettivo | Fatto quando | Responsabile | Prossima verifica | Prove | Priorità |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | 🟡 | Keep | ok | a | b | c | alta |

## Completati
<!-- wiki:done -->

| ID | Stato | Obiettivo | Chiuso | Criteri | Prove |
| --- | --- | --- | --- | --- | --- |
`;

  const promoted = promoteProposalToOpen({
    trackerMarkdown: before,
    logMarkdown: LOG,
    proposalText: 'Nuova',
    proposalBy: 'stefano',
    proposalDate: '2026-11-10',
    person: 'Stefano',
    owner: 'Mario',
    doneWhen: 'Fatto',
    nextVerification: 'npm test',
    dateIso: '2026-11-10',
  });
  assert.match(
    promoted.trackerMarkdown,
    /^\| T2 \| ⚪ \| Nuova \| Fatto \| Mario \| npm test \| promoted by Stefano 2026-11-10 \|/m,
  );
  assert.match(promoted.trackerMarkdown, /\| T1 \| 🟡 \| Keep \| ok \| a \| b \| c \| alta \|/);
  assertUnchangedLines(before, promoted.trackerMarkdown, new Set(changedLineIndices(before, promoted.trackerMarkdown)));

  const edited = updateOpenRowField({
    trackerMarkdown: promoted.trackerMarkdown,
    id: 'T2',
    field: 'owner',
    value: 'Luigi',
  });
  assert.match(edited.trackerMarkdown, /^\| T2 \| ⚪ \| Nuova \| Fatto \| Luigi \|/m);

  const closed = closeTrackerItemHumanUnproven({
    trackerMarkdown: edited.trackerMarkdown,
    logMarkdown: promoted.logMarkdown,
    taskId: 'T2',
    person: 'Stefano',
    notProvenReason: 'non dimostrato',
    closureSource: 'chat',
    dateIso: '2026-11-10',
  });
  assert.match(
    closed.trackerMarkdown,
    /^\| T2 \| ⚫ \| Nuova \| 2026-11-10 \| closed by Stefano 2026-11-10; not proven: non dimostrato \| chat \|/m,
  );
  assert.doesNotMatch(closed.trackerMarkdown, /^\| T2 \|.*\| Luigi/m);
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

test('markPageReviewed preserves block verified entries and removes orphan lines', () => {
  const pageCol0 = `---
title: Block0
verified:
- by: human:old
  at: 2026-01-01T00:00:00Z
---
# Block0
`;
  const res0 = markPageReviewed({
    pageMarkdown: pageCol0,
    logMarkdown: '',
    person: 'Stefano',
    atIso: '2026-11-10T12:00:00Z',
    commit: 'abc',
  });
  assert.equal(res0.pageMarkdown.match(/^verified:/gm)!.length, 1);
  assert.doesNotMatch(res0.pageMarkdown, /^- by: human:old/m);
  assert.match(
    res0.pageMarkdown,
    /^verified: \[\{ by: human:old, at: 2026-01-01T00:00:00Z \}, \{ by: human:stefano, at: 2026-11-10T12:00:00Z, commit: abc \}\]$/m,
  );

  const pageIndented = `---
title: BlockInd
verified:
  - by: human:mario
    at: 2026-02-01T00:00:00Z
---
# BlockInd
`;
  const res1 = markPageReviewed({
    pageMarkdown: pageIndented,
    logMarkdown: '',
    person: 'Stefano',
    atIso: '2026-11-11T12:00:00Z',
    commit: 'def',
  });
  assert.equal(res1.pageMarkdown.match(/^verified:/gm)!.length, 1);
  assert.match(res1.pageMarkdown, /human:mario/);

  const quotedFlow = `---
title: Q
verified: [{ by: "agent/weird", at: 2026-01-01T00:00:00Z }]
---
# Q
`;
  const res2 = markPageReviewed({
    pageMarkdown: quotedFlow,
    logMarkdown: '',
    person: 'Stefano',
    atIso: '2026-11-12T12:00:00Z',
    commit: 'ghi',
  });
  assert.match(res2.pageMarkdown, /"agent\/weird"/);
});
