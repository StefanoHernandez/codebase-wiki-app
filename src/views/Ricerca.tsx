import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { copyText } from '../api';
import { Dialog } from '../components/Dialog';
import { Empty } from '../components/Empty';
import { Markdown } from '../components/Markdown';
import { SidePanel } from '../components/SidePanel';
import { useToast } from '../components/Toast';
import { formatIndexState, parseIndexStatus, type IndexStatus } from '../lib/rag-format';
import { useProject } from '../state/project';
import { useRag } from '../state/rag';
import './ricerca.css';

type CatalogRow = { id: string; languages: string; sizeMb: number; note: string; tested: boolean; installed: boolean };
type SearchHit = { path: string; startLine: number; endLine: number; snippet: string; score: number };
type HarnessRow = { id: string; label: string; status: 'connected' | 'outdated' | 'absent'; configPath: string; hint?: string | null };
type HarnessDlg = { id: string; label: string; action: string; path: string; before: string; after: string };

const DEFAULT_MODEL = 'multilingual-e5-small';
const COPY_ONLY = new Set(['antigravity']);
const LINK_LABEL: Record<HarnessRow['status'], string> = {
  connected: 'Collegato',
  outdated: 'Da aggiornare',
  absent: 'Non collegato',
};
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Ricerca() {
  const project = useProject();
  const rag = useRag();
  const toast = useToast();
  const repo = project.snapshot?.repoPath ?? null;
  const wikiRoot = project.snapshot?.wikiRoot ?? null;
  const job = rag.indexJob(repo);

  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [harness, setHarness] = useState<HarnessRow[]>([]);
  const [harnessError, setHarnessError] = useState<string | null>(null);
  const [dlg, setDlg] = useState<HarnessDlg | null>(null);
  const [dlgBusy, setDlgBusy] = useState(false);
  const [hfQuery, setHfQuery] = useState('');
  const [hfHits, setHfHits] = useState<Array<{ id: string; downloads: number }>>([]);
  const [hfError, setHfError] = useState<string | null>(null);
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
    try {
      const m = (await invoke('rag_models')) as { catalog?: Array<Record<string, unknown>> };
      setCatalog(
        (m.catalog ?? []).map((r) => ({
          id: String(r.id ?? ''),
          languages: String(r.languages ?? ''),
          sizeMb: Number(r.size_mb ?? 0),
          note: String(r.note ?? ''),
          tested: r.tested === true,
          installed: r.installed === true,
        })),
      );
    } catch {
      setCatalog([]);
    }
  }, [repo]);

  const refreshHarness = useCallback(async () => {
    try {
      setHarness((await invoke('rag_harness_state')) as HarnessRow[]);
    } catch (e) {
      setHarnessError(message(e));
    }
  }, []);

  // Re-read when the project changes and whenever an index or download job ends.
  useEffect(() => {
    void refresh();
  }, [refresh, rag.tick]);
  useEffect(() => {
    void refreshHarness();
  }, [refreshHarness]);

  if (!repo) {
    return (
      <section className="view">
        <h1 className="view-title">Ricerca</h1>
        <Empty title="Apri un progetto per usare la ricerca locale." />
      </section>
    );
  }

  const activeModel = status?.model || DEFAULT_MODEL;

  const useModel = async (id: string) => {
    if (status?.indexed && status.indexedModel && status.indexedModel !== id) {
      if (!window.confirm("L'indice verrà ricostruito con il nuovo modello.")) return;
    }
    try {
      await invoke('rag_set_model', { id });
    } catch (e) {
      toast(message(e), 'error');
    }
    void refresh();
  };

  const searchHf = async () => {
    if (!hfQuery.trim()) return;
    setHfError(null);
    try {
      setHfHits((await invoke('rag_models_search', { q: hfQuery })) as Array<{ id: string; downloads: number }>);
    } catch (e) {
      setHfError(message(e));
    }
  };

  const addHf = async (hfRepo: string) => {
    setHfError(null);
    try {
      await invoke('rag_models_add', { hfRepo });
      toast(`${hfRepo} aggiunto al catalogo: ora puoi scaricarlo`);
      void refresh();
    } catch (e) {
      setHfError(message(e));
    }
  };

  const openHarness = async (row: HarnessRow) => {
    const action = row.status === 'connected' ? 'disconnect' : row.status === 'outdated' ? 'update' : 'connect';
    setHarnessError(null);
    try {
      const preview = (await invoke('rag_harness_preview', { harness: row.id, action })) as Omit<HarnessDlg, 'id' | 'label' | 'action'>;
      setDlg({ id: row.id, label: row.label, action, ...preview });
    } catch (e) {
      setHarnessError(message(e));
    }
  };

  const confirmHarness = async () => {
    if (!dlg) return;
    if (COPY_ONLY.has(dlg.id)) {
      await copyText(dlg.after);
      toast('Configurazione copiata');
      setDlg(null);
      return;
    }
    setDlgBusy(true);
    try {
      await invoke('rag_harness_apply', { harness: dlg.id, action: dlg.action });
      toast(dlg.action === 'disconnect' ? `${dlg.label} scollegato` : `${dlg.label} collegato`);
      setDlg(null);
      void refreshHarness();
    } catch (e) {
      setHarnessError(message(e));
      setDlg(null);
    } finally {
      setDlgBusy(false);
    }
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

  const dl = rag.download;
  const dialogVerb = dlg?.action === 'disconnect' ? 'Scollega' : dlg?.action === 'update' ? 'Aggiorna' : 'Collega';

  return (
    <section className="view">
      <h1 className="view-title">Ricerca</h1>
      {status?.staleInstall && (
        <p className="banner banner-drift">Chiudi gli agenti collegati e riapri l'app per aggiornare il server MCP.</p>
      )}

      <section className="group">
        <h2 className="group-title">Indice</h2>
        <p className={status?.indexed === false ? 'muted' : undefined}>{formatIndexState(status)}</p>
        <div className="toolbar">
          <button type="button" className="btn btn-strong" disabled={job.running || !!dl} onClick={() => void rag.startIndex(repo)}>
            {job.running && (
              <span className="spin" aria-hidden="true">
                ⟳
              </span>
            )}
            Indicizza
          </button>
          {job.running && (
            <button type="button" className="btn" onClick={() => void rag.cancelIndex(repo)}>
              Annulla
            </button>
          )}
          <label className="ricerca-check">
            <input type="checkbox" checked={rag.autoIndex} onChange={(e) => rag.setAutoIndex(e.target.checked)} />
            Indicizza automaticamente
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
        <h2 className="group-title">Modello</h2>
        <table className="table">
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
                  <span className="mono">{row.id}</span>
                  {activeModel === row.id && <span className="badge badge-ok ricerca-badge">attivo</span>}
                  {!row.tested && <span className="badge ricerca-badge">non provato</span>}
                  {row.note && <div className="muted">{row.note}</div>}
                </td>
                <td>{row.languages}</td>
                <td>{row.sizeMb > 0 ? `${row.sizeMb} MB` : '—'}</td>
                <td className="ricerca-actions">
                  {dl?.id === row.id ? (
                    <progress value={dl.done} max={dl.total || 1} aria-label={`Download ${row.id}`} />
                  ) : row.installed ? (
                    activeModel !== row.id && (
                      <button type="button" className="btn" onClick={() => void useModel(row.id)}>
                        Usa questo
                      </button>
                    )
                  ) : (
                    <button type="button" className="btn" disabled={!!dl || job.running} onClick={() => void rag.startPull(row.id)}>
                      Scarica
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rag.downloadError && <p className="error-text">{rag.downloadError}</p>}
        <div className="toolbar">
          <input
            className="input"
            value={hfQuery}
            onChange={(e) => setHfQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void searchHf()}
            placeholder="Nome o argomento del modello"
            aria-label="Cerca modelli su Hugging Face"
          />
          <button type="button" className="btn" onClick={() => void searchHf()}>
            Cerca su Hugging Face
          </button>
        </div>
        {hfError && <p className="error-text">{hfError}</p>}
        {hfHits.length > 0 && (
          <table className="table">
            <tbody>
              {hfHits.map((h) => (
                <tr key={h.id}>
                  <td className="mono">{h.id}</td>
                  <td className="muted">{h.downloads.toLocaleString('it-IT')} download</td>
                  <td className="ricerca-actions">
                    <button type="button" className="btn" onClick={() => void addHf(h.id)}>
                      Aggiungi
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="group">
        <h2 className="group-title">Collega agli agenti</h2>
        <table className="table">
          <tbody>
            {harness.map((row) => (
              <tr key={row.id}>
                <td>{row.label}</td>
                <td className={row.status === 'connected' ? undefined : 'muted'}>{LINK_LABEL[row.status]}</td>
                <td className="muted">{row.hint}</td>
                <td className="ricerca-actions">
                  <button type="button" className="btn" onClick={() => void openHarness(row)}>
                    {COPY_ONLY.has(row.id)
                      ? 'Mostra configurazione'
                      : row.status === 'connected'
                        ? 'Scollega'
                        : row.status === 'outdated'
                          ? 'Aggiorna'
                          : 'Collega'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {harnessError && <p className="error-text">{harnessError}</p>}
      </section>

      <section className="group">
        <h2 className="group-title">Prova una ricerca</h2>
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
        {hits?.map((h) => {
          const rel = wikiRel(h.path);
          const label = `${h.path}:${h.startLine}-${h.endLine}`;
          return (
            <div key={`${h.path}:${h.startLine}`} className="ricerca-hit">
              {rel ? (
                <button type="button" className="btn btn-quiet mono" onClick={() => void openHit(rel)}>
                  {label}
                </button>
              ) : (
                <span className="mono">{label}</span>
              )}
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

      <Dialog
        open={!!dlg}
        title={dlg ? `${dialogVerb} ${dlg.label}` : ''}
        confirmLabel={dlg && COPY_ONLY.has(dlg.id) ? 'Copia' : dlg?.id === 'claude' ? 'Esegui' : 'Conferma'}
        busy={dlgBusy}
        onCancel={() => setDlg(null)}
        onConfirm={() => void confirmHarness()}
      >
        {dlg && (
          <>
            <p className="dialog-note mono">{dlg.path}</p>
            {dlg.id === 'claude' || COPY_ONLY.has(dlg.id) ? (
              <>
                <pre className="ricerca-snippet">{dlg.after}</pre>
                {dlg.id === 'claude' && (
                  <button type="button" className="btn btn-quiet" onClick={() => void copyText(dlg.after).then(() => toast('Comando copiato'))}>
                    Copia comando
                  </button>
                )}
              </>
            ) : (
              <div className="ricerca-diff">
                <div>
                  <p className="muted">Prima</p>
                  <pre className="ricerca-snippet">{dlg.before || '(file assente)'}</pre>
                </div>
                <div>
                  <p className="muted">Dopo</p>
                  <pre className="ricerca-snippet">{dlg.after}</pre>
                </div>
              </div>
            )}
          </>
        )}
      </Dialog>
    </section>
  );
}
