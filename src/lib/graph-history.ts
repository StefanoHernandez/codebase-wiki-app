import { matchesSource } from './graph-builder.ts';

/** One commit from `graph_history` (Rust `HistoryCommit`), repo-relative paths. */
export interface HistoryCommit {
  sha: string;
  date: string;
  subject: string;
  added: string[];
  modified: string[];
}

export interface GraphHistory {
  /** Oldest first. */
  commits: HistoryCommit[];
  /** Older commits were left out. */
  truncated: boolean;
}

export interface TimelineFrame {
  sha: string;
  date: string;
  subject: string;
  /** Node ids that appear in this frame. */
  born: Set<string>;
  /** Node ids already present and changed in this frame. */
  touched: Set<string>;
}

export interface Timeline {
  frames: TimelineFrame[];
  /** Frame index where each node appears. */
  birth: Map<string, number>;
}

interface TimelineNode {
  id: string;
  kind: 'wiki' | 'source';
  path: string;
}

/**
 * Frames of the graph's growth: one per commit that touches a node. A node is born at the
 * first commit touching its file (a source folder: any file inside it). Nodes git never saw
 * appear in the last frame, or in the first when older history was cut off.
 */
export function buildTimeline(history: GraphHistory, nodes: TimelineNode[], wikiRoot: string): Timeline {
  const root = wikiRoot.replace(/^\.\/?/, '').replace(/\/+$/, '');
  const repoPath = (n: TimelineNode) => (n.kind === 'wiki' && root ? `${root}/${n.path}` : n.path);
  const targets = nodes.map((n) => ({ id: n.id, path: repoPath(n) }));
  const hits = (files: string[]) => {
    const out = new Set<string>();
    for (const t of targets) if (files.some((f) => matchesSource(f, t.path))) out.add(t.id);
    return out;
  };

  const frames: TimelineFrame[] = [];
  const birth = new Map<string, number>();
  for (const c of history.commits) {
    const ids = hits([...c.added, ...c.modified]);
    if (ids.size === 0) continue;
    const frame: TimelineFrame = { sha: c.sha, date: c.date, subject: c.subject, born: new Set(), touched: new Set() };
    for (const id of ids) {
      if (birth.has(id)) frame.touched.add(id);
      else {
        birth.set(id, frames.length);
        frame.born.add(id);
      }
    }
    frames.push(frame);
  }
  if (frames.length > 0) {
    const fallback = history.truncated ? 0 : frames.length - 1;
    for (const n of nodes) {
      if (birth.has(n.id)) continue;
      birth.set(n.id, fallback);
      frames[fallback].born.add(n.id);
    }
  }
  return { frames, birth };
}

/** The graph as it was at `frame`: born nodes, and links whose two ends are born. */
export function visibleAt<N extends { id: string }, E extends { source: string; target: string }>(
  graph: { nodes: N[]; edges: E[] },
  birth: Map<string, number>,
  frame: number
): { nodes: N[]; edges: E[] } {
  const alive = (id: string) => (birth.get(id) ?? 0) <= frame;
  return {
    nodes: graph.nodes.filter((n) => alive(n.id)),
    edges: graph.edges.filter((e) => alive(e.source) && alive(e.target)),
  };
}
