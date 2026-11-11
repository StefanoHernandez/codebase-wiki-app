import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Empty } from '../components/Empty';
import { Markdown } from '../components/Markdown';
import { SidePanel } from '../components/SidePanel';
import { useToast } from '../components/Toast';
import { formatBytes, parseIndexStatus, type IndexStatus } from '../lib/rag-format';
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
  if (running) return { label: 'Indicizzazione in corso', tone: 'muted' };
  if (!s?.indexed) return { label: 'Indice assente', tone: 'muted' };
  const behind = (s.changedSinceIndex ?? 0) > 0 || (!!s.head && !!s.indexedHead && s.head !== s.indexedHead);
  return behind ? { label: 'Da aggiornare', tone: 'drift' } : { label: 'Aggiornato', tone: 'ok' };
}

/** Where a hit came from: keyword list, meaning (vector) list, or both. */
function matchLabel(h: SearchHit): string {
  if (h.bm25Rank && h.vecRank) return `testo #${h.bm25Rank}, significato #${h.vecRank}`;
  if (h.bm25Rank) return `solo testo #${h.bm25Rank}`;
  if (h.vecRank) return `solo significato #${h.vecRank}`;
  return '—';
}

export default function Ricerca() {
  const project = useProject();
  const rag = useRag();
  const nav = useNav();
  const toast = useToast();
  const repo = project.snapshot?.repoPath ?? null;
  const wikiRoot = project.snapshot?.wikiRoot ?? null;
  const job = rag.indexJob(repo);

  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [harness, setHarness] = useState<HarnessRow[]>([]);
  const [query, setQuery] = useState('');
  const [wiki, setWiki] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [panel, setPanel] = useState<{ path: string; markdown: string } | null>(null);

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
  useEffect(() => {
    invoke<HarnessRow[]>('rag_harness_state')
      .then(setHarness)
      .catch(() => setHarness([]));
  }, []);

  if (!repo) {
    return (
      <section className="view">
        <h1 className="view-title">Ricerca locale</h1>
        <Empty title="Apri un progetto per usare la ricerca locale." />
      </section>
    );
  }

  const busy = job.running || !!rag.download;
  const state = indexState(status, job.running);
  const code = status?.bySource?.code;
  const docs = status?.bySource?.wiki;
  const connected = harness.filter((h) => h.status !== 'absent');

  const rebuild = async (andIndex: boolean) => {
    const msg = andIndex
      ? "L'indice di questo progetto verrà cancellato e ricostruito da zero."
      : "L'indice di questo progetto verrà cancellato. La ricerca e l'MCP non risponderanno finché non lo ricrei.";
    if (!window.confirm(msg)) return;
    try {
      await invoke('rag_index_delete', { repo });
      if (andIndex) await rag.startIndex(repo);
      else toast('Indice cancellato');
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
      setHits((await invoke('rag_preview', { repo, query, wiki })) as SearchHit[]);
    } catch (e) {
      setHits(null);
      setSearchError(message(e));
    } finally {
      setSearching(false);
    }
  };

  const wikiRel = (path: string): string | null => {
    if (!wikiRoot) return null;
    const root = wikiRoot.replace(/\\/g, '/').replace(/\/+$/, '');
    const p = path.replace(/\\/g, '/');
    return p.startsWith(`${root}/`) ? p.slice(root.length + 1) : null;
  };

  const openHit = async (rel: string) => {
    try {
      setPanel({ path: rel, markdown: await invoke<string>('read_wiki_file', { repo, relPath: rel }) });
    } catch (e) {
      setSearchError(message(e));
    }
  };

  return (
    <section className="view">
      <h1 className="view-title">Ricerca locale</h1>
      <p className="muted">
        Indice del codice e della wiki di questo progetto, usato dalla ricerca qui sotto e dagli agenti via MCP.
      </p>
      {status?.staleInstall && (
        <p className="banner banner-drift">Chiudi gli agenti collegati e riapri l'app per aggiornare il server MCP.</p>
      )}

      <section className="group">
        <h2 className="group-title">Stato</h2>
        <div className="rag-tiles">
          <div className="rag-tile">
            <span className="rag-tile-label">Indice</span>
            <span className={`rag-tile-value rag-tone-${state.tone}`}>{state.label}</span>
            <span className="rag-tile-sub">
              {status?.indexed
                ? `${status.changedSinceIndex ?? 0} file cambiati, indice @${short(status.indexedHead)}, HEAD @${short(status.head)}`
                : (status?.error ?? 'Premi Indicizza per crearlo')}
            </span>
          </div>
          <div className="rag-tile">
            <span className="rag-tile-label">Contenuto</span>
            <span className="rag-tile-value">{(status?.chunks ?? 0).toLocaleString('it-IT')} frammenti</span>
            <span className="rag-tile-sub">
              codice {code?.files ?? 0} file, wiki e docs {docs?.files ?? 0} file
            </span>
          </div>
          <div className="rag-tile">
            <span className="rag-tile-label">Su disco</span>
            <span className="rag-tile-value">{formatBytes(status?.sizeBytes ?? 0)}</span>
            <span className="rag-tile-sub">
              {status?.indexedAt
                ? `ultima scrittura ${new Date(status.indexedAt * 1000).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}`
                : '—'}
            </span>
          </div>
          <div className="rag-tile">
            <span className="rag-tile-label">Modelli</span>
            <span className="rag-tile-value mono">{status?.model || DEFAULT_MODEL}</span>
            <span className="rag-tile-sub">reranker: {status?.reranker ?? 'non installato'}</span>
          </div>
          <div className="rag-tile">
            <span className="rag-tile-label">Agenti (MCP)</span>
            <span className="rag-tile-value">{connected.length ? `${connected.length} collegati` : 'Nessuno'}</span>
            <span className="rag-tile-sub">{connected.map((h) => h.label).join(', ') || 'Collegali dalle Impostazioni'}</span>
          </div>
        </div>
        <button type="button" className="btn btn-quiet" onClick={() => nav.go('impostazioni')}>
          Cambia modelli o agenti
        </button>
      </section>

      <section className="group">
        <h2 className="group-title">Azioni</h2>
        <div className="toolbar">
          <button type="button" className="btn btn-strong" disabled={busy} onClick={() => void rag.startIndex(repo)}>
            {job.running && (
              <span className="spin" aria-hidden="true">
                ⟳
              </span>
            )}
            {status?.indexed ? 'Aggiorna indice' : 'Indicizza'}
          </button>
          {job.running ? (
            <button type="button" className="btn" onClick={() => void rag.cancelIndex(repo)}>
              Annulla
            </button>
          ) : (
            status?.indexed && (
              <>
                <button type="button" className="btn" disabled={busy} onClick={() => void rebuild(true)}>
                  Ricostruisci da zero
                </button>
                <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void rebuild(false)}>
                  Elimina indice
                </button>
              </>
            )
          )}
          <label className="ricerca-check">
            <input type="checkbox" checked={rag.autoIndex} onChange={(e) => rag.setAutoIndex(e.target.checked)} />
            Aggiorna automaticamente quando cambiano i file
          </label>
        </div>
        {job.progress && (
          <div className="ricerca-progress">
            <span className="muted">
              {job.progress.phase === 'wiki' ? 'Documentazione' : 'Codice'}: {job.progress.done}/{job.progress.total}
            </span>
            <progress value={job.progress.done} max={job.progress.total || 1} />
          </div>
        )}
        {job.error && <p className="error-text">{job.error}</p>}
      </section>

      <section className="group">
        <h2 className="group-title">Prova una ricerca</h2>
        <p className="muted">Gli stessi risultati che riceve un agente con search_code o search_wiki.</p>
        <div className="toolbar">
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
            placeholder="Dove viene gestito il watcher?"
            aria-label="Domanda"
          />
          <div className="segmented" role="group" aria-label="Dove cercare">
            <button type="button" aria-pressed={!wiki} onClick={() => setWiki(false)}>
              Codice
            </button>
            <button type="button" aria-pressed={wiki} onClick={() => setWiki(true)}>
              Documentazione
            </button>
          </div>
          <button type="button" className="btn btn-strong" disabled={searching || !query.trim()} onClick={() => void runSearch()}>
            Cerca
          </button>
        </div>
        {searchError && <p className="error-text">{searchError}</p>}
        {hits && hits.length === 0 && <p className="muted">Nessun risultato.</p>}
        {hits && hits.length > 0 && (
          <p className="muted">
            {hits[0].reranked
              ? 'Ordinati dal reranker; tra parentesi la posizione prima del reranker.'
              : 'Ordinati fondendo ricerca testuale e per significato (RRF).'}
          </p>
        )}
        {hits?.map((h, i) => {
          const rel = wikiRel(h.path);
          const label = `${h.path}:${h.startLine}-${h.endLine}`;
          return (
            <div key={`${h.path}:${h.startLine}`} className="ricerca-hit">
              <div className="ricerca-hit-head">
                <span className="rag-rank">#{i + 1}</span>
                {rel ? (
                  <button type="button" className="btn btn-quiet mono" onClick={() => void openHit(rel)}>
                    {label}
                  </button>
                ) : (
                  <span className="mono">{label}</span>
                )}
                {h.stale && <span className="badge badge-drift">cambiato dopo l'indice</span>}
                <span className="ricerca-hit-meta">
                  <span>{matchLabel(h)}</span>
                  {h.reranked && <span>prima del reranker #{h.fusedRank}</span>}
                  <span>punteggio {h.score.toFixed(3)}</span>
                </span>
              </div>
              <pre className="ricerca-snippet">{h.snippet}</pre>
            </div>
          );
        })}
      </section>

      {panel && (
        <SidePanel title={panel.path} onClose={() => setPanel(null)}>
          <Markdown markdown={panel.markdown} pagePath={panel.path} />
        </SidePanel>
      )}
    </section>
  );
}
