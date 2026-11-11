import { useEffect, useMemo, useState } from 'react';
import { Empty } from '../components/Empty';
import { Markdown } from '../components/Markdown';
import { ReviewDialog } from '../components/ReviewDialog';
import { SidePanel } from '../components/SidePanel';
import { useStamp } from '../components/stamp';
import { SIGN_HINT } from '../components/TrackerDialogs';
import { useToast } from '../components/Toast';
import { DEFAULT_CORE_MAP, DEFAULT_SCHEMA_BUDGETS } from '../lib/schema-parser';
import type { TrustTier } from '../lib/trust';
import { useProject } from '../state/project';
import { useNav } from '../state/nav';
import './salute.css';

const TRUST_LABEL: Record<TrustTier, string> = {
  unverified: 'Non verificata',
  'machine-confirmed': 'Confermata da agente',
  'human-reviewed': 'Rivista da persona',
  'stale-verified': 'Verificata ma superata',
};

const TRUST_BADGE: Record<TrustTier, string> = {
  unverified: 'badge',
  'machine-confirmed': 'badge badge-ok',
  'human-reviewed': 'badge badge-human',
  'stale-verified': 'badge badge-drift',
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function coreReadPaths(coreMap: Record<string, string>): Set<string> {
  const paths = new Set<string>(['SCHEMA.md']);
  for (const p of Object.values(coreMap)) {
    if (!p.endsWith('/')) paths.add(p);
  }
  return paths;
}

function recentLogSections(markdown: string): string[] {
  const parts = markdown.split(/\n(?=## )/);
  return parts.filter((p) => p.startsWith('## ')).slice(-10).reverse();
}

function formatLintWhen(d: Date): string {
  return d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

type PanelPage = { path: string; markdown: string };

export default function Salute() {
  const project = useProject();
  const nav = useNav();
  const toast = useToast();
  const { stamp, isStamped } = useStamp();

  const [lintError, setLintError] = useState<string | null>(null);
  const [lastLintAt, setLastLintAt] = useState<Date | null>(null);
  const [panel, setPanel] = useState<PanelPage | null>(null);
  const [review, setReview] = useState<{ path: string; markdown: string } | null>(null);
  const [tierFilter, setTierFilter] = useState<TrustTier | ''>('');
  const [driftOnly, setDriftOnly] = useState(false);

  const signable = !project.actorError;
  const core = project.schema?.coreMap ?? DEFAULT_CORE_MAP;
  const budgets = project.schema?.budgets ?? DEFAULT_SCHEMA_BUDGETS;

  useEffect(() => {
    if (!nav.ref || nav.section !== 'salute') return;
    const el = document.querySelector(`[data-page="${CSS.escape(nav.ref)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [nav.ref, nav.section]);

  const runStructureLint = async () => {
    setLintError(null);
    try {
      await project.runLint();
      setLastLintAt(new Date());
    } catch (e) {
      setLintError(e instanceof Error ? e.message : String(e));
    }
  };

  const openPage = (path: string) => {
    const page = project.pages.find((p) => p.relPath === path);
    if (page) setPanel({ path, markdown: page.markdown });
  };

  const trustPages = useMemo(() => {
    let list = [...project.pages];
    if (tierFilter) list = list.filter((p) => p.trust === tierFilter);
    if (driftOnly) list = list.filter((p) => p.changedSources.length > 0);
    return list.sort((a, b) => a.relPath.localeCompare(b.relPath));
  }, [project.pages, tierFilter, driftOnly]);

  const logRel = core.log;

  const overBudget = project.pages.filter(
    (p) => p.relPath !== logRel && p.sizeBytes > budgets.singlePageBytes,
  );

  const corePaths = useMemo(() => coreReadPaths(core), [core]);

  const coreReadBytes = useMemo(
    () => project.pages.filter((p) => corePaths.has(p.relPath)).reduce((s, p) => s + p.sizeBytes, 0),
    [project.pages, corePaths],
  );

  const logPage = project.pages.find((p) => p.relPath === core.log);
  const logBytes = logPage?.sizeBytes ?? 0;
  const risksPage = project.pages.find((p) => p.relPath === core.risks);

  if (!project.snapshot?.wikiRoot) {
    return (
      <section className="view">
        <h1 className="view-title">Salute</h1>
        <Empty title="Apri un progetto con wiki per vedere la salute." />
      </section>
    );
  }

  const findings = project.lint?.findings ?? [];

  const finishReview = () => {
    const path = review?.path ?? '';
    setReview(null);
    toast('Pagina segnata come rivista', 'human');
    if (path) stamp(path);
  };

  return (
    <section className="view">
      <h1 className="view-title">Salute</h1>

      <section className="group">
        <h2 className="group-title">Struttura</h2>
        <div className="toolbar">
          <button type="button" className="btn btn-strong" disabled={project.lintRunning} onClick={runStructureLint}>
            {project.lintRunning && (
              <span className="spin" aria-hidden="true">
                ⟳
              </span>
            )}
            Esegui controllo
          </button>
          {lastLintAt && <p className="muted">Ultimo controllo: {formatLintWhen(lastLintAt)}</p>}
        </div>
        {lintError && <p className="error-text">{lintError}</p>}
        {project.lint && findings.length === 0 && !lintError && (
          <p className="muted">Nessun problema di struttura.</p>
        )}
        {findings.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Riga</th>
                <th>Messaggio</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f, i) => (
                <tr
                  key={`${f.wikiRelPath}:${f.line}:${i}`}
                  className="salute-clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => openPage(f.wikiRelPath)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openPage(f.wikiRelPath)}
                >
                  <td className="salute-table-path">{f.wikiRelPath}</td>
                  <td>{f.line}</td>
                  <td>{f.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="group">
        <h2 className="group-title">Fiducia</h2>
        <div className="toolbar">
          <label className="toolbar-field">
            <span>Livello</span>
            <select
              className="input"
              value={tierFilter}
              onChange={(e) => setTierFilter((e.target.value || '') as TrustTier | '')}
            >
              <option value="">Tutti</option>
              {(Object.keys(TRUST_LABEL) as TrustTier[]).map((t) => (
                <option key={t} value={t}>
                  {TRUST_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="toolbar-field">
            <input type="checkbox" checked={driftOnly} onChange={(e) => setDriftOnly(e.target.checked)} />
            Solo drift
          </label>
          {!signable && <p className="muted">{SIGN_HINT}</p>}
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Percorso</th>
              <th>Tipo</th>
              <th>Livello</th>
              <th>Fonti</th>
              <th>Drift</th>
              <th>Dimensione</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {trustPages.map((p) => (
              <tr
                key={p.relPath}
                data-page={p.relPath}
                className={`${isStamped(p.relPath) ? 'stamp' : ''}${nav.ref === p.relPath ? ' is-selected' : ''}`}
              >
                <td className="salute-table-path">{p.relPath}</td>
                <td>{p.frontmatter.fields.type || '—'}</td>
                <td>
                  <span className={TRUST_BADGE[p.trust]}>{TRUST_LABEL[p.trust]}</span>
                </td>
                <td>{p.frontmatter.sources.length}</td>
                <td>
                  {p.changedSources.length > 0 ? (
                    <span className="badge badge-drift">{p.changedSources.length}</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{formatBytes(p.sizeBytes)}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-human"
                    aria-disabled={!signable}
                    title={signable ? undefined : SIGN_HINT}
                    onClick={() => signable && setReview({ path: p.relPath, markdown: p.markdown })}
                  >
                    Segna come rivista
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="group">
        <h2 className="group-title">Budget</h2>
          {overBudget.length > 0 && (
            <>
              <p className="muted">Pagine oltre il limite ({formatBytes(budgets.singlePageBytes)})</p>
              <ul className="rows">
                {overBudget.map((p) => (
                  <li key={p.relPath} className="row">
                    <span className="salute-table-path">{p.relPath}</span>
                    <span className="badge badge-drift">{formatBytes(p.sizeBytes)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {overBudget.length === 0 && <p className="muted">Nessuna pagina supera il limite per pagina.</p>}

          <div className="salute-budget-row salute-budget-row--spaced">
            <p className="salute-budget-label">
              Lettura core
              <span
                className="field-hint"
                title="Somma dei byte di SCHEMA.md e delle pagine file nella Core map (esclude le cartelle come decisions/ o log/)."
              >
                {' '}
                (approssimazione)
              </span>
            </p>
            <p className="salute-budget-value">
              {formatBytes(coreReadBytes)} / {formatBytes(budgets.coreReadBytes)}
            </p>
            <div
              className={`salute-bar${coreReadBytes > budgets.coreReadBytes ? ' salute-bar-over' : ''}`}
              style={{ gridColumn: '1 / -1' }}
              role="progressbar"
              aria-valuenow={coreReadBytes}
              aria-valuemax={budgets.coreReadBytes}
            >
              <div
                className="salute-bar-fill"
                style={{ width: `${Math.min(100, (coreReadBytes / budgets.coreReadBytes) * 100)}%` }}
              />
            </div>
          </div>

          <div className="salute-budget-row">
            <p className="salute-budget-label">Log</p>
            <p className="salute-budget-value">
              {formatBytes(logBytes)} / {formatBytes(budgets.logBytes)}
            </p>
            <div
              className={`salute-bar${logBytes > budgets.logBytes ? ' salute-bar-over' : ''}`}
              style={{ gridColumn: '1 / -1' }}
              role="progressbar"
              aria-valuenow={logBytes}
              aria-valuemax={budgets.logBytes}
            >
              <div
                className="salute-bar-fill"
                style={{ width: `${Math.min(100, (logBytes / budgets.logBytes) * 100)}%` }}
              />
            </div>
          </div>
      </section>

      <section className="group">
        <h2 className="group-title">Rischi</h2>
        {risksPage ? (
          <div className="salute-risks md">
            <Markdown markdown={risksPage.markdown} pagePath={risksPage.relPath} onOpenPage={openPage} />
          </div>
        ) : (
          <p className="muted">Nessun file rischi nella Core map.</p>
        )}
      </section>

      <section className="group">
        <h2 className="group-title">Log recente</h2>
        {logPage ? (
          recentLogSections(logPage.markdown).map((block, i) => (
            <pre key={i} className="salute-log-entry mono">
              {block.trimEnd()}
            </pre>
          ))
        ) : (
          <p className="muted">Nessun log.</p>
        )}
      </section>

      {panel && (
        <SidePanel title={panel.path} onClose={() => setPanel(null)}>
          <Markdown markdown={panel.markdown} pagePath={panel.path} onOpenPage={(rel) => openPage(rel)} />
        </SidePanel>
      )}

      {review && (
        <ReviewDialog
          pageRelPath={review.path}
          pageMarkdown={review.markdown}
          onClose={() => setReview(null)}
          onDone={finishReview}
        />
      )}
    </section>
  );
}
