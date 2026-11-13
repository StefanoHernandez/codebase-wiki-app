import { locale, t, type Key } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { Empty } from '../components/Empty';
import { UpgradeBanner } from '../components/Compat';
import { Markdown } from '../components/Markdown';
import { ReviewDialog } from '../components/ReviewDialog';
import { SidePanel } from '../components/SidePanel';
import { useStamp } from '../components/stamp';
import { useToast } from '../components/Toast';
import { DEFAULT_CORE_MAP, DEFAULT_SCHEMA_BUDGETS, pageTypeFor } from '../lib/schema-parser';
import { codeChangedSources } from '../lib/attention';
import { unownedSevereRisks } from '../lib/wiki-extras';
import { renderInlineCode } from '../lib/inline-code';
import type { TrustTier } from '../lib/trust';
import { useProject } from '../state/project';
import { useNav } from '../state/nav';
import './salute.css';

const TRUST_TIERS: TrustTier[] = ['unverified', 'machine-confirmed', 'human-reviewed', 'stale-verified'];
const trustLabel = (tier: TrustTier) => t(`revisione.health.trust.${tier}` as Key);

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
  return d.toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });
}

type PanelPage = { path: string; markdown: string };

export default function Salute() {
  const project = useProject();
  const nav = useNav();
  const toast = useToast();
  const { stamp, isStamped } = useStamp();

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

  // Errors land in project.lintError.
  const runStructureLint = () => void project.runLint().catch(() => {});
  const lintError = project.lintError;
  const lastLintAt = project.lintAt;

  const openPage = (path: string) => {
    const page = project.pages.find((p) => p.relPath === path);
    if (page) setPanel({ path, markdown: page.markdown });
  };

  const trustPages = useMemo(() => {
    let list = [...project.pages];
    if (tierFilter) list = list.filter((p) => p.trust === tierFilter);
    if (driftOnly) list = list.filter((p) => codeChangedSources(p.changedSources, project.snapshot?.wikiRoot ?? undefined).length > 0);
    return list.sort((a, b) => a.relPath.localeCompare(b.relPath));
  }, [project.pages, project.snapshot?.wikiRoot, tierFilter, driftOnly]);

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
  const unowned = new Set(unownedSevereRisks(project.risks ?? []));

  if (!project.snapshot?.wikiRoot) {
    return (
      <section className="view">
        <h1 className="view-title">{t('revisione.health.title')}</h1>
        <Empty title={t('revisione.health.noWiki')} />
      </section>
    );
  }

  const findings = project.lint?.findings ?? [];
  const infos = project.lint?.infos ?? [];

  const finishReview = () => {
    const path = review?.path ?? '';
    setReview(null);
    toast(t('revisione.health.reviewed'), 'human');
    if (path) stamp(path);
  };

  return (
    <section className="view">
      <h1 className="view-title">{t('revisione.health.title')}</h1>
      <UpgradeBanner />

      <section className="group">
        <h2 className="group-title">{t('revisione.health.structure')}</h2>
        <div className="toolbar">
          <button type="button" className="btn btn-strong" disabled={project.lintRunning} onClick={runStructureLint}>
            {project.lintRunning && (
              <span className="spin" aria-hidden="true">
                ⟳
              </span>
            )}
            {t('revisione.health.runCheck')}
          </button>
          {lastLintAt && <p className="muted">{t('revisione.health.lastCheck', { when: formatLintWhen(lastLintAt) })}</p>}
        </div>
        {lintError && <p className="error-text">{lintError}</p>}
        {project.compat.validatorUnavailable && (
          <p className="error-text">{t('revisione.health.validatorFailed', { error: project.compat.validatorUnavailable })}</p>
        )}
        {project.lint && !project.lint.error && findings.length === 0 && !lintError && (
          <p className="muted">{t('revisione.health.noStructureIssues')}</p>
        )}
        {findings.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>{t('revisione.health.colFile')}</th>
                <th>{t('revisione.health.colLine')}</th>
                <th>{t('revisione.health.colMessage')}</th>
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

      {infos.length > 0 && (
        <section className="group">
          <h2 className="group-title">
            {t('revisione.health.validatorNotes')} <span className="group-count">{infos.length}</span>
          </h2>
          <ul className="rows">
            {infos.map((i, n) => (
              <li key={`${i.code}:${n}`} className="row">
                <div className="row-main">
                  <p className="row-title">
                    {i.wikiRelPath ? (
                      <span className="salute-table-path">
                        {i.wikiRelPath}
                        {i.line ? `:${i.line}` : ''}
                      </span>
                    ) : (
                      i.code
                    )}
                  </p>
                  <p className="row-detail">{i.message}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="group">
        <h2 className="group-title">{t('revisione.health.trustTitle')}</h2>
        <div className="toolbar">
          <label className="toolbar-field">
            <span>{t('revisione.health.level')}</span>
            <select
              className="input"
              value={tierFilter}
              onChange={(e) => setTierFilter((e.target.value || '') as TrustTier | '')}
            >
              <option value="">{t('revisione.health.all')}</option>
              {TRUST_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {trustLabel(tier)}
                </option>
              ))}
            </select>
          </label>
          <label className="toolbar-field">
            <input type="checkbox" checked={driftOnly} onChange={(e) => setDriftOnly(e.target.checked)} />
            {t('revisione.health.driftOnly')}
          </label>
          {!signable && <p className="muted">{t('lavori.dialog.signHint')}</p>}
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>{t('revisione.health.colPath')}</th>
              <th>{t('revisione.health.colType')}</th>
              <th>{t('revisione.health.level')}</th>
              <th>{t('revisione.health.colSources')}</th>
              <th>{t('revisione.health.colDrift')}</th>
              <th>{t('revisione.health.colSize')}</th>
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
                <td>{p.frontmatter.fields.type || pageTypeFor(p.relPath, project.schema?.pageTypes ?? []) || '—'}</td>
                <td>
                  <span className={TRUST_BADGE[p.trust]}>{trustLabel(p.trust)}</span>
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
                    className="btn btn-human-outline"
                    aria-disabled={!signable}
                    title={signable ? undefined : t('lavori.dialog.signHint')}
                    onClick={() => signable && setReview({ path: p.relPath, markdown: p.markdown })}
                  >
                    {t('revisione.review.title')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="group">
        <h2 className="group-title">{t('revisione.health.budget')}</h2>
          {overBudget.length > 0 && (
            <>
              <p className="muted">{t('revisione.health.overLimit', { size: formatBytes(budgets.singlePageBytes) })}</p>
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
          {overBudget.length === 0 && <p className="muted">{t('revisione.health.noneOverLimit')}</p>}

          <div className="salute-budget-row salute-budget-row--spaced">
            <p className="salute-budget-label">
              {t('revisione.health.coreRead')}
              <span
                className="field-hint"
                title={t('revisione.health.coreReadHint')}
              >
                {' '}
                {t('revisione.health.approx')}
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
            <p className="salute-budget-label">{t('revisione.health.log')}</p>
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
        <h2 className="group-title">{t('revisione.health.risks')}</h2>
        {project.risks && risksPage && (
          <p className="muted">
            {t('revisione.health.risksOnlyTable')}{' '}
            <button type="button" className="btn" onClick={() => openPage(risksPage.relPath)}>
              {t('revisione.health.openRisksPage')}
            </button>
          </p>
        )}
        {project.risks ? (
          project.risks.length === 0 ? (
            <p className="muted">{t('revisione.health.risksEmpty')}</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('revisione.health.colId')}</th>
                  <th>{t('revisione.health.colRisk')}</th>
                  <th>{t('revisione.health.colSeverity')}</th>
                  <th>{t('revisione.health.colTrigger')}</th>
                  <th>{t('revisione.health.colMitigation')}</th>
                  <th>{t('revisione.health.colOwner')}</th>
                  <th>{t('revisione.health.colLinked')}</th>
                </tr>
              </thead>
              <tbody>
                {project.risks.map((r, i) => (
                  <tr
                    key={`${r.id}:${i}`}
                    data-page={r.id}
                    className={nav.ref === r.id ? 'is-selected' : undefined}
                  >
                    <td>{r.id}</td>
                    <td>{renderInlineCode(r.risk)}</td>
                    <td>{r.severity}</td>
                    <td>{renderInlineCode(r.trigger)}</td>
                    <td>{renderInlineCode(r.mitigation)}</td>
                    <td>
                      {unowned.has(r) ? <span className="badge badge-drift">{t('revisione.health.nobody')}</span> : renderInlineCode(r.owner)}
                    </td>
                    <td>{renderInlineCode(r.ids)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : risksPage ? (
          <div className="salute-risks md">
            <Markdown markdown={risksPage.markdown} pagePath={risksPage.relPath} onOpenPage={openPage} />
          </div>
        ) : (
          <p className="muted">{t('revisione.health.noRisksFile')}</p>
        )}
      </section>

      <section className="group">
        <h2 className="group-title">{t('revisione.health.recentLog')}</h2>
        {logPage ? (
          recentLogSections(logPage.markdown).map((block, i) => (
            <pre key={i} className="salute-log-entry mono">
              {block.trimEnd()}
            </pre>
          ))
        ) : (
          <p className="muted">{t('revisione.health.noLog')}</p>
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
