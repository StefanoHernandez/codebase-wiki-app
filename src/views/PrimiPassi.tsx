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
import './primi-passi.css';

const DEFAULT_MODEL = 'multilingual-e5-small';
const PLUGIN_URL = 'https://github.com/StefanoHernandez/codebase-wiki-llm';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const TITLES: Record<FirstRunStepId, string> = {
  nome: 'Il tuo nome',
  progetto: 'Un progetto con la wiki',
  struttura: 'Controllo della struttura',
  ricerca: 'Ricerca nel codice',
  agente: 'Collega un agente (plugin e ricerca)',
};

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
      toast('Prompt /wiki-init copiato');
    } catch (e) {
      toast(`Copia non riuscita: ${message(e)}`, 'error');
    }
  };

  const body: Record<FirstRunStepId, ReactNode> = {
    nome: (
      <label className="field">
        <span className="field-hint">Firma le azioni che fai qui: approvato da, chiuso da, rivista da.</span>
        <input
          className="input"
          value={project.actor}
          onChange={(e) => project.setActor(e.target.value)}
          aria-invalid={!!project.actorError}
          aria-label="Il tuo nome"
          placeholder="Nome e cognome"
        />
        {project.actorError && <span className="field-hint error-text">{project.actorError}</span>}
      </label>
    ),
    progetto: (
      <>
        <p className="field-hint">
          La wiki la scrive un agente con il plugin Codebase Wiki LLM installato in Claude Code o Codex (
          <span className="mono">{PLUGIN_URL.replace('https://', '')}</span>).
        </p>
        {state.project === 'no-wiki' && (
          <p className="field-hint">
            {project.snapshot?.repoPath.split(/[\\/]/).pop()} non ha ancora una wiki: avvia /wiki-init nell'agente. Questa pagina si aggiorna
            da sola quando la wiki esiste.
          </p>
        )}
        {state.project === 'incompatible' && (
          <p className="field-hint">La wiki usa un formato vecchio: avvia /wiki-init --adopt nell'agente.</p>
        )}
        <div className="primi-passi-actions">
          <button type="button" className="btn" onClick={() => void openFolder()} disabled={project.loading}>
            {project.snapshot ? 'Apri un’altra cartella' : 'Apri cartella'}
          </button>
          {state.project === 'no-wiki' && (
            <button type="button" className="btn" onClick={() => void copyInit()}>
              Copia prompt /wiki-init
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
            Indica il percorso di Python
          </button>
        </div>
      </>
    ) : (
      <p className="field-hint">
        {!repo
          ? 'Parte da solo quando apri un progetto con la wiki: serve Python 3.10 o più recente.'
          : project.lintRunning
            ? 'Controllo in corso…'
            : 'Il validatore del plugin controlla che la wiki rispetti il formato.'}
      </p>
    ),
    ricerca: (
      <>
        <p className="field-hint">
          Un modello locale indicizza il codice, così gli agenti trovano dove e come senza leggere tutto. Niente esce dal computer.
        </p>
        <div className="primi-passi-actions">
          {state.search === 'no-model' ? (
            rag.download ? (
              <span className="muted">
                Scaricamento {rag.download.id}…{' '}
                {rag.download.total > 0 && `${formatBytes(rag.download.done)} di ${formatBytes(rag.download.total)}`}
              </span>
            ) : (
              <button type="button" className="btn" onClick={() => void rag.startPull(model)}>
                Scarica {model} (~120 MB)
              </button>
            )
          ) : state.search === 'no-index' ? (
            rag.indexJob(repo).running ? (
              <span className="muted">
                Indicizzazione…{' '}
                {rag.indexJob(repo).progress && `${rag.indexJob(repo).progress!.done} di ${rag.indexJob(repo).progress!.total}`}
              </span>
            ) : (
              <button type="button" className="btn" onClick={() => repo && void rag.startIndex(repo)} disabled={!repo}>
                Indicizza il progetto
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
          Installa il plugin, che scrive la wiki, e collega la ricerca nello stesso agente (Claude Code, Codex, Cursor…). Prima di
          scrivere ti mostra cosa cambia.
        </p>
        <div className="primi-passi-actions">
          <button type="button" className="btn" onClick={() => nav.go('impostazioni')}>
            Collega dalle Impostazioni
          </button>
        </div>
      </>
    ),
  };

  return (
    <section className="view primi-passi">
      <h1 className="view-title">Primi passi</h1>
      <p className="muted">Ogni passo si spunta da solo quando è fatto. Puoi farli in qualsiasi ordine, o saltarli.</p>
      <ol className="primi-passi-list">
        {steps.map((s) => (
          <li key={s.id} className={`primi-passi-step${s.done ? ' is-done' : ''}${s.id === current ? ' is-current' : ''}`}>
            <span className="primi-passi-mark" aria-hidden="true">
              {s.done ? '✓' : ''}
            </span>
            <div className="primi-passi-main">
              <h2 className="primi-passi-title">
                {TITLES[s.id]}
                {s.done && <span className="visually-hidden"> (fatto)</span>}
              </h2>
              {(!s.done || s.id === 'nome') && body[s.id]}
            </div>
          </li>
        ))}
      </ol>
      <div className="primi-passi-actions">
        <button type="button" className={allDone ? 'btn btn-strong' : 'btn'} onClick={finish}>
          {allDone ? 'Fine' : 'Salta per ora'}
        </button>
      </div>
    </section>
  );
}
