import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { markPageReviewed } from '../src/lib/human-actions.ts';
import { makeTempRepo, runValidator, read } from './helpers/fixture.ts';

const PAGE = 'agent/context.md';

function headCommit(repo: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
}

test('markPageReviewed on fixture page passes validator with one then two verified entries on one line', () => {
  const temp = makeTempRepo();
  try {
    const head = headCommit(temp.repo);
    const at = '2026-11-10T14:00:00Z';

    const page0 = read(temp.wiki, PAGE);
    const log0 = read(temp.wiki, 'log.md');
    const once = markPageReviewed({
      pageMarkdown: page0,
      logMarkdown: log0,
      person: 'Stefano',
      atIso: at,
      commit: head,
    });
    assert.match(
      once.pageMarkdown,
      new RegExp(
        `^verified: \\{ by: human:stefano, at: 2026-11-10T14:00:00Z, commit: ${head} \\}$`,
        'm',
      ),
    );
    assert.equal(once.pageMarkdown.match(/^verified:/gm)!.length, 1);

    fs.writeFileSync(path.join(temp.wiki, PAGE), once.pageMarkdown);
    fs.writeFileSync(path.join(temp.wiki, 'log.md'), once.logMarkdown);
    let result = runValidator(temp.wiki);
    assert.equal(result.status, 0, result.output);

    const twice = markPageReviewed({
      pageMarkdown: once.pageMarkdown,
      logMarkdown: once.logMarkdown,
      person: 'Stefano',
      atIso: '2026-11-11T10:00:00.000Z',
      commit: head,
    });
    assert.match(twice.pageMarkdown, /^verified: \[\{/m);
    assert.match(twice.pageMarkdown, /^verified: \[\{[^\n]*\}, \{[^\n]*\}\]$/m);
    assert.match(twice.pageMarkdown, new RegExp(`commit: ${head}`));
    assert.doesNotMatch(twice.pageMarkdown, /at: 2026-11-11T10:00:00\.000Z/);
    assert.match(twice.pageMarkdown, /at: 2026-11-11T10:00:00Z/);
    assert.equal(twice.pageMarkdown.match(/^verified:/gm)!.length, 1);

    fs.writeFileSync(path.join(temp.wiki, PAGE), twice.pageMarkdown);
    fs.writeFileSync(path.join(temp.wiki, 'log.md'), twice.logMarkdown);
    result = runValidator(temp.wiki);
    assert.equal(result.status, 0, result.output);
  } finally {
    temp.cleanup();
  }
});
