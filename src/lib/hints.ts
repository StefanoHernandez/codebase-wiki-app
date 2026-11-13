// First-run guidance: which hints this person has already closed, and how often the app opened.
// Per Mac (localStorage), like the theme; losing it only shows the hints again.

export const HINTS_KEY = 'cw.hints';

export interface HintState {
  seen: string[];
  launches: number;
}

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function store(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readHints(s: Store | null = store()): HintState {
  try {
    const v = JSON.parse(s?.getItem(HINTS_KEY) ?? 'null');
    if (v && Array.isArray(v.seen)) return { seen: v.seen.filter((x: unknown) => typeof x === 'string'), launches: Number(v.launches) || 0 };
  } catch {
    /* unreadable: start over */
  }
  return { seen: [], launches: 0 };
}

function write(state: HintState, s: Store | null = store()) {
  try {
    s?.setItem(HINTS_KEY, JSON.stringify(state));
  } catch {
    /* not persisted: the hint may show again */
  }
}

/** Counts an app start. The first time ever, a person who already finished Getting started skips the welcome. */
export function countLaunch(alreadyUsed: boolean, s: Store | null = store()): HintState {
  const fresh = s?.getItem(HINTS_KEY) == null;
  const state = readHints(s);
  if (fresh && alreadyUsed) state.seen.push('welcome');
  state.launches += 1;
  write(state, s);
  return state;
}

export function markSeen(id: string, s: Store | null = store()): HintState {
  const state = readHints(s);
  if (!state.seen.includes(id)) state.seen.push(id);
  write(state, s);
  return state;
}

/** Settings → "Show hints again". Keeps the launch count. */
export function resetHints(s: Store | null = store()): HintState {
  const state = { seen: [], launches: readHints(s).launches };
  write(state, s);
  return state;
}

/** Sections with a tip at the top, the first time they open. */
export const TIP_SECTIONS = ['progetti', 'per-te', 'lavori', 'decisioni', 'handoff', 'salute', 'grafo', 'ricerca', 'impostazioni'] as const;

export interface Spotlight {
  id: 'sign' | 'connect' | 'palette';
  /** CSS selector of the element to ring; the first visible match counts. */
  selector: string;
  /** Section where it may show; null = any. */
  section: string | null;
  minLaunches: number;
}

/** In priority order; one shows at a time. */
export const SPOTLIGHTS: Spotlight[] = [
  { id: 'sign', selector: '.content .btn-human-outline:not([aria-disabled="true"])', section: null, minLaunches: 1 },
  { id: 'connect', selector: '[data-hint="connect"]', section: 'impostazioni', minLaunches: 1 },
  { id: 'palette', selector: '[data-hint="palette"]', section: null, minLaunches: 3 },
];

/**
 * Which hint to show now: the welcome first, then the section tip, then the spotlights still due here,
 * in priority order (the view shows the first whose target is on screen).
 */
export function nextHint(state: HintState, section: string): { kind: 'welcome' } | { kind: 'tip'; id: string } | { kind: 'spots'; spots: Spotlight[] } | null {
  const seen = new Set(state.seen);
  if (!seen.has('welcome')) return { kind: 'welcome' };
  const tip = `tip:${section}`;
  if ((TIP_SECTIONS as readonly string[]).includes(section) && !seen.has(tip)) return { kind: 'tip', id: tip };
  const spots = SPOTLIGHTS.filter((s) => !seen.has(`spot:${s.id}`) && (s.section === null || s.section === section) && state.launches >= s.minLaunches);
  return spots.length ? { kind: 'spots', spots } : null;
}
