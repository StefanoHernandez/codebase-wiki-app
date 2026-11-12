// Primi passi: each step is read from the app's real state, never ticked by hand.

export type FirstRunStepId = 'nome' | 'progetto' | 'struttura' | 'ricerca' | 'agente';

export type FirstRunState = {
  /** A signing name is set and valid. */
  name: boolean;
  project: 'none' | 'no-wiki' | 'incompatible' | 'ok';
  /** The validator ran (ok) or failed to start, usually for Python (error). */
  lint: 'pending' | 'ok' | 'error';
  search: 'no-model' | 'no-index' | 'ok';
  /** At least one agent harness is connected. */
  agent: boolean;
};

export const FIRST_RUN_KEY = 'firstRun.done';

export function firstRunSteps(s: FirstRunState): {
  steps: { id: FirstRunStepId; done: boolean }[];
  current: FirstRunStepId | null;
  allDone: boolean;
} {
  const steps: { id: FirstRunStepId; done: boolean }[] = [
    { id: 'nome', done: s.name },
    { id: 'progetto', done: s.project === 'ok' },
    { id: 'struttura', done: s.lint === 'ok' },
    { id: 'ricerca', done: s.search === 'ok' },
    { id: 'agente', done: s.agent },
  ];
  const current = steps.find((x) => !x.done)?.id ?? null;
  return { steps, current, allDone: current === null };
}
