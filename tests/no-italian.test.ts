import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// UI text lives in src/i18n. A string elsewhere with Italian accents or common Italian UI words
// was missed by the move. Comments are ignored.
const ROOT = join(import.meta.dirname, '..', 'src');
const SKIP_DIRS = new Set(['i18n']);
// Italian on purpose: plugin vocabulary mapped in labels.ts.
const SKIP_FILES = new Set(['lib/labels.ts']);
const WORDS = /\b(Apri|Nessun|Nessuna|Chiudi|Salva|Annulla|Copia|Rivedi|Impossibile|della|delle|degli|nella|questo|questa)\b/;
const STRING = /(['"`])(?:\\.|(?!\1).)*\1|>[^<>{}]+</g;

function files(dir: string, rel = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(path).isDirectory()) return SKIP_DIRS.has(name) ? [] : files(path, r);
    return /\.(ts|tsx)$/.test(name) && !SKIP_FILES.has(r) ? [r] : [];
  });
}

test('no Italian UI text outside src/i18n', () => {
  const hits: string[] = [];
  for (const rel of files(ROOT)) {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/^\s*(\*|\/\*)/.test(code)) return;
      for (const m of code.match(STRING) ?? []) {
        if (/[àèéìòù]/.test(m) || WORDS.test(m)) hits.push(`${rel}:${i + 1}: ${m.slice(0, 70)}`);
      }
    });
  }
  assert.deepEqual(hits, [], `Italian left outside src/i18n:\n${hits.join('\n')}`);
});
