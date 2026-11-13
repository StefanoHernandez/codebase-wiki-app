import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-2d';
import { graphHistory } from '../api';
import { Empty } from '../components/Empty';
import { PageDrawer, type PageDrawerTarget } from '../components/PageDrawer';
import { buildWikiCodeGraph, filterWikiGraph } from '../lib/graph-builder';
import { buildTimeline, visibleAt, type GraphHistory } from '../lib/graph-history';
import { useProject } from '../state/project';
import { useTheme } from '../state/theme';
import type { GraphEdge, GraphNode, GraphNodeCategory } from '../types/wiki';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  LABEL_ZOOM_THRESHOLD,
  neighborIds,
  nodeRadius,
  readCategoryColors,
  withAlpha,
} from './grafo-helpers';
import './grafo.css';

type FgNode = GraphNode & { x?: number; y?: number };
type FgLink = GraphEdge & { source: string | FgNode; target: string | FgNode };

/** Categories with their own hue; links pointing at them take that hue. */
const HUED = new Set<GraphNodeCategory>(['decision', 'tracker', 'agent']);
const endId = (end: string | FgNode) => (typeof end === 'object' ? end.id : end);


const LEGEND_KEY = 'grafo.legendOpen';
/** The whole history plays in about this long, whatever the number of commits. */
const PLAY_MS = 15_000;
const dateFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
export default function Grafo() {
  const project = useProject();
  const { theme } = useTheme();
  const snapshot = project.snapshot;

  const viewRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<FgNode> | undefined>(undefined);

  const [size, setSize] = useState({ w: 640, h: 480 });
  const [colors, setColors] = useState<Record<GraphNodeCategory, string>>(() =>
    Object.fromEntries(CATEGORIES.map((c) => [c, '#888'])) as Record<GraphNodeCategory, string>
  );
  const [tokenInk, setTokenInk] = useState('#1b2220');
  const [tokenDrift, setTokenDrift] = useState('#b4540a');
  const [tokenError, setTokenError] = useState('#b42318');
  const [tokenMuted, setTokenMuted] = useState('#5f6a66');
  const [labelFont, setLabelFont] = useState('sans-serif');

  const [includeSources, setIncludeSources] = useState(true);
  const [onlyDrift, setOnlyDrift] = useState(false);
  const [localHop, setLocalHop] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [zoomK, setZoomK] = useState(1);
  const [drawer, setDrawer] = useState<PageDrawerTarget | null>(null);
  const [hiddenCats, setHiddenCats] = useState<Set<GraphNodeCategory>>(() => new Set());
  // Storia: the graph replayed commit by commit. `frame` null = today's graph.
  const [history, setHistory] = useState<GraphHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [frame, setFrame] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  const pagesByPath = useMemo(
    () => new Map(project.pages.map((p) => [p.relPath, p])),
    [project.pages]
  );

  const fullGraph = useMemo(() => {
    if (!snapshot?.wikiRoot) return null;
    return buildWikiCodeGraph({
      wikiRoot: snapshot.wikiRoot,
      pages: snapshot.pages,
      repoFiles: snapshot.repoFiles,
      changedFilesByPage: snapshot.changedFilesByPage,
      dirtyRepoFiles: snapshot.gitState.dirtyFiles,
      lintFindings: project.lint?.findings ?? [],
    });
  }, [snapshot, project.lint]);

  const filtered = useMemo(() => {
    if (!fullGraph) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };
    const focusId = localHop && selectedId ? selectedId : undefined;
    return filterWikiGraph(fullGraph, {
      includeCodeSources: includeSources,
      onlyDriftOrErrors: onlyDrift,
      searchQuery: '',
      focusNodeId: focusId,
      localGraphHops: focusId ? 1 : undefined,
    });
  }, [fullGraph, includeSources, onlyDrift, localHop, selectedId]);

  const timeline = useMemo(
    () => (history && fullGraph && snapshot?.wikiRoot ? buildTimeline(history, fullGraph.nodes, snapshot.wikiRoot) : null),
    [history, fullGraph, snapshot?.wikiRoot]
  );
  const current = timeline && frame !== null ? timeline.frames[frame] : null;

  // Node objects are kept across renders so positions survive filter changes and each
  // timeline frame: the graph grows in place instead of re-laying out from scratch.
  const nodeCache = useRef(new Map<string, FgNode>());
  const graphData = useMemo(() => {
    const shown = timeline && frame !== null ? visibleAt(filtered, timeline.birth, frame) : filtered;
    const nodes = shown.nodes.filter((n) => !hiddenCats.has(n.category));
    const ids = new Set(nodes.map((n) => n.id));
    const links = shown.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    const cache = nodeCache.current;
    const out = nodes.map((n) => {
      const prev = cache.get(n.id);
      if (prev) return Object.assign(prev, n);
      // A new node starts next to a neighbour already on screen.
      const link = links.find((l) => (l.source === n.id && cache.has(l.target)) || (l.target === n.id && cache.has(l.source)));
      const near = link ? cache.get(link.source === n.id ? link.target : link.source) : undefined;
      const node: FgNode = { ...n };
      if (near?.x != null && near.y != null) {
        node.x = near.x + (Math.random() - 0.5) * 20;
        node.y = near.y + (Math.random() - 0.5) * 20;
      }
      cache.set(n.id, node);
      return node;
    });
    return { nodes: out, links: links.map((e) => ({ ...e })) };
  }, [filtered, hiddenCats, timeline, frame]);

  const startHistory = useCallback(async () => {
    if (!snapshot) return;
    setHistoryError(null);
    try {
      const h = history ?? (await graphHistory(snapshot.repoPath));
      setHistory(h);
      setFrame(0);
      setPlaying(true);
    } catch (e) {
      setHistoryError(String(e));
    }
  }, [snapshot, history]);
  const exitHistory = useCallback(() => {
    setPlaying(false);
    setFrame(null);
  }, []);

  useEffect(() => {
    if (timeline && frame !== null && timeline.frames.length === 0) {
      setHistoryError('Nessun commit in git: la storia del grafo parte dal primo commit.');
      exitHistory();
    }
  }, [timeline, frame, exitHistory]);

  useEffect(() => {
    if (!playing || !timeline || frame === null) return;
    if (frame >= timeline.frames.length - 1) {
      setPlaying(false);
      return;
    }
    const step = Math.min(800, Math.max(80, PLAY_MS / timeline.frames.length));
    const t = setTimeout(() => setFrame((f) => (f === null ? f : f + 1)), step);
    return () => clearTimeout(t);
  }, [playing, timeline, frame]);

  const categoryOf = useMemo(() => new Map(filtered.nodes.map((n) => [n.id, n.category])), [filtered.nodes]);

  /** Per-category counts for the legend (before the legend's own toggles). */
  const counts = useMemo(() => {
    const out = new Map<GraphNodeCategory, number>();
    for (const n of filtered.nodes) out.set(n.category, (out.get(n.category) ?? 0) + 1);
    return out;
  }, [filtered.nodes]);

  const toggleCat = (c: GraphNodeCategory) =>
    setHiddenCats((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const highlight = useMemo(() => {
    const active = hoverId ?? selectedId;
    if (!active) return null;
    return neighborIds(active, filtered.edges);
  }, [hoverId, selectedId, filtered.edges]);

  useEffect(() => {
    if (selectedId && !filtered.nodes.some((n) => n.id === selectedId)) {
      setSelectedId(null);
      setLocalHop(false);
    }
  }, [filtered.nodes, selectedId]);

  const refreshTokens = useCallback(() => {
    const el = viewRef.current;
    if (!el) return;
    setColors(readCategoryColors(el));
    const cs = getComputedStyle(el);
    setTokenInk(cs.getPropertyValue('--ink').trim() || '#1b2220');
    setTokenDrift(cs.getPropertyValue('--drift').trim() || '#b4540a');
    setTokenError(cs.getPropertyValue('--error').trim() || '#b42318');
    setTokenMuted(cs.getPropertyValue('--ink-muted').trim() || '#5f6a66');
    const bodyFont = cs.getPropertyValue('font-family').trim();
    const mono = cs.getPropertyValue('--font-code').trim();
    setLabelFont(mono || bodyFont || 'sans-serif');
  }, []);

  useLayoutEffect(() => {
    refreshTokens();
  }, [refreshTokens, theme]);

  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => refreshTokens());
    obs.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => refreshTokens();
    mq.addEventListener('change', onScheme);
    return () => {
      obs.disconnect();
      mq.removeEventListener('change', onScheme);
    };
  }, [refreshTokens]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setSize({ w: Math.max(200, cr.width), h: Math.max(200, cr.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Spread the layout: stronger repulsion and longer links than the defaults, then fit once it settles.
  const fitted = useRef(false);
  // After the first fit, a resized stage (window, sidebar, drawer) refits once it stops changing.
  useEffect(() => {
    if (!fitted.current) return;
    const t = setTimeout(() => fgRef.current?.zoomToFit(300, 40), 200);
    return () => clearTimeout(t);
  }, [size.w, size.h]);
  const [legendOpen, setLegendOpen] = useState(() => {
    try {
      return localStorage.getItem(LEGEND_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength?.(-70);
    const link = fg.d3Force('link') as unknown as { distance?: (d: number) => void } | undefined;
    link?.distance?.(38);
    fitted.current = false;
    fg.d3ReheatSimulation();
  }, [graphData]);

  const centerOn = useCallback((node: FgNode) => {
    if (node.x == null || node.y == null) return;
    const fg = fgRef.current;
    if (!fg) return;
    fg.centerAt(node.x, node.y, 400);
    fg.zoom(Math.max(zoomK, LABEL_ZOOM_THRESHOLD), 400);
  }, [zoomK]);

  const runSearch = useCallback(() => {
    const q = searchDraft.trim();
    if (!q || !fullGraph) return;
    const match = fullGraph.nodes.find(
      (n) => n.label.toLowerCase().includes(q.toLowerCase()) || n.path.toLowerCase().includes(q.toLowerCase())
    );
    if (match) {
      setSelectedId(match.id);
      const visible = filtered.nodes.find((n) => n.id === match.id) ?? match;
      setTimeout(() => centerOn(visible as FgNode), 50);
    }
  }, [searchDraft, fullGraph, filtered.nodes, centerOn]);

  /** Like Obsidian: focus lasts while the page is open; closing it returns to the whole graph. */
  const clearFocus = useCallback(() => {
    setDrawer(null);
    setSelectedId(null);
    setLocalHop(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || drawer) return;
      if (frame !== null) exitHistory();
      else clearFocus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer, clearFocus, frame, exitHistory]);

  const openDrawerForNode = useCallback((node: GraphNode) => {
    if (node.kind === 'wiki') {
      setDrawer({ mode: 'wiki', wikiRelPath: node.path });
    } else {
      setDrawer({ mode: 'source', relPath: node.path });
    }
  }, []);

  const onNodeClick = useCallback(
    (node: NodeObject<FgNode>) => {
      setSelectedId(node.id);
      openDrawerForNode(node);
    },
    [openDrawerForNode]
  );

  const paintNode = useCallback(
    (node: FgNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const r = nodeRadius(node.degree);
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const fill = colors[node.category] || tokenInk;
      const dim =
        highlight && !highlight.has(node.id)
          ? 0.18
          : node.id === selectedId
            ? 1
            : node.id === hoverId
              ? 0.95
              : 0.75;

      ctx.beginPath();
      // Code files are squares: shape, not only color, separates them from wiki pages.
      if (node.kind === 'source') ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
      else ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = fill;
      ctx.globalAlpha = dim;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (node.id === selectedId) {
        ctx.strokeStyle = tokenInk;
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }
      // Storia: a halo for pages born in this commit, a ring for pages it changed.
      if (current && (current.born.has(node.id) || current.touched.has(node.id))) {
        const born = current.born.has(node.id);
        ctx.beginPath();
        ctx.arc(x, y, r + (born ? 5 : 3) / globalScale + r * 0.4, 0, 2 * Math.PI);
        ctx.strokeStyle = born ? fill : tokenInk;
        ctx.globalAlpha = born ? 0.55 : 0.8;
        ctx.lineWidth = (born ? 3 : 1.4) / globalScale;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Drift / lint: a small badge at the top-right, so status never paints over the category fill.
      const badge = (color: string, dx: number) => {
        ctx.beginPath();
        ctx.arc(x + r * 0.75 + dx, y - r * 0.75, Math.max(r * 0.38, 1.4), 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.globalAlpha = dim;
        ctx.fill();
        ctx.globalAlpha = 1;
      };
      if (node.hasDrift) badge(tokenDrift, 0);
      if (node.hasLintError) badge(tokenError, node.hasDrift ? r * 0.8 : 0);

      const showLabel =
        node.id === hoverId || node.id === selectedId || globalScale >= LABEL_ZOOM_THRESHOLD;
      if (showLabel && node.label) {
        const fontSize = Math.max(10 / globalScale, 3);
        ctx.font = `${fontSize}px ${labelFont}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = tokenInk;
        ctx.globalAlpha = dim;
        const label = node.label.length > 36 ? `${node.label.slice(0, 34)}…` : node.label;
        ctx.fillText(label, x, y + r + 1.5 / globalScale);
        ctx.globalAlpha = 1;
      }
    },
    [colors, tokenInk, tokenDrift, tokenError, highlight, selectedId, hoverId, labelFont, current]
  );

  /** A link's state: highlighted (touches the hovered/selected node), dimmed, or normal. */
  const linkState = useCallback(
    (link: FgLink): 'on' | 'off' | 'normal' => {
      if (!highlight) return 'normal';
      const active = hoverId ?? selectedId;
      const s = endId(link.source);
      const t = endId(link.target);
      return s === active || t === active ? 'on' : 'off';
    },
    [highlight, hoverId, selectedId]
  );

  const linkBase = useCallback(
    (link: FgLink) => {
      if (link.kind === 'source-link') return tokenMuted;
      const cat = categoryOf.get(endId(link.target));
      return cat && HUED.has(cat) ? colors[cat] : tokenMuted;
    },
    [categoryOf, colors, tokenMuted]
  );

  const linkColor = useCallback(
    (link: FgLink) => {
      const state = linkState(link);
      return withAlpha(linkBase(link), state === 'on' ? 0.95 : state === 'off' ? 0.06 : 0.4);
    },
    [linkState, linkBase]
  );

  if (!snapshot?.wikiRoot || !fullGraph) {
    return (
      <section className="view grafo-view">
        <Empty title="Nessun grafo da mostrare." />
      </section>
    );
  }

  const showEmpty = graphData.nodes.length === 0;

  return (
    <section className="grafo-view" ref={viewRef} aria-label="Grafo wiki e codice">
      <div className="grafo-stage" ref={stageRef}>
        <div className="grafo-toolbar toolbar toolbar-floating">
          <input
            className="input"
            placeholder="Cerca nodo"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            aria-label="Cerca nel grafo"
          />
          <button type="button" className="btn" onClick={runSearch}>
            Centra
          </button>
          <label className="grafo-toggle">
            <input
              type="checkbox"
              checked={includeSources}
              onChange={(e) => setIncludeSources(e.target.checked)}
            />
            File sorgente
          </label>
          <label className="grafo-toggle">
            <input type="checkbox" checked={onlyDrift} onChange={(e) => setOnlyDrift(e.target.checked)} />
            Solo drift
          </label>
          <label className="grafo-toggle" title={selectedId ? undefined : 'Seleziona un nodo'}>
            <input
              type="checkbox"
              checked={localHop}
              disabled={!selectedId}
              onChange={(e) => setLocalHop(e.target.checked)}
            />
            Locale (1 salto)
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => fgRef.current?.zoomToFit(400, 24)}
          >
            Adatta
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => (frame === null ? void startHistory() : exitHistory())}
            title="Riproduce la crescita del grafo commit per commit"
            aria-pressed={frame !== null}
          >
            {frame === null ? '▶ Storia' : 'Esci dalla storia'}
          </button>
        </div>
        {historyError && frame === null && (
          <p className="grafo-history-error" role="status">
            {historyError}
          </p>
        )}

        {showEmpty ? (
          <div className="grafo-empty">
            <Empty title="Nessun nodo con i filtri attuali." />
          </div>
        ) : (
          <ForceGraph2D<FgNode>
            ref={fgRef as MutableRefObject<ForceGraphMethods<FgNode>>}
            width={size.w}
            height={size.h}
            graphData={graphData}
            backgroundColor="transparent"
            nodeId="id"
            linkSource="source"
            linkTarget="target"
            nodeCanvasObjectMode={() => 'replace'}
            nodeCanvasObject={paintNode}
            nodePointerAreaPaint={(node, color, ctx) => {
              ctx.beginPath();
              ctx.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node.degree) + 2, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
            }}
            linkColor={(l) => linkColor(l as FgLink)}
            linkWidth={(l) => (linkState(l as FgLink) === 'on' ? 1.6 : 0.8)}
            linkLineDash={(l) => ((l as FgLink).kind === 'source-link' ? [2, 2] : null)}
            linkDirectionalArrowLength={(l) => (linkState(l as FgLink) === 'on' ? 4 : 0)}
            linkDirectionalArrowRelPos={0.92}
            linkDirectionalArrowColor={(l) => linkColor(l as FgLink)}
            linkCurvature={0.18}
            linkDirectionalParticles={0}
            cooldownTicks={200}
            onEngineStop={() => {
              if (fitted.current) return;
              fitted.current = true;
              fgRef.current?.zoomToFit(400, 40);
            }}
            d3VelocityDecay={0.35}
            onNodeClick={onNodeClick}
            onBackgroundClick={clearFocus}
            onNodeHover={(n) => setHoverId(n?.id ?? null)}
            onZoom={({ k }) => setZoomK(k)}
          />
        )}
        <details
          className="grafo-legend"
          open={legendOpen}
          onToggle={(e) => {
            const open = e.currentTarget.open;
            setLegendOpen(open);
            try {
              localStorage.setItem(LEGEND_KEY, open ? '1' : '0');
            } catch {
              /* per-viewer convenience only */
            }
          }}
        >
          <summary>
            {CATEGORIES.filter((c) => counts.has(c)).map((c) => (
              <span
                key={c}
                className={c === 'source' ? 'grafo-swatch grafo-swatch-square' : 'grafo-swatch'}
                style={{ background: colors[c], opacity: hiddenCats.has(c) ? 0.3 : 1 }}
                aria-hidden="true"
              />
            ))}
            Legenda
            {hiddenCats.size > 0 && <span className="grafo-legend-count">{hiddenCats.size} nascosti</span>}
          </summary>
          <div className="grafo-legend-body" role="group" aria-label="Legenda e filtri per tipo">
            {CATEGORIES.filter((c) => counts.has(c)).map((c) => (
              <button key={c} type="button" aria-pressed={!hiddenCats.has(c)} onClick={() => toggleCat(c)}>
                <span
                  className={c === 'source' ? 'grafo-swatch grafo-swatch-square' : 'grafo-swatch'}
                  style={{ background: colors[c] }}
                  aria-hidden="true"
                />
                {CATEGORY_LABEL[c]}
                <span className="grafo-legend-count">{counts.get(c)}</span>
              </button>
            ))}
            <hr />
            <span className="grafo-legend-edge">
              <span className="grafo-swatch grafo-swatch-line" aria-hidden="true" />
              Link tra pagine (colore della pagina di arrivo)
            </span>
            <span className="grafo-legend-edge">
              <span className="grafo-swatch grafo-swatch-line grafo-swatch-dash" aria-hidden="true" />
              Pagina → file citato
            </span>
            <hr />
            <span className="grafo-legend-edge">
              <span className="grafo-swatch" style={{ background: tokenDrift }} aria-hidden="true" />
              Drift: il codice citato è cambiato
            </span>
            <span className="grafo-legend-edge">
              <span className="grafo-swatch" style={{ background: tokenError }} aria-hidden="true" />
              Errore di lint
            </span>
          </div>
        </details>
        {timeline && current && frame !== null && (
          <div className="grafo-history" role="group" aria-label="Storia del grafo">
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (!playing && frame >= timeline.frames.length - 1) setFrame(0);
                setPlaying(!playing);
              }}
              aria-label={playing ? 'Pausa' : 'Riproduci'}
            >
              {playing ? '⏸' : '▶'}
            </button>
            <input
              type="range"
              min={0}
              max={timeline.frames.length - 1}
              value={frame}
              onChange={(e) => {
                setPlaying(false);
                setFrame(Number(e.target.value));
              }}
              aria-label="Commit"
            />
            <div className="grafo-history-label">
              <span>
                {dateFmt.format(new Date(current.date))} · {frame + 1}/{timeline.frames.length}
                {history?.truncated && frame === 0 ? ' · storia più vecchia omessa' : ''}
              </span>
              <span className="grafo-history-subject" title={current.subject}>
                {current.subject}
              </span>
            </div>
            <button type="button" className="btn" onClick={exitHistory}>
              Esci
            </button>
          </div>
        )}
      </div>

      <PageDrawer
        open={drawer !== null}
        target={drawer}
        repo={snapshot.repoPath}
        pagesByPath={pagesByPath}
        onClose={() => (localHop ? setDrawer(null) : clearFocus())}
        onOpenWiki={(wikiRelPath) => setDrawer({ mode: 'wiki', wikiRelPath })}
        onOpenSource={(relPath, fromWikiPath) => setDrawer({ mode: 'source', relPath, fromWikiPath })}
      />
    </section>
  );
}
