import type { GraphEdge, GraphNodeCategory } from '../types/wiki';

export const LABEL_ZOOM_THRESHOLD = 2.2;

export type DiffLineKind = 'add' | 'del' | 'hunk' | 'ctx';

export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith('+++') || line.startsWith('---')) return 'ctx';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}

export function neighborIds(nodeId: string, edges: GraphEdge[]): Set<string> {
  const out = new Set<string>([nodeId]);
  for (const e of edges) {
    if (e.source === nodeId) out.add(e.target);
    if (e.target === nodeId) out.add(e.source);
  }
  return out;
}

const CATEGORIES: GraphNodeCategory[] = ['core', 'decision', 'tracker', 'agent', 'topic', 'source'];

export function readCategoryColors(root: HTMLElement): Record<GraphNodeCategory, string> {
  const cs = getComputedStyle(root);
  return {
    core: cs.getPropertyValue('--graph-cat-core').trim(),
    decision: cs.getPropertyValue('--graph-cat-decision').trim(),
    tracker: cs.getPropertyValue('--graph-cat-tracker').trim(),
    agent: cs.getPropertyValue('--graph-cat-agent').trim(),
    topic: cs.getPropertyValue('--graph-cat-topic').trim(),
    source: cs.getPropertyValue('--graph-cat-source').trim(),
  };
}
