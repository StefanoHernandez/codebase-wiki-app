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
import { Empty } from '../components/Empty';
import { PageDrawer, type PageDrawerTarget } from '../components/PageDrawer';
import { buildWikiCodeGraph, filterWikiGraph } from '../lib/graph-builder';
import { useProject } from '../state/project';
import { useTheme } from '../state/theme';
import type { GraphEdge, GraphNode, GraphNodeCategory } from '../types/wiki';
import './grafo.css';

export const LABEL_ZOOM_THRESHOLD = 2.2;

type FgNode = GraphNode & { x?: number; y?: number };

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
  const [tokenRule, setTokenRule] = useState('#d5dbd8');

  const [includeSources, setIncludeSources] = useState(true);
  const [onlyDrift, setOnlyDrift] = useState(false);
  const [localHop, setLocalHop] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [zoomK, setZoomK] = useState(1);
  const [drawer, setDrawer] = useState<PageDrawerTarget | null>(null);

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
      searchQuery,
      focusNodeId: focusId,
      localGraphHops: focusId ? 1 : undefined,
    });
  }, [fullGraph, includeSources, onlyDrift, searchQuery, localHop, selectedId]);

  const graphData = useMemo(
    () => ({
      nodes: filtered.nodes.map((n) => ({ ...n })),
      links: filtered.edges.map((e) => ({ ...e })),
    }),
    [filtered]
  );

  const highlight = useMemo(() => {
    const active = hoverId ?? selectedId;
    if (!active) return null;
    return neighborIds(active, filtered.edges);
  }, [hoverId, selectedId, filtered.edges]);

  const refreshTokens = useCallback(() => {
    const el = viewRef.current;
    if (!el) return;
    setColors(readCategoryColors(el));
    const cs = getComputedStyle(el);
    setTokenInk(cs.getPropertyValue('--ink').trim() || '#1b2220');
    setTokenDrift(cs.getPropertyValue('--drift').trim() || '#b4540a');
    setTokenError(cs.getPropertyValue('--error').trim() || '#b42318');
    setTokenRule(cs.getPropertyValue('--rule').trim() || '#d5dbd8');
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

  const centerOn = useCallback((node: FgNode) => {
    if (node.x == null || node.y == null) return;
    const fg = fgRef.current;
    if (!fg) return;
    fg.centerAt(node.x, node.y, 400);
    fg.zoom(Math.max(zoomK, LABEL_ZOOM_THRESHOLD), 400);
  }, [zoomK]);

  const runSearch = useCallback(() => {
    const q = searchDraft.trim();
    setSearchQuery(q);
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
      const r = 3.5;
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
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = fill;
      ctx.globalAlpha = dim;
      ctx.fill();
      ctx.globalAlpha = 1;

      if (node.hasDrift) {
        ctx.beginPath();
        ctx.arc(x, y, r + 2.2 / globalScale, 0, 2 * Math.PI);
        ctx.strokeStyle = tokenDrift;
        ctx.lineWidth = 1.2 / globalScale;
        ctx.stroke();
      }
      if (node.hasLintError) {
        ctx.beginPath();
        ctx.arc(x, y, r + 3.6 / globalScale, 0, 2 * Math.PI);
        ctx.strokeStyle = tokenError;
        ctx.lineWidth = 1.2 / globalScale;
        ctx.stroke();
      }

      const showLabel =
        node.id === hoverId || node.id === selectedId || globalScale >= LABEL_ZOOM_THRESHOLD;
      if (showLabel && node.label) {
        const fontSize = Math.max(10 / globalScale, 3);
        ctx.font = `${fontSize}px ${getComputedStyle(viewRef.current ?? document.body).fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = tokenInk;
        ctx.globalAlpha = dim;
        const label = node.label.length > 36 ? `${node.label.slice(0, 34)}…` : node.label;
        ctx.fillText(label, x, y + r + 1.5 / globalScale);
        ctx.globalAlpha = 1;
      }
    },
    [colors, tokenInk, tokenDrift, tokenError, highlight, selectedId, hoverId]
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
        </div>

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
            linkColor={(link) => {
              if (!highlight) return tokenRule;
              const s = typeof link.source === 'object' ? link.source.id : link.source;
              const t = typeof link.target === 'object' ? link.target.id : link.target;
              const on = highlight.has(String(s)) && highlight.has(String(t));
              return on ? tokenRule : 'rgba(0,0,0,0.06)';
            }}
            linkWidth={(link) => {
              if (!highlight) return 0.65;
              const s = typeof link.source === 'object' ? link.source.id : link.source;
              const t = typeof link.target === 'object' ? link.target.id : link.target;
              return highlight.has(String(s)) && highlight.has(String(t)) ? 1 : 0.25;
            }}
            linkCurvature={0.22}
            linkDirectionalParticles={0}
            cooldownTicks={120}
            d3VelocityDecay={0.35}
            onEngineStop={() => fgRef.current?.pauseAnimation()}
            onNodeClick={onNodeClick}
            onNodeHover={(n) => setHoverId(n?.id ?? null)}
            onZoom={({ k }) => setZoomK(k)}
          />
        )}
      </div>

      <PageDrawer
        open={drawer !== null}
        target={drawer}
        repo={snapshot.repoPath}
        pagesByPath={pagesByPath}
        onClose={() => setDrawer(null)}
        onOpenWiki={(wikiRelPath) => setDrawer({ mode: 'wiki', wikiRelPath })}
        onOpenSource={(relPath, fromWikiPath) => setDrawer({ mode: 'source', relPath, fromWikiPath })}
      />
    </section>
  );
}
