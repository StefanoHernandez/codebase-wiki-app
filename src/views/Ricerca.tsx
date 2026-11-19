import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as api from '../api';
import { Dialog } from '../components/Dialog';
import { Empty } from '../components/Empty';
import { PageDrawer, type PageDrawerTarget } from '../components/PageDrawer';
import { useToast } from '../components/Toast';
import { locale, t } from '../i18n';
import { relativeTime } from '../lib/overview';
import {
  availableExtensions,
  formatBytes,
  isMaskedPrivateQuery,
  parseIndexStatus,
  pathExtension,
  type IndexStatus,
} from '../lib/rag-format';
import { useNav } from '../state/nav';
import { useProject } from '../state/project';
import { useRag } from '../state/rag';
import type { ActivityLine } from '../types/snapshot';
import { SemanticRadar } from './SemanticRadar';
import { searchWiki, type WikiHit } from '../lib/wiki-search';
import './ricerca.css';

const DEFAULT_MODEL = 'multilingual-e5-small';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const short = (sha?: string | null) => (sha ? sha.slice(0, 7) : '—');
const isTestPath = (p: string) => /(\b|_|\.|\/)(test|tests|spec)(\b|_|\.|\/)/i.test(p);

/** One word for the index state, and its tone. */
function indexState(
  s: IndexStatus | null,
  running: boolean,
): { label: string; tone: 'ok' | 'drift' | 'muted' } {
  if (running) return { label: t('esplora.ricerca.indexing'), tone: 'muted' };
  if (!s?.indexed) return { label: t('esplora.ricerca.noIndex'), tone: 'muted' };
  const behind =
    (s.changedSinceIndex ?? 0) > 0 || (!!s.head && !!s.indexedHead && s.head !== s.indexedHead);
  return behind
    ? { label: t('esplora.ricerca.outdated'), tone: 'drift' }
    : { label: t('esplora.ricerca.upToDate'), tone: 'ok' };
}

/** Where a hit came from: keyword list, meaning (vector) list, or both. */
function matchLabel(h: api.RagSearchHit): string {
  if (h.bm25Rank && h.vecRank) {
    return t('esplora.ricerca.matchBoth', { text: h.bm25Rank, meaning: h.vecRank });
  }
  if (h.bm25Rank) return t('esplora.ricerca.matchText', { text: h.bm25Rank });
  if (h.vecRank) return t('esplora.ricerca.matchMeaning', { meaning: h.vecRank });
  return '—';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightSnippet(snippet: string, query: string): ReactNode {
  const tokens = Array.from(
    new Set(
      query
        .trim()
        .split(/\s+/)
        .map((tok) => tok.replace(/[^a-zA-Z0-9_-]/g, ''))
        .filter((tok) => tok.length >= 2),
    ),
  ).slice(0, 6);
  if (tokens.length === 0) return snippet;
  const re = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi');
  const parts = snippet.split(re);
  const tokenSet = new Set(tokens.map((x) => x.toLowerCase()));
  return parts.map((part, idx) =>
    tokenSet.has(part.toLowerCase()) ? (
      <mark key={idx} className="ricerca-mark">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function rankFill(rank: number | null): number {
  if (!rank || rank <= 0) return 0;
  return Math.max(0.12, Math.min(1, 1 - (rank - 1) / 20));
}

function HitCard({
  hit,
  index,
  query,
  onCopy,
  onOpen,
}: {
  hit: api.RagSearchHit;
  index: number;
  query: string;
  onCopy(refLabel: string): void;
  onOpen(path: string): void;
}) {
  const label = `${hit.path}:${hit.startLine}-${hit.endLine}`;
  const bm25Fill = rankFill(hit.bm25Rank);
  const vecFill = rankFill(hit.vecRank);

  return (
    <>
      <div className="ricerca-hit-head">
        <span className="rag-rank">#{index + 1}</span>
        <span className="mono">{label}</span>
        {hit.stale && <span className="badge badge-drift">{t('esplora.ricerca.changedAfter')}</span>}
        <span className="ricerca-hit-meta">
          <span>{matchLabel(hit)}</span>
          {hit.reranked && <span>{t('esplora.ricerca.beforeRerank', { rank: hit.fusedRank })}</span>}
          <span>{t('esplora.ricerca.score', { score: hit.score.toFixed(3) })}</span>
        </span>
      </div>

      {(hit.bm25Rank || hit.vecRank) && (
        <div className="ricerca-rank-bars">
          {hit.bm25Rank && (
            <span className="ricerca-rank-pill">
              <span>{t('esplora.ricerca.rankBm25', { n: hit.bm25Rank })}</span>
              <span className="ricerca-rank-track" aria-hidden="true">
                <span
                  className="ricerca-rank-fill"
                  style={{ transform: `scaleX(${bm25Fill})` }}
                />
              </span>
            </span>
          )}
          {hit.vecRank && (
            <span className="ricerca-rank-pill">
              <span>{t('esplora.ricerca.rankVec', { n: hit.vecRank })}</span>
              <span className="ricerca-rank-track" aria-hidden="true">
                <span
                  className="ricerca-rank-fill"
                  style={{ transform: `scaleX(${vecFill})` }}
                />
              </span>
            </span>
          )}
        </div>
      )}

      <pre className="ricerca-snippet">{highlightSnippet(hit.snippet, query)}</pre>

      <div className="ricerca-hit-actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={(e) => {
            e.stopPropagation();
            onCopy(label);
          }}
        >
          {t('esplora.ricerca.copyRef')}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-strong"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(hit.path);
          }}
        >
          {t('esplora.ricerca.openDrawer')}
        </button>
      </div>
    </>
  );
}

export default function Ricerca() {
  const project = useProject();
  const rag = useRag();
  const nav = useNav();
  const toast = useToast();
  const repo = project.snapshot?.repoPath ?? null;
  const job = rag.indexJob(repo);

  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [harness, setHarness] = useState<api.HarnessRow[]>([]);
  const [query, setQuery] = useState('');
  const [wikiHits, setWikiHits] = useState<WikiHit[]>([]);
  const [hits, setHits] = useState<api.RagSearchHit[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const [extFilter, setExtFilter] = useState<string>('all');
  const [noTest, setNoTest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [drawer, setDrawer] = useState<PageDrawerTarget | null>(null);
  const [activity, setActivity] = useState<ActivityLine[]>([]);
  const [confirmAction, setConfirmAction] = useState<'rebuild' | 'delete' | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const pagesByPath = useMemo(
    () => new Map(project.pages.map((p) => [p.relPath, p])),
    [project.pages],
  );

  const refresh = useCallback(async () => {
    if (!repo) return;
    try {
      setStatus(parseIndexStatus(await api.ragStatus(repo)));
    } catch (e) {
      setStatus({ indexed: false, error: message(e) });
    }
  }, [repo]);

  useEffect(() => {
    void refresh();
  }, [refresh, rag.tick]);

  useEffect(() => {
    setExtFilter('all');
  }, [repo]);

  useEffect(() => {
    let cancelled = false;
    api
      .agentActivity(1_000_000)
      .then((a) => {
        if (!cancelled) setActivity(a.filter((l) => l.repo === repo));
      })
      .catch(() => {
        if (!cancelled) setActivity([]);
      });
    return () => {
      cancelled = true;
    };
  }, [repo, rag.tick]);

  useEffect(() => {
    api
      .ragHarnessState()
      .then(setHarness)
      .catch(() => setHarness([]));
  }, []);

  const lastCall = activity[0] ?? null;

  const recentQueries = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    const privateText = t('esplora.progetti.privateQuery');
    for (const line of activity) {
      if (line.error || !line.query) continue;
      const q = line.query.trim();
      if (!q || isMaskedPrivateQuery(q) || q === privateText || seen.has(q)) continue;
      seen.add(q);
      out.push(q);
      if (out.length >= 5) break;
    }
    return out;
  }, [activity]);

  const extOptions = useMemo(
    () => availableExtensions(hits, project.snapshot?.repoFiles ?? [], project.snapshot?.wikiRoot),
    [hits, project.snapshot?.repoFiles, project.snapshot?.wikiRoot],
  );

  useEffect(() => {
    if (extFilter !== 'all' && !extOptions.includes(extFilter)) {
      setExtFilter('all');
    }
  }, [extFilter, extOptions]);

  const filteredHits = useMemo(() => {
    if (!hits) return [];
    return hits.filter((h) => {
      if (extFilter !== 'all' && pathExtension(h.path) !== extFilter) return false;
      if (noTest && isTestPath(h.path)) return false;
      return true;
    });
  }, [hits, extFilter, noTest]);

  const clampedIdx =
    filteredHits.length === 0 ? 0 : Math.max(0, Math.min(activeIdx, filteredHits.length - 1));

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActiveIdx(0);
  }, [hits, extFilter, noTest]);

  // A dot picked on the map brings its result into view in the list.
  useEffect(() => {
    listRef.current?.children[clampedIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [clampedIdx]);

  const runSearch = useCallback(
    async (explicitQuery?: string) => {
      const target = (explicitQuery ?? query).trim();
      if (!repo || !target) return;
      if (explicitQuery !== undefined) setQuery(explicitQuery);
      // Wiki pages are already in memory: they answer at once, the code search follows.
      setWikiHits(
        searchWiki(
          project.pages.map((p) => ({ relPath: p.relPath, markdown: p.markdown, title: p.frontmatter.fields.title })),
          target,
        ),
      );
      setSearching(true);
      setSearchError(null);
      try {
        setHits(await api.ragPreview(repo, target));
      } catch (e) {
        setHits(null);
        setSearchError(message(e));
      } finally {
        setSearching(false);
      }
    },
    [repo, query, project.pages],
  );

  if (!repo) {
    return (
      <section className="view">
        <h1 className="view-title">{t('esplora.ricerca.title')}</h1>
        <Empty title={t('esplora.ricerca.openProject')} />
      </section>
    );
  }

  const busy = job.running || !!rag.download;
  const state = indexState(status, job.running);
  const code = status?.bySource?.code;
  const connected = harness.filter((h) => h.status !== 'absent');

  const executeRebuild = async (andIndex: boolean) => {
    setActionBusy(true);
    try {
      await api.ragIndexDelete(repo);
      if (andIndex) await rag.startIndex(repo);
      else toast(t('esplora.ricerca.deleted'));
    } catch (e) {
      toast(message(e), 'error');
    } finally {
      setActionBusy(false);
      setConfirmAction(null);
    }
    void refresh();
  };

  const handleCopyRef = (refLabel: string) => {
    void api
      .copyText(refLabel)
      .then(() => toast(t('esplora.ricerca.copiedRef', { ref: refLabel })))
      .catch((e) => toast(message(e), 'error'));
  };

  const showWorkbench = hits !== null || job.running || status?.indexed || wikiHits.length > 0;

  return (
    <section className="view">
      <h1 className="view-title">{t('esplora.ricerca.title')}</h1>
      <p className="muted">{t('esplora.ricerca.intro')}</p>
      {status?.staleInstall && (
        <p className="banner banner-drift">{t('esplora.ricerca.staleInstall')}</p>
      )}

      {/* Search-first Hero */}
      <div className="ricerca-hero">
        <div className="ricerca-search-row">
          <div className="ricerca-search-wrap">
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <circle cx="7" cy="7" r="4.8" />
              <path d="m10.7 10.7 3.2 3.2" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              className="ricerca-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
              placeholder={t('esplora.ricerca.placeholder')}
              aria-label={t('esplora.ricerca.question')}
            />
          </div>
          <button
            type="button"
            className="btn btn-strong"
            disabled={searching || !query.trim()}
            onClick={() => void runSearch()}
          >
            {t('esplora.ricerca.search')}
          </button>
        </div>

        <div className="ricerca-filters">
          <div className="ricerca-chip-row">
            <button
              type="button"
              className="ricerca-filter-chip"
              aria-pressed={extFilter === 'all'}
              onClick={() => setExtFilter('all')}
            >
              {t('esplora.ricerca.filterAll')}
            </button>
            {extOptions.map((ext) => (
              <button
                key={ext}
                type="button"
                className="ricerca-filter-chip"
                aria-pressed={extFilter === ext}
                onClick={() => setExtFilter((f) => (f === ext ? 'all' : ext))}
              >
                .{ext}
              </button>
            ))}
            <button
              type="button"
              className="ricerca-filter-chip"
              aria-pressed={noTest}
              onClick={() => setNoTest((v) => !v)}
            >
              {t('esplora.ricerca.filterNoTest')}
            </button>
          </div>

          {recentQueries.length > 0 && (
            <div className="ricerca-chip-row">
              <span className="ricerca-chip-label">{t('esplora.ricerca.recentQueries')}</span>
              {recentQueries.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="ricerca-query-chip"
                  title={q}
                  onClick={() => void runSearch(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Compact Telemetry & Index Actions Strip */}
      <div className="ricerca-telemetry">
        <div className="ricerca-tel-pills">
          <span className="ricerca-tel-pill">
            <span
              className={`ricerca-tel-dot ${
                job.running
                  ? 'is-running'
                  : state.tone === 'ok'
                    ? 'is-ok'
                    : state.tone === 'drift'
                      ? 'is-drift'
                      : ''
              }`}
              aria-hidden="true"
            />
            <strong>{state.label}</strong>
          </span>
          <span className="ricerca-tel-pill">
            {t('esplora.ricerca.chunks', { n: (status?.chunks ?? 0).toLocaleString(locale()) })}
            {' · '}
            {t('esplora.ricerca.codeFiles', { n: code?.files ?? 0 })}
          </span>
          <span className="ricerca-tel-pill mono">{status?.model || DEFAULT_MODEL}</span>
          <span className="ricerca-tel-pill">{formatBytes(status?.sizeBytes ?? 0)}</span>
          <span className="ricerca-tel-pill">
            {connected.length === 1
              ? t('esplora.ricerca.oneConnected')
              : connected.length
                ? t('esplora.ricerca.nConnected', { n: connected.length })
                : t('esplora.ricerca.none')}
          </span>
        </div>

        <div className="ricerca-tel-actions">
          <button
            type="button"
            className="btn btn-sm btn-strong"
            disabled={busy}
            onClick={() => void rag.startIndex(repo)}
          >
            {job.running && (
              <span className="spin" aria-hidden="true">
                ⟳
              </span>
            )}
            {status?.indexed ? t('esplora.ricerca.updateIndex') : t('esplora.ricerca.indexNow')}
          </button>
          {job.running ? (
            <button type="button" className="btn btn-sm" onClick={() => void rag.cancelIndex(repo)}>
              {t('esplora.ricerca.cancel')}
            </button>
          ) : (
            status?.indexed && (
              <>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() => setConfirmAction('rebuild')}
                >
                  {t('esplora.ricerca.rebuild')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  disabled={busy}
                  onClick={() => setConfirmAction('delete')}
                >
                  {t('esplora.ricerca.deleteIndex')}
                </button>
              </>
            )
          )}
          <label className="ricerca-check">
            <input
              type="checkbox"
              checked={rag.autoIndex}
              onChange={(e) => rag.setAutoIndex(e.target.checked)}
            />
            {t('esplora.ricerca.autoUpdate')}
          </label>
        </div>
      </div>

      {job.progress && (
        <div className="ricerca-progress">
          <span className="muted">
            {t('esplora.ricerca.progress', { done: job.progress.done, total: job.progress.total })}
          </span>
          <progress value={job.progress.done} max={job.progress.total || 1} />
        </div>
      )}
      {job.error && <p className="error-text">{job.error}</p>}
      {searchError && <p className="error-text">{searchError}</p>}

      {/* Full Index & Agent Status Tiles (collapsible for dense detail inspection) */}
      <details className="ricerca-details">
        <summary>{t('esplora.ricerca.status')}</summary>
        <div className="rag-tiles">
          <div className="rag-tile">
            <span className="rag-tile-label">{t('esplora.ricerca.index')}</span>
            <span className={`rag-tile-value rag-tone-${state.tone}`}>{state.label}</span>
            <span className="rag-tile-sub">
              {status?.indexed
                ? t('esplora.ricerca.indexSub', {
                    changed: status.changedSinceIndex ?? 0,
                    indexed: short(status.indexedHead),
                    head: short(status.head),
                  })
                : (status?.error ?? t('esplora.ricerca.pressIndex'))}
            </span>
          </div>
          <div className="rag-tile">
            <span className="rag-tile-label">{t('esplora.ricerca.content')}</span>
            <span className="rag-tile-value">
              {t('esplora.ricerca.chunks', { n: (status?.chunks ?? 0).toLocaleString(locale()) })}
            </span>
            <span className="rag-tile-sub">
              {t('esplora.ricerca.codeFiles', { n: code?.files ?? 0 })}
            </span>
          </div>
          <div className="rag-tile">
            <span className="rag-tile-label">{t('esplora.ricerca.disk')}</span>
            <span className="rag-tile-value">{formatBytes(status?.sizeBytes ?? 0)}</span>
            <span className="rag-tile-sub">
              {status?.indexedAt
                ? t('esplora.ricerca.lastWrite', {
                    when: new Date(status.indexedAt * 1000).toLocaleString(locale(), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }),
                  })
                : '—'}
            </span>
          </div>
          <div className="rag-tile">
            <span className="rag-tile-label">{t('esplora.ricerca.models')}</span>
            <span className="rag-tile-value mono">{status?.model || DEFAULT_MODEL}</span>
            <span className="rag-tile-sub">
              {t('esplora.ricerca.reranker', {
                name: status?.reranker ?? t('esplora.ricerca.notInstalled'),
              })}
            </span>
          </div>
          <div className="rag-tile">
            <span className="rag-tile-label">{t('esplora.ricerca.agents')}</span>
            <span className="rag-tile-value">
              {connected.length === 1
                ? t('esplora.ricerca.oneConnected')
                : connected.length
                  ? t('esplora.ricerca.nConnected', { n: connected.length })
                  : t('esplora.ricerca.none')}
            </span>
            <span className="rag-tile-sub">
              {connected.map((h) => h.label).join(', ') || t('esplora.ricerca.connectInSettings')}
            </span>
            <span className="rag-tile-sub">
              {lastCall
                ? t('esplora.ricerca.lastCall', {
                    agent: lastCall.agent,
                    when: relativeTime(lastCall.ts, Date.now()),
                  })
                : t('esplora.ricerca.noCall')}
            </span>
            <button type="button" className="btn btn-link" onClick={() => nav.go('progetti')}>
              {t('esplora.ricerca.seeActivity')}
            </button>
          </div>
        </div>
        <button type="button" className="btn btn-link" onClick={() => nav.go('impostazioni')}>
          {t('esplora.ricerca.changeModels')}
        </button>
      </details>

      {/* Workbench: result map + list */}
      {showWorkbench && (
        <div className="ricerca-workbench">
          <SemanticRadar
            hits={filteredHits}
            activeIdx={clampedIdx}
            onSelect={setActiveIdx}
            indexing={job.running}
          />

          <div className="ricerca-results-col">
            {wikiHits.length > 0 && (
              <section className="panel ricerca-wiki" aria-label={t('esplora.ricerca.inWiki')}>
                <h2 className="ricerca-wiki-title">{t('esplora.ricerca.inWiki')}</h2>
                <ul>
                  {wikiHits.map((w) => (
                    <li key={w.relPath}>
                      <button
                        type="button"
                        className="ricerca-wiki-hit"
                        onClick={() => setDrawer({ mode: 'wiki', wikiRelPath: w.relPath })}
                      >
                        <span className="ricerca-wiki-name">{w.title}</span>
                        <span className="ricerca-wiki-path">{w.relPath}</span>
                        {w.snippet && <span className="ricerca-wiki-snippet">{w.snippet}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {hits === null ? (
              <div className="panel" style={{ padding: '18px 16px' }}>
                <p className="muted">{t('esplora.ricerca.tryHint')}</p>
              </div>
            ) : filteredHits.length === 0 ? (
              <div className="panel" style={{ padding: '18px 16px' }}>
                <p className="muted">{t('esplora.ricerca.noResults')}</p>
              </div>
            ) : (
              <>
                <div className="ricerca-results-bar">
                  <span className="muted">
                    {filteredHits[0].reranked
                      ? t('esplora.ricerca.orderReranked')
                      : t('esplora.ricerca.orderFused')}
                  </span>
                </div>

                <div ref={listRef}>
                  {filteredHits.map((h, i) => (
                    <div
                      key={`${h.path}:${h.startLine}`}
                      className={`ricerca-hit card${i === clampedIdx ? ' is-active' : ''}`}
                      onClick={() => setActiveIdx(i)}
                    >
                      <HitCard
                        hit={h}
                        index={i}
                        query={query}
                        onCopy={handleCopyRef}
                        onOpen={(relPath) => setDrawer({ mode: 'source', relPath })}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={confirmAction !== null}
        title={confirmAction === 'rebuild' ? t('esplora.ricerca.rebuild') : t('esplora.ricerca.deleteIndex')}
        confirmLabel={confirmAction === 'rebuild' ? t('esplora.ricerca.rebuild') : t('esplora.ricerca.deleteIndex')}
        busy={actionBusy}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => confirmAction && void executeRebuild(confirmAction === 'rebuild')}
      >
        <p className="dialog-note">
          {confirmAction === 'rebuild' ? t('esplora.ricerca.confirmRebuild') : t('esplora.ricerca.confirmDelete')}
        </p>
      </Dialog>

      <PageDrawer
        open={drawer !== null}
        target={drawer}
        repo={repo}
        pagesByPath={pagesByPath}
        onClose={() => setDrawer(null)}
        onOpenWiki={(wikiRelPath) => setDrawer({ mode: 'wiki', wikiRelPath })}
        onOpenSource={(relPath, fromWikiPath) =>
          setDrawer({ mode: 'source', relPath, fromWikiPath })
        }
      />
    </section>
  );
}
