import { renderInlineCode } from '../lib/inline-code';
import { useEffect, useState, type ReactNode } from 'react';
import { Empty } from '../components/Empty';
import { CloseDialog, FieldDialog, PromoteDialog, SIGN_HINT } from '../components/TrackerDialogs';
import { useStamp } from '../components/stamp';
import { NextStepsCard } from '../components/NextSteps';
import { CLOSE_BLOCKED_REASON } from '../lib/wiki-compat';
import { useToast } from '../components/Toast';
import { useProject } from '../state/project';
import { useNav } from '../state/nav';
import type { TrackerDoneRow, TrackerOpenRow, TrackerProposalRow } from '../types/wiki';

type Pending =
  | { kind: 'promote'; proposal: TrackerProposalRow }
  | { kind: 'close'; row: TrackerOpenRow }
  | { kind: 'owner'; row: TrackerOpenRow }
  | { kind: 'priority'; row: TrackerOpenRow; column: string };

/** Open columns the app knows; any other header is an extra column shown as key/value. */
const KNOWN_OPEN = ['id', 'status', 'goal', 'done when', 'owner', 'next verification', 'evidence'];
const DONE_STATUS_TEXT: Record<string, string> = { '🟢': 'Verificato', '⚫': 'Chiuso senza prova' };
const KNOWN_OPEN_STATUS = new Set(['⚪', '🟡', '🔴']);
const CLOSURE = /^closed by (.+?) (\d{4}-\d{2}-\d{2}); not proven: (.+)$/;

const idNumber = (id: string) => Number(id.replace(/\D/g, '')) || 0;

/** Closure text as written by a person, read back as a sentence. Unknown shapes are shown as stored. */
function closureCopy(criteria: string): string {
  const m = CLOSURE.exec(criteria);
  return m ? `Chiuso da ${m[1]} il ${m[2]}. Non provato: ${m[3]}` : criteria;
}

export default function Lavori() {
  const project = useProject();
  const nav = useNav();
  const toast = useToast();
  const { stamp, isStamped } = useStamp();
  const [pending, setPending] = useState<Pending | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [phase, setPhase] = useState('');
  const signable = !project.actorError;

  const tracker = project.tracker;

  // A ref from another view (a closed row, for instance) must be visible: open the closed column, then scroll to it.
  useEffect(() => {
    if (!nav.ref) return;
    if (tracker?.done.some((r) => r.id === nav.ref)) setShowClosed(true);
  }, [nav.ref, tracker]);
  useEffect(() => {
    if (!nav.ref) return;
    const el = document.querySelector(`[data-key="${CSS.escape(nav.ref)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [nav.ref, showClosed]);

  if (!tracker) {
    return (
      <section className="view">
        <h1 className="view-title">Lavori</h1>
        <Empty title="Questa wiki non ha un tracker dei lavori." />
      </section>
    );
  }

  const phaseHeader = tracker.openHeader.find((h) => h.trim().toLowerCase() === 'phase');
  const priorityHeader = tracker.openHeader.find((h) => h.trim().toLowerCase() === 'priority');
  const extraOpen = tracker.openHeader.filter((h) => !KNOWN_OPEN.includes(h.trim().toLowerCase()));
  const phases = phaseHeader
    ? [...new Set(tracker.open.map((r) => r.extra[phaseHeader] ?? '').filter(Boolean))].sort()
    : [];
  const open = tracker.open.filter((r) => !phase || (phaseHeader && r.extra[phaseHeader] === phase));
  const closed = [...tracker.done].sort(
    (a, b) => b.closed.localeCompare(a.closed) || idNumber(b.id) - idNumber(a.id),
  );

  const finish = (text: string, id: string | null, extra?: () => void) => {
    setPending(null);
    toast(text);
    if (id) stamp(id);
    extra?.();
  };

  const closeBlocked = project.compat.closeBlocked;
  const signButton = (label: string, cls: string, onClick: () => void, blockedReason: string | null = null) => (
    <button
      type="button"
      className={`btn ${cls}`}
      aria-disabled={!signable || !!blockedReason}
      title={blockedReason ?? (signable ? undefined : SIGN_HINT)}
      onClick={() => signable && !blockedReason && onClick()}
    >
      {label}
    </button>
  );

  const extras = (values: Record<string, string>, headers: string[]) =>
    headers
      .filter((h) => values[h])
      .map((h) => (
        <div key={h} className="card-extra">
          <dt>{h}</dt>
          <dd>{renderInlineCode(values[h])}</dd>
        </div>
      ));

  const openCard = (row: TrackerOpenRow) => (
    <article
      key={row.id}
      data-key={row.id}
      className={`card kanban-card${isStamped(row.id) ? ' stamp' : ''}${nav.ref === row.id ? ' is-selected' : ''}`}
    >
      <p className="kanban-card-id">
        <span className="status-icon" aria-hidden="true">
          {row.status}
        </span>
        {row.id}
      </p>
      <p className="card-goal">{renderInlineCode(row.goal)}</p>
      <dl className="card-meta">
        <div>
          <dt>Responsabile</dt>
          <dd>{row.owner || 'Nessuno'}</dd>
        </div>
        <div>
          <dt>Fatto quando</dt>
          <dd className="clamp-3">{renderInlineCode(row.doneWhen)}</dd>
        </div>
        <div>
          <dt>Prossima verifica</dt>
          <dd>
            <code>{row.nextVerification}</code>
          </dd>
        </div>
        <div>
          <dt>Prova</dt>
          <dd className="clamp-3">{renderInlineCode(row.evidence)}</dd>
        </div>
        {extras(row.extra, extraOpen)}
      </dl>
      <div className="card-actions">
        {signButton('Cambia responsabile', 'btn-quiet', () => setPending({ kind: 'owner', row }))}
        {priorityHeader &&
          signButton('Cambia priorità', 'btn-quiet', () =>
            setPending({ kind: 'priority', row, column: priorityHeader }),
          )}
        {signButton('Chiudi senza prova', 'btn-human-outline', () => setPending({ kind: 'close', row }), closeBlocked ? CLOSE_BLOCKED_REASON : null)}
      </div>
    </article>
  );

  const proposalCard = (p: TrackerProposalRow, index: number) => (
    <article key={`${index}:${p.proposal}`} data-key={p.proposal} className={`card kanban-card${nav.ref === p.proposal ? ' is-selected' : ''}`}>
      <p className="card-goal">{renderInlineCode(p.proposal)}</p>
      <p className="card-meta-text">
        {p.by || 'Qualcuno'}
        {p.date ? ` il ${p.date}` : ''}
      </p>
      {p.why && <p className="card-meta-text">{renderInlineCode(p.why)}</p>}
      <div className="card-actions">
        {signButton('Promuovi a lavoro', 'btn-human-outline', () =>
          setPending({ kind: 'promote', proposal: p }),
        )}
      </div>
    </article>
  );

  const doneCard = (row: TrackerDoneRow) => (
    <article
      key={row.id}
      data-key={row.id}
      className={`card kanban-card${isStamped(row.id) ? ' stamp' : ''}${nav.ref === row.id ? ' is-selected' : ''}`}
    >
      <p className="kanban-card-id">
        <span className="status-icon" aria-hidden="true">
          {row.status}
        </span>
        {row.id}
        <span className="muted">{DONE_STATUS_TEXT[row.status] ?? ''}</span>
      </p>
      <p className="card-goal">{renderInlineCode(row.goal)}</p>
      <dl className="card-meta">
        <div>
          <dt>Chiuso il</dt>
          <dd>{row.closed}</dd>
        </div>
        <div>
          <dt>Criteri</dt>
          <dd className="clamp-3">{closureCopy(row.criteriaMet)}</dd>
        </div>
        <div>
          <dt>Prova</dt>
          <dd className="clamp-3">{renderInlineCode(row.evidence)}</dd>
        </div>
        {extras(row.extra, tracker.doneHeader.filter((h) => !['id', 'status', 'goal', 'closed', 'criteria met', 'evidence'].includes(h.trim().toLowerCase())))}
      </dl>
    </article>
  );

  const byStatus = (status: string) => open.filter((r) => r.status === status);
  const otherOpen = open.filter((r) => !KNOWN_OPEN_STATUS.has(r.status));
  const column = (title: string, icon: string | null, count: number, body: ReactNode) => (
    <section className="kanban-col">
      <h2 className="kanban-title">
        {icon && (
          <span className="status-icon" aria-hidden="true">
            {icon}
          </span>
        )}
        {title} <span className="kanban-count">{count}</span>
      </h2>
      {body}
    </section>
  );
  const none = <p className="muted">Nessun lavoro qui.</p>;

  return (
    <section className="view">
      <h1 className="view-title">Lavori</h1>
      <NextStepsCard />
      <div className="toolbar">
        {phaseHeader && phases.length > 0 && (
          <label className="toolbar-field">
            <span>Fase</span>
            <select className="input" value={phase} onChange={(e) => setPhase(e.target.value)}>
              <option value="">Tutte</option>
              {phases.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}
        {!signable && <p className="muted">{SIGN_HINT}</p>}
        {closeBlocked && <p className="muted">{CLOSE_BLOCKED_REASON}</p>}
      </div>

      <div className="kanban">
        {column(
          'Proposte',
          null,
          tracker.proposals.length,
          tracker.proposals.length
            ? tracker.proposals.map((p, i) => proposalCard(p, i))
            : none,
        )}
        {column('Da fare', '⚪', byStatus('⚪').length, byStatus('⚪').length ? byStatus('⚪').map(openCard) : none)}
        {column('In corso', '🟡', byStatus('🟡').length, byStatus('🟡').length ? byStatus('🟡').map(openCard) : none)}
        {column('Bloccati', '🔴', byStatus('🔴').length, byStatus('🔴').length ? byStatus('🔴').map(openCard) : none)}
        {column('Altro', null, otherOpen.length, otherOpen.length ? otherOpen.map(openCard) : none)}
        <section className="kanban-col">
          <h2 className="kanban-title">
            <span className="status-icon" aria-hidden="true">
              🟢 ⚫
            </span>
            Chiusi <span className="kanban-count">{closed.length}</span>
          </h2>
          <button
            type="button"
            className="btn btn-quiet"
            aria-expanded={showClosed}
            onClick={() => setShowClosed((v) => !v)}
          >
            {showClosed ? 'Nascondi chiusi' : 'Mostra chiusi'}
          </button>
          {showClosed && (closed.length ? closed.map(doneCard) : none)}
        </section>
      </div>

      {pending?.kind === 'promote' && (
        <PromoteDialog
          proposal={pending.proposal}
          onClose={() => setPending(null)}
          onDone={(id) => finish(`Proposta promossa a ${id}`, id)}
        />
      )}
      {pending?.kind === 'close' && (
        <CloseDialog
          row={pending.row}
          onClose={() => setPending(null)}
          onDone={(id) => finish('Lavoro chiuso', id, () => setShowClosed(true))}
        />
      )}
      {pending?.kind === 'owner' && (
        <FieldDialog
          row={pending.row}
          column="owner"
          label="Responsabile"
          title="Cambia responsabile"
          initial={pending.row.owner}
          onClose={() => setPending(null)}
          onDone={(id) => finish('Responsabile aggiornato', id)}
        />
      )}
      {pending?.kind === 'priority' && (
        <FieldDialog
          row={pending.row}
          column={pending.column}
          label="Priorità"
          title="Cambia priorità"
          initial={pending.row.extra[pending.column] ?? ''}
          onClose={() => setPending(null)}
          onDone={(id) => finish('Priorità aggiornata', id)}
        />
      )}
    </section>
  );
}
