import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTrackerMarkdown } from '../src/lib/markdown-tables.ts';
import { promoteProposalToOpen, closeTrackerItemHumanUnproven } from '../src/lib/human-actions.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'wiki-v2');
const VALIDATOR = path.join(ROOT, 'resources', 'validate-wiki.py');

// Source files the fixture pages cite. The validator requires them to exist in the repository.
const FIXTURE_SOURCES: Record<string, string> = {
  'README.md': '# Fixture repository\n',
  'package.json': '{ "name": "fixture" }\n',
  'src/parser.ts': 'export const parse = () => null;\n',
  'tests/parsers.test.ts': '// fixture\n',
};

/** Copies the fixture to `<tmp>/repo/wiki` inside a fresh git repository. Never touches a real wiki. */
function makeTempRepo(): { repo: string; wiki: string; cleanup: () => void } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-fixture-'));
  const repo = path.join(tmp, 'repo');
  const wiki = path.join(repo, 'wiki');
  fs.cpSync(FIXTURE, wiki, { recursive: true });
  for (const [rel, content] of Object.entries(FIXTURE_SOURCES)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), content);
  }
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync(
    'git',
    ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-q', '-m', 'fixture'],
    { cwd: repo },
  );
  return { repo, wiki, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

function runValidator(wiki: string) {
  const result = spawnSync('python3', [VALIDATOR, wiki], { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const read = (wiki: string, rel: string) => fs.readFileSync(path.join(wiki, rel), 'utf8');
const logEntries = (log: string) => log.split('\n').filter((l) => l.startsWith('## ')).length;

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
      proposalIndex: 0,
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
  } finally {
    temp.cleanup();
  }
});
