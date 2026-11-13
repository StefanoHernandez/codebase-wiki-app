import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseTrackerMarkdown } from '../src/lib/markdown-tables.ts';
import { promoteProposalToOpen, closeTrackerItemHumanUnproven } from '../src/lib/human-actions.ts';
import { makeTempRepo, runValidator, read, logEntries } from './helpers/fixture.ts';

test('fixture wiki passes the structural validator as delivered', () => {
  const temp = makeTempRepo();
  try {
    const result = runValidator(temp.wiki);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /validation passed/);
  } finally {
    temp.cleanup();
  }
});

test('promote and human closure keep the fixture valid and add two log entries', () => {
  const temp = makeTempRepo();
  try {
    const trackerBefore = read(temp.wiki, 'project/work-tracker.md');
    const logBefore = read(temp.wiki, 'log.md');
    const entriesBefore = logEntries(logBefore);

    const promoted = promoteProposalToOpen({
      trackerMarkdown: trackerBefore,
      logMarkdown: logBefore,
      proposalText: parseTrackerMarkdown(trackerBefore).proposals[0]!.proposal,
      proposalBy: parseTrackerMarkdown(trackerBefore).proposals[0]!.by,
      proposalDate: parseTrackerMarkdown(trackerBefore).proposals[0]!.date,
      person: 'Stefano',
      owner: 'Stefano',
      doneWhen: 'Phase filter is listed in the work view',
      nextVerification: '`npm test`',
      dateIso: '2026-11-10',
    });
    assert.equal(promoted.assignedId, 'T4');

    const closed = closeTrackerItemHumanUnproven({
      trackerMarkdown: promoted.trackerMarkdown,
      logMarkdown: promoted.logMarkdown,
      taskId: 'T2',
      person: 'Stefano',
      notProvenReason: 'the watcher fix is not verified',
      closureSource: 'chat with stefano, 2026-11-10',
      dateIso: '2026-11-10',
    });

    fs.writeFileSync(path.join(temp.wiki, 'project/work-tracker.md'), closed.trackerMarkdown);
    fs.writeFileSync(path.join(temp.wiki, 'log.md'), closed.logMarkdown);

    const after = parseTrackerMarkdown(read(temp.wiki, 'project/work-tracker.md'));
    assert.deepEqual(after.open.map((r) => r.id), ['T1', 'T4']);
    assert.equal(after.proposals.length, 1);
    const t2 = after.done.find((r) => r.id === 'T2');
    assert.equal(t2?.status, '⚫');

    assert.equal(logEntries(read(temp.wiki, 'log.md')) - entriesBefore, 2);

    const result = runValidator(temp.wiki);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /validation passed/);
  } finally {
    temp.cleanup();
  }
});

test('extra Phase, Priority and Depends on columns survive promote and closure', () => {
  const temp = makeTempRepo();
  try {
    const original = read(temp.wiki, 'project/work-tracker.md')
      .replace(
        '| ID | Status | Goal | Done when | Owner | Next verification | Evidence |\n| --- | --- | --- | --- | --- | --- | --- |',
        '| ID | Status | Goal | Done when | Owner | Next verification | Evidence | Phase | Priority | Depends on |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      )
      .replace('| `tests/parsers.test.ts` |', '| `tests/parsers.test.ts` | WP1 | high | — |')
      .replace('| ⚠️ NOT VERIFIED - waiting for the watcher fix |', '| ⚠️ NOT VERIFIED - waiting for the watcher fix | WP2 | low | T1, review |');
    const proposal = parseTrackerMarkdown(original).proposals[0]!;
    const promoted = promoteProposalToOpen({
      trackerMarkdown: original,
      logMarkdown: read(temp.wiki, 'log.md'),
      proposalText: proposal.proposal,
      proposalBy: proposal.by,
      proposalDate: proposal.date,
      person: 'Stefano',
      owner: 'Stefano',
      doneWhen: 'Listed',
      nextVerification: '`npm test`',
      dateIso: '2026-11-13',
    });
    const closed = closeTrackerItemHumanUnproven({
      trackerMarkdown: promoted.trackerMarkdown,
      logMarkdown: promoted.logMarkdown,
      taskId: 'T1',
      person: 'Stefano',
      notProvenReason: 'not needed',
      closureSource: 'chat with stefano, 2026-11-13',
      dateIso: '2026-11-13',
    });
    const after = parseTrackerMarkdown(closed.trackerMarkdown);
    const t2 = after.open.find((r) => r.id === 'T2')!;
    assert.equal(t2.extra.Phase, 'WP2');
    assert.equal(t2.extra.Priority, 'low');
    assert.deepEqual(t2.dependsOn, { ids: ['T1'], external: ['review'] });
    assert.equal(after.open.find((r) => r.id === 'T4')!.extra.Phase, '');

    fs.writeFileSync(path.join(temp.wiki, 'project/work-tracker.md'), closed.trackerMarkdown);
    fs.writeFileSync(path.join(temp.wiki, 'log.md'), closed.logMarkdown);
    const result = runValidator(temp.wiki);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /validation passed/);
  } finally {
    temp.cleanup();
  }
});
