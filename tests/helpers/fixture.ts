import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Shared by every fixture test. Each test file imports these instead of copying them.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
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
export function makeTempRepo(): { repo: string; wiki: string; cleanup: () => void } {
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

export function runValidator(wiki: string) {
  const result = spawnSync('python3', [VALIDATOR, wiki], { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

export const read = (wiki: string, rel: string) => fs.readFileSync(path.join(wiki, rel), 'utf8');
export const logEntries = (log: string) => log.split('\n').filter((l) => l.startsWith('## ')).length;
