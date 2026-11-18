import { locale, t, type Key } from '../i18n';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Empty } from '../components/Empty';
import { UpgradeBanner } from '../components/Compat';
import { Markdown } from '../components/Markdown';
import { ReviewDialog } from '../components/ReviewDialog';
import { SidePanel } from '../components/SidePanel';
import { useStamp } from '../components/stamp';
import { useToast } from '../components/Toast';
import { DEFAULT_CORE_MAP, DEFAULT_SCHEMA_BUDGETS, pageTypeFor } from '../lib/schema-parser';
import { codeChangedSources } from '../lib/attention';
import { coreRead } from '../lib/budgets';
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

function recentLogSections(markdown: string): string[] {
  const parts = markdown.split(/\n(?=## )/);
  return parts.filter((p) => p.startsWith('## ')).slice(-10).reverse();
}

function formatLintWhen(d: Date): string {
  return d.toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });
}

type PanelPage = { path: string; markdown: string };
type Section = 'trust' | 'structure' | 'budget' | 'risks' | 'log';

export default function Salute() {
  const project = useProject();
  const nav = useNav();
  const toast = useToast();
  const { stamp, isStamped } = useStamp();

  const [panel, setPanel] = useState<PanelPage | null>(null);
  const [review, setReview] = useState<{ path: string; markdown: string } | null>(null);
  const [tierFilter, setTierFilter] = useState<TrustTier | ''>('');
  const [driftOnly, setDriftOnly] = useState(false);
  const [open, setOpen] = useState<Section | null>(null);

  const signable = !project.actorError;
  const coreMap = project.schema?.coreMap ?? DEFAULT_CORE_MAP;
  const budgets = project.schema?.budgets ?? DEFAULT_SCHEMA_BUDGETS;

  // A link to a page or a risk opens its section first, then scrolls to the row.
  useEffect(() => {
    if (!nav.ref || nav.section !== 'salute') return;
    setOpen(project.risks?.some((r) => r.id === nav.ref) ? 'risks' : 'trust');
    const id = requestAnimationFrame(() =>
      document.querySelector(`[data-page="${CSS.escape(nav.ref!)}"]`)?.scrollIntoView({ block: 'nearest' }),
    );
    return () => cancelAnimationFrame(id);
  }, [nav.ref, nav.section, project.risks]);

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

  const logRel = coreMap.log;

  const overBudget = project.pages.filter(
    (p) => p.relPath !== logRel && p.sizeBytes > budgets.singlePageBytes,
  );

  const core = useMemo(() => coreRead(project.pages, coreMap), [project.pages, coreMap]);
  // Limits still at the values written before plugin 0.16 (20 KB page, 60 KB core read).
  const oldSchemaBudgets = budgets.singlePageBytes === 20 * 1024 || budgets.coreReadBytes === 60 * 1024;

  const logPage = project.pages.find((p) => p.relPath === coreMap.log);
  const logBytes = logPage?.sizeBytes ?? 0;
  const risksPage = project.pages.find((p) => p.relPath === coreMap.risks);
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

  const tierCount = (tier: TrustTier) => project.pages.filter((p) => p.trust === tier).length;
  const verifiedPct = project.pages.length
    ? Math.round(((tierCount('machine-confirmed') + tierCount('human-reviewed')) / project.pages.length) * 100)
    : 0;
  const logEntries = logPage ? recentLogSections(logPage.markdown).length : 0;
  const cards: Array<{ key: Section; title: string; value: string; sub: string; warn: boolean }> = [
    {
      key: 'trust',
      title: t('revisione.health.trustTitle'),
      value: t('revisione.health.card.trustValue', { pct: verifiedPct }),
      sub: t('revisione.health.card.trustSub', { drift: tierCount('stale-verified'), never: tierCount('unverified') }),
      warn: tierCount('stale-verified') > 0,
    },
    {
      key: 'structure',
      title: t('revisione.health.structure'),
      value: !project.lint
        ? t('revisione.health.card.notChecked')
        : findings.length === 0
          ? t('revisione.health.card.noProblems')
          : t('revisione.health.card.problems', { n: findings.length }),
      sub: lastLintAt
        ? t('revisione.health.lastCheck', { when: formatLintWhen(lastLintAt) })
        : t('revisione.health.card.runIt'),
      warn: findings.length > 0 || Boolean(lintError),
    },
    {
      key: 'budget',
      title: t('revisione.health.budget'),
      value: `${formatBytes(core.total)} / ${formatBytes(budgets.coreReadBytes)}`,
      sub: t('revisione.health.card.budgetSub', { n: overBudget.length, size: formatBytes(budgets.singlePageBytes) }),
      warn: core.total > budgets.coreReadBytes || overBudget.length > 0,
    },
    {
      key: 'risks',
      title: t('revisione.health.risks'),
      value: project.risks ? String(project.risks.length) : '—',
      sub: t('revisione.health.card.risksSub', { n: unowned.size }),
      warn: unowned.size > 0,
    },
    {
      key: 'log',
      title: t('revisione.health.recentLog'),
      value: `${formatBytes(logBytes)} / ${formatBytes(budgets.logBytes)}`,
      sub: t('revisione.health.card.logSub', { n: logEntries }),
      warn: logBytes > budgets.logBytes,
    },
  ];

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
      <HealthHeadline
        pages={project.pages.map((p) => p.trust)}
        findings={project.lint ? findings.length : null}
        unownedRisks={unowned.size}
      />

      <div className="salute-cards" role="group" aria-label={t('revisione.health.title')}>
        {cards.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`salute-card${c.warn ? ' is-warn' : ''}`}
            aria-pressed={open === c.key}
            onClick={() => setOpen(open === c.key ? null : c.key)}
          >
            <span className="salute-card-title">{c.title}</span>
            <span className="salute-card-value">{c.value}</span>
            <span className="salute-card-sub">{c.sub}</span>
          </button>
        ))}
      </div>

      {open === 'trust' && (
      <section className="group">
        <h2 className="group-title">{t('revisione.health.trustTitle')}</h2>
        <dl className="salute-legend">
          {TRUST_TIERS.map((tier) => (
            <Fragment key={tier}>
              <dt>
                <span className={TRUST_BADGE[tier]}>{trustLabel(tier)}</span>
              </dt>
              <dd>{t(`revisione.health.trustMeaning.${tier}` as Key)}</dd>
            </Fragment>
          ))}
        </dl>
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
      )}
      {open === 'structure' && (
        <>
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
        </>
      )}
      {open === 'budget' && (
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
              {formatBytes(core.total)} / {formatBytes(budgets.coreReadBytes)}
            </p>
            <div
              className={`salute-bar${core.total > budgets.coreReadBytes ? ' salute-bar-over' : ''}`}
              style={{ gridColumn: '1 / -1' }}
              role="progressbar"
              aria-valuenow={core.total}
              aria-valuemax={budgets.coreReadBytes}
            >
              <div
                className="salute-bar-fill"
                style={{ width: `${Math.min(100, (core.total / budgets.coreReadBytes) * 100)}%` }}
              />
            </div>
          </div>

          <ul className="salute-core-files">
            {core.items.map((i) => (
              <li key={i.path}>
                <span className="salute-table-path">{i.path}</span>
                <span>{formatBytes(i.bytes)}</span>
              </li>
            ))}
          </ul>
          {oldSchemaBudgets && <p className="muted salute-note">{t('revisione.health.oldBudgets')}</p>}

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
      )}
      {open === 'risks' && (
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
      )}
      {open === 'log' && (
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
      )}

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

/** One plain answer on top: how much of the wiki can be trusted now, and what pulls it down. */
function HealthHeadline({ pages, findings, unownedRisks }: { pages: TrustTier[]; findings: number | null; unownedRisks: number }) {
  if (pages.length === 0) return null;
  const count = (tier: TrustTier) => pages.filter((p) => p === tier).length;
  const verified = count('machine-confirmed') + count('human-reviewed');
  const drift = count('stale-verified');
  const never = count('unverified');
  const share = Math.round((verified / pages.length) * 100);
  const issues = [
    drift > 0 && t('revisione.health.headline.drift', { n: drift }),
    never > 0 && t('revisione.health.headline.never', { n: never }),
    findings && t('revisione.health.headline.findings', { n: findings }),
    unownedRisks > 0 && t('revisione.health.headline.risks', { n: unownedRisks }),
  ].filter(Boolean) as string[];
  return (
    <div className={`panel health-headline${issues.length === 0 ? ' is-good' : ''}`}>
      <p className="health-headline-main">{t('revisione.health.headline.share', { share, n: pages.length })}</p>
      <p className="health-headline-sub">
        {issues.length === 0 ? t('revisione.health.headline.allGood') : issues.join(' · ')}
      </p>
    </div>
  );
}
