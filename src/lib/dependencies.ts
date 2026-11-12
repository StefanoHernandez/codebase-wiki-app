import type { TrackerData } from '../types/wiki.ts';

/** `unknown`: waited-for IDs that are in neither Open nor Done (the validator reports them). */
export type Readiness = { ready: boolean; waitingOn: string[]; external: string[]; unknown: string[] };

/** Per open task: IDs not yet in Done (unknown IDs included) and external conditions still listed. */
export function taskReadiness(tracker: TrackerData): Map<string, Readiness> {
  const done = new Set(tracker.done.map((r) => r.id));
  const open = new Set(tracker.open.map((r) => r.id));
  const out = new Map<string, Readiness>();
  for (const row of tracker.open) {
    const ids = row.dependsOn?.ids ?? [];
    const external = row.dependsOn?.external ?? [];
    const waitingOn = ids.filter((id) => !done.has(id));
    out.set(row.id, {
      ready: waitingOn.length === 0 && external.length === 0,
      waitingOn,
      external,
      unknown: waitingOn.filter((id) => !open.has(id)),
    });
  }
  return out;
}
