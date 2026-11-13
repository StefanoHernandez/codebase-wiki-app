import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Empty } from '../components/Empty';
import { useToast } from '../components/Toast';
import { formatBytes, parseIndexStatus, type IndexStatus } from '../lib/rag-format';
import { relativeTime } from '../lib/overview';
import { locale, t } from '../i18n';
import { agentActivity } from '../api';
import type { ActivityLine } from '../types/snapshot';
import { useNav } from '../state/nav';
import { useProject } from '../state/project';
import { useRag } from '../state/rag';
import './ricerca.css';

type SearchHit = {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  bm25Rank: number | null;
  vecRank: number | null;
  fusedRank: number;
  reranked: boolean;
  stale: boolean;
};
type HarnessRow = { id: string; label: string; status: 'connected' | 'outdated' | 'absent' };

const DEFAULT_MODEL = 'multilingual-e5-small';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const short = (sha?: string | null) => (sha ? sha.slice(0, 7) : '—');

/** One word for the index state, and its tone. */
function indexState(s: IndexStatus | null, running: boolean): { label: string; tone: 'ok' | 'drift' | 'muted' } {
  if (running) return { label: t('esplora.ricerca.indexing'), tone: 'muted' };
  if (!s?.indexed) return { label: t('esplora.ricerca.noIndex'), tone: 'muted' };
  const behind = (s.changedSinceIndex ?? 0) > 0 || (!!s.head && !!s.indexedHead && s.head !== s.indexedHead);
  return behind ? { label: t('esplora.ricerca.outdated'), tone: 'drift' } : { label: t('esplora.ricerca.upToDate'), tone: 'ok' };
}

/** Where a hit came from: keyword list, meaning (vector) list, or both. */
function matchLabel(h: SearchHit): string {
  if (h.bm25Rank && h.vecRank) return t('esplora.ricerca.matchBoth', { text: h.bm25Rank, meaning: h.vecRank });
  if (h.bm25Rank) return t('esplora.ricerca.matchText', { text: h.bm25Rank });
  if (h.vecRank) return t('esplora.ricerca.matchMeaning', { meaning: h.vecRank });
  return '—';
}

export default function Ricerca() {
  const project = useProject();
  const rag = useRag();
  const nav = useNav();
  const toast = useToast();
  const repo = project.snapshot?.repoPath ?? null;
  const job = rag.indexJob(repo);

  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [harness, setHarness] = useState<HarnessRow[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const refresh = useCallback(async () => {
    if (!repo) return;
    try {
      setStatus(parseIndexStatus((await invoke('rag_status', { repo })) as Record<string, unknown>));
    } catch (e) {
      setStatus({ indexed: false, error: message(e) });
    }
  }, [repo]);

  // Re-read when the project changes and whenever an index or download job ends.
  useEffect(() => {
    void refresh();
  }, [refresh, rag.tick]);
  const [lastCall, setLastCall] = useState<ActivityLine | null>(null);
  useEffect(() => {
    let cancelled = false;
    agentActivity(1_000_000)
      .then((a) => !cancelled && setLastCall(a.find((l) => l.repo === repo) ?? null))
      .catch(() => !cancelled && setLastCall(null));
    return () => {
      cancelled = true;
    };
  }, [repo, rag.tick]);
  useEffect(() => {
    invoke<HarnessRow[]>('rag_harness_state')
      .then(setHarness)
      .catch(() => setHarness([]));
  }, []);

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

  const rebuild = async (andIndex: boolean) => {
    const msg = andIndex
      ? t('esplora.ricerca.confirmRebuild')
      : t('esplora.ricerca.confirmDelete');
    if (!window.confirm(msg)) return;
    try {
      await invoke('rag_index_delete', { repo });
      if (andIndex) await rag.startIndex(repo);
      else toast(t('esplora.ricerca.deleted'));
    } catch (e) {
      toast(message(e), 'error');
    }
    void refresh();
  };

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      setHits((await invoke('rag_preview', { repo, query })) as SearchHit[]);
    } catch (e) {
      setHits(null);
      setSearchError(message(e));
    } finally {
      setSearching(false);
    }
  };

  return (
    <section className="view">
      <h1 className="view-title">{t('esplora.ricerca.title')}</h1>
      <p className="muted">{t('esplora.ricerca.intro')}</p>
      {status?.staleInstall && (
        <p className="banner banner-drift">{t('esplora.ricerca.staleInstall')}</p>
      )}

      <section className="group">
        <h2 className="group-title">{t('esplora.ricerca.status')}</h2>
        <div className="rag-tiles">
          <div className="rag-tile">
            <span className="rag-tile-label">{t('esplora.ricerca.index')}</span>
            <span className={`rag-tile-value rag-tone-${state.tone}`}>{state.label}</span>
            <span className="rag-tile-sub">
              {status?.indexed
                ? t('esplora.ricerca.indexSub', { changed: status.changedSinceIndex ?? 0, indexed: short(status.indexedHead), head: short(status.head) })
                : (status?.error ?? t('esplora.ricerca.pressIndex'))}
            </span>
          </div>
          <div className="rag-tile">
            <span className="rag-tile-label">{t('esplora.ricerca.content')}</span>
            <span className="rag-tile-value">{t('esplora.ricerca.chunks', { n: (status?.chunks ?? 0).toLocaleString(locale()) })}</span>
            <span className="rag-tile-sub">{t('esplora.ricerca.codeFiles', { n: code?.files ?? 0 })}</span>
          </div>
          <div className="rag-tile">
            <span className="rag-tile-label">{t('esplora.ricerca.disk')}</span>
            <span className="rag-tile-value">{formatBytes(status?.sizeBytes ?? 0)}</span>
            <span className="rag-tile-sub">
              {status?.indexedAt
                ? t('esplora.ricerca.lastWrite', { when: new Date(status.indexedAt * 1000).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' }) })
                : '—'}
            </span>
          </div>
          <div className="rag-tile">
            <span className="rag-tile-label">{t('esplora.ricerca.models')}</span>
            <span className="rag-tile-value mono">{status?.model || DEFAULT_MODEL}</span>
            <span className="rag-tile-sub">{t('esplora.ricerca.reranker', { name: status?.reranker ?? t('esplora.ricerca.notInstalled') })}</span>
          </div>
          <div className="rag-tile">
            <span className="rag-tile-label">{t('esplora.ricerca.agents')}</span>
            <span className="rag-tile-value">{connected.length === 1 ? t('esplora.ricerca.oneConnected') : connected.length ? t('esplora.ricerca.nConnected', { n: connected.length }) : t('esplora.ricerca.none')}</span>
            <span className="rag-tile-sub">{connected.map((h) => h.label).join(', ') || t('esplora.ricerca.connectInSettings')}</span>
            <span className="rag-tile-sub">
              {lastCall ? t('esplora.ricerca.lastCall', { agent: lastCall.agent, when: relativeTime(lastCall.ts, Date.now()) }) : t('esplora.ricerca.noCall')}
            </span>
            <button type="button" className="btn btn-link" onClick={() => nav.go('progetti')}>
              {t('esplora.ricerca.seeActivity')}
            </button>
          </div>
        </div>
        <button type="button" className="btn btn-link" onClick={() => nav.go('impostazioni')}>
          {t('esplora.ricerca.changeModels')}
        </button>
      </section>

      <section className="group">
        <h2 className="group-title">{t('esplora.ricerca.actions')}</h2>
        <div className="toolbar">
          <button type="button" className="btn btn-strong" disabled={busy} onClick={() => void rag.startIndex(repo)}>
            {job.running && (
              <span className="spin" aria-hidden="true">
                ⟳
              </span>
            )}
            {status?.indexed ? t('esplora.ricerca.updateIndex') : t('esplora.ricerca.indexNow')}
          </button>
          {job.running ? (
            <button type="button" className="btn" onClick={() => void rag.cancelIndex(repo)}>
              {t('esplora.ricerca.cancel')}
            </button>
          ) : (
            status?.indexed && (
              <>
                <button type="button" className="btn" disabled={busy} onClick={() => void rebuild(true)}>
                  {t('esplora.ricerca.rebuild')}
                </button>
                <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void rebuild(false)}>
                  {t('esplora.ricerca.deleteIndex')}
                </button>
              </>
            )
          )}
          <label className="ricerca-check">
            <input type="checkbox" checked={rag.autoIndex} onChange={(e) => rag.setAutoIndex(e.target.checked)} />
            {t('esplora.ricerca.autoUpdate')}
          </label>
        </div>
        {job.progress && (
          <div className="ricerca-progress">
            <span className="muted">{t('esplora.ricerca.progress', { done: job.progress.done, total: job.progress.total })}</span>
            <progress value={job.progress.done} max={job.progress.total || 1} />
          </div>
        )}
        {job.error && <p className="error-text">{job.error}</p>}
      </section>

      <section className="group">
        <h2 className="group-title">{t('esplora.ricerca.tryTitle')}</h2>
        <p className="muted">{t('esplora.ricerca.tryHint')}</p>
        <div className="toolbar">
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
            placeholder={t('esplora.ricerca.placeholder')}
            aria-label={t('esplora.ricerca.question')}
          />
          <button type="button" className="btn btn-strong" disabled={searching || !query.trim()} onClick={() => void runSearch()}>
            {t('esplora.ricerca.search')}
          </button>
        </div>
        {searchError && <p className="error-text">{searchError}</p>}
        {hits && hits.length === 0 && <p className="muted">{t('esplora.ricerca.noResults')}</p>}
        {hits && hits.length > 0 && (
          <p className="muted">
            {hits[0].reranked
              ? t('esplora.ricerca.orderReranked')
              : t('esplora.ricerca.orderFused')}
          </p>
        )}
        {hits?.map((h, i) => {
          const label = `${h.path}:${h.startLine}-${h.endLine}`;
          return (
            <div key={`${h.path}:${h.startLine}`} className="ricerca-hit">
              <div className="ricerca-hit-head">
                <span className="rag-rank">#{i + 1}</span>
                <span className="mono">{label}</span>
                {h.stale && <span className="badge badge-drift">{t('esplora.ricerca.changedAfter')}</span>}
                <span className="ricerca-hit-meta">
                  <span>{matchLabel(h)}</span>
                  {h.reranked && <span>{t('esplora.ricerca.beforeRerank', { rank: h.fusedRank })}</span>}
                  <span>{t('esplora.ricerca.score', { score: h.score.toFixed(3) })}</span>
                </span>
              </div>
              <pre className="ricerca-snippet">{h.snippet}</pre>
            </div>
          );
        })}
      </section>

    </section>
  );
}
