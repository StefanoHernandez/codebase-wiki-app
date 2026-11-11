import assert from 'node:assert/strict';

/** Lines removed from `before` and added in `after`, by longest common subsequence (small docs only). */
export function lineDiff(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.replace(/^﻿/, '').split(/\r?\n/);
  const b = after.replace(/^﻿/, '').split(/\r?\n/);
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      removed.push(a[i++]!);
    } else {
      added.push(b[j++]!);
    }
  }
  while (i < a.length) removed.push(a[i++]!);
  while (j < b.length) added.push(b[j++]!);
  return { removed, added };
}

/** Every line not listed stays byte-identical and in order; EOL style and BOM are unchanged. */
export function assertOnlyChanged(before: string, after: string, removed: string[], added: (string | RegExp)[]) {
  const d = lineDiff(before, after);
  assert.deepEqual(d.removed, removed, 'removed lines');
  assert.equal(d.added.length, added.length, `added lines: ${JSON.stringify(d.added)}`);
  added.forEach((want, k) => {
    if (typeof want === 'string') assert.equal(d.added[k], want);
    else assert.match(d.added[k]!, want);
  });
  assert.equal(after.startsWith('﻿'), before.startsWith('﻿'), 'BOM');
  assert.equal(after.includes('\r\n'), before.includes('\r\n'), 'EOL');
  assert.equal(/\n$/.test(after), /\n$/.test(before), 'final newline');
}
