import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { useTheme } from '../state/theme';
import { drawFlatNode, readThemePalette, type ThemePalette } from './grafo-3d';
import { withAlpha } from './grafo-helpers';

export interface RadarHit {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  bm25Rank: number | null;
  vecRank: number | null;
  stale: boolean;
}

interface RadarProps {
  hits: RadarHit[];
  activeIdx: number;
  onSelect(index: number): void;
  indexing: boolean;
}

type Source = 'keyword' | 'meaning' | 'both';

/** Which retriever found the hit: keywords only, meaning only, or both. */
function sourceOf(h: RadarHit): Source {
  if (h.bm25Rank !== null && h.vecRank === null) return 'keyword';
  if (h.vecRank !== null && h.bm25Rank === null) return 'meaning';
  return 'both';
}

// Each source owns a 120° sector; angles in radians, 0 = right, clockwise on screen.
const SECTOR_CENTER: Record<Source, number> = {
  keyword: (-150 * Math.PI) / 180,
  meaning: (-30 * Math.PI) / 180,
  both: Math.PI / 2,
};
const SECTOR_SPAN = (100 * Math.PI) / 180;

interface Dot {
  idx: number;
  hit: RadarHit;
  x: number;
  y: number;
}

/**
 * Static map of the results: the query sits at the center, each hit lies in the sector of the
 * retriever that found it, and its distance grows as its score falls below the best hit's.
 * It redraws only when the results, the selection or the hover change.
 */
export function SemanticRadar({ hits, activeIdx, onSelect, indexing }: RadarProps) {
  const { theme } = useTheme();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paletteRef = useRef<ThemePalette | null>(null);
  const dotsRef = useRef<Dot[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Position in unit space: radius 0..1 from the center, angle inside the source's sector.
  const layout = useMemo(() => {
    const best = Math.max(...hits.map((h) => h.score), 0) || 1;
    const bySource = new Map<Source, number[]>();
    hits.forEach((h, i) => {
      const s = sourceOf(h);
      bySource.set(s, [...(bySource.get(s) ?? []), i]);
    });
    const out: Array<{ idx: number; rad: number; ang: number }> = [];
    for (const [source, idxs] of bySource) {
      idxs.forEach((idx, k) => {
        const spread = idxs.length === 1 ? 0.5 : k / (idxs.length - 1);
        const ang = SECTOR_CENTER[source] - SECTOR_SPAN / 2 + spread * SECTOR_SPAN;
        const rad = 0.22 + 0.74 * (1 - Math.max(0, hits[idx].score) / best);
        out.push({ idx, rad, ang });
      });
    }
    return out;
  }, [hits]);

  const counts = useMemo(() => {
    const c: Record<Source, number> = { keyword: 0, meaning: 0, both: 0 };
    for (const h of hits) c[sourceOf(h)] += 1;
    return c;
  }, [hits]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || size.w === 0) return;
    const palette = (paletteRef.current ??= readThemePalette(canvas));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const cx = size.w / 2;
    const cy = size.h / 2 + 6;
    const R = Math.min(size.w, size.h) / 2 - 26;

    // Distance rings and sector dividers.
    ctx.strokeStyle = palette.rule;
    ctx.lineWidth = 1;
    for (const f of [1 / 3, 2 / 3, 1]) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const a of [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();
    }

    // Sector labels just outside the outer ring.
    ctx.font = '500 11px "IBM Plex Sans", system-ui, sans-serif';
    ctx.fillStyle = palette.muted;
    ctx.textBaseline = 'middle';
    for (const s of ['keyword', 'meaning', 'both'] as Source[]) {
      const a = SECTOR_CENTER[s];
      const label = t(`esplora.ricerca.radarSource.${s}`);
      const lx = cx + Math.cos(a) * (R + 14);
      const ly = cy + Math.sin(a) * (R + 14);
      ctx.textAlign = Math.cos(a) > 0.3 ? 'left' : Math.cos(a) < -0.3 ? 'right' : 'center';
      ctx.fillText(label, lx, Math.min(ly, size.h - 8));
    }

    const dots: Dot[] = layout.map(({ idx, rad, ang }) => ({
      idx,
      hit: hits[idx],
      x: cx + Math.cos(ang) * rad * R,
      y: cy + Math.sin(ang) * rad * R,
    }));
    dotsRef.current = dots;

    // Thin line from the query to the selected hit.
    const sel = dots.find((d) => d.idx === activeIdx);
    if (sel) {
      ctx.strokeStyle = withAlpha(palette.human, 0.6);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(sel.x, sel.y);
      ctx.stroke();
    }

    drawFlatNode(ctx, cx, cy, 4.5, 'target', palette.ink, palette);

    // Unselected first, so the selected and hovered dots sit on top.
    const ordered = [...dots].sort(
      (a, b) => Number(a.idx === activeIdx || a.idx === hoveredIdx) - Number(b.idx === activeIdx || b.idx === hoveredIdx),
    );
    for (const d of ordered) {
      const isActive = d.idx === activeIdx;
      const isHovered = d.idx === hoveredIdx;
      const color = isActive ? palette.human : d.hit.stale ? palette.drift : isHovered ? palette.ink : palette.muted;
      drawFlatNode(ctx, d.x, d.y, isActive || isHovered ? 6 : 4.5, 'disc', color, palette);
      if (isActive || isHovered) {
        ctx.font = '600 10.5px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = palette.ink;
        ctx.fillText(`#${d.idx + 1}`, d.x, d.y - 14);
      }
    }
  }, [size, layout, hits, activeIdx, hoveredIdx]);

  useEffect(() => {
    paletteRef.current = null;
    draw();
  }, [theme, draw]);

  const hitTest = (clientX: number, clientY: number): number | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: { idx: number; d: number } | null = null;
    for (const p of dotsRef.current) {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d <= 10 && (!best || d < best.d)) best = { idx: p.idx, d };
    }
    return best?.idx ?? null;
  };

  const activeHit = hits[activeIdx];

  return (
    <div className="ricerca-radar-card">
      <div className="ricerca-radar-head">
        <span className="ricerca-radar-title">{t('esplora.ricerca.radarTitle')}</span>
        <span className="ricerca-radar-orbits">
          {indexing
            ? t('esplora.ricerca.radarIndexing')
            : t('esplora.ricerca.radarCounts', { k: counts.keyword, m: counts.meaning, b: counts.both })}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className={`ricerca-radar-canvas${hoveredIdx !== null ? ' is-hovering' : ''}`}
        role="img"
        aria-label={t('esplora.ricerca.radarCaption')}
        onPointerMove={(e) => setHoveredIdx(hitTest(e.clientX, e.clientY))}
        onPointerLeave={() => setHoveredIdx(null)}
        onClick={(e) => {
          const hit = hitTest(e.clientX, e.clientY);
          if (hit !== null) onSelect(hit);
        }}
      />
      <div className="ricerca-radar-foot">
        {activeHit
          ? t('esplora.ricerca.radarSelected', {
              rank: activeIdx + 1,
              file: activeHit.path,
              score: activeHit.score.toFixed(3),
            })
          : t('esplora.ricerca.radarCaption')}
      </div>
    </div>
  );
}
