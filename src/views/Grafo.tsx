import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import { Empty } from '../components/Empty';
import { PageDrawer, type PageDrawerTarget } from '../components/PageDrawer';
import { t } from '../i18n/index.ts';
import { buildWikiCodeGraph, filterWikiGraph } from '../lib/graph-builder';
import { buildTimeline, type GraphHistory, type Timeline } from '../lib/graph-history';
import { useProject } from '../state/project';
import { useTheme } from '../state/theme';
import type { GraphEdge, GraphNode, GraphNodeCategory } from '../types/wiki';
import {
  CATEGORIES,
  categoryLabel,
  neighborIds,
  nodeRadius,
  readCategoryColors,
  withAlpha,
} from './grafo-helpers';
import {
  computeGraphLayout,
  CATEGORY_SHAPE,
  drawFlatNode,
  drawLabelsNoOverlap,
  readThemePalette,
  type LabelCandidate,
  type ThemePalette,
} from './grafo-canvas';
import { computeCoverage } from '../lib/coverage';
import { Copertura } from './Copertura';
import { LensSwitch, Mappa, type GraphLens } from './Mappa';
import './grafo.css';

interface NodeScreenPos {
  node: GraphNode;
  sx: number;
  sy: number;
  r: number;
}

function scaledNodeRadius(node: GraphNode): number {
  const base = nodeRadius(node.degree);
  return node.category === 'core' ? Math.max(7.5, base * 1.48) : base;
}

export default function Grafo() {
  const project = useProject();
  const { theme } = useTheme();
  const snapshot = project.snapshot;

  const [includeCodeSources, setIncludeCodeSources] = useState(true);
  const [onlyDriftOrErrors, setOnlyDriftOrErrors] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [enabledCats, setEnabledCats] = useState<Set<GraphNodeCategory>>(
    () => new Set(CATEGORIES),
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<GraphNodeCategory>>(
    () => new Set(),
  );
  const [drawer, setDrawer] = useState<PageDrawerTarget | null>(null);
  // The code map is the default; the link graph and the coverage list are one click away.
  const [lens, setLens] = useState<GraphLens>('map');

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<GraphHistory | null>(null);
  const [storyStep, setStoryStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const fullGraph = useMemo(() => {
    if (!snapshot) {
      return { nodes: [], edges: [], backlinks: {}, uncoveredRepoFiles: [] };
    }
    return buildWikiCodeGraph({
      wikiRoot: snapshot.wikiRoot ?? 'wiki',
      pages: project.pages.map((p) => ({
        wikiRelPath: p.relPath,
        content: p.markdown,
        sizeBytes: p.sizeBytes,
      })),
      repoFiles: snapshot.repoFiles,
      changedFilesByPage: snapshot.changedFilesByPage,
      dirtyRepoFiles: snapshot.gitState.dirtyFiles,
      lintFindings: project.lint?.findings ?? [],
    });
  }, [snapshot, project.pages, project.lint]);

  const coverage = useMemo(
    () => (lens !== 'links' && snapshot ? computeCoverage(snapshot.repoFiles, fullGraph, snapshot.wikiRoot ?? 'wiki') : []),
    [lens, snapshot, fullGraph],
  );
  const coverageFiles = useMemo(() => coverage.flatMap((m) => m.files), [coverage]);
  const decisionPaths = useMemo(() => {
    const root = (snapshot?.wikiRoot ?? 'wiki').replace(/\/+$/, '') + '/';
    return new Set(project.decisions.map((d) => (d.relPath.startsWith(root) ? d.relPath.slice(root.length) : d.relPath)));
  }, [project.decisions, snapshot?.wikiRoot]);

  const pagesByPath = useMemo(
    () => new Map(project.pages.map((p) => [p.relPath, p])),
    [project.pages],
  );

  const filteredGraph = useMemo(() => {
    const base = filterWikiGraph(fullGraph, {
      includeCodeSources,
      onlyDriftOrErrors,
      searchQuery,
      focusNodeId: focusNodeId ?? undefined,
      localGraphHops: focusNodeId ? 2 : undefined,
    });
    const nodes = base.nodes.filter((n) => enabledCats.has(n.category));
    const keep = new Set(nodes.map((n) => n.id));
    const edges = base.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
    return { nodes, edges };
  }, [fullGraph, includeCodeSources, onlyDriftOrErrors, searchQuery, focusNodeId, enabledCats]);

  const layout = useMemo(
    () => computeGraphLayout(fullGraph.nodes, fullGraph.edges),
    [fullGraph],
  );

  const nodeById = useMemo(
    () => new Map(fullGraph.nodes.map((n) => [n.id, n])),
    [fullGraph.nodes],
  );

  const timeline: Timeline | null = useMemo(() => {
    if (!historyData || !snapshot) return null;
    return buildTimeline(historyData, fullGraph.nodes, snapshot.wikiRoot ?? 'wiki');
  }, [historyData, fullGraph.nodes, snapshot]);

  const repoKey = snapshot ? `${snapshot.repoPath}@${snapshot.gitState.headSha}` : '';
  useEffect(() => {
    setHistoryData(null);
    setHistoryError(null);
    setHistoryOpen(false);
    setPlaying(false);
    setStoryStep(0);
    setFocusNodeId(null);
    setSelectedId(null);
    setHoveredId(null);
  }, [repoKey]);

  const loadHistory = useCallback(async () => {
    if (!snapshot) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const h = await api.graphHistory(snapshot.repoPath);
      setHistoryData(h);
      setStoryStep(0);
      setPlaying(true);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    } finally {
      setHistoryLoading(false);
    }
  }, [snapshot]);

  const toggleHistory = useCallback(() => {
    if (historyOpen) {
      setHistoryOpen(false);
      setPlaying(false);
      return;
    }
    setHistoryOpen(true);
    if (!historyData && !historyLoading) {
      void loadHistory();
    } else if (timeline && timeline.frames.length > 0) {
      if (storyStep >= timeline.frames.length - 1) setStoryStep(0);
      setPlaying(true);
    }
  }, [historyOpen, historyData, historyLoading, loadHistory, timeline, storyStep]);

  useEffect(() => {
    if (!historyOpen || !playing || !timeline || timeline.frames.length === 0) return;
    if (storyStep >= timeline.frames.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setStoryStep((s) => Math.min(timeline.frames.length - 1, s + 1));
    }, 1150);
    return () => window.clearTimeout(timer);
  }, [historyOpen, playing, timeline, storyStep]);

  // Pan & zoom refs (mutated inside RAF without React re-renders)
  const panXRef = useRef(0);
  const panYRef = useRef(0);
  const panTargetRef = useRef<{ x: number; y: number } | null>(null);
  const zoomRef = useRef(1.0);
  const draggingRef = useRef(false);
  const pointerDownRef = useRef<{ x: number; y: number; moved: number } | null>(null);
  const screenNodesRef = useRef<NodeScreenPos[]>([]);
  const hoverIdRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const explorerOpenRef = useRef(explorerOpen);
  const drawerOpenRef = useRef(Boolean(drawer));
  const storyAnimRef = useRef(0);
  const scheduleDrawRef = useRef<() => void>(() => {});
  const paletteRef = useRef<ThemePalette | null>(null);
  const catColorsRef = useRef<Record<GraphNodeCategory, string> | null>(null);

  useEffect(() => {
    hoverIdRef.current = hoveredId;
    scheduleDrawRef.current();
  }, [hoveredId]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    scheduleDrawRef.current();
  }, [selectedId]);

  useEffect(() => {
    explorerOpenRef.current = explorerOpen;
    scheduleDrawRef.current();
  }, [explorerOpen]);

  useEffect(() => {
    drawerOpenRef.current = Boolean(drawer);
    scheduleDrawRef.current();
  }, [drawer]);

  useEffect(() => {
    if (!selectedId) return;
    if (!filteredGraph.nodes.some((n) => n.id === selectedId)) {
      setSelectedId(null);
      return;
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !drawer) setSelectedId(null);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [selectedId, drawer, filteredGraph.nodes]);

  const panToNode = useCallback(
    (nodeId: string) => {
      const p = layout.get(nodeId);
      const wrap = wrapRef.current;
      if (!p || !wrap) return;
      const rect = wrap.getBoundingClientRect();
      const leftInset = explorerOpenRef.current && rect.width >= 721 ? 244 : 0;
      const rightInset = drawerOpenRef.current && rect.width >= 721 ? Math.min(420, rect.width * 0.92) : 0;
      const minDim = Math.max(240, Math.min(rect.width - leftInset - rightInset * 0.35, rect.height));
      const baseScale = (minDim / 560) * zoomRef.current;
      panTargetRef.current = { x: -p.x2 * baseScale, y: -p.y2 * baseScale };
      scheduleDrawRef.current();
    },
    [layout],
  );

  const resetView = useCallback(() => {
    panTargetRef.current = { x: 0, y: 0 };
    zoomRef.current = 1.0;
    scheduleDrawRef.current();
  }, []);

  const refreshColors = useCallback(() => {
    const el = wrapRef.current ?? document.documentElement;
    paletteRef.current = readThemePalette(el);
    catColorsRef.current = readCategoryColors(el);
    scheduleDrawRef.current();
  }, []);

  useEffect(() => {
    refreshColors();
  }, [theme, refreshColors]);

  useEffect(() => {
    if (!historyOpen || !timeline || timeline.frames.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        setPlaying(false);
        setStoryStep((s) => Math.min(timeline.frames.length - 1, s + 1));
      } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        setPlaying(false);
        setStoryStep((s) => Math.max(0, s - 1));
      } else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [historyOpen, timeline]);

  // Main 2D canvas renderer; idle while the map or the list covers it.
  useEffect(() => {
    if (lens !== 'links') return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    refreshColors();
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let rafId = 0;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();

    const drawFrame = () => {
      rafId = 0;

      if (!draggingRef.current && panTargetRef.current) {
        const dx = panTargetRef.current.x - panXRef.current;
        const dy = panTargetRef.current.y - panYRef.current;
        if (reducedMotion || (Math.abs(dx) < 0.8 && Math.abs(dy) < 0.8)) {
          panXRef.current = panTargetRef.current.x;
          panYRef.current = panTargetRef.current.y;
          panTargetRef.current = null;
        } else {
          panXRef.current += dx * 0.16;
          panYRef.current += dy * 0.16;
        }
      }

      if (historyOpen) {
        if (reducedMotion) {
          storyAnimRef.current = storyStep;
        } else {
          storyAnimRef.current += (storyStep - storyAnimRef.current) * 0.14;
        }
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;
      const leftInset = explorerOpenRef.current && width >= 721 ? 244 : 0;
      const rightInset = drawerOpenRef.current && width >= 721 ? Math.min(420, width * 0.92) : 0;
      const cx = leftInset + (width - leftInset - rightInset) / 2 + panXRef.current;
      const cy = height / 2 + panYRef.current;
      const minDim = Math.max(240, Math.min(width - leftInset - rightInset * 0.35, height));
      const baseScale = (minDim / 560) * zoomRef.current;

      const palette = paletteRef.current ?? readThemePalette(wrap);

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const activeTimeline = historyOpen ? timeline : null;
      const frames = activeTimeline?.frames ?? [];
      const clampedStep = Math.max(0, Math.min(frames.length - 1, storyStep));
      const activeFrame = frames[clampedStep];
      const isStoryMode = Boolean(historyOpen && activeTimeline && frames.length > 0);

      const nodesToRender = isStoryMode
        ? filteredGraph.nodes.filter((n) => {
            const b = activeTimeline!.birth.get(n.id);
            return b !== undefined && b <= clampedStep;
          })
        : filteredGraph.nodes;

      const visibleSet = new Set(nodesToRender.map((n) => n.id));
      const edgesToRender: GraphEdge[] = filteredGraph.edges.filter(
        (e) => visibleSet.has(e.source) && visibleSet.has(e.target),
      );

      const activeAnchor = hoverIdRef.current ?? selectedIdRef.current ?? focusNodeId;
      const activeNbrs = activeAnchor ? neighborIds(activeAnchor, edgesToRender) : null;

      // Project 2D positions
      const projMap = new Map<string, NodeScreenPos>();
      for (const node of nodesToRender) {
        const p = layout.get(node.id);
        if (!p) continue;
        const sx = cx + p.x2 * baseScale;
        const sy = cy + p.y2 * baseScale;
        const rBase = scaledNodeRadius(node);
        const birthIdx = isStoryMode ? activeTimeline?.birth.get(node.id) ?? 0 : 0;
        const age = isStoryMode ? Math.max(0, storyAnimRef.current - birthIdx) : 1;
        const popScale = isStoryMode ? Math.min(1, 0.45 + age * 0.55) : 1;
        const isTouchedNow = Boolean(isStoryMode && activeFrame?.touched.has(node.id));
        const boost = isTouchedNow ? 1.18 : 1;
        const r = Math.max(3, rBase * Math.max(0.72, Math.min(1.5, zoomRef.current)) * popScale * boost);
        projMap.set(node.id, { node, sx, sy, r });
      }

      // 1. Draw edges
      for (let idx = 0; idx < edgesToRender.length; idx++) {
        const edge = edgesToRender[idx];
        const a = projMap.get(edge.source);
        const b = projMap.get(edge.target);
        if (!a || !b) continue;

        const isBranchHot = Boolean(
          activeAnchor && (edge.source === activeAnchor || edge.target === activeAnchor),
        );
        const isCommitHot = Boolean(
          isStoryMode &&
            activeFrame &&
            (activeFrame.touched.has(edge.source) || activeFrame.touched.has(edge.target)),
        );
        const isHot = isBranchHot || isCommitHot;

        let alpha = edge.kind === 'markdown-link' ? 0.34 : 0.18;
        if (activeNbrs && !isBranchHot) alpha = 0.04;
        if (isHot) alpha = 0.85;

        const strokeColor = isHot ? palette.human : palette.ruleStrong;

        ctx.strokeStyle = withAlpha(strokeColor, alpha);
        ctx.lineWidth = isHot ? 1.4 : edge.kind === 'markdown-link' ? 1.1 : 0.75;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();

      }

      // 2. Draw nodes (source cubes first, then wiki spheres on top)
      const sortedNodes = Array.from(projMap.values()).sort((a, b) => {
        if (a.node.kind !== b.node.kind) return a.node.kind === 'source' ? -1 : 1;
        return a.r - b.r;
      });
      screenNodesRef.current = sortedNodes;

      const labelCandidates: LabelCandidate[] = [];
      const q = searchQuery.trim().toLowerCase();

      for (const item of sortedNodes) {
        const { node, sx, sy, r } = item;
        if (sx < -40 || sx > width + 40 || sy < -40 || sy > height + 40) continue;

        const isHovered = hoverIdRef.current === node.id;
        const isSelected = selectedIdRef.current === node.id;
        const isFocused = focusNodeId === node.id;
        const isNeighbor = Boolean(activeNbrs?.has(node.id));
        const isQueryMatch = Boolean(
          q && (node.label.toLowerCase().includes(q) || node.path.toLowerCase().includes(q)),
        );
        const isCommitHot = Boolean(isStoryMode && activeFrame?.touched.has(node.id));

        let dim = false;
        if (activeNbrs && !isHovered && !isSelected && !isFocused && !isNeighbor) dim = true;

        const alpha = dim ? 0.16 : 1;
        // Category colour; cobalt marks the node in focus; status rings carry drift and errors.
        const isActive = isHovered || isSelected || isFocused || isCommitHot;
        const color = isActive ? palette.human : catColorsRef.current?.[node.category] ?? palette.muted;

        let statusRing: { color: string; dashed?: boolean } | undefined;
        if (!dim) {
          if (node.hasLintError) statusRing = { color: palette.error };
          else if (node.hasDrift) statusRing = { color: palette.drift };
          else if (node.needsReverify) statusRing = { color: palette.drift, dashed: true };
          else if (node.isOrphan) statusRing = { color: palette.muted, dashed: true };
        }

        drawFlatNode(ctx, sx, sy, r, CATEGORY_SHAPE[node.category], color, palette, statusRing, alpha);

        const shouldShowLabel =
          !dim &&
          (isHovered ||
            isSelected ||
            isFocused ||
            isNeighbor ||
            isQueryMatch ||
            isCommitHot ||
            node.category === 'core' ||
            zoomRef.current >= 1.15 ||
            sortedNodes.length <= 28);

        if (shouldShowLabel) {
          let priority = node.degree;
          if (node.category === 'core') priority += 20;
          if (isQueryMatch || isCommitHot) priority += 40;
          if (isNeighbor) priority += 60;
          if (isFocused) priority += 80;
          if (isSelected) priority += 100;
          if (isHovered) priority += 120;
          labelCandidates.push({
            id: node.id,
            text: node.label,
            sx,
            sy,
            r,
            priority,
            accent: isHovered || isSelected || isFocused || isCommitHot,
            muted: node.kind === 'source' && !isHovered && !isSelected && !isNeighbor,
          });
        }
      }

      // 3. Anti-collision pill labels
      drawLabelsNoOverlap(ctx, labelCandidates, width, height, palette, leftInset + 8);

      // 4. Commit card during Storia playback
      if (isStoryMode && activeFrame) {
        const cardW = Math.min(340, width - leftInset - 32);
        const cardX = leftInset + (width - leftInset - rightInset) / 2 - cardW / 2;
        const cardY = 64;
        const bornCount = activeFrame.born.size;
        const touchedCount = activeFrame.touched.size;
        const badgeText = `${bornCount > 0 ? '+' : '~'} ${activeFrame.sha.slice(0, 7)}`;

        ctx.save();
        ctx.fillStyle = palette.glass;
        ctx.strokeStyle = palette.ruleStrong;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(cardX, cardY, cardW, 48, 8);
        ctx.fill();
        ctx.stroke();

        ctx.font = '600 11px "IBM Plex Mono", ui-monospace, monospace';
        ctx.fillStyle = palette.human;
        ctx.fillText(badgeText, cardX + 12, cardY + 18);

        ctx.font = '400 11px "IBM Plex Sans", system-ui, sans-serif';
        ctx.fillStyle = palette.muted;
        const stats = `${t('esplora.grafo.commitBorn', { n: bornCount })} · ${t('esplora.grafo.commitTouched', { n: touchedCount })}`;
        ctx.fillText(stats, cardX + cardW - ctx.measureText(stats).width - 12, cardY + 18);

        ctx.font = '500 12px "IBM Plex Sans", system-ui, sans-serif';
        ctx.fillStyle = palette.ink;
        const msg =
          activeFrame.subject.length > 46
            ? `${activeFrame.subject.slice(0, 44)}…`
            : activeFrame.subject;
        ctx.fillText(msg, cardX + 12, cardY + 36);
        ctx.restore();
      }

      ctx.restore();
      const storyAnimating =
        historyOpen && !reducedMotion && Math.abs(storyStep - storyAnimRef.current) > 0.005;
      const panAnimating = !reducedMotion && panTargetRef.current !== null;
      if (draggingRef.current || panAnimating || storyAnimating) {
        rafId = requestAnimationFrame(drawFrame);
      } else if (historyOpen) {
        storyAnimRef.current = storyStep;
      }
    };

    const scheduleDraw = () => {
      if (!rafId) rafId = requestAnimationFrame(drawFrame);
    };
    scheduleDrawRef.current = scheduleDraw;

    const ro = new ResizeObserver(() => {
      resize();
      scheduleDraw();
    });
    ro.observe(wrap);

    scheduleDraw();
    return () => {
      scheduleDrawRef.current = () => {};
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [
    lens,
    historyOpen,
    storyStep,
    timeline,
    filteredGraph,
    layout,
    focusNodeId,
    searchQuery,
    refreshColors,
  ]);

  const hitTest = useCallback((clientX: number, clientY: number): GraphNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const items = screenNodesRef.current;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const hitR = Math.max(10, it.r + 5);
      const dx = x - it.sx;
      const dy = y - it.sy;
      if (dx * dx + dy * dy <= hitR * hitR) return it.node;
    }
    return null;
  }, []);

  const openNodeInDrawer = useCallback(
    (node: GraphNode) => {
      if (node.kind === 'wiki') {
        setDrawer({ mode: 'wiki', wikiRelPath: node.path });
        return;
      }
      const linkedWikiEdge = fullGraph.edges.find(
        (e) => e.kind === 'source-link' && e.target === node.id,
      );
      const fromWiki = linkedWikiEdge ? nodeById.get(linkedWikiEdge.source)?.path : undefined;
      setDrawer({ mode: 'source', relPath: node.path, fromWikiPath: fromWiki });
    },
    [fullGraph.edges, nodeById],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true;
    panTargetRef.current = null;
    pointerDownRef.current = { x: e.clientX, y: e.clientY, moved: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    scheduleDrawRef.current();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingRef.current && pointerDownRef.current) {
      const dx = e.clientX - pointerDownRef.current.x;
      const dy = e.clientY - pointerDownRef.current.y;
      pointerDownRef.current.x = e.clientX;
      pointerDownRef.current.y = e.clientY;
      pointerDownRef.current.moved += Math.hypot(dx, dy);
      panXRef.current += dx;
      panYRef.current += dy;
      scheduleDrawRef.current();
      return;
    }
    const hit = hitTest(e.clientX, e.clientY);
    setHoveredId(hit ? hit.id : null);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const moved = pointerDownRef.current?.moved ?? 0;
    draggingRef.current = false;
    pointerDownRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    scheduleDrawRef.current();
    if (moved < 6) {
      const hit = hitTest(e.clientX, e.clientY);
      if (hit) {
        if (e.altKey || e.shiftKey) {
          setFocusNodeId((cur) => (cur === hit.id ? null : hit.id));
        } else {
          setSelectedId(hit.id);
          openNodeInDrawer(hit);
        }
      } else {
        setSelectedId(null);
      }
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (historyOpen && timeline && timeline.frames.length > 0) {
      setPlaying(false);
      if (e.deltaY > 0) {
        setStoryStep((s) => Math.min(timeline.frames.length - 1, s + 1));
      } else if (e.deltaY < 0) {
        setStoryStep((s) => Math.max(0, s - 1));
      }
      return;
    }
    const factor = e.deltaY < 0 ? 1.09 : 0.92;
    zoomRef.current = Math.max(0.35, Math.min(3.2, zoomRef.current * factor));
    scheduleDrawRef.current();
  };

  const toggleCategory = (cat: GraphNodeCategory) => {
    setEnabledCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const hoveredNode = hoveredId ? nodeById.get(hoveredId) ?? null : null;
  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;
  const highlightedNode = hoveredNode ?? selectedNode;
  const focusedNode = focusNodeId ? nodeById.get(focusNodeId) ?? null : null;

  const explorerGroups = useMemo(() => {
    const groups: Array<{ category: GraphNodeCategory; nodes: GraphNode[] }> = [];
    for (const cat of CATEGORIES) {
      const nodes = filteredGraph.nodes
        .filter((n) => n.category === cat)
        .sort((a, b) => a.label.localeCompare(b.label));
      if (nodes.length > 0) groups.push({ category: cat, nodes });
    }
    return groups;
  }, [filteredGraph.nodes]);

  const toggleGroup = (cat: GraphNodeCategory) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const hoverHint = useMemo(() => {
    if (historyOpen) return t('esplora.grafo.hintStory');
    return t('esplora.grafo.hint2d');
  }, [historyOpen]);

  if (!snapshot) {
    return null;
  }

  return (
    <div
      className={`grafo${drawer ? ' has-drawer' : ''}${explorerOpen ? ' has-explorer' : ''}`}
      ref={wrapRef}
    >
      <canvas
        ref={canvasRef}
        className={`grafo-canvas${hoveredId ? ' is-hovering' : ''}`}
        tabIndex={0}
        aria-label={t('esplora.grafo.aria')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          draggingRef.current = false;
          setHoveredId(null);
        }}
        onDoubleClick={(e) => {
          const hit = hitTest(e.clientX, e.clientY);
          if (hit) setFocusNodeId((cur) => (cur === hit.id ? null : hit.id));
        }}
        onWheel={onWheel}
      />

      {explorerOpen && (
        <aside className="grafo-explorer" aria-label={t('esplora.grafo.explorer')}>
          <div className="grafo-explorer-head">
            <span>{t('esplora.grafo.explorer')}</span>
            <span className="grafo-explorer-count">{filteredGraph.nodes.length}</span>
            <button
              type="button"
              className="grafo-exp-open"
              onClick={() => setExplorerOpen(false)}
              aria-label={t('esplora.grafo.exit')}
            >
              ×
            </button>
          </div>
          <div className="grafo-explorer-list">
            {explorerGroups.map((group) => {
              const collapsed = collapsedGroups.has(group.category);
              return (
                <div key={group.category} className="grafo-exp-group">
                  <button
                    type="button"
                    className="grafo-exp-group-btn"
                    aria-expanded={!collapsed}
                    onClick={() => toggleGroup(group.category)}
                  >
                    <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
                    <span className={`swatch swatch-${CATEGORY_SHAPE[group.category]}`} style={{ color: `var(--graph-cat-${group.category})` }} aria-hidden="true" />
                    <span>{categoryLabel(group.category)}</span>
                    <span className="grafo-exp-group-count">{group.nodes.length}</span>
                  </button>
                  {!collapsed && (
                    <ul className="grafo-exp-items">
                      {group.nodes.map((node) => {
                        const isSel = selectedId === node.id;
                        return (
                          <li
                            key={node.id}
                            className={`grafo-exp-row${isSel ? ' is-selected' : ''}`}
                            onMouseEnter={() => setHoveredId(node.id)}
                            onMouseLeave={() =>
                              setHoveredId((cur) => (cur === node.id ? null : cur))
                            }
                          >
                            <button
                              type="button"
                              className="grafo-exp-pick"
                              title={node.path}
                              onClick={() => {
                                if (isSel) {
                                  setSelectedId(null);
                                  panTargetRef.current = null;
                                } else {
                                  setSelectedId(node.id);
                                  panToNode(node.id);
                                }
                              }}
                            >
                              <span
                                className={`grafo-exp-dot${
                                  node.category === 'core'
                                    ? ' is-core'
                                    : node.category === 'source'
                                      ? ' is-source'
                                      : ''
                                }`}
                              />
                              <span className="grafo-exp-label">{node.label}</span>
                              <span className="grafo-exp-deg">{node.degree}</span>
                            </button>
                            <button
                              type="button"
                              className="grafo-exp-open"
                              title={t('esplora.grafo.openFile')}
                              aria-label={`${t('esplora.grafo.openFile')}: ${node.label}`}
                              onClick={() => {
                                setSelectedId(node.id);
                                openNodeInDrawer(node);
                              }}
                            >
                              ↗
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      )}

      <div className="grafo-hud-top">
        <div className="grafo-toolbar">
          <LensSwitch value="links" onChange={setLens} />
          <button
            type="button"
            className={`btn btn-sm${explorerOpen ? ' btn-strong' : ''}`}
            aria-pressed={explorerOpen}
            onClick={() => setExplorerOpen((o) => !o)}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M2 3.5h4l1.3 1.4H14v7.6H2z" strokeLinejoin="round" />
            </svg>
            <span>{t('esplora.grafo.explorer')}</span>
          </button>

          <input
            type="search"
            className="input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('esplora.grafo.searchPlaceholder')}
            aria-label={t('esplora.grafo.searchPlaceholder')}
          />

          <label className="grafo-check">
            <input
              type="checkbox"
              checked={includeCodeSources}
              onChange={(e) => setIncludeCodeSources(e.target.checked)}
            />
            <span>{t('esplora.grafo.sourceFiles')}</span>
          </label>

          <label className="grafo-check">
            <input
              type="checkbox"
              checked={onlyDriftOrErrors}
              onChange={(e) => setOnlyDriftOrErrors(e.target.checked)}
            />
            <span>{t('esplora.grafo.onlyDrift')}</span>
          </label>


          <button type="button" className="btn btn-sm" onClick={resetView}>
            {t('esplora.grafo.fit')}
          </button>

          {focusedNode && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setFocusNodeId(null)}
            >
              {t('esplora.grafo.branchFull')} ({focusedNode.label}) ×
            </button>
          )}

          <button
            type="button"
            className={`btn btn-sm${historyOpen ? ' btn-strong' : ''}`}
            onClick={toggleHistory}
          >
            {t('esplora.grafo.history')}
          </button>

          <span className="grafo-counts">
            {filteredGraph.nodes.length}/{filteredGraph.edges.length}
          </span>
        </div>

        {!drawer && (
          <div className="grafo-hover-hint">
            {highlightedNode
              ? t('esplora.grafo.hintHover', { label: highlightedNode.label })
              : hoverHint}
          </div>
        )}
      </div>

      {filteredGraph.nodes.length === 0 && (
        <div className="grafo-empty">
          <Empty
            title={t(fullGraph.nodes.length === 0 ? 'esplora.grafo.empty' : 'esplora.grafo.noNodes')}
            action={
              (focusNodeId || searchQuery || onlyDriftOrErrors) && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setFocusNodeId(null);
                    setSearchQuery('');
                    setOnlyDriftOrErrors(false);
                    setEnabledCats(new Set(CATEGORIES));
                  }}
                >
                  {t('esplora.grafo.branchFull')}
                </button>
              )
            }
          />
        </div>
      )}

      <div className="grafo-hud-bottom">
        <div className="grafo-legend">
          {CATEGORIES.map((cat) => {
            const pressed = enabledCats.has(cat);
            return (
              <button
                key={cat}
                type="button"
                className="grafo-leg-btn"
                aria-pressed={pressed}
                onClick={() => toggleCategory(cat)}
              >
                <span className={`swatch swatch-${CATEGORY_SHAPE[cat]}`} style={{ color: `var(--graph-cat-${cat})` }} aria-hidden="true" />
                <span>{categoryLabel(cat)}</span>
              </button>
            );
          })}
        </div>

        {historyOpen && (
          <div className="grafo-history">
            {historyLoading ? (
              <span className="muted">{t('esplora.progetti.reading')}</span>
            ) : historyError ? (
              <span className="error-text">{historyError}</span>
            ) : !timeline || timeline.frames.length === 0 ? (
              <span className="muted">{t('esplora.grafo.noHistory')}</span>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setPlaying(false);
                    setStoryStep((s) => Math.max(0, s - 1));
                  }}
                  disabled={storyStep <= 0}
                  aria-label="<"
                >
                  ◀
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-strong"
                  onClick={() => {
                    if (storyStep >= timeline.frames.length - 1) setStoryStep(0);
                    setPlaying((p) => !p);
                  }}
                >
                  {playing ? t('esplora.grafo.pause') : t('esplora.grafo.play')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setPlaying(false);
                    setStoryStep((s) => Math.min(timeline.frames.length - 1, s + 1));
                  }}
                  disabled={storyStep >= timeline.frames.length - 1}
                  aria-label=">"
                >
                  ▶
                </button>
                <input
                  type="range"
                  className="grafo-history-range"
                  min={0}
                  max={timeline.frames.length - 1}
                  value={storyStep}
                  onChange={(e) => {
                    setPlaying(false);
                    setStoryStep(Number(e.target.value));
                  }}
                />
                <span className="mono">
                  {storyStep + 1}/{timeline.frames.length}
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setHistoryOpen(false);
                    setPlaying(false);
                  }}
                >
                  ×
                </button>
                <div className="grafo-history-meta">
                  <span className="mono">{timeline.frames[storyStep]?.sha.slice(0, 7)}</span>
                  <span className="grafo-history-msg">
                    {timeline.frames[storyStep]?.subject}
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {lens === 'map' && (
        <Mappa
          files={coverageFiles}
          decisionPaths={decisionPaths}
          onLens={setLens}
          onOpenWiki={(wikiRelPath) => setDrawer({ mode: 'wiki', wikiRelPath })}
          onOpenSource={(relPath, fromWikiPath) => setDrawer({ mode: 'source', relPath, fromWikiPath })}
        />
      )}

      {lens === 'coverage' && (
        <Copertura
          modules={coverage}
          onLens={setLens}
          onOpenWiki={(wikiRelPath) => setDrawer({ mode: 'wiki', wikiRelPath })}
          onOpenSource={(relPath, fromWikiPath) => setDrawer({ mode: 'source', relPath, fromWikiPath })}
        />
      )}

      <PageDrawer
        open={drawer !== null}
        target={drawer}
        repo={snapshot.repoPath}
        pagesByPath={pagesByPath}
        onClose={() => setDrawer(null)}
        onOpenWiki={(wikiRelPath) => setDrawer({ mode: 'wiki', wikiRelPath })}
        onOpenSource={(relPath, fromWikiPath) =>
          setDrawer({ mode: 'source', relPath, fromWikiPath })
        }
      />
    </div>
  );
}
