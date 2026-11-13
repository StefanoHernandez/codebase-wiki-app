import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import * as api from '../api';
import { CopyAdoptButton } from '../components/Compat';
import { useToast } from '../components/Toast';
import { FIRST_RUN_KEY, firstRunSteps, type FirstRunState, type FirstRunStepId } from '../lib/first-run';
import { formatBytes, parseIndexStatus, type IndexStatus } from '../lib/rag-format';
import { useNav } from '../state/nav';
import { useProject } from '../state/project';
import { useRag } from '../state/rag';
import { agentReady, type PluginRow } from '../lib/plugin';
import { t } from '../i18n';
import './primi-passi.css';

const DEFAULT_MODEL = 'multilingual-e5-small';
const PLUGIN_URL = 'https://github.com/StefanoHernandez/codebase-wiki-llm';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function markFirstRunDone(done: boolean) {
  try {
    if (done) localStorage.setItem(FIRST_RUN_KEY, '1');
    else localStorage.removeItem(FIRST_RUN_KEY);
  } catch {
    /* per-viewer convenience only */
  }
}

export function firstRunDone(): boolean {
  try {
    return localStorage.getItem(FIRST_RUN_KEY) === '1';
  } catch {
    return true;
  }
}

export default function PrimiPassi() {
  const project = useProject();
  const rag = useRag();
  const nav = useNav();
  const toast = useToast();
  const repo = project.snapshot?.wikiRoot ? project.snapshot.repoPath : null;
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [agent, setAgent] = useState(false);

  const refresh = useCallback(async () => {
    if (repo) {
      setStatus(
        await invoke('rag_status', { repo })
          .then((r) => parseIndexStatus(r as Record<string, unknown>))
          .catch((e) => ({ indexed: false, error: message(e) })),
      );
    }
    await invoke('rag_models')
      .then((m) => {
        const rows = ((m as { catalog?: Array<Record<string, unknown>> }).catalog ?? []).map((r) => [String(r.id), r.installed === true]);
        setInstalled(Object.fromEntries(rows));
      })
      .catch(() => undefined);
    await Promise.all([
      invoke<Array<{ id: string; status: string }>>('rag_harness_state'),
      invoke<PluginRow[]>('plugin_state'),
    ])
      .then(([mcp, plugins]) => setAgent(agentReady(mcp, plugins)))
      .catch(() => undefined);
  }, [repo]);

  useEffect(() => {
    void refresh();
  }, [refresh, rag.tick]);

  const model = status?.model || DEFAULT_MODEL;
  const lintFailed = !!project.lintError || !!project.lint?.error;
  const state: FirstRunState = {
    name: !!project.actor && !project.actorError,
    project: !project.snapshot ? 'none' : !project.snapshot.wikiRoot ? 'no-wiki' : project.compat.incompatible ? 'incompatible' : 'ok',
    lint: lintFailed ? 'error' : project.lint ? 'ok' : 'pending',
    search: !installed[model] ? 'no-model' : status?.indexed ? 'ok' : 'no-index',
    agent,
  };
  const { steps, current, allDone } = firstRunSteps(state);

  const finish = () => {
    markFirstRunDone(true);
    nav.go(project.snapshot?.wikiRoot ? 'per-te' : 'progetti');
  };

  const openFolder = async () => {
    try {
      const path = await api.pickFolder();
      if (path) await project.open(path);
    } catch (e) {
      toast(message(e), 'error');
    }
  };

  const copyInit = async () => {
    if (!project.current) return;
    try {
      await api.copyText(await api.workflowPrompt(project.current, 'wiki-init'));
      toast(t('impostazioni.pp.initCopied'));
    } catch (e) {
      toast(t('impostazioni.pp.copyFailed', { error: message(e) }), 'error');
    }
  };

  const body: Record<FirstRunStepId, ReactNode> = {
    nome: (
      <label className="field">
        <span className="field-hint">{t('impostazioni.pp.nameHint')}</span>
        <input
          className="input"
          value={project.actor}
          onChange={(e) => project.setActor(e.target.value)}
          aria-invalid={!!project.actorError}
          aria-label={t('impostazioni.pp.step.nome')}
          placeholder={t('impostazioni.profile.namePlaceholder')}
        />
        {project.actorError && <span className="field-hint error-text">{project.actorError}</span>}
      </label>
    ),
    progetto: (
      <>
        <p className="field-hint">
          {t('impostazioni.pp.projectHint')}
          <span className="mono">{PLUGIN_URL.replace('https://', '')}</span>).
        </p>
        {state.project === 'no-wiki' && (
          <p className="field-hint">
            {t('impostazioni.pp.noWiki', { name: project.snapshot?.repoPath.split(/[\\/]/).pop() ?? '' })}
          </p>
        )}
        {state.project === 'incompatible' && (
          <p className="field-hint">{t('impostazioni.pp.incompatible')}</p>
        )}
        {project.loading && <p className="field-hint">{t('impostazioni.pp.opening')}</p>}
        {project.error && <p className="field-hint error-text">{project.error}</p>}
        <div className="primi-passi-actions">
          <button type="button" className="btn" onClick={() => void openFolder()} disabled={project.loading}>
            {t(project.snapshot ? 'impostazioni.pp.openOther' : 'impostazioni.pp.openFolder')}
          </button>
          {state.project === 'no-wiki' && (
            <button type="button" className="btn" onClick={() => void copyInit()}>
              {t('impostazioni.pp.copyInit')}
            </button>
          )}
          {state.project === 'incompatible' && <CopyAdoptButton />}
        </div>
      </>
    ),
    struttura: lintFailed ? (
      <>
        <p className="field-hint error-text">{project.lint?.error ?? project.lintError}</p>
        <div className="primi-passi-actions">
          <button type="button" className="btn" onClick={() => nav.go('impostazioni')}>
            {t('impostazioni.pp.pythonPath')}
          </button>
        </div>
      </>
    ) : (
      <p className="field-hint">
        {!repo
          ? t('impostazioni.pp.lintAuto')
          : project.lintRunning
            ? t('impostazioni.pp.lintRunning')
            : t('impostazioni.pp.lintIdle')}
      </p>
    ),
    ricerca: (
      <>
        <p className="field-hint">
          {t('impostazioni.pp.searchHint')}
        </p>
        <div className="primi-passi-actions">
          {state.search === 'no-model' ? (
            rag.download ? (
              <span className="muted">
                {t('impostazioni.pp.downloading', { id: rag.download.id })}{' '}
                {rag.download.total > 0 &&
                  t('impostazioni.pp.bytesOf', { done: formatBytes(rag.download.done), total: formatBytes(rag.download.total) })}
              </span>
            ) : (
              <button type="button" className="btn" onClick={() => void rag.startPull(model)}>
                {t('impostazioni.pp.downloadModel', { model })}
              </button>
            )
          ) : state.search === 'no-index' ? (
            rag.indexJob(repo).running ? (
              <span className="muted">
                {t('impostazioni.pp.indexing')}{' '}
                {rag.indexJob(repo).progress &&
                  t('impostazioni.pp.progressOf', { done: rag.indexJob(repo).progress!.done, total: rag.indexJob(repo).progress!.total })}
              </span>
            ) : (
              <button type="button" className="btn" onClick={() => repo && void rag.startIndex(repo)} disabled={!repo}>
                {t('impostazioni.pp.indexProject')}
              </button>
            )
          ) : null}
        </div>
        {(rag.downloadError || rag.indexJob(repo).error) && (
          <p className="field-hint error-text">{rag.downloadError ?? rag.indexJob(repo).error}</p>
        )}
      </>
    ),
    agente: (
      <>
        <p className="field-hint">
          {t('impostazioni.pp.agentHint')}
        </p>
        <div className="primi-passi-actions">
          <button type="button" className="btn" onClick={() => nav.go('impostazioni')}>
            {t('impostazioni.pp.connectFromSettings')}
          </button>
        </div>
      </>
    ),
  };

  return (
    <section className="view primi-passi">
      <h1 className="view-title">{t('impostazioni.pp.title')}</h1>
      <p className="muted">{t('impostazioni.pp.intro')}</p>
      <ol className="primi-passi-list">
        {steps.map((s) => (
          <li key={s.id} className={`primi-passi-step${s.done ? ' is-done' : ''}${s.id === current ? ' is-current' : ''}`}>
            <span className="primi-passi-mark" aria-hidden="true">
              {s.done ? '✓' : ''}
            </span>
            <div className="primi-passi-main">
              <h2 className="primi-passi-title">
                {t(`impostazioni.pp.step.${s.id}`)}
                {s.done && <span className="visually-hidden">{t('impostazioni.pp.done')}</span>}
              </h2>
              {(!s.done || s.id === 'nome') && body[s.id]}
            </div>
          </li>
        ))}
      </ol>
      <div className="primi-passi-actions">
        <button type="button" className={allDone ? 'btn btn-strong' : 'btn'} onClick={finish}>
          {t(allDone ? 'impostazioni.pp.finish' : 'impostazioni.pp.skip')}
        </button>
      </div>
    </section>
  );
}
