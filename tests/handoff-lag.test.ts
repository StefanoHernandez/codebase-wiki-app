import test from 'node:test';
import assert from 'node:assert/strict';
import { handoffLag, type HandoffLagAction } from '../src/lib/handoff-lag.ts';
import type { HandoffData } from '../src/types/wiki.ts';

function handoff(overrides: Partial<HandoffData> = {}): HandoffData {
  return {
    stateBullets: {},
    baton: [],
    noOpenWork: false,
    blockers: [],
    ...overrides,
  };
}

test('handoffLag returns null when handoff is missing', () => {
  const action: HandoffLagAction = { kind: 'promote' };
  assert.equal(handoffLag(null, action), null);
  assert.equal(handoffLag(null, { kind: 'close', taskId: 'T1' }), null);
});

test('handoffLag warns on promote when handoff says no open work', () => {
  const msg = handoffLag(handoff({ noOpenWork: true }), { kind: 'promote' });
  assert.ok(msg);
  assert.match(msg, /wiki-sync/i);
  assert.match(msg, /nessun lavoro aperto|No open work/i);
});

test('handoffLag does not warn on promote when baton has tasks and noOpenWork is false', () => {
  const msg = handoffLag(
    handoff({
      baton: [
        {
          order: '1',
          task: 'T1 - Finish parser',
          startFiles: '`src/x.ts`',
          doneWhen: 'tests green',
          verificationCommand: 'npm test',
          notes: '',
        },
      ],
    }),
    { kind: 'promote' },
  );
  assert.equal(msg, null);
});

test('handoffLag warns on close when task id is still in the baton', () => {
  const msg = handoffLag(
    handoff({
      baton: [
        {
          order: '1',
          task: 'T2 - Wire dialog',
          startFiles: '`src/y.tsx`',
          doneWhen: 'merged',
          verificationCommand: 'npm test',
          notes: '',
        },
      ],
    }),
    { kind: 'close', taskId: 'T2' },
  );
  assert.ok(msg);
  assert.match(msg, /T2/);
  assert.match(msg, /baton/i);
  assert.match(msg, /wiki-sync/i);
});

test('handoffLag does not warn on close when task id is absent from baton', () => {
  const msg = handoffLag(
    handoff({
      baton: [
        {
          order: '1',
          task: 'T3 - Other task',
          startFiles: '—',
          doneWhen: '—',
          verificationCommand: 'npm test',
          notes: '',
        },
      ],
    }),
    { kind: 'close', taskId: 'T1' },
  );
  assert.equal(msg, null);
});

test('handoffLag does not warn on close for unrelated field edits', () => {
  assert.equal(handoffLag(handoff({ noOpenWork: true }), { kind: 'close', taskId: 'T9' }), null);
});
