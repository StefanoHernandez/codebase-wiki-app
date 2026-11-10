import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { acceptDecisionHuman, rejectDecisionHuman } from '../src/lib/human-actions.ts';
import { parseFrontmatter } from '../src/lib/frontmatter.ts';
import { makeTempRepo, runValidator, read, logEntries } from './helpers/fixture.ts';

const DECISION = 'project/decisions/0001-use-tauri.md';
const LOG = 'log.md';

test('acceptDecisionHuman on fixture passes validator and updates approval', () => {
  const temp = makeTempRepo();
  try {
    const decisionBefore = read(temp.wiki, DECISION);
    const logBefore = read(temp.wiki, LOG);
    const entriesBefore = logEntries(logBefore);

    const result = acceptDecisionHuman({
      decisionMarkdown: decisionBefore,
      logMarkdown: logBefore,
      person: 'Stefano',
      whereContext: 'riunione 2026-11-10',
      dateIso: '2026-11-10',
    });

    assert.equal(parseFrontmatter(result.decisionMarkdown).fields.status, 'accepted');
    const approvalStart = result.decisionMarkdown.indexOf('## Approval');
    const approval = result.decisionMarkdown.slice(approvalStart);
    assert.ok(approval.includes('proposed: stefano, 2026-11-09'));
    assert.ok(approval.includes('accepted: Stefano, riunione 2026-11-10, 2026-11-10'));

    fs.writeFileSync(path.join(temp.wiki, DECISION), result.decisionMarkdown);
    fs.writeFileSync(path.join(temp.wiki, LOG), result.logMarkdown);
    assert.equal(logEntries(read(temp.wiki, LOG)) - entriesBefore, 1);

    const validation = runValidator(temp.wiki);
    assert.equal(validation.status, 0, validation.output);
  } finally {
    temp.cleanup();
  }
});

test('rejectDecisionHuman on fixture passes validator', () => {
  const temp = makeTempRepo();
  try {
    const result = rejectDecisionHuman({
      decisionMarkdown: read(temp.wiki, DECISION),
      logMarkdown: read(temp.wiki, LOG),
      person: 'Stefano',
      whereContext: 'chat 2026-11-10',
      dateIso: '2026-11-10',
    });

    assert.equal(parseFrontmatter(result.decisionMarkdown).fields.status, 'rejected');
    fs.writeFileSync(path.join(temp.wiki, DECISION), result.decisionMarkdown);
    fs.writeFileSync(path.join(temp.wiki, LOG), result.logMarkdown);

    const validation = runValidator(temp.wiki);
    assert.equal(validation.status, 0, validation.output);
  } finally {
    temp.cleanup();
  }
});

test('accepting an already accepted decision throws', () => {
  const temp = makeTempRepo();
  try {
    const accepted = acceptDecisionHuman({
      decisionMarkdown: read(temp.wiki, DECISION),
      logMarkdown: read(temp.wiki, LOG),
      person: 'Stefano',
      whereContext: 'riunione 2026-11-10',
      dateIso: '2026-11-10',
    });
    assert.throws(
      () =>
        acceptDecisionHuman({
          decisionMarkdown: accepted.decisionMarkdown,
          logMarkdown: accepted.logMarkdown,
          person: 'Stefano',
          whereContext: 'x',
          dateIso: '2026-11-11',
        }),
      /proposed/,
    );
  } finally {
    temp.cleanup();
  }
});
