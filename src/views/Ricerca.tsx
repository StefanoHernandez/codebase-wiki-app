import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useProject } from '../state/project';
import { formatIndexState, reduceRagProgress, type IndexStatus } from '../lib/rag-format';

type CatalogRow = { id: string; languages: string; sizeMb: number; note: string; tested: boolean };

export default function Ricerca() {
  const project = useProject();
  const repo = project.repoPath;
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [query, setQuery] = useState('');
  const [wiki, setWiki] = useState(false);
  const [preview, setPreview] = useState('');
  const [installed, setInstalled] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (!repo) return;
    try {
      const s = (await invoke('rag_status', { repo })) as IndexStatus & Record<string, unknown>;
      setStatus({
        model: String(s.model ?? ''),
        files: Number(s.files ?? 0),
        chunks: Number(s.chunks ?? 0),
        indexedHead: (s.indexedHead as string) ?? (s.indexed_head as string) ?? null,
        head: (s.head as string) ?? null,
        changedSinceIndex: Number(s.changedSinceIndex ?? s.changed_since_index ?? 0),
      });
    } catch {
      setStatus(null);
    }
    try {
      const m = (await invoke('rag_models')) as { installed?: string[] };
      setInstalled(m.installed ?? []);
    } catch {
      setInstalled([]);
    }
  }, [repo]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const un = listen<string>('rag://progress', (e) => {
      const next = reduceRagProgress(null, e.payload);
      if (next) {
        setProgress(`${next.phase}: ${next.done}/${next.total}`);
      }
      if (e.payload.includes('"event":"done"')) {
        setIndexing(false);
        void refresh();
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, [refresh]);

  const startIndex = async () => {
    if (!repo) return;
    setIndexing(true);
    setProgress('');
    await invoke('rag_index_start', { repo });
  };

  const cancelIndex = async () => {
    await invoke('rag_index_cancel');
    setIndexing(false);
  };

  const pullModel = async (id: string) => {
    await invoke('rag_set_model', { id });
    // Model pull via sidecar would be a dedicated command; use CLI externally for now.
    void refresh();
  };

  const runPreview = async () => {
    if (!repo || !query.trim()) return;
    const out = await invoke<string>('rag_preview', { repo, query, wiki });
    setPreview(out);
  };

  const catalog: CatalogRow[] = [
    { id: 'multilingual-e5-small', languages: 'multilingue', sizeMb: 120, note: 'Default', tested: true },
    { id: 'bge-small-en-v1.5', languages: 'EN', sizeMb: 130, note: 'Veloce', tested: true },
    { id: 'all-MiniLM-L6-v2', languages: 'EN', sizeMb: 90, note: 'Piccolo', tested: true },
  ];

  if (!repo) {
    return <p className="empty">Apri un progetto per usare la ricerca locale.</p>;
  }

  return (
    <div className="view ricerca-view">
      <h1 className="view-title">Ricerca</h1>
      <section className="card">
        <h2>Stato indice</h2>
        <p>{formatIndexState(status)}</p>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={indexing} onClick={() => void startIndex()}>
            Indicizza
          </button>
          <button type="button" className="btn" disabled={!indexing} onClick={() => void cancelIndex()}>
            Annulla
          </button>
        </div>
        {progress ? <p className="hint">{progress}</p> : null}
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
                  {status?.model === row.id ? ' (attivo)' : ''}
                  {!row.tested ? ' — non provato' : ''}
                </td>
                <td>{row.languages}</td>
                <td>{row.sizeMb} MB</td>
                <td>
                  {installed.includes(row.id) ? (
                    <button type="button" className="btn" onClick={() => void pullModel(row.id)}>
                      Usa questo
                    </button>
                  ) : (
                    <button type="button" className="btn" disabled title="Scarica dal terminale: models pull">
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
        <label>
          <input type="checkbox" checked={wiki} onChange={(e) => setWiki(e.target.checked)} /> Wiki
        </label>
        <button type="button" className="btn btn-primary" onClick={() => void runPreview()}>
          Cerca
        </button>
        {preview ? <pre className="preview-out">{preview}</pre> : null}
      </section>
      <section className="card">
        <h2>Collega agli agenti</h2>
        <p className="hint">Configura MCP da terminale o dalla prossima iterazione della UI Collega.</p>
      </section>
    </div>
  );
}
