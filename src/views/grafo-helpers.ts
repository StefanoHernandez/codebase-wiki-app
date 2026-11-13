import { t, type Key } from '../i18n/index.ts';
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

export const CATEGORIES: GraphNodeCategory[] = ['core', 'decision', 'tracker', 'agent', 'topic', 'source'];

export const categoryLabel = (c: GraphNodeCategory): string => t(`esplora.grafo.cat.${c}` as Key);

export function readCategoryColors(root: HTMLElement): Record<GraphNodeCategory, string> {
  const cs = getComputedStyle(root);
  return Object.fromEntries(
    CATEGORIES.map((c) => [c, cs.getPropertyValue(`--graph-cat-${c}`).trim()]),
  ) as Record<GraphNodeCategory, string>;
}

/** `#rrggbb` → `rgba(r,g,b,a)`; anything else is returned unchanged. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Node radius grows with the square root of its degree, capped so hubs do not swallow the view. */
export function nodeRadius(degree: number): number {
  return Math.min(3 + Math.sqrt(degree) * 1.1, 11);
}
