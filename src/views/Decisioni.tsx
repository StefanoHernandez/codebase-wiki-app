import { t, type Key } from '../i18n';
import { fixedValue } from '../lib/labels';
import { useEffect, useMemo, useState } from 'react';
import { Empty } from '../components/Empty';
import { Markdown } from '../components/Markdown';
import { DecideDialog } from '../components/DecisionDialogs';
import { decisionBlockedReason } from '../lib/wiki-compat';
import { useStamp } from '../components/stamp';
import { useToast } from '../components/Toast';
import { parseFrontmatter } from '../lib/frontmatter';
import { useProject } from '../state/project';
import { useNav } from '../state/nav';
import type { Decision, DecisionStatus } from '../types/wiki';
import './decisioni.css';

const GROUPS: Array<{ status: DecisionStatus; human?: boolean }> = [
  { status: 'proposed', human: true },
  { status: 'accepted' },
  { status: 'rejected' },
  { status: 'superseded' },
  { status: 'unknown' },
];

const statusLabel = (s: DecisionStatus) => t(`revisione.decisions.status.${s}` as Key);

function statusChip(decision: Decision) {
  const label =
    decision.status === 'superseded' && decision.supersededBy
      ? t('revisione.decisions.supersededBy', { id: decision.supersededBy })
      : statusLabel(decision.status);
  const cls =
    decision.status === 'proposed'
      ? 'badge badge-human'
      : decision.status === 'accepted'
        ? 'badge badge-ok'
        : 'badge';
  return <span className={cls}>{label}</span>;
}

export default function Decisioni() {
  const project = useProject();
  const nav = useNav();
  const toast = useToast();
  const { stamp } = useStamp();
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<{ decision: Decision; verdict: 'accepted' | 'rejected' } | null>(null);
  const signable = !project.actorError;

  const grouped = useMemo(() => {
    const map = new Map<DecisionStatus, Decision[]>();
    for (const g of GROUPS) map.set(g.status, []);
    for (const d of project.decisions) {
      const list = map.get(d.status);
      if (list) list.push(d);
    }
    return GROUPS.map((g) => ({ ...g, items: map.get(g.status) ?? [] })).filter((g) => g.items.length > 0);
  }, [project.decisions]);

  useEffect(() => {
    if (nav.section === 'decisioni' && nav.ref) setSelected(nav.ref);
  }, [nav.section, nav.ref]);

  useEffect(() => {
    if (selected && !project.decisions.some((d) => d.number === selected)) {
      setSelected(project.decisions[0]?.number ?? null);
    } else if (!selected && project.decisions.length > 0) {
      const proposed = project.decisions.find((d) => d.status === 'proposed');
      setSelected(proposed?.number ?? project.decisions[0].number);
    }
  }, [project.decisions, selected]);

  const active = project.decisions.find((d) => d.number === selected) ?? null;
  const page = active ? project.pages.find((p) => p.relPath === active.relPath) : null;
  const meta = page ? parseFrontmatter(page.markdown) : null;
  const activeBlocked = !!active && project.compat.decisionBlocked.has(active.relPath);

  const openDecisionLink = (relPath: string) => {
    const normalized = relPath.replace(/\\/g, '/');
    const hit = project.decisions.find((d) => d.relPath === normalized);
    if (hit) setSelected(hit.number);
  };

  const finish = (text: string, number: string) => {
    setPending(null);
    toast(text);
    stamp(number);
    setSelected(number);
  };

  const signButton = (label: string, onClick: () => void, blocked = false) => (
    <button
      type="button"
      className="btn btn-human-outline"
      aria-disabled={!signable || blocked}
      title={blocked ? decisionBlockedReason() : signable ? undefined : t('lavori.dialog.signHint')}
      onClick={() => signable && !blocked && onClick()}
    >
      {label}
    </button>
  );

  if (project.decisions.length === 0) {
    return (
      <section className="view">
        <h1 className="view-title">{t('revisione.decisions.title')}</h1>
        <Empty title={t('revisione.decisions.empty')} />
      </section>
    );
  }

  return (
    <section className="view">
      <h1 className="view-title">{t('revisione.decisions.title')}</h1>
      <div className="decisioni-layout">
        <div className="decisioni-list">
          {grouped.map((group) => (
            <div key={group.status}>
              <h2 className={`decisioni-group-title${group.human ? ' decisioni-group-title--human' : ''}`}>
                {t(`revisione.decisions.group.${group.status}` as Key)}
              </h2>
              {group.items.map((d) => (
                <button
                  key={d.number}
                  type="button"
                  className={`decisioni-row${selected === d.number ? ' is-selected' : ''}`}
                  onClick={() => setSelected(d.number)}
                >
                  <span className="decisioni-row-num">{d.number}</span>
                  <span className="decisioni-row-title">{d.title.replace(new RegExp(`^${d.number}\\s*[-–—:]\\s*`), '')}</span>
                  {statusChip(d)}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div>
          {active && page ? (
            <>
              <dl className="decisioni-meta">
                <div>
                  <dt>{t('revisione.decisions.metaStatus')}</dt>
                  <dd>{statusLabel(active.status)}</dd>
                </div>
                {meta && meta.sources.length > 0 && (
                  <div>
                    <dt>{t('revisione.decisions.metaSources')}</dt>
                    <dd>{meta.sources.join(', ')}</dd>
                  </div>
                )}
                {meta?.fields.confidence && (
                  <div>
                    <dt>{t('revisione.decisions.metaConfidence')}</dt>
                    <dd>{fixedValue(meta.fields.confidence)}</dd>
                  </div>
                )}
              </dl>
              <div className="decisioni-detail">
                <Markdown
                  markdown={page.markdown}
                  pagePath={page.relPath}
                  onOpenPage={openDecisionLink}
                  wikiLinkTargets={project.decisions.map((d) => d.relPath)}
                />
              </div>
              {active.status === 'proposed' && (
                <div className="decisioni-actions">
                  {signButton(t('revisione.decisions.accept'), () => setPending({ decision: active, verdict: 'accepted' }), activeBlocked)}
                  {signButton(t('revisione.decisions.reject'), () => setPending({ decision: active, verdict: 'rejected' }), activeBlocked)}
                  {activeBlocked && <p className="muted">{decisionBlockedReason()}</p>}
                </div>
              )}
            </>
          ) : (
            <Empty title={t('revisione.decisions.select')} />
          )}
        </div>
      </div>

      {pending && (
        <DecideDialog
          decision={pending.decision}
          verdict={pending.verdict}
          onClose={() => setPending(null)}
          onDone={(number) =>
            finish(pending.verdict === 'accepted' ? t('revisione.decisions.accepted') : t('revisione.decisions.rejected'), number)
          }
        />
      )}
    </section>
  );
}
