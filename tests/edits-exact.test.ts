import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  promoteProposalToOpen,
  closeTrackerItemHumanUnproven,
  updateOpenRowField,
  acceptDecisionHuman,
  markPageReviewed,
  appendLogEntry,
} from '../src/lib/human-actions.ts';
import { assertOnlyChanged } from './helpers/line-diff.ts';

const LOG = '---\ntitle: Log\n---\n# Log\n';

function promote(tracker: string, proposal: string, logMarkdown = LOG) {
  return promoteProposalToOpen({
    trackerMarkdown: tracker,
    logMarkdown,
    proposalText: proposal,
    proposalBy: 'stefano',
    proposalDate: '2026-11-10',
    person: 'Stefano',
    owner: 'Mario',
    doneWhen: 'Fatto',
    nextVerification: 'npm test',
    dateIso: '2026-11-10',
  });
}

function close(tracker: string, id: string) {
  return closeTrackerItemHumanUnproven({
    trackerMarkdown: tracker,
    logMarkdown: LOG,
    taskId: id,
    person: 'Stefano',
    notProvenReason: 'non dimostrato',
    closureSource: 'riunione',
    dateIso: '2026-11-11',
  });
}

const ITALIAN = `---
title: Tracker
---
# Tracker

## Proposte
<!-- wiki:proposals -->

| Proposta | Da | Data | Perché | Priorità |
| --- | --- | --- | --- | --- |
| Nuova | stefano | 2026-11-10 | sì | alta |

## Aperti
<!-- wiki:open -->

| ID | Stato | Obiettivo | Fatto quando | Responsabile | Prossima verifica | Prove | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | 🟡 | Tieni | ok | a | b | c | n1 |

## Completati
<!-- wiki:done -->

| ID | Stato | Obiettivo | Chiuso | Criteri | Prove | Note |
| --- | --- | --- | --- | --- | --- | --- |
`;

test('translated tracker: promote changes exactly the proposal and the new Open row', () => {
  const after = promote(ITALIAN, 'Nuova').trackerMarkdown;
  assertOnlyChanged(
    ITALIAN,
    after,
    ['| Nuova | stefano | 2026-11-10 | sì | alta |'],
    [/^\| T2 \| ⚪ \| Nuova \| Fatto \| Mario \| npm test \| promoted by Stefano 2026-11-10 \| +\|$/],
  );
});

test('translated tracker: update changes one cell of one line', () => {
  const after = updateOpenRowField({ trackerMarkdown: ITALIAN, id: 'T1', field: 'owner', value: 'Luigi' }).trackerMarkdown;
  assertOnlyChanged(ITALIAN, after, ['| T1 | 🟡 | Tieni | ok | a | b | c | n1 |'], ['| T1 | 🟡 | Tieni | ok | Luigi | b | c | n1 |']);
});

test('translated tracker: close moves the row and keeps the extra column', () => {
  const after = close(ITALIAN, 'T1').trackerMarkdown;
  assertOnlyChanged(
    ITALIAN,
    after,
    ['| T1 | 🟡 | Tieni | ok | a | b | c | n1 |'],
    ['| T1 | ⚫ | Tieni | 2026-11-11 | closed by Stefano 2026-11-11; not proven: non dimostrato | riunione | n1 |'],
  );
});

test('fenced example tracker above the real one is byte-identical after promote', () => {
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
  const after = promote(before, 'Ship it').trackerMarkdown;
  assertOnlyChanged(before, after, ['| Ship it | stefano | 2026-11-10 | yes |'], [/^\| T2 \| ⚪ \| Ship it \|/]);
  assert.ok(after.indexOf('| T2 |') > after.indexOf('| T1 | 🟡 | Real'), 'new row lands in the real table');
});

test('CRLF + BOM tracker: promote keeps EOL and BOM and touches two lines', () => {
  const before =
    '﻿---\r\ntitle: Tracker\r\n---\r\n\r\n## Open\r\n<!-- wiki:open -->\r\n\r\n' +
    '| ID | Status | Goal | Done when | Owner | Next verification | Evidence |\r\n' +
    '| --- | --- | --- | --- | --- | --- | --- |\r\n| T1 | 🟡 | G | ok | a | b | c |\r\n\r\n' +
    '## Proposals\r\n<!-- wiki:proposals -->\r\n\r\n| Proposal | By | Date | Why |\r\n| --- | --- | --- | --- |\r\n' +
    '| P | stefano | 2026-11-10 | w |\r\n';
  const after = promote(before, 'P').trackerMarkdown;
  assertOnlyChanged(before, after, ['| P | stefano | 2026-11-10 | w |'], [/^\| T2 \| ⚪ \| P \|/]);
});

test('BOM-only LF decision: accept keeps BOM and changes status plus one approval line', () => {
  const before = '﻿---\ntype: Decision\ntitle: D\nstatus: proposed\n---\n\n# D\n\n## Approval\nproposed: x.\n';
  const after = acceptDecisionHuman({
    decisionMarkdown: before,
    logMarkdown: LOG,
    person: 'Stefano',
    whereContext: 'review',
    dateIso: '2026-11-11',
  }).decisionMarkdown;
  assertOnlyChanged(before, after, ['status: proposed'], ['status: accepted', 'accepted: Stefano, review, 2026-11-11']);
});

test('legacy English Done table without Status: close is refused and nothing changes', () => {
  const before = `## Open
<!-- wiki:open -->

| ID | Status | Goal | Done when | Owner | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 🟡 | G | ok | a | b | c |

## Done
<!-- wiki:done -->

| ID | Goal | Closed | Criteria met | Evidence |
| --- | --- | --- | --- | --- |
| T0 | Old | 2026-01-01 | proven | log |
`;
  assert.throws(() => close(before, 'T1'), /non ha la colonna Status/);
});

test('English Open header reordered with all columns: values land by name', () => {
  const before = `## Open
<!-- wiki:open -->

| ID | Status | Goal | Owner | Done when | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 🟡 | G | a | ok | b | c |

## Proposals
<!-- wiki:proposals -->

| Proposal | By | Date | Why |
| --- | --- | --- | --- |
| Ship | stefano | 2026-11-10 | w |
`;
  const after = promote(before, 'Ship').trackerMarkdown;
  assertOnlyChanged(
    before,
    after,
    ['| Ship | stefano | 2026-11-10 | w |'],
    ['| T2 | ⚪ | Ship | Mario | Fatto | npm test | promoted by Stefano 2026-11-10 |'],
  );
  const edited = updateOpenRowField({ trackerMarkdown: before, id: 'T1', field: 'owner', value: 'Z' }).trackerMarkdown;
  assertOnlyChanged(before, edited, ['| T1 | 🟡 | G | a | ok | b | c |'], ['| T1 | 🟡 | G | Z | ok | b | c |']);
});

test('English Open header missing a column: actions are refused, not guessed', () => {
  const before = `## Open
<!-- wiki:open -->

| ID | Status | Goal | Owner | Done when | Evidence |
| --- | --- | --- | --- | --- | --- |
| T1 | 🟡 | G | a | ok | c |

## Proposals
<!-- wiki:proposals -->

| Proposal | By | Date | Why |
| --- | --- | --- | --- |
| Ship | stefano | 2026-11-10 | w |
`;
  assert.throws(() => promote(before, 'Ship'), /non corrispondono al formato/);
  assert.throws(
    () => updateOpenRowField({ trackerMarkdown: before, id: 'T1', field: 'owner', value: 'Z' }),
    /non corrispondono al formato/,
  );
});

test('block verified with an unknown key or without at is refused', () => {
  const review = (page: string) =>
    markPageReviewed({ pageMarkdown: page, logMarkdown: LOG, person: 'Stefano', atIso: '2026-11-11T10:00:00Z', commit: '' });
  const withNote = '---\ntitle: X\nverified:\n- by: human:ann\n  at: 2026-11-01T00:00:00Z\n  note: keep me\n---\n# X\n';
  assert.throws(() => review(withNote), /correggilo a mano/);
  const withoutAt = '---\ntitle: X\nverified:\n- by: human:ann\n---\n# X\n';
  assert.throws(() => review(withoutAt), /correggilo a mano/);
  const quoted = '---\ntitle: X\nverified:\n  - by: human:ann\n    at: "2026-11-01T00:00:00Z"\n---\n# X\n';
  const out = review(quoted).pageMarkdown;
  assert.match(out, /^verified: \[\{ by: human:ann, at: "2026-11-01T00:00:00Z" \}, \{ by: human:stefano, at: 2026-11-11T10:00:00Z/m);
});

test('empty log gets exactly one entry ending with a newline', () => {
  const out = appendLogEntry({ logMarkdown: '', date: '2026-11-11', title: 'T', what: 'w', evidence: 'e', ids: [] });
  assert.ok(out.startsWith('## 2026-11-11 · T · human\n'));
  assert.ok(out.endsWith('\n') && !out.endsWith('\n\n'));
});

test('no browser code imports Node modules (they are empty in the Tauri webview)', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && /from ['"]node:/.test(fs.readFileSync(full, 'utf8'))) offenders.push(full);
    }
  };
  walk(path.resolve(process.cwd(), 'src'));
  assert.deepEqual(offenders, []);
});

test('newest-first log: one blank line between the new entry and the next one', () => {
  const log = '---\ntitle: Log\n---\n# Log\n\n## 2026-11-01 · Old · agent\n- What: x\n';
  const out = appendLogEntry({ logMarkdown: log, date: '2026-11-11', title: 'New', what: 'w', evidence: 'e', ids: [], order: 'newest-first' });
  assert.match(out, /- IDs: none\n\n## 2026-11-01 · Old · agent/);
  assertOnlyChanged(log, out, [], ['## 2026-11-11 · New · human', '- What: w', '- Evidence: e', '- IDs: none', '']);
});
