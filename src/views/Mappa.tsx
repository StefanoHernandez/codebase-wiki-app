import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { copyText } from '../api';
import { t } from '../i18n/index.ts';
import type { FileCoverage } from '../lib/coverage';
import { buildTree, squarify, type MapNode } from '../lib/treemap';
import { documentPrompt } from './Copertura';

export type GraphLens = 'map' | 'links' | 'coverage';

/** The three ways to look at the project in the Graph section, the same switch in each. */
export function LensSwitch({ value, onChange }: { value: GraphLens; onChange(lens: GraphLens): void }) {
  const lenses: Array<[GraphLens, string]> = [
    ['map', t('esplora.mappa.title')],
    ['links', t('esplora.mappa.links')],
    ['coverage', t('esplora.mappa.list')],
  ];
  return (
    <div className="lens-switch" role="group" aria-label={t('esplora.mappa.views')}>
      {lenses.map(([lens, text]) => (
        <button key={lens} type="button" aria-pressed={value === lens} onClick={() => onChange(lens)}>
          {text}
        </button>
      ))}
    </div>
  );
}

interface Props {
  files: FileCoverage[];
  /** Wiki paths of decision pages, to list the decisions that touch an area. */
  decisionPaths: Set<string>;
  onLens(lens: GraphLens): void;
  onOpenWiki(wikiRelPath: string): void;
  onOpenSource(relPath: string, fromWikiPath?: string): void;
}

type Status = 'ok' | 'drift' | 'uncovered';

/** Tile colour: amber when something drifted, grey when most files have no page, green otherwise. */
function statusOf(n: MapNode): Status {
  if (n.drifted > 0) return 'drift';
  if (n.uncovered * 2 >= n.files.length) return 'uncovered';
  return 'ok';
}

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

function find(root: MapNode, path: string): MapNode | null {
  if (root.path === path && root.kind === 'folder') return root;
  for (const c of root.children) {
    if (c.kind === 'folder' && (path === c.path || path.startsWith(c.path + '/'))) return find(c, path);
  }
  return null;
}

/**
 * Code map: the folder in view as tiles sized by file count and coloured by wiki coverage.
 * Click selects a tile, double click (or Enter) opens a folder; the side panel says what
 * describes the selected area and what is missing.
 */
export function Mappa({ files, decisionPaths, onLens, onOpenWiki, onOpenSource }: Props) {
  const root = useMemo(() => buildTree(files), [files]);
  const [path, setPath] = useState('');
  const [selected, setSelected] = useState<MapNode | null>(null);
  const [copied, setCopied] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const current = find(root, path) ?? root;
  const tiles = useMemo(() => {
    const kids = current.children.filter((c) => c.files.length > 0);
    const rects = squarify(
      kids.map((c) => c.files.length),
      { x: 0, y: 0, w: size.w, h: size.h },
    );
    return kids.map((node, i) => ({ node, r: rects[i] }));
  }, [current, size]);

  const inside = (n: MapNode) => current.path === '' || n.path === current.path || n.path.startsWith(current.path + '/');
  const shown = selected && selected !== current && inside(selected) ? selected : current;
  const enter = (n: MapNode) => {
    if (n.kind !== 'folder') return;
    setPath(n.path);
    setSelected(null);
  };

  const crumbs = path ? path.split('/') : [];
  const pages = useMemo(() => {
    const freq = new Map<string, number>();
    for (const f of shown.files) for (const p of f.pages) freq.set(p, (freq.get(p) ?? 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p);
  }, [shown]);
  const decisions = pages.filter((p) => decisionPaths.has(p));
  const describing = pages.filter((p) => !decisionPaths.has(p));
  const missing = shown.files.filter((f) => f.pages.length === 0);
  const label = (n: MapNode) =>
    n.kind === 'loose' ? t('esplora.mappa.loose', { n: n.files.length }) : n.path || t('esplora.copertura.root');

  // A main folder with room shows its subfolders inside (one level), like a nested map.
  const HEAD = 24;
  const PAD = 4;
  const renderTile = (node: MapNode, r: { x: number; y: number; w: number; h: number }, depth: number): JSX.Element => {
    const key = `${depth}:${node.kind}:${node.path}`;
    const kids = node.children.filter((c) => c.files.length > 0);
    const nest = depth === 0 && node.kind === 'folder' && kids.length > 1 && r.w > 150 && r.h > 110;
    const common = {
      title: `${label(node)} · ${t('esplora.copertura.rowAria', { v: node.verified, d: node.drifted, u: node.uncovered })}`,
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        setSelected(node);
      },
      onDoubleClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        enter(node);
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && node.kind === 'folder') {
          e.preventDefault();
          e.stopPropagation();
          enter(node);
        }
      },
    };
    if (nest) {
      const inner = squarify(
        kids.map((c) => c.files.length),
        { x: PAD, y: HEAD, w: r.w - 2 * PAD, h: r.h - HEAD - PAD },
      );
      return (
        <div
          key={key}
          className={`mappa-group${shown === node ? ' is-selected' : ''}`}
          style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
        >
          <button type="button" className="mappa-group-head" {...common}>
            <span className="mappa-tile-name">{node.name}/</span>
            <span className="mappa-tile-meta">
              {t('esplora.mappa.tileMeta', { n: node.files.length, v: pct(node.verified, node.files.length) })}
            </span>
          </button>
          {kids.map((c, i) => renderTile(c, inner[i], depth + 1))}
        </div>
      );
    }
    const roomy = r.w > 80 && r.h > 40;
    return (
      <button
        key={key}
        type="button"
        className={`mappa-tile is-${statusOf(node)}${shown === node ? ' is-selected' : ''}`}
        style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
        {...common}
      >
        {roomy && (
          <>
            <span className="mappa-tile-name">
              {node.kind === 'loose' ? t('esplora.mappa.loose', { n: node.files.length }) : node.name}
              {node.kind === 'folder' && '/'}
            </span>
            <span className="mappa-tile-meta">
              {t('esplora.mappa.tileMeta', { n: node.files.length, v: pct(node.verified, node.files.length) })}
            </span>
          </>
        )}
        <span className="mappa-tile-bar" aria-hidden="true">
          <span className="cov-verified" style={{ flexGrow: node.verified }} />
          <span className="cov-drift" style={{ flexGrow: node.drifted }} />
          <span className="cov-uncovered" style={{ flexGrow: node.uncovered }} />
        </span>
      </button>
    );
  };

  const copy = async () => {
    await copyText(documentPrompt({ dir: shown.path || '.', ...shown }));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="mappa">
      <div className="mappa-head">
        <nav className="mappa-crumbs" aria-label={t('esplora.mappa.where')}>
          <button type="button" onClick={() => enter(root)}>
            {t('esplora.copertura.root')}
          </button>
          {crumbs.map((c, i) => {
            const p = crumbs.slice(0, i + 1).join('/');
            return (
              <span key={p}>
                <span aria-hidden="true">/</span>
                <button type="button" onClick={() => setPath(p)} aria-current={p === path ? 'page' : undefined}>
                  {c}
                </button>
              </span>
            );
          })}
        </nav>
        <div className="copertura-key" aria-hidden="true">
          <span><i className="cov-verified" />{t('esplora.copertura.verified')}</span>
          <span><i className="cov-drift" />{t('esplora.copertura.drift')}</span>
          <span><i className="cov-uncovered" />{t('esplora.copertura.uncovered')}</span>
        </div>
        <LensSwitch value="map" onChange={onLens} />
      </div>

      <div className="mappa-body">
        <div className="mappa-box" ref={boxRef}>
          {tiles.map(({ node, r }) => renderTile(node, r, 0))}
          {tiles.length === 0 && <p className="muted mappa-empty">{t('esplora.copertura.empty')}</p>}
        </div>

        <aside className="mappa-side" aria-label={label(shown)}>
          <h2 className="mappa-side-title">{label(shown)}</h2>
          <p className="mappa-side-sum">
            {t('esplora.copertura.summary', {
              n: shown.files.length,
              v: pct(shown.verified, shown.files.length),
              d: pct(shown.drifted, shown.files.length),
              u: pct(shown.uncovered, shown.files.length),
            })}
          </p>
          {shown.kind === 'folder' && shown !== current && (
            <button type="button" className="btn btn-sm" onClick={() => enter(shown)}>
              {t('esplora.mappa.open')}
            </button>
          )}

          <h3 className="mappa-side-h">{t('esplora.mappa.pages')}</h3>
          {describing.length === 0 ? (
            <p className="muted mappa-side-none">{t('esplora.mappa.none')}</p>
          ) : (
            <div className="mappa-chips">
              {describing.slice(0, 12).map((p) => (
                <button key={p} type="button" className="copertura-chip" onClick={() => onOpenWiki(p)}>
                  {p}
                </button>
              ))}
            </div>
          )}

          {decisions.length > 0 && (
            <>
              <h3 className="mappa-side-h">{t('esplora.mappa.decisions')}</h3>
              <div className="mappa-chips">
                {decisions.map((p) => (
                  <button key={p} type="button" className="copertura-chip" onClick={() => onOpenWiki(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </>
          )}

          {missing.length > 0 && (
            <>
              <h3 className="mappa-side-h">{t('esplora.mappa.missing', { n: missing.length })}</h3>
              <ul className="mappa-missing">
                {missing.slice(0, 8).map((f) => (
                  <li key={f.path}>
                    <button type="button" className="copertura-file" onClick={() => onOpenSource(f.path)}>
                      {f.path}
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn btn-sm" onClick={copy}>
                {copied ? t('esplora.copertura.copied') : t('esplora.copertura.copyPrompt')}
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
