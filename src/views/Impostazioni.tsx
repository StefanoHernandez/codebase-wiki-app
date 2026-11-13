import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appVersion, copyText } from '../api';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { parseIndexStatus, type IndexStatus } from '../lib/rag-format';
import { PYTHON_KEY, useProject } from '../state/project';
import { useRag } from '../state/rag';
import { useNav } from '../state/nav';
import { useUpdates } from '../state/updates';
import { useLang } from '../state/lang';
import { hasKey, locale, t } from '../i18n';
import { resetHints } from '../lib/hints';
import { HINTS_CHANGED } from '../components/Guide';
import { markFirstRunDone } from './PrimiPassi';
import { AGENT_LABEL, pluginBlocked, pluginStateText, type PluginRow } from '../lib/plugin';
import type { ThemeChoice } from '../state/theme';
import './ricerca.css';

type CatalogRow = { id: string; languages: string; sizeMb: number; note: string; tested: boolean; installed: boolean };
type HarnessRow = { id: string; label: string; status: 'connected' | 'outdated' | 'absent'; configPath: string; hint?: string | null };
type HarnessDlg = { id: string; label: string; action: string; path: string; before: string; after: string };

const DEFAULT_MODEL = 'multilingual-e5-small';
const linkLabel = (s: HarnessRow['status']) => t(`impostazioni.link.${s}`);
const THEMES: ThemeChoice[] = ['system', 'light', 'dark'];
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Catalog texts come from the backend in English; known ids get the chosen language, custom models a fixed label.
const catalogText = (id: string, part: 'note' | 'lang') => {
  const key = `impostazioni.catalog.${part}.${id}`;
  return hasKey(key) ? t(key) : t(part === 'note' ? 'impostazioni.catalog.customNote' : 'impostazioni.catalog.customLang');
};
const toRow = (r: Record<string, unknown>): CatalogRow => ({
  id: String(r.id ?? ''),
  languages: catalogText(String(r.id ?? ''), 'lang'),
  sizeMb: Number(r.size_mb ?? 0),
  note: catalogText(String(r.id ?? ''), 'note'),
  tested: r.tested === true,
  installed: r.installed === true,
});

/** App-wide settings: works with or without an open project (models and agents are global). */
type ThemeProps = { theme: ThemeChoice; setTheme(t: ThemeChoice): void };

/** Theme state lives in Shell (one `useTheme` for the app), so it comes in as props. */
export default function Impostazioni(props: ThemeProps) {
  return (
    <section className="view">
      <h1 className="view-title">{t('impostazioni.title')}</h1>
      <Profilo {...props} />
      <Modelli />
      <Agenti />
      <PluginAgenti />
      <Aggiornamenti />
    </section>
  );
}

function Profilo({ theme, setTheme }: ThemeProps) {
  const nav = useNav();
  const { actor, nameError, setActor } = useProject();
  // Draft keeps what is typed (spaces between names); the context exposes it trimmed.
  const [draft, setDraft] = useState(actor);
  const [python, setPython] = useState(() => {
    try {
      return localStorage.getItem(PYTHON_KEY) ?? '';
    } catch {
      return '';
    }
  });

  return (
    <section className="group">
      <h2 className="group-title">{t('impostazioni.profile.title')}</h2>
      <div className="settings-grid">
        <label className="field">
          <span className="field-label">{t('impostazioni.profile.name')}</span>
          <input
            className="input"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setActor(e.target.value);
            }}
            aria-invalid={!!nameError}
            placeholder={t('impostazioni.profile.namePlaceholder')}
          />
          <span className={nameError ? 'field-hint error-text' : 'field-hint'}>
            {nameError ?? t('impostazioni.profile.nameHint')}
          </span>
        </label>
        <label className="field">
          <span className="field-label">{t('impostazioni.profile.python')}</span>
          <input
            className="input mono"
            value={python}
            onChange={(e) => {
              setPython(e.target.value);
              try {
                localStorage.setItem(PYTHON_KEY, e.target.value);
              } catch {
                // Storage unavailable: the value still applies for this session.
              }
            }}
            placeholder="/usr/bin/python3"
          />
          <span className="field-hint">
            {t('impostazioni.profile.pythonHint')}
          </span>
        </label>
        <fieldset className="field">
          <legend className="field-label">{t('impostazioni.profile.theme')}</legend>
          <div className="segmented">
            {THEMES.map((id) => (
              <button key={id} type="button" aria-pressed={theme === id} onClick={() => setTheme(id)}>
                {t(`impostazioni.theme.${id}`)}
              </button>
            ))}
          </div>
        </fieldset>
        <LanguageField />
      </div>
      <div className="link-row">
      <button
        type="button"
        className="btn btn-link"
        onClick={() => {
          markFirstRunDone(false);
          nav.go('primi-passi');
        }}
      >
        {t('impostazioni.profile.review')}
      </button>
      <button
        type="button"
        className="btn btn-link"
        onClick={() => {
          resetHints();
          window.dispatchEvent(new Event(HINTS_CHANGED));
        }}
      >
        {t('impostazioni.profile.hintsAgain')}
      </button>
      </div>
    </section>
  );
}

function Modelli() {
  const project = useProject();
  const rag = useRag();
  const toast = useToast();
  const repo = project.snapshot?.repoPath ?? null;
  const job = rag.indexJob(repo);
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [reranker, setReranker] = useState<CatalogRow | null>(null);
  const [hfQuery, setHfQuery] = useState('');
  const [hfHits, setHfHits] = useState<Array<{ id: string; downloads: number }>>([]);
  const [hfError, setHfError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (repo) {
      try {
        setStatus(parseIndexStatus((await invoke('rag_status', { repo })) as Record<string, unknown>));
      } catch (e) {
        setStatus({ indexed: false, error: message(e) });
      }
    }
    try {
      const m = (await invoke('rag_models')) as { catalog?: Array<Record<string, unknown>>; reranker?: Record<string, unknown> };
      setCatalog((m.catalog ?? []).map(toRow));
      setReranker(m.reranker ? toRow(m.reranker) : null);
    } catch {
      setCatalog([]);
    }
  }, [repo]);

  // Re-read when the project changes and whenever an index or download job ends.
  useEffect(() => {
    void refresh();
  }, [refresh, rag.tick]);

  const activeModel = status?.model || DEFAULT_MODEL;
  const dl = rag.download;

  const useModel = async (id: string) => {
    if (status?.indexed && status.indexedModel && status.indexedModel !== id) {
      if (!window.confirm(t('impostazioni.models.rebuildConfirm'))) return;
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
      toast(t('impostazioni.models.added', { repo: hfRepo }));
      void refresh();
    } catch (e) {
      setHfError(message(e));
    }
  };

  const removeModel = async (row: CatalogRow, what: string) => {
    if (!window.confirm(t('impostazioni.models.removeConfirm', { id: row.id, size: row.sizeMb, what }))) return;
    try {
      await invoke('rag_model_remove', { id: row.id });
      toast(t('impostazioni.models.removed', { id: row.id }));
    } catch (e) {
      toast(message(e), 'error');
    }
    void refresh();
  };

  const action = (row: CatalogRow, onUse: (() => void) | null, removeNote: string) =>
    dl?.id === row.id ? (
      <progress value={dl.done} max={dl.total || 1} aria-label={t('impostazioni.models.downloadLabel', { id: row.id })} />
    ) : !row.installed ? (
      <button type="button" className="btn" disabled={!!dl || job.running} onClick={() => void rag.startPull(row.id)}>
        {t('impostazioni.models.download')}
      </button>
    ) : (
      <>
        {onUse && (
          <button type="button" className="btn" onClick={onUse}>
            {t('impostazioni.models.use')}
          </button>
        )}
        <button
          type="button"
          className="btn btn-quiet"
          disabled={!!dl || job.running}
          onClick={() => void removeModel(row, removeNote)}
        >
          {t('impostazioni.models.remove')}
        </button>
      </>
    );

  return (
    <section className="group">
      <h2 className="group-title">{t('impostazioni.models.title')}</h2>
      <p className="muted">{t('impostazioni.models.intro')}</p>
      <table className="table">
        <thead>
          <tr>
            <th>{t('impostazioni.models.colEmbedding')}</th>
            <th>{t('impostazioni.models.colLanguages')}</th>
            <th>{t('impostazioni.models.colSize')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {catalog.map((row) => (
            <tr key={row.id}>
              <td>
                <span className="mono">{row.id}</span>
                {activeModel === row.id &&
                  (row.installed ? (
                    <span className="badge badge-ok ricerca-badge">{t('impostazioni.models.active')}</span>
                  ) : (
                    <span className="badge badge-drift ricerca-badge">{t('impostazioni.models.chosen')}</span>
                  ))}
                {!row.tested && <span className="badge ricerca-badge">{t('impostazioni.models.untested')}</span>}
                {row.note && <div className="muted">{row.note}</div>}
              </td>
              <td>{row.languages}</td>
              <td>{row.sizeMb > 0 ? `${row.sizeMb} MB` : '—'}</td>
              <td className="ricerca-actions">{action(
                  row,
                  activeModel === row.id ? null : () => void useModel(row.id),
                  activeModel === row.id
                    ? t('impostazioni.models.activeRemoveNote')
                    : t('impostazioni.models.removeNote'),
                )}</td>
            </tr>
          ))}
        </tbody>
        {reranker && (
          <>
            <thead>
              <tr>
                <th colSpan={4}>{t('impostazioni.models.reranker')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className="mono">{reranker.id}</span>
                  {reranker.installed && <span className="badge badge-ok ricerca-badge">{t('impostazioni.models.active')}</span>}
                  <div className="muted">{t('impostazioni.models.rerankerNote')}</div>
                </td>
                <td>{reranker.languages}</td>
                <td>{reranker.sizeMb} MB</td>
                <td className="ricerca-actions">
                  {action(reranker, null, t('impostazioni.models.rerankerRemoveNote'))}
                </td>
              </tr>
            </tbody>
          </>
        )}
      </table>
      {rag.downloadError && <p className="error-text">{rag.downloadError}</p>}
      <div className="toolbar">
        <input
          className="input"
          value={hfQuery}
          onChange={(e) => setHfQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void searchHf()}
          placeholder={t('impostazioni.models.hfPlaceholder')}
          aria-label={t('impostazioni.models.hfLabel')}
        />
        <button type="button" className="btn" onClick={() => void searchHf()}>
          {t('impostazioni.models.hfSearch')}
        </button>
      </div>
      {hfError && <p className="error-text">{hfError}</p>}
      {hfHits.length > 0 && (
        <table className="table">
          <tbody>
            {hfHits.map((h) => (
              <tr key={h.id}>
                <td className="mono">{h.id}</td>
                <td className="muted">{t('impostazioni.models.hfDownloads', { n: h.downloads.toLocaleString(locale()) })}</td>
                <td className="ricerca-actions">
                  <button type="button" className="btn" onClick={() => void addHf(h.id)}>
                    {t('impostazioni.models.hfAdd')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Agenti() {
  const toast = useToast();
  const [harness, setHarness] = useState<HarnessRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dlg, setDlg] = useState<HarnessDlg | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setHarness((await invoke('rag_harness_state')) as HarnessRow[]);
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = async (row: HarnessRow) => {
    const action = row.status === 'connected' ? 'disconnect' : row.status === 'outdated' ? 'update' : 'connect';
    setError(null);
    try {
      const preview = (await invoke('rag_harness_preview', { harness: row.id, action })) as Omit<HarnessDlg, 'id' | 'label' | 'action'>;
      setDlg({ id: row.id, label: row.label, action, ...preview });
    } catch (e) {
      setError(message(e));
    }
  };

  const confirm = async () => {
    if (!dlg) return;
    setBusy(true);
    try {
      await invoke('rag_harness_apply', { harness: dlg.id, action: dlg.action });
      toast(t(dlg.action === 'disconnect' ? 'impostazioni.agents.disconnected' : 'impostazioni.agents.connected', { label: dlg.label }));
      setDlg(null);
      void refresh();
    } catch (e) {
      setError(message(e));
      setDlg(null);
    } finally {
      setBusy(false);
    }
  };

  const verb = t(
    dlg?.action === 'disconnect'
      ? 'impostazioni.agents.disconnect'
      : dlg?.action === 'update'
        ? 'impostazioni.agents.update'
        : 'impostazioni.agents.connect',
  );

  return (
    <section className="group">
      <h2 className="group-title">{t('impostazioni.agents.title')}</h2>
      <p className="muted">
        {t('impostazioni.agents.intro')}
      </p>
      <table className="table">
        <tbody>
          {harness.map((row) => (
            <tr key={row.id}>
              <td>{row.label}</td>
              <td className={row.status === 'connected' ? undefined : 'muted'}>{linkLabel(row.status)}</td>
              <td className="muted">{row.hint}</td>
              <td className="ricerca-actions">
                <button type="button" className="btn" onClick={() => void open(row)} data-hint={row.status === 'connected' ? undefined : 'connect'}>
                  {t(`impostazioni.agents.${row.status === 'connected' ? 'disconnect' : row.status === 'outdated' ? 'update' : 'connect'}`)}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="error-text">{error}</p>}

      <Dialog
        open={!!dlg}
        title={dlg ? t('impostazioni.agents.dialogTitle', { verb, label: dlg.label }) : ''}
        confirmLabel={t(dlg?.id === 'claude' ? 'impostazioni.agents.run' : 'impostazioni.agents.confirm')}
        busy={busy}
        onCancel={() => setDlg(null)}
        onConfirm={() => void confirm()}
      >
        {dlg && (
          <>
            <p className="dialog-note mono">{dlg.path}</p>
            {dlg.id === 'claude' ? (
              <>
                <pre className="ricerca-snippet">{dlg.after}</pre>
                <button type="button" className="btn btn-quiet" onClick={() => void copyText(dlg.after).then(() => toast(t('impostazioni.agents.commandCopied')))}>
                  {t('impostazioni.agents.copyCommand')}
                </button>
              </>
            ) : (
              <div className="ricerca-diff">
                <div>
                  <p className="muted">{t('impostazioni.agents.before')}</p>
                  <pre className="ricerca-snippet">{dlg.before || t('impostazioni.agents.fileMissing')}</pre>
                </div>
                <div>
                  <p className="muted">{t('impostazioni.agents.after')}</p>
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

type PluginDlg = { id: string; label: string; update: boolean; commands: string[]; folders: string[] };

function PluginAgenti() {
  const toast = useToast();
  const [rows, setRows] = useState<PluginRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dlg, setDlg] = useState<PluginDlg | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRows(await invoke<PluginRow[]>('plugin_state'));
    } catch (e) {
      setError(message(e));
      setRows([]);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = async (row: PluginRow) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const p = await invoke<{ commands: string[]; folders: string[] }>('plugin_preview', { agent: row.id });
      setDlg({ id: row.id, label: AGENT_LABEL[row.id] ?? row.id, update: row.status === 'outdated', ...p });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!dlg) return;
    setBusy(true);
    try {
      await invoke('plugin_apply', { agent: dlg.id });
      toast(t(dlg.update ? 'impostazioni.plugins.doneUpdated' : 'impostazioni.plugins.doneInstalled', { label: dlg.label }));
      setDlg(null);
      void refresh();
    } catch (e) {
      setError(message(e));
      setDlg(null);
      // A CLI may have done part of the work: show what is there now.
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const latest = rows?.find((r) => r.latest)?.latest;

  return (
    <section className="group">
      <h2 className="group-title">{t('impostazioni.plugins.title')}</h2>
      <p className="muted">
        {t('impostazioni.plugins.intro')}{' '}
        {latest ? t('impostazioni.plugins.latest', { version: latest }) : rows ? t('impostazioni.plugins.latestUnknown') : ''}
      </p>
      {!rows ? (
        <p className="muted">{t('impostazioni.plugins.checking')}</p>
      ) : (
        <table className="table">
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{AGENT_LABEL[row.id] ?? row.id}</td>
                <td className={row.status === 'current' ? undefined : 'muted'}>{pluginStateText(row)}</td>
                <td className="muted">
                  {row.error ??
                    (row.agentFound ? (pluginBlocked(row) ?? (row.skillsOnly ? t('impostazioni.plugins.skillsOnly') : '')) : '')}
                </td>
                <td className="ricerca-actions">
                  {row.agentFound && row.error ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void copyText(row.manual.join('\n')).then(() => toast(t('impostazioni.plugins.commandsCopied')))}
                    >
                      {t('impostazioni.plugins.copyCommands')}
                    </button>
                  ) : row.agentFound && (row.status === 'missing' || row.status === 'outdated') ? (
                    <button type="button" className="btn" onClick={() => void open(row)} disabled={busy || !!pluginBlocked(row)}>
                      {t(row.status === 'missing' ? 'impostazioni.plugins.install' : 'impostazioni.plugins.updateBtn')}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <p className="error-text">{error}</p>}

      <Dialog
        open={!!dlg}
        title={dlg ? t(dlg.update ? 'impostazioni.plugins.dialogUpdate' : 'impostazioni.plugins.dialogInstall', { label: dlg.label }) : ''}
        confirmLabel={t(dlg?.update ? 'impostazioni.plugins.confirmUpdate' : 'impostazioni.plugins.confirmInstall')}
        busy={busy}
        onCancel={() => setDlg(null)}
        onConfirm={() => void confirm()}
      >
        {dlg && (
          <>
            {dlg.commands.length > 0 && (
              <>
                <p className="muted">{t('impostazioni.plugins.commandsTitle')}</p>
                <pre className="ricerca-snippet">{dlg.commands.join('\n')}</pre>
              </>
            )}
            {dlg.folders.length > 0 && (
              <>
                <p className="muted">{t('impostazioni.plugins.foldersTitle')}</p>
                <pre className="ricerca-snippet">{dlg.folders.join('\n')}</pre>
              </>
            )}
          </>
        )}
      </Dialog>
    </section>
  );
}

/** App version and a manual update check; the answer shows in the banner on top. */
function Aggiornamenti() {
  const { checking, progress, checkNow } = useUpdates();
  const [version, setVersion] = useState('');
  useEffect(() => {
    appVersion().then(setVersion, () => setVersion(''));
  }, []);
  return (
    <section className="group">
      <h2 className="group-title">{t('impostazioni.updates.title')}</h2>
      <p className="field-hint">
        {version ? t('impostazioni.updates.version', { version }) : ''}
        {t('impostazioni.updates.intro')}
      </p>
      <button type="button" className="btn" onClick={() => void checkNow()} disabled={checking || progress !== undefined}>
        {t(checking ? 'impostazioni.updates.checking' : 'impostazioni.updates.check')}
      </button>
    </section>
  );
}

/** Interface language; the names of the two languages stay in their own language. */
function LanguageField() {
  const { choice, setChoice } = useLang();
  const options = [
    { id: 'auto', label: t('common.language.auto') },
    { id: 'it', label: 'Italiano' },
    { id: 'en', label: 'English' },
  ] as const;
  return (
    <fieldset className="field">
      <legend className="field-label">{t('common.language')}</legend>
      <div className="segmented">
        {options.map((o) => (
          <button key={o.id} type="button" aria-pressed={choice === o.id} onClick={() => setChoice(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
      <span className="field-hint">{t('common.language.hint')}</span>
    </fieldset>
  );
}
