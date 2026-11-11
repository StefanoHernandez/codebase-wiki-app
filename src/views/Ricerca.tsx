import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useProject } from '../state/project';
import { useRag } from '../state/rag';
import { formatIndexState, type IndexStatus } from '../lib/rag-format';
import { SidePanel } from '../components/SidePanel';

type CatalogRow = {
  id: string;
  languages: string;
  sizeMb: number;
  note: string;
  tested: boolean;
  installed: boolean;
};

type SearchHit = {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
};

const DEFAULT_MODEL = 'multilingual-e5-small';

export default function Ricerca() {
  const project = useProject();
  const rag = useRag();
  const repo = project.snapshot?.repoPath ?? null;
  const wikiRoot = project.snapshot?.wikiRoot ?? null;
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [query, setQuery] = useState('');
  const [wiki, setWiki] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [panel, setPanel] = useState<{ path: string; markdown: string } | null>(null);

  const job = rag.jobFor(repo);

  const refresh = useCallback(async () => {
    if (!repo) return;
    try {
      const s = (await invoke('rag_status', { repo })) as Record<string, unknown>;
      setStatus(rag.parseStatus(s));
    } catch {
      setStatus(null);
    }
    try {
      const m = (await invoke('rag_models')) as {
        catalog?: Array<Record<string, unknown>>;
      };
      const rows =
        m.catalog?.map((row) => ({
          id: String(row.id ?? ''),
          languages: String(row.languages ?? ''),
          sizeMb: Number(row.size_mb ?? row.sizeMb ?? 0),
          note: String(row.note ?? ''),
          tested: row.tested === true,
          installed: row.installed === true,
        })) ?? [];
      setCatalog(rows);
    } catch {
      setCatalog([]);
    }
  }, [repo, rag]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeModel = status?.model || DEFAULT_MODEL;

  const startIndex = async () => {
    if (!repo) return;
    rag.noteIndexStart(repo);
    await invoke('rag_index_start', { repo });
  };

  const cancelIndex = async () => {
    if (!repo) return;
    await invoke('rag_index_cancel', { repo });
  };

  const useModel = async (id: string) => {
    if (status?.indexedModel && status.indexedModel !== id) {
      if (!window.confirm("L'indice verrà ricostruito con il nuovo modello.")) return;
    }
    await invoke('rag_set_model', { id });
    void refresh();
  };

  const pullModel = async (id: string) => {
    if (!repo) return;
    rag.noteDownloadStart(repo, id);
    await invoke('rag_model_pull', { id });
  };

  const runPreview = async () => {
    if (!repo || !query.trim()) return;
    setPreviewLoading(true);
    setSearchError(null);
    setHits([]);
    try {
      const out = (await invoke('rag_preview', { repo, query, wiki })) as SearchHit[];
      setHits(out);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewLoading(false);
    }
  };

  const openHit = async (hit: SearchHit) => {
    if (!repo || !wikiRoot) return;
    const normRoot = wikiRoot.replace(/\\/g, '/').replace(/\/+$/, '');
    const normPath = hit.path.replace(/\\/g, '/');
    if (!normPath.startsWith(`${normRoot}/`) && normPath !== normRoot) return;
    const rel = normPath.startsWith(`${normRoot}/`) ? normPath.slice(normRoot.length + 1) : normPath;
    try {
      const markdown = await invoke<string>('read_wiki_file', { repo, relPath: rel });
      setPanel({ path: rel, markdown });
    } catch {
      setSearchError('Impossibile aprire la pagina wiki.');
    }
  };

  if (!repo) {
    return <p className="empty">Apri un progetto per usare la ricerca locale.</p>;
  }

  return (
    <div className="view ricerca-view">
      <h1 className="view-title">Ricerca</h1>
      {status?.staleInstall ? (
        <p className="hint">Chiudi gli agenti collegati e riapri l'app per aggiornare il server MCP.</p>
      ) : null}
      <section className="card">
        <h2>Stato indice</h2>
        <p>{formatIndexState(status)}</p>
        <label className="grafo-toggle">
          <input
            type="checkbox"
            checked={rag.autoIndex}
            onChange={(e) => rag.setAutoIndex(e.target.checked)}
          />
          Indicizza automaticamente
        </label>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={job.running} onClick={() => void startIndex()}>
            Indicizza
          </button>
          <button type="button" className="btn" disabled={!job.running} onClick={() => void cancelIndex()}>
            Annulla
          </button>
        </div>
        {job.progress ? (
          <progress value={job.progress.done} max={job.progress.total || 1}>
            {job.progress.phase}
          </progress>
        ) : null}
        {job.progress ? (
          <p className="hint">
            {job.progress.phase}: {job.progress.done}/{job.progress.total}
          </p>
        ) : null}
        {job.error ? <p className="error">{job.error}</p> : null}
      </section>
      <section className="card">
        <h2>Modello</h2>
        <table className="wiki-table">
          <thead>
            <tr>
              <th>Modello</th>
              <th>Lingue</th>
              <th>Dimensione</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {catalog.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.id}
                  {activeModel === row.id ? ' (attivo)' : ''}
                  {!row.tested ? ' — non provato' : ''}
                  {row.note ? ` — ${row.note}` : ''}
                </td>
                <td>{row.languages}</td>
                <td>{row.sizeMb} MB</td>
                <td>
                  {row.installed ? (
                    <button type="button" className="btn" onClick={() => void useModel(row.id)}>
                      Usa questo
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={job.downloading}
                      onClick={() => void pullModel(row.id)}
                    >
                      Scarica
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>Prova una ricerca</h2>
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Dove è definito…"
        />
        <div className="segmented">
          <button type="button" aria-pressed={!wiki} onClick={() => setWiki(false)}>
            Codice
          </button>
          <button type="button" aria-pressed={wiki} onClick={() => setWiki(true)}>
            Documentazione
          </button>
        </div>
        <button type="button" className="btn btn-primary" disabled={previewLoading} onClick={() => void runPreview()}>
          Cerca
        </button>
        {searchError ? <p className="error">{searchError}</p> : null}
        <ul className="search-hits">
          {hits.map((h) => (
            <li key={`${h.path}:${h.startLine}`}>
              <button type="button" className="linklike" onClick={() => void openHit(h)}>
                {h.path}:{h.startLine}-{h.endLine}
              </button>
              <pre className="preview-out">{h.snippet}</pre>
            </li>
          ))}
        </ul>
      </section>
      {panel ? (
        <SidePanel title={panel.path} onClose={() => setPanel(null)}>
          <pre className="preview-out">{panel.markdown}</pre>
        </SidePanel>
      ) : null}
    </div>
  );
}
