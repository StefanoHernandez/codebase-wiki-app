import type { GraphEdge, GraphNode, GraphNodeCategory } from '../types/wiki';

export interface NodePosition {
  x2: number;
  y2: number;
}

export interface SimNode {
  id: string;
  category: GraphNodeCategory;
  degree: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
  fx: number;
  fy: number;
}

export interface GraphViewport {
  width: number;
  height: number;
  leftInset: number;
  rightInset: number;
  cx: number;
  cy: number;
  baseScale: number;
}

interface SimEdge {
  a: number;
  b: number;
  restLength: number;
  strength: number;
  bias: number;
}

const ALPHA_MIN = 0.004;
const CHARGE_STRENGTH = 9500;
const MIN_DIST_SQ = 28 * 28; // 784
const MAX_DIST = 620;
const MAX_DIST_SQ = MAX_DIST * MAX_DIST; // 384400
const VELOCITY_DECAY = 0.72;
const MAX_SPEED = 65;

const SHELL_RADII: Record<GraphNodeCategory, [number, number]> = {
  core: [0, 95],
  agent: [155, 255],
  decision: [185, 295],
  tracker: [195, 310],
  topic: [230, 365],
  source: [340, 500],
};

function hashStr(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Shared viewport transform used by rendering, hit-testing, node dragging, zooming, and fitting. */
export function computeViewport(
  width: number,
  height: number,
  explorerOpen: boolean,
  drawerOpen: boolean,
  panX: number,
  panY: number,
  zoom: number,
): GraphViewport {
  const leftInset = explorerOpen && width >= 721 ? 244 : 0;
  const rightInset = drawerOpen && width >= 721 ? Math.min(420, width * 0.92) : 0;
  const cx = leftInset + (width - leftInset - rightInset) / 2 + panX;
  const cy = height / 2 + panY;
  const minDim = Math.max(240, Math.min(width - leftInset - rightInset * 0.35, height));
  const baseScale = (minDim / 780) * zoom;
  return { width, height, leftInset, rightInset, cx, cy, baseScale };
}

export function worldToScreen(
  wx: number,
  wy: number,
  vp: GraphViewport,
): { sx: number; sy: number } {
  return {
    sx: vp.cx + wx * vp.baseScale,
    sy: vp.cy + wy * vp.baseScale,
  };
}

export function screenToWorld(
  sx: number,
  sy: number,
  vp: GraphViewport,
): { wx: number; wy: number } {
  const scale = vp.baseScale || 1e-6;
  return {
    wx: (sx - vp.cx) / scale,
    wy: (sy - vp.cy) / scale,
  };
}

/**
 * Interactive 2D force-directed physics simulation.
 * Runs synchronously on initial load (`warmUp`) for a wide Obsidian-like layout,
 * then wakes on-demand when a user drags a node so connected branches follow smoothly.
 */
export class GraphSimulation {
  private readonly nodes: SimNode[] = [];
  private readonly indexById = new Map<string, number>();
  private readonly edges: SimEdge[] = [];
  private alpha = 0;
  private pinnedCount = 0;
  private interactive = false;

  constructor(nodes: GraphNode[], edges: GraphEdge[]) {
    if (nodes.length === 0) return;

    // Identify the primary core hub so it anchors cleanly near the center.
    let topCoreId: string | null = null;
    let topCoreDeg = -1;
    for (const n of nodes) {
      if (n.category === 'core' && n.degree > topCoreDeg) {
        topCoreDeg = n.degree;
        topCoreId = n.id;
      }
    }

    const grouped = new Map<GraphNodeCategory, GraphNode[]>();
    for (const n of nodes) {
      const arr = grouped.get(n.category) ?? [];
      arr.push(n);
      grouped.set(n.category, arr);
    }

    const seededPos = new Map<string, [number, number]>();
    for (const [cat, list] of grouped) {
      const sorted = [...list].sort((a, b) => a.id.localeCompare(b.id));
      const [rMin, rMax] = SHELL_RADII[cat];
      const count = sorted.length;
      sorted.forEach((n, idx) => {
        if (n.id === topCoreId) {
          seededPos.set(n.id, [0, 0]);
          return;
        }
        const jitter = hashStr(n.id);
        const angle = (idx / Math.max(1, count)) * Math.PI * 2 + jitter * 0.45;
        const radius = rMin + (rMax - rMin) * (0.28 + 0.72 * jitter);
        seededPos.set(n.id, [Math.cos(angle) * radius, Math.sin(angle) * radius]);
      });
    }

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const [x, y] = seededPos.get(n.id) ?? [0, 0];
      this.indexById.set(n.id, i);
      this.nodes.push({
        id: n.id,
        category: n.category,
        degree: Math.max(1, n.degree),
        x,
        y,
        vx: 0,
        vy: 0,
        pinned: false,
        fx: x,
        fy: y,
      });
    }

    for (const e of edges) {
      const a = this.indexById.get(e.source);
      const b = this.indexById.get(e.target);
      if (a === undefined || b === undefined || a === b) continue;
      const degA = this.nodes[a].degree;
      const degB = this.nodes[b].degree;
      const total = degA + degB;
      const bias = total > 0 ? degA / total : 0.5;
      this.edges.push({
        a,
        b,
        restLength: e.kind === 'source-link' ? 175 : 150,
        strength: e.kind === 'source-link' ? 0.20 : 0.24,
        bias,
      });
    }

    this.warmUp(140);
    this.interactive = true;
  }

  private applyRepulsionPair(i: number, j: number, alpha: number): void {
    const a = this.nodes[i];
    const b = this.nodes[j];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let d2 = dx * dx + dy * dy;

    if (d2 === 0) {
      const angle = ((i * 73 + j * 139) % 360) * (Math.PI / 180);
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      d2 = 1;
    }
    if (d2 >= MAX_DIST_SQ) return;

    const effD2 = Math.max(d2, MIN_DIST_SQ);
    const d = Math.sqrt(effD2);
    let force = (CHARGE_STRENGTH * alpha) / effD2;

    if (d2 < 46 * 46) {
      const realD = Math.sqrt(d2);
      force += ((46 - realD) / 46) * 1.45 * alpha;
    }

    const fx = (dx / d) * force;
    const fy = (dy / d) * force;

    if (!a.pinned) {
      a.vx -= fx;
      a.vy -= fy;
    }
    if (!b.pinned) {
      b.vx += fx;
      b.vy += fy;
    }
  }

  private tick(coolingFactor: number): void {
    const nCount = this.nodes.length;
    if (nCount === 0) return;

    if (this.pinnedCount > 0) {
      this.alpha = Math.max(this.alpha, 0.52);
    }
    const alpha = this.alpha;
    if (alpha <= ALPHA_MIN && this.pinnedCount === 0) {
      this.alpha = 0;
      return;
    }

    // 1. Link spring forces with degree-weighted bias so dragging a node pulls its branch along.
    for (let k = 0; k < this.edges.length; k++) {
      const edge = this.edges[k];
      const a = this.nodes[edge.a];
      const b = this.nodes[edge.b];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      if (dist < 1e-4) {
        dx = 1;
        dy = 0;
        dist = 1;
      }

      const pinBoost = a.pinned || b.pinned ? 1.75 : 1;
      const disp = ((dist - edge.restLength) / dist) * edge.strength * alpha * pinBoost;
      const fx = dx * disp;
      const fy = dy * disp;

      const weightB = a.pinned ? Math.max(edge.bias, 0.38) : edge.bias;
      const weightA = b.pinned ? Math.max(1 - edge.bias, 0.38) : 1 - edge.bias;

      if (!a.pinned) {
        a.vx += fx * weightA;
        a.vy += fy * weightA;
      }
      if (!b.pinned) {
        b.vx -= fx * weightB;
        b.vy -= fy * weightB;
      }
    }

    // 2. Many-body repulsion to spread the graph cleanly.
    if (nCount <= 450) {
      for (let i = 0; i < nCount; i++) {
        for (let j = i + 1; j < nCount; j++) {
          this.applyRepulsionPair(i, j, alpha);
        }
      }
    } else {
      const cellSize = 220;
      const grid = new Map<string, number[]>();
      const cells: Array<[number, number]> = new Array(nCount);
      for (let i = 0; i < nCount; i++) {
        const node = this.nodes[i];
        const cx = Math.floor(node.x / cellSize);
        const cy = Math.floor(node.y / cellSize);
        cells[i] = [cx, cy];
        const key = `${cx},${cy}`;
        let bucket = grid.get(key);
        if (!bucket) {
          bucket = [];
          grid.set(key, bucket);
        }
        bucket.push(i);
      }

      for (let i = 0; i < nCount; i++) {
        const [cx, cy] = cells[i];
        for (let dcx = -1; dcx <= 1; dcx++) {
          for (let dcy = -1; dcy <= 1; dcy++) {
            const bucket = grid.get(`${cx + dcx},${cy + dcy}`);
            if (!bucket) continue;
            for (let m = 0; m < bucket.length; m++) {
              const j = bucket[m];
              if (j > i) this.applyRepulsionPair(i, j, alpha);
            }
          }
        }
      }
    }

    // 3. Gentle center gravity (kept minimal during interactive drag so placed branches stay put).
    const baseGravity = this.interactive ? 0.004 : 0.012;
    for (let i = 0; i < nCount; i++) {
      const node = this.nodes[i];
      if (node.pinned) continue;
      const g = (!this.interactive && node.category === 'core' ? 0.022 : baseGravity) * alpha;
      node.vx -= node.x * g;
      node.vy -= node.y * g;
    }

    // 4. Integrate velocities with damping and speed cap.
    for (let i = 0; i < nCount; i++) {
      const node = this.nodes[i];
      if (node.pinned) {
        node.x = node.fx;
        node.y = node.fy;
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx *= VELOCITY_DECAY;
      node.vy *= VELOCITY_DECAY;
      const speed = Math.hypot(node.vx, node.vy);
      if (speed > MAX_SPEED) {
        const scale = MAX_SPEED / speed;
        node.vx *= scale;
        node.vy *= scale;
      }
      node.x += node.vx;
      node.y += node.vy;
    }

    if (this.pinnedCount === 0) {
      this.alpha *= coolingFactor;
      if (this.alpha <= ALPHA_MIN) {
        this.alpha = 0;
        for (let i = 0; i < nCount; i++) {
          this.nodes[i].vx = 0;
          this.nodes[i].vy = 0;
        }
      }
    }
  }

  /** Synchronously settles the initial layout and zeroes velocities. */
  warmUp(ticks = 140): void {
    if (this.nodes.length === 0) return;
    this.alpha = 1;
    for (let t = 0; t < ticks && this.alpha > ALPHA_MIN; t++) {
      this.tick(0.972);
    }
    this.alpha = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      this.nodes[i].vx = 0;
      this.nodes[i].vy = 0;
    }
  }

  pinNode(id: string, wx: number, wy: number): void {
    const idx = this.indexById.get(id);
    if (idx === undefined) return;
    const node = this.nodes[idx];
    if (!node.pinned) {
      node.pinned = true;
      this.pinnedCount++;
    }
    node.fx = wx;
    node.fy = wy;
    node.x = wx;
    node.y = wy;
    node.vx = 0;
    node.vy = 0;
    this.alpha = Math.max(this.alpha, 0.52);
  }

  movePinnedNode(id: string, wx: number, wy: number): void {
    const idx = this.indexById.get(id);
    if (idx === undefined) return;
    const node = this.nodes[idx];
    if (!node.pinned) {
      this.pinNode(id, wx, wy);
      return;
    }
    node.fx = wx;
    node.fy = wy;
    node.x = wx;
    node.y = wy;
    node.vx = 0;
    node.vy = 0;
    this.alpha = Math.max(this.alpha, 0.52);
  }

  unpinNode(id: string): void {
    const idx = this.indexById.get(id);
    if (idx === undefined) return;
    const node = this.nodes[idx];
    if (!node.pinned) return;
    node.pinned = false;
    this.pinnedCount = Math.max(0, this.pinnedCount - 1);
    this.alpha = Math.max(this.alpha, 0.28);
  }

  /** Synchronous short settle used when `prefers-reduced-motion` disables animated frames. */
  settleNow(maxTicks = 24): void {
    for (let t = 0; t < maxTicks && this.isActive(); t++) {
      this.tick(0.9);
    }
    if (this.pinnedCount === 0) {
      this.alpha = 0;
      for (let i = 0; i < this.nodes.length; i++) {
        this.nodes[i].vx = 0;
        this.nodes[i].vy = 0;
      }
    }
  }

  isActive(): boolean {
    return this.pinnedCount > 0 || this.alpha > ALPHA_MIN;
  }

  /** Advances the simulation by one frame and returns true if another frame is needed. */
  step(): boolean {
    if (!this.isActive()) return false;
    this.tick(0.935);
    return this.isActive();
  }

  getPosition(id: string): NodePosition | undefined {
    const idx = this.indexById.get(id);
    if (idx === undefined) return undefined;
    const n = this.nodes[idx];
    return { x2: n.x, y2: n.y };
  }

  computeBounds(
    visibleIds?: Set<string>,
  ): { minX: number; maxX: number; minY: number; maxY: number; cx: number; cy: number; width: number; height: number } | null {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let count = 0;

    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (visibleIds && !visibleIds.has(n.id)) continue;
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
      count++;
    }

    if (count === 0) return null;
    return {
      minX,
      maxX,
      minY,
      maxY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }

  toPositionMap(): Map<string, NodePosition> {
    const out = new Map<string, NodePosition>();
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      out.set(n.id, { x2: n.x, y2: n.y });
    }
    return out;
  }
}

/** Deterministic wide 2D force-directed layout for arbitrary repository graphs. */
export function computeGraphLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Map<string, NodePosition> {
  return new GraphSimulation(nodes, edges).toPositionMap();
}
