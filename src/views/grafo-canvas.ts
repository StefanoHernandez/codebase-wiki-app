import type { GraphNodeCategory } from '../types/wiki';
import { withAlpha } from './grafo-helpers';

export {
  computeGraphLayout,
  computeViewport,
  GraphSimulation,
  screenToWorld,
  worldToScreen,
  type GraphViewport,
  type NodePosition,
} from '../lib/graph-physics';

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
    const pw = tw + 10;
    const ph = 18;
    const px = Math.round(c.sx - pw / 2);
    const py = Math.round(c.sy + c.r + 6);
    if (px < minLeft || px + pw > width - 8 || py < 56 || py + ph > height - 54) continue;

    const overlaps = placed.some(
      ([x1, y1, x2, y2]) => !(px + pw + 5 < x1 || px - 5 > x2 || py + ph + 3 < y1 || py - 3 > y2),
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
    ctx.fillText(label, px + 5, py + ph / 2 + 0.5);
  }
  ctx.restore();
}
