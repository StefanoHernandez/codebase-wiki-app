import type { GraphEdge, GraphNode, GraphNodeCategory } from '../types/wiki';
import { withAlpha } from './grafo-helpers';

export interface NodePosition {
  x2: number;
  y2: number;
}

export interface ThemePalette {
  ink: string;
  muted: string;
  faint: string;
  ground: string;
  surface: string;
  surfaceRaised: string;
  rule: string;
  ruleStrong: string;
  human: string;
  drift: string;
  error: string;
  glass: string;
  isDark: boolean;
}

export interface LabelCandidate {
  id: string;
  text: string;
  sx: number;
  sy: number;
  r: number;
  priority: number;
  accent?: boolean;
  muted?: boolean;
}

function hashStr(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const SHELL_RADII: Record<GraphNodeCategory, [number, number]> = {
  core: [22, 68],
  agent: [86, 140],
  decision: [104, 164],
  tracker: [110, 170],
  topic: [132, 204],
  source: [195, 275],
};

/**
 * Deterministic 2D radial + force-relaxed layout for arbitrary repository graphs.
 * Core pages sit near the center; connected nodes pull together while nearby nodes repel.
 */
export function computeGraphLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Map<string, NodePosition> {
  const out = new Map<string, NodePosition>();
  if (nodes.length === 0) return out;

  const grouped = new Map<GraphNodeCategory, GraphNode[]>();
  for (const n of nodes) {
    const arr = grouped.get(n.category) ?? [];
    arr.push(n);
    grouped.set(n.category, arr);
  }

  const pos = new Map<string, [number, number]>();
  for (const [cat, list] of grouped) {
    const sorted = [...list].sort((a, b) => a.id.localeCompare(b.id));
    const [rMin, rMax] = SHELL_RADII[cat];
    const count = sorted.length;
    sorted.forEach((n, idx) => {
      const jitter = hashStr(n.id);
      const angle = (idx / Math.max(1, count)) * Math.PI * 2 + jitter * 0.45;
      const radius = rMin + (rMax - rMin) * (0.3 + 0.7 * jitter);
      pos.set(n.id, [Math.cos(angle) * radius, Math.sin(angle) * radius]);
    });
  }

  const nodeIds = nodes.map((n) => n.id);
  const iters = nodes.length <= 400 ? 32 : 12;
  for (let it = 0; it < iters; it++) {
    for (const e of edges) {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      if (!a || !b) continue;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const dist = Math.hypot(dx, dy) || 1;
      const targetDist = e.kind === 'source-link' ? 76 : 62;
      const pull = ((dist - targetDist) / dist) * 0.065;
      a[0] += dx * pull;
      a[1] += dy * pull;
      b[0] -= dx * pull;
      b[1] -= dy * pull;
    }

    if (nodeIds.length <= 280) {
      for (let i = 0; i < nodeIds.length; i++) {
        const a = pos.get(nodeIds[i])!;
        for (let j = i + 1; j < nodeIds.length; j++) {
          const b = pos.get(nodeIds[j])!;
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const d2 = dx * dx + dy * dy;
          if (d2 > 0 && d2 < 960) {
            const d = Math.sqrt(d2);
            const push = ((31 - d) / d) * 0.22;
            a[0] -= dx * push;
            a[1] -= dy * push;
            b[0] += dx * push;
            b[1] += dy * push;
          }
        }
      }
    }
  }

  for (const n of nodes) {
    const p = pos.get(n.id) ?? [0, 0];
    out.set(n.id, { x2: p[0], y2: p[1] });
  }
  return out;
}

export function readThemePalette(el: Element): ThemePalette {
  const cs = getComputedStyle(el);
  const read = (v: string, fb: string) => cs.getPropertyValue(v).trim() || fb;
  const darkAttr = document.documentElement.getAttribute('data-theme');
  const isDark =
    darkAttr === 'dark' ||
    (darkAttr !== 'light' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  return {
    ink: read('--ink', isDark ? '#f1f2f5' : '#111216'),
    muted: read('--ink-muted', isDark ? '#9da2b0' : '#505562'),
    faint: read('--ink-faint', isDark ? '#727888' : '#6b7180'),
    ground: read('--ground', isDark ? '#090a0c' : '#f6f6f7'),
    surface: read('--surface', isDark ? '#111216' : '#ffffff'),
    surfaceRaised: read('--surface-raised', isDark ? '#17191f' : '#ffffff'),
    rule: read('--rule', isDark ? '#22252e' : '#e0e2e7'),
    ruleStrong: read('--rule-strong', isDark ? '#343947' : '#c4c8d1'),
    human: read('--human', isDark ? '#6e8eff' : '#3452dd'),
    drift: read('--drift', isDark ? '#e8a838' : '#b45309'),
    error: read('--error', isDark ? '#ef6461' : '#c53030'),
    glass: read('--glass', isDark ? 'rgba(17,18,22,0.86)' : 'rgba(255,255,255,0.90)'),
    isDark,
  };
}

export type NodeShape = 'target' | 'disc' | 'triangle' | 'ring' | 'diamond' | 'square';

/** Graph category → node shape: the graph tells types apart by shape, not by colour. */
export const CATEGORY_SHAPE: Record<GraphNodeCategory, NodeShape> = {
  core: 'target',
  topic: 'disc',
  agent: 'triangle',
  decision: 'ring',
  tracker: 'diamond',
  source: 'square',
};

/** Flat graph node: one solid colour, no gradient or glow; a status ring outside when given. */
export function drawFlatNode(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  r: number,
  shape: NodeShape,
  color: string,
  palette: ThemePalette,
  statusRing?: { color: string; dashed?: boolean },
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  if (shape === 'square') {
    const s = r * 1.6;
    ctx.roundRect(sx - s / 2, sy - s / 2, s, s, 1.5);
  } else if (shape === 'triangle') {
    const t = r * 1.3;
    ctx.moveTo(sx, sy - t);
    ctx.lineTo(sx + t * 0.87, sy + t * 0.5);
    ctx.lineTo(sx - t * 0.87, sy + t * 0.5);
    ctx.closePath();
  } else if (shape === 'diamond') {
    const d = r * 1.25;
    ctx.moveTo(sx, sy - d);
    ctx.lineTo(sx + d, sy);
    ctx.lineTo(sx, sy + d);
    ctx.lineTo(sx - d, sy);
    ctx.closePath();
  } else {
    ctx.arc(sx, sy, shape === 'ring' ? r - 0.75 : r, 0, Math.PI * 2);
  }
  if (shape === 'ring') {
    ctx.fillStyle = palette.ground;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
  }
  // Core pages: a disc with a thin outer ring, so they never read as a plain topic.
  if (shape === 'target') {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, r + 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (statusRing) {
    ctx.strokeStyle = withAlpha(statusRing.color, 0.8);
    ctx.lineWidth = 1;
    if (statusRing.dashed) ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(sx, sy, r + (shape === 'target' ? 5 : 2.5), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

export function drawLabelsNoOverlap(
  ctx: CanvasRenderingContext2D,
  candidates: LabelCandidate[],
  width: number,
  height: number,
  palette: ThemePalette,
  minLeft = 8,
): void {
  if (candidates.length === 0) return;
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority);
  const placed: Array<[number, number, number, number]> = [];
  ctx.save();
  ctx.font = '500 11px "IBM Plex Sans", system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  for (const c of sorted) {
    const label = c.text.length > 26 ? `${c.text.slice(0, 24)}…` : c.text;
    const tw = ctx.measureText(label).width;
    const pw = tw + 12;
    const ph = 19;
    const px = Math.round(c.sx - pw / 2);
    const py = Math.round(c.sy + c.r + 7);
    if (px < minLeft || px + pw > width - 8 || py < 56 || py + ph > height - 54) continue;

    const overlaps = placed.some(
      ([x1, y1, x2, y2]) => !(px + pw + 6 < x1 || px - 6 > x2 || py + ph + 4 < y1 || py - 4 > y2),
    );
    if (overlaps) continue;
    placed.push([px, py, px + pw, py + ph]);

    ctx.fillStyle = palette.glass;
    ctx.strokeStyle = c.accent ? palette.human : palette.ruleStrong;
    ctx.lineWidth = c.accent ? 1.2 : 1;
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = c.muted ? palette.muted : palette.ink;
    ctx.fillText(label, px + 6, py + ph / 2 + 0.5);
  }
  ctx.restore();
}
