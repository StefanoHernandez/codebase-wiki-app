import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Shared by every fixture test. Each test imports these instead of copying them.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'wiki-v2');
const VALIDATOR = path.join(ROOT, 'resources', 'validate-wiki.py');

const PYTHON_CANDIDATES = ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3'] as const;

const PYTHON_NOT_FOUND_MSG =
  'Il validatore wiki richiede Python 3.10 o più recente. Imposta PYTHON sul binario giusto oppure installa python3.10+ (es. brew install python).';

// Source files the fixture pages cite. The validator requires them to exist in the repository.
const FIXTURE_SOURCES: Record<string, string> = {
  'README.md': '# Fixture repository\n',
  'package.json': '{ "name": "fixture" }\n',
  'src/parser.ts': 'export const parse = () => null;\n',
  'tests/parsers.test.ts': '// fixture\n',
};

function pythonVersionAt(exe: string): { major: number; minor: number } | null {
  const result = spawnSync(exe, [
    '-c',
    'import sys; print(sys.version_info[0], sys.version_info[1])',
  ], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const line = (result.stdout ?? '').trim().split(/\s+/);
  if (line.length < 2) return null;
  const major = Number(line[0]);
  const minor = Number(line[1]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
  return { major, minor };
}

function pythonMeetsMinimum(major: number, minor: number): boolean {
  return major > 3 || (major === 3 && minor >= 10);
}

function executableOnPath(name: string): string | null {
  const pathEnv = process.env.PATH ?? '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const plain = path.join(dir, name);
    if (fs.existsSync(plain) && fs.statSync(plain).isFile()) return plain;
  }
  return null;
}

/** Picks PYTHON from the env, else the first python3.x on PATH with version ≥ 3.10. */
export function resolvePythonForValidator(): string {
  const fromEnv = process.env.PYTHON?.trim();
  if (fromEnv) return fromEnv;

  for (const name of PYTHON_CANDIDATES) {
    const exe = executableOnPath(name);
    if (!exe) continue;
    const version = pythonVersionAt(exe);
    if (version && pythonMeetsMinimum(version.major, version.minor)) {
      return exe;
    }
  }

  throw new Error(PYTHON_NOT_FOUND_MSG);
}

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
  const python = resolvePythonForValidator();
  const result = spawnSync(python, [VALIDATOR, wiki], { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

export const read = (wiki: string, rel: string) => fs.readFileSync(path.join(wiki, rel), 'utf8');
export const logEntries = (log: string) => log.split('\n').filter((l) => l.startsWith('## ')).length;
