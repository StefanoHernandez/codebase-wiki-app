import { useEffect, useMemo, useState } from 'react';
import { Empty } from '../components/Empty';
import { Markdown } from '../components/Markdown';
import { DecideDialog, SIGN_HINT } from '../components/DecisionDialogs';
import { useStamp } from '../components/stamp';
import { useToast } from '../components/Toast';
import { parseFrontmatter } from '../lib/frontmatter';
import { useProject } from '../state/project';
import { useNav } from '../state/nav';
import type { Decision, DecisionStatus } from '../types/wiki';
import './decisioni.css';

const GROUPS: Array<{ status: DecisionStatus; title: string; human?: boolean }> = [
  { status: 'proposed', title: 'In attesa', human: true },
  { status: 'accepted', title: 'Accettate' },
  { status: 'rejected', title: 'Rifiutate' },
  { status: 'superseded', title: 'Superate' },
  { status: 'unknown', title: 'Altro' },
];

const STATUS_LABEL: Record<DecisionStatus, string> = {
  proposed: 'In attesa',
  accepted: 'Accettata',
  rejected: 'Rifiutata',
  superseded: 'Superata',
  unknown: 'Sconosciuto',
};

function statusChip(decision: Decision) {
  const label =
    decision.status === 'superseded' && decision.supersededBy
      ? `Superata da ${decision.supersededBy}`
      : STATUS_LABEL[decision.status];
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

  const signButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      className="btn btn-human"
      aria-disabled={!signable}
      title={signable ? undefined : SIGN_HINT}
      onClick={() => signable && onClick()}
    >
      {label}
    </button>
  );

  if (project.decisions.length === 0) {
    return (
      <section className="view">
        <h1 className="view-title">Decisioni</h1>
        <Empty title="Questa wiki non ha decisioni registrate." />
      </section>
    );
  }

  return (
    <section className="view">
      <h1 className="view-title">Decisioni</h1>
      <div className="decisioni-layout">
        <div className="decisioni-list">
          {grouped.map((group) => (
            <div key={group.status}>
              <h2 className={`decisioni-group-title${group.human ? ' decisioni-group-title--human' : ''}`}>
                {group.title}
              </h2>
              {group.items.map((d) => (
                <button
                  key={d.number}
                  type="button"
                  className={`decisioni-row${selected === d.number ? ' is-selected' : ''}`}
                  onClick={() => setSelected(d.number)}
                >
                  <span className="decisioni-row-num">{d.number}</span>
                  <span className="decisioni-row-title">{d.title}</span>
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
                  <dt>Stato</dt>
                  <dd>{STATUS_LABEL[active.status]}</dd>
                </div>
                {meta && meta.sources.length > 0 && (
                  <div>
                    <dt>Fonti</dt>
                    <dd>{meta.sources.join(', ')}</dd>
                  </div>
                )}
                {meta?.fields.confidence && (
                  <div>
                    <dt>Affidabilità</dt>
                    <dd>{meta.fields.confidence}</dd>
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
                  {signButton('Accetta decisione', () => setPending({ decision: active, verdict: 'accepted' }))}
                  {signButton('Rifiuta decisione', () => setPending({ decision: active, verdict: 'rejected' }))}
                </div>
              )}
            </>
          ) : (
            <Empty title="Seleziona una decisione dall'elenco." />
          )}
        </div>
      </div>

      {pending && (
        <DecideDialog
          decision={pending.decision}
          verdict={pending.verdict}
          onClose={() => setPending(null)}
          onDone={(number) =>
            finish(pending.verdict === 'accepted' ? 'Decisione accettata' : 'Decisione rifiutata', number)
          }
        />
      )}
    </section>
  );
}
