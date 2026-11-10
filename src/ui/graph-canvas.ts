import type { GraphNode, GraphEdge } from '../types/wiki.ts';

export interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pinned?: boolean;
}

export interface SimEdge {
  source: SimNode;
  target: SimNode;
  kind: 'markdown-link' | 'source-link';
}

export class GraphCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private nodes: SimNode[] = [];
  private edges: SimEdge[] = [];
  private nodeMap: Map<string, SimNode> = new Map();

  // Viewport transform
  private zoom = 1.0;
  private panX = 0;
  private panY = 0;

  // Interaction
  private hoveredNode: SimNode | null = null;
  private selectedNodeId: string | null = null;
  private draggedNode: SimNode | null = null;
  private isPanning = false;
  private startPanX = 0;
  private startPanY = 0;
  private dragStartX = 0;
  private dragStartY = 0;
  private didDragMove = false;

  // Simulation physics
  private animFrameId: number | null = null;
  private alpha = 1.0;
  private readonly alphaDecay = 0.985;
  private readonly minAlpha = 0.003;

  private onSelectNode?: (node: GraphNode) => void;

  constructor(
    canvas: HTMLCanvasElement,
    options?: { onSelectNode?: (node: GraphNode) => void }
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get 2D context from canvas');
    }
    this.ctx = ctx;
    this.onSelectNode = options?.onSelectNode;

    this.bindEvents();
    this.resizeCanvas();
  }

  public resizeCanvas(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width || 600;
    const height = rect.height || 400;

    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.ctx.resetTransform();
    this.ctx.scale(dpr, dpr);

    if (this.panX === 0 && this.panY === 0) {
      this.panX = width / 2;
      this.panY = height / 2;
    }
    this.requestRender();
  }

  public setData(rawNodes: GraphNode[], rawEdges: GraphEdge[]): void {
    const existingPositions = new Map<string, { x: number; y: number; vx: number; vy: number }>();
    for (const n of this.nodes) {
      existingPositions.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy });
    }

    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || 600;
    const height = rect.height || 400;

    this.nodes = rawNodes.map((n, idx) => {
      const existing = existingPositions.get(n.id);
      let radius = 8;
      if (n.category === 'core' && n.role === 'index') {
        radius = 16;
      } else if (n.category === 'core') {
        radius = 12;
      } else if (n.category === 'source') {
        radius = 5;
      } else if (n.category === 'topic') {
        radius = 9;
      } else if (n.category === 'decision') {
        radius = 10;
      } else {
        radius = 7 + Math.min(8, n.degree);
      }

      if (existing) {
        return {
          ...n,
          x: existing.x,
          y: existing.y,
          vx: existing.vx,
          vy: existing.vy,
          radius,
        };
      }

      const angle = (idx / Math.max(1, rawNodes.length)) * 2 * Math.PI;
      const dist = 50 + Math.random() * Math.min(width, height) * 0.35;
      return {
        ...n,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        radius,
      };
    });

    this.nodeMap.clear();
    for (const n of this.nodes) {
      this.nodeMap.set(n.id, n);
    }

    this.edges = [];
    for (const e of rawEdges) {
      const src = this.nodeMap.get(e.source);
      const tgt = this.nodeMap.get(e.target);
      if (src && tgt) {
        this.edges.push({
          source: src,
          target: tgt,
          kind: e.kind,
        });
      }
    }

    this.alpha = 1.0;
    this.startSimulation();
  }

  public selectNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
    this.requestRender();
  }

  public resetView(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || 600;
    const height = rect.height || 400;
    this.zoom = 1.0;
    this.panX = width / 2;
    this.panY = height / 2;
    this.requestRender();
  }

  public zoomIn(): void {
    this.applyZoom(1.25);
  }

  public zoomOut(): void {
    this.applyZoom(0.8);
  }

  private applyZoom(factor: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const centerX = (rect.width || 600) / 2;
    const centerY = (rect.height || 400) / 2;
    const newZoom = Math.max(0.15, Math.min(4.0, this.zoom * factor));
    this.panX = centerX - (centerX - this.panX) * (newZoom / this.zoom);
    this.panY = centerY - (centerY - this.panY) * (newZoom / this.zoom);
    this.zoom = newZoom;
    this.requestRender();
  }

  private startSimulation(): void {
    if (this.animFrameId !== null) return;

    const tick = () => {
      if (this.alpha > this.minAlpha) {
        this.stepSimulation();
        this.alpha *= this.alphaDecay;
      }
      this.render();

      if (this.alpha > this.minAlpha || this.isPanning || this.draggedNode) {
        this.animFrameId = requestAnimationFrame(tick);
      } else {
        this.animFrameId = null;
      }
    };

    this.animFrameId = requestAnimationFrame(tick);
  }

  private requestRender(): void {
    if (this.animFrameId === null) {
      this.startSimulation();
    }
  }

  private stepSimulation(): void {
    const repulsionStrength = 750;
    const springStrength = 0.045;
    const idealSpringLength = 65;
    const centerStrength = 0.015;
    const damping = 0.82;

    // Node repulsion (n-body)
    for (let i = 0; i < this.nodes.length; i++) {
      const a = this.nodes[i];
      for (let j = i + 1; j < this.nodes.length; j++) {
        const b = this.nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) distSq = 1;
        const dist = Math.sqrt(distSq);

        const force = (repulsionStrength / distSq) * this.alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (!a.pinned && a !== this.draggedNode) {
          a.vx -= fx;
          a.vy -= fy;
        }
        if (!b.pinned && b !== this.draggedNode) {
          b.vx += fx;
          b.vy += fy;
        }
      }
    }

    // Edge attraction (springs)
    for (const e of this.edges) {
      const a = e.source;
      const b = e.target;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const displacement = dist - idealSpringLength;
      const force = displacement * springStrength * this.alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (!a.pinned && a !== this.draggedNode) {
        a.vx += fx;
        a.vy += fy;
      }
      if (!b.pinned && b !== this.draggedNode) {
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    // Gravity pull towards center (0, 0)
    for (const n of this.nodes) {
      if (!n.pinned && n !== this.draggedNode) {
        n.vx -= n.x * centerStrength * this.alpha;
        n.vy -= n.y * centerStrength * this.alpha;

        n.vx *= damping;
        n.vy *= damping;

        n.x += n.vx;
        n.y += n.vy;
      }
    }
  }

  private render(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || 600;
    const height = rect.height || 400;

    this.ctx.clearRect(0, 0, width, height);

    if (this.nodes.length === 0) {
      this.ctx.save();
      this.ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      this.ctx.fillStyle = '#64748b';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(
        "No Wiki loaded in this folder — click '📁 Browse...' to select a repo or '+ Init Wiki' to create one",
        width / 2,
        height / 2
      );
      this.ctx.restore();
      return;
    }

    this.ctx.save();

    // Transform view
    this.ctx.translate(this.panX, this.panY);
    this.ctx.scale(this.zoom, this.zoom);

    // Connected neighbors for hover
    const hoverId = this.hoveredNode?.id;
    const selectedId = this.selectedNodeId;
    const hoverNeighborIds = new Set<string>();
    if (hoverId) {
      hoverNeighborIds.add(hoverId);
      for (const e of this.edges) {
        if (e.source.id === hoverId) hoverNeighborIds.add(e.target.id);
        if (e.target.id === hoverId) hoverNeighborIds.add(e.source.id);
      }
    }

    // 1. Draw Edges
    for (const e of this.edges) {
      const isIncidentToHover = Boolean(hoverId && (e.source.id === hoverId || e.target.id === hoverId));
      const isIncidentToSelected = Boolean(selectedId && (e.source.id === selectedId || e.target.id === selectedId));
      const isHighlighted = isIncidentToHover || isIncidentToSelected;
      const isDimmed = Boolean(hoverId && !isIncidentToHover);

      this.ctx.beginPath();
      this.ctx.moveTo(e.source.x, e.source.y);
      this.ctx.lineTo(e.target.x, e.target.y);

      if (isHighlighted) {
        this.ctx.strokeStyle = isIncidentToHover ? '#a5b4fc' : '#818cf8';
        this.ctx.lineWidth = 2.2 / this.zoom;
      } else if (isDimmed) {
        this.ctx.strokeStyle = 'rgba(100, 116, 139, 0.08)';
        this.ctx.lineWidth = 0.8 / this.zoom;
      } else if (e.kind === 'source-link') {
        this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.40)';
        this.ctx.lineWidth = 1.5 / this.zoom;
      } else {
        this.ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
        this.ctx.lineWidth = 1.5 / this.zoom;
      }
      this.ctx.stroke();
    }

    // 2. Draw Nodes
    for (const n of this.nodes) {
      const isSelected = n.id === this.selectedNodeId;
      const isHovered = n === this.hoveredNode;
      const isDimmed = Boolean(hoverId && !hoverNeighborIds.has(n.id));

      this.ctx.save();
      if (isDimmed) {
        this.ctx.globalAlpha = 0.25;
      }

      // Outer rings (Drift = Orange, Lint = Red, Selected = White)
      if (isSelected) {
        this.ctx.beginPath();
        this.ctx.arc(n.x, n.y, n.radius + 5, 0, 2 * Math.PI);
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2.5 / this.zoom;
        this.ctx.stroke();
      }

      if (n.hasDrift) {
        this.ctx.beginPath();
        this.ctx.arc(n.x, n.y, n.radius + (isSelected ? 8 : 4), 0, 2 * Math.PI);
        this.ctx.strokeStyle = '#f97316'; // Obsidian vibrant orange
        this.ctx.lineWidth = 2.5 / this.zoom;
        this.ctx.stroke();
      }

      if (n.hasLintError) {
        this.ctx.beginPath();
        this.ctx.arc(n.x, n.y, n.radius + (isSelected || n.hasDrift ? 9 : 4), 0, 2 * Math.PI);
        this.ctx.strokeStyle = '#ef4444'; // Red alert ring
        this.ctx.lineWidth = 2.5 / this.zoom;
        this.ctx.stroke();
      }

      // Node Body fill
      this.ctx.beginPath();
      this.ctx.arc(n.x, n.y, n.radius, 0, 2 * Math.PI);
      this.ctx.fillStyle = this.getNodeColor(n);
      this.ctx.fill();

      // Subtle border on node
      this.ctx.strokeStyle = isHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.2)';
      this.ctx.lineWidth = 1.0 / this.zoom;
      this.ctx.stroke();

      // Text Label
      const showLabel =
        this.zoom > 0.65 ||
        isHovered ||
        isSelected ||
        n.category === 'core' ||
        n.degree >= 3;

      if (showLabel) {
        const fontSize = Math.max(10, Math.min(13, 11 / Math.sqrt(this.zoom)));
        this.ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        this.ctx.fillStyle = isHovered || isSelected ? '#ffffff' : '#cbd5e1';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'top';
        this.ctx.fillText(n.label, n.x, n.y + n.radius + 3);
      }

      this.ctx.restore();
    }

    this.ctx.restore();
  }

  private getNodeColor(n: SimNode): string {
    if (n.category === 'source') {
      return '#64748b'; // Slate code file
    }
    if (n.category === 'topic') {
      return '#38bdf8'; // Sky topic
    }
    if (n.category === 'decision') {
      return '#fbbf24'; // Amber decision
    }

    // Core role colors
    switch (n.role) {
      case 'index':
        return '#3b82f6'; // Blue
      case 'log':
      case 'log-archive':
        return '#a855f7'; // Purple
      case 'tracker':
        return '#10b981'; // Emerald
      case 'decisions':
        return '#f59e0b'; // Amber
      case 'risks':
        return '#ef4444'; // Red
      case 'context':
        return '#06b6d4'; // Cyan
      case 'handoff':
        return '#6366f1'; // Indigo
      case 'troubleshooting':
        return '#f43f5e'; // Rose
      case 'glossary':
        return '#14b8a6'; // Teal
      default:
        return '#94a3b8';
    }
  }

  private screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return {
      x: (x - this.panX) / this.zoom,
      y: (y - this.panY) / this.zoom,
    };
  }

  private findNodeAt(worldX: number, worldY: number): SimNode | null {
    // Search in reverse order (top to bottom)
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      const dx = worldX - n.x;
      const dy = worldY - n.y;
      const hitRadius = n.radius + 4 / this.zoom;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return n;
      }
    }
    return null;
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.resizeCanvas());

    this.canvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const newZoom = Math.max(0.15, Math.min(4.0, this.zoom * factor));

      this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
      this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
      this.zoom = newZoom;
      this.requestRender();
    });

    this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0 && e.button !== 1) return; // Left or middle click
      const world = this.screenToWorld(e.clientX, e.clientY);
      const clicked = this.findNodeAt(world.x, world.y);

      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.didDragMove = false;

      if (clicked) {
        this.draggedNode = clicked;
        this.alpha = 0.7;
        this.startSimulation();
      } else {
        this.isPanning = true;
        this.startPanX = e.clientX - this.panX;
        this.startPanY = e.clientY - this.panY;
        this.canvas.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
      const dx = Math.abs(e.clientX - this.dragStartX);
      const dy = Math.abs(e.clientY - this.dragStartY);
      if (dx > 3 || dy > 3) {
        this.didDragMove = true;
      }

      if (this.draggedNode) {
        const world = this.screenToWorld(e.clientX, e.clientY);
        this.draggedNode.x = world.x;
        this.draggedNode.y = world.y;
        this.draggedNode.vx = 0;
        this.draggedNode.vy = 0;
        this.alpha = 0.5;
        this.requestRender();
        return;
      }

      if (this.isPanning) {
        this.panX = e.clientX - this.startPanX;
        this.panY = e.clientY - this.startPanY;
        this.requestRender();
        return;
      }

      // Hover detection
      const world = this.screenToWorld(e.clientX, e.clientY);
      const hit = this.findNodeAt(world.x, world.y);
      if (hit !== this.hoveredNode) {
        this.hoveredNode = hit;
        this.canvas.style.cursor = hit ? 'pointer' : 'default';
        this.requestRender();
      }
    });

    window.addEventListener('mouseup', (e: MouseEvent) => {
      if (this.draggedNode) {
        const releasedNode = this.draggedNode;
        this.draggedNode = null;
        if (!this.didDragMove && this.onSelectNode) {
          this.selectNode(releasedNode.id);
          this.onSelectNode(releasedNode);
        }
      }

      if (this.isPanning) {
        this.isPanning = false;
        this.canvas.style.cursor = this.hoveredNode ? 'pointer' : 'default';
      }
    });
  }

  public destroy(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }
}
