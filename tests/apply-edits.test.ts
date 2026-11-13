import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEdits,
  LOG_UNREADABLE,
  peer,
  type FileEdit,
} from '../src/lib/apply-edits.ts';
import { promoteProposalToOpen } from '../src/lib/human-actions.ts';
import { parseTrackerMarkdown } from '../src/lib/markdown-tables.ts';

const TRACKER = `---
type: Project
title: Work Tracker
---

# Work Tracker

## Open
<!-- wiki:open -->

| ID | Status | Goal | Done when | Owner | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 🟡 | Keep me | Tests pass | a | \`npm test\` | ok |

## Proposals
<!-- wiki:proposals -->

| Proposal | By | Date | Why |
| --- | --- | --- | --- |
| New thing | bob | 2026-11-10 | need it |

## Done
<!-- wiki:done -->

| ID | Status | Goal | Closed | Criteria met | Evidence |
| --- | --- | --- | --- | --- | --- |
`;

const LOG = `# Log\n\n## 2026-11-01 · Old · human\n- What: x\n- Evidence: y\n- IDs: T1\n`;

const TRACKER_PATH = 'project/work-tracker.md';
const LOG_PATH = 'log.md';

function insertOpenRow(tracker: string, id: string, goal: string): string {
  const needle = '| T1 | 🟡 | Keep me |';
  return tracker.replace(
    needle,
    `${needle}\n| ${id} | 🟡 | ${goal} | Tests pass | a | \`npm test\` | agent added |`,
  );
}

test('applyEdits: row added on disk before promote stays in Open', async () => {
  const snapshotTracker = TRACKER;
  const diskTracker = insertOpenRow(TRACKER, 'T9', 'Agent row');
  const store = new Map<string, string>([
    [TRACKER_PATH, diskTracker],
    [LOG_PATH, LOG],
  ]);
  const written: string[] = [];

  let logOut = '';
  const edits: FileEdit[] = [
    {
      relPath: TRACKER_PATH,
      apply: (current) => {
        const r = promoteProposalToOpen({
          trackerMarkdown: current,
          logMarkdown: peer(LOG_PATH),
          proposalText: 'New thing',
          proposalBy: 'bob',
          proposalDate: '2026-11-10',
          person: 'Stefano',
          owner: 'Stefano',
          doneWhen: 'done',
          nextVerification: 'npm test',
          dateIso: '2026-11-11',
        });
        logOut = r.logMarkdown;
        return r.trackerMarkdown;
      },
    },
    { relPath: LOG_PATH, apply: () => logOut },
  ];

  await applyEdits(
    edits,
    async (rel) => store.get(rel) ?? snapshotTracker,
    async (files) => {
      for (const { relPath, content } of files) {
        written.push(relPath);
        store.set(relPath, content);
      }
    },
    LOG_PATH,
  );

  const open = parseTrackerMarkdown(store.get(TRACKER_PATH)!).open;
  assert.ok(open.some((r) => r.id === 'T9' && r.goal === 'Agent row'));
  assert.ok(open.some((r) => r.goal === 'New thing'));
  assert.deepEqual(written, [TRACKER_PATH, LOG_PATH]);
});

test('applyEdits: unreadable log writes nothing', async () => {
  const store = new Map([[TRACKER_PATH, TRACKER]]);
  const written: string[] = [];
  let logOut = 'should not run';

  await assert.rejects(
    () =>
      applyEdits(
        [
          {
            relPath: TRACKER_PATH,
            apply: (t) => {
              logOut = t;
              return t;
            },
          },
          { relPath: LOG_PATH, apply: () => logOut },
        ],
        async (rel) => {
          if (rel === LOG_PATH) throw new Error('ENOENT');
          return store.get(rel)!;
        },
        async (files) => {
          for (const { relPath, content } of files) {
            written.push(relPath);
            store.set(relPath, content);
          }
        },
        LOG_PATH,
      ),
    (e: Error) => e.message === LOG_UNREADABLE(),
  );
  assert.deepEqual(written, []);
});
