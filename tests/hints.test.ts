import test from 'node:test';
import assert from 'node:assert/strict';
import { countLaunch, HINTS_KEY, markSeen, nextHint, readHints, resetHints } from '../src/lib/hints.ts';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

test('new person: welcome, then the section tip, then the sign spotlight', () => {
  const s = mem();
  let st = countLaunch(false, s);
  assert.deepEqual(nextHint(st, 'lavori'), { kind: 'welcome' });
  st = markSeen('welcome', s);
  assert.deepEqual(nextHint(st, 'lavori'), { kind: 'tip', id: 'tip:lavori' });
  st = markSeen('tip:lavori', s);
  const h = nextHint(st, 'lavori');
  assert.deepEqual(h?.kind === 'spots' && h.spots.map((s) => s.id), ['sign']);
  st = markSeen('spot:sign', s);
  assert.equal(nextHint(st, 'lavori'), null, 'palette waits for the third launch');
});

test('a person who already used the app skips the welcome, not the tips', () => {
  const s = mem();
  const st = countLaunch(true, s);
  assert.deepEqual(nextHint(st, 'grafo'), { kind: 'tip', id: 'tip:grafo' });
});

test('palette spotlight from the third launch; connect only in Settings', () => {
  const s = mem();
  countLaunch(false, s);
  countLaunch(false, s);
  for (const id of ['welcome', 'tip:grafo', 'tip:impostazioni', 'spot:sign']) markSeen(id, s);
  assert.equal(nextHint(readHints(s), 'grafo'), null);
  let st = countLaunch(false, s);
  assert.equal(st.launches, 3);
  const g = nextHint(st, 'grafo');
  assert.deepEqual(g?.kind === 'spots' && g.spots.map((s) => s.id), ['palette']);
  const i = nextHint(st, 'impostazioni');
  assert.deepEqual(i?.kind === 'spots' && i.spots.map((s) => s.id), ['connect', 'palette']);
  st = markSeen('spot:connect', s);
});

test('primi-passi has no tip; reset brings everything back, keeps launches', () => {
  const s = mem();
  countLaunch(false, s);
  markSeen('welcome', s);
  const st = readHints(s);
  assert.notEqual(nextHint(st, 'primi-passi')?.kind, 'tip');
  const r = resetHints(s);
  assert.deepEqual(r, { seen: [], launches: 1 });
  assert.deepEqual(nextHint(r, 'lavori'), { kind: 'welcome' });
});

test('unreadable storage starts over', () => {
  const s = mem();
  s.m.set(HINTS_KEY, '{oops');
  assert.deepEqual(readHints(s), { seen: [], launches: 0 });
});
