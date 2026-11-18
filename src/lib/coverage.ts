import { matchesSource } from './graph-builder.ts';
import type { WikiGraph } from '../types/wiki.ts';

export interface FileCoverage {
  path: string;
  /** Wiki pages (relative paths) whose `sources` include this file. */
  pages: string[];
  /** Some describing page is in drift because of this file. */
  drift: boolean;
}

export interface ModuleCoverage {
  dir: string;
  files: FileCoverage[];
  /** Described and not in drift. */
  verified: number;
  drifted: number;
  uncovered: number;
}

/** Module of a file: its first two directories (`src/views`), its folder, or `.` at the root. */
export function moduleOf(path: string): string {
  const parts = path.split('/');
  if (parts.length <= 1) return '.';
  return parts.slice(0, Math.min(2, parts.length - 1)).join('/');
}

/**
 * How well the wiki describes the code: each repository file is described (by pages whose
 * `sources` match it), in drift (a describing page lists it as changed), or not described.
 * Files inside the wiki root are left out. Modules come back with the most undescribed files first.
 */
export function computeCoverage(repoFiles: string[], graph: WikiGraph, wikiRoot: string): ModuleCoverage[] {
  const root = wikiRoot.replace(/\/+$/, '');
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  // source path → pages that cite it
  const citing = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.kind !== 'source-link') continue;
    const page = byId.get(e.source);
    const src = byId.get(e.target);
    if (page?.kind !== 'wiki' || src?.kind !== 'source') continue;
    if (!citing.has(src.path)) citing.set(src.path, new Set());
    citing.get(src.path)!.add(page.path);
  }
  const driftByPage = new Map(
    graph.nodes.filter((n) => n.kind === 'wiki').map((n) => [n.path, new Set(n.driftFiles)]),
  );

  const modules = new Map<string, ModuleCoverage>();
  for (const path of repoFiles) {
    if (root && (path === root || path.startsWith(root + '/'))) continue;
    if (path.split('/').includes('.private-terms')) continue;
    const pages = new Set<string>();
    for (const [src, cited] of citing) {
      if (matchesSource(path, src)) for (const p of cited) pages.add(p);
    }
    const drift = [...pages].some((p) => driftByPage.get(p)?.has(path));
    const dir = moduleOf(path);
    let m = modules.get(dir);
    if (!m) modules.set(dir, (m = { dir, files: [], verified: 0, drifted: 0, uncovered: 0 }));
    m.files.push({ path, pages: [...pages].sort(), drift });
    if (pages.size === 0) m.uncovered += 1;
    else if (drift) m.drifted += 1;
    else m.verified += 1;
  }
  return [...modules.values()].sort(
    (a, b) => b.uncovered - a.uncovered || b.drifted - a.drifted || a.dir.localeCompare(b.dir),
  );
}
