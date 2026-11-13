import { fieldLabel, fixedValue } from '../lib/labels';
import { renderInlineCode } from '../lib/inline-code';
import { useEffect, useState, type ReactNode } from 'react';
import { Empty } from '../components/Empty';
import { CloseDialog, FieldDialog, PromoteDialog } from '../components/TrackerDialogs';
import { useStamp } from '../components/stamp';
import { NextStepsCard } from '../components/NextSteps';
import { closeBlockedReason } from '../lib/wiki-compat';
import { useToast } from '../components/Toast';
import { useProject } from '../state/project';
import { useNav } from '../state/nav';
import { taskReadiness } from '../lib/dependencies';
import type { TrackerDoneRow, TrackerOpenRow, TrackerProposalRow } from '../types/wiki';
import { t, type Key } from '../i18n';

type Pending =
  | { kind: 'promote'; proposal: TrackerProposalRow }
  | { kind: 'close'; row: TrackerOpenRow }
  | { kind: 'owner'; row: TrackerOpenRow }
  | { kind: 'priority'; row: TrackerOpenRow; column: string };

/** Open columns the app knows; any other header is an extra column shown as key/value. */
const KNOWN_OPEN = ['id', 'status', 'goal', 'done when', 'owner', 'next verification', 'evidence', 'depends on'];
const DONE_STATUS_TEXT: Record<string, Key> = { '🟢': 'lavori.board.verified', '⚫': 'lavori.board.closedUnproven' };
const KNOWN_OPEN_STATUS = new Set(['⚪', '🟡', '🔴']);
const CLOSURE = /^closed by (.+?) (\d{4}-\d{2}-\d{2}); not proven: (.+)$/;

const idNumber = (id: string) => Number(id.replace(/\D/g, '')) || 0;

/** Closure text as written by a person, read back as a sentence. Unknown shapes are shown as stored. */
function closureCopy(criteria: string): string {
  const m = CLOSURE.exec(criteria);
  return m ? t('lavori.board.closure', { by: m[1]!, date: m[2]!, notProven: m[3]! }) : criteria;
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
    // A phase filter must not hide the selected open card.
    if (tracker?.open.some((r) => r.id === nav.ref)) setPhase('');
  }, [nav.ref, tracker]);
  useEffect(() => {
    if (!nav.ref) return;
    const el = document.querySelector(`[data-key="${CSS.escape(nav.ref)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [nav.ref, showClosed, phase]);

  if (!tracker) {
    return (
      <section className="view">
        <h1 className="view-title">{t('lavori.title')}</h1>
        <Empty title={t('lavori.noTracker')} />
      </section>
    );
  }

  const phaseHeader = tracker.openHeader.find((h) => h.trim().toLowerCase() === 'phase');
  const priorityHeader = tracker.openHeader.find((h) => h.trim().toLowerCase() === 'priority');
  const readiness = taskReadiness(tracker);
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
      title={blockedReason ?? (signable ? undefined : t('lavori.dialog.signHint'))}
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
          <dt>{fieldLabel(h)}</dt>
          <dd>{renderInlineCode(fixedValue(values[h]))}</dd>
        </div>
      ));

  /** "Pronto" when the row lists dependencies and all are met; otherwise what it still waits for. */
  const waitLine = (row: TrackerOpenRow) => {
    const r = readiness.get(row.id);
    const listed = (row.dependsOn?.ids.length ?? 0) + (row.dependsOn?.external.length ?? 0);
    if (!r || listed === 0) return null;
    if (r.ready) return <p className="card-deps"><span className="badge badge-ok">{t('lavori.board.ready')}</span></p>;
    return (
      <p className="card-deps">
        {t('lavori.board.waits')}{' '}
        {r.waitingOn.map((id, i) => (
          <span key={id}>
            {i > 0 && ', '}
            {r.unknown.includes(id) ? (
              <span title={t('lavori.board.unknownId')}>{id}</span>
            ) : (
              <button
                type="button"
                className="btn btn-link"
                onClick={() => {
                  // Same ref twice: the effect does not re-run, so scroll here.
                  if (nav.ref === id) document.querySelector(`[data-key="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
                  else nav.go('lavori', id);
                }}
              >
                {id}
              </button>
            )}
          </span>
        ))}
        {r.waitingOn.length > 0 && r.external.length > 0 && ' · '}
        {r.external.join(' · ')}
      </p>
    );
  };

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
      {waitLine(row)}
      <dl className="card-meta">
        <div>
          <dt>{t('lavori.field.owner')}</dt>
          <dd>{row.owner || t('lavori.board.nobody')}</dd>
        </div>
        <div>
          <dt>{t('lavori.field.doneWhen')}</dt>
          <dd className="clamp-3">{renderInlineCode(row.doneWhen)}</dd>
        </div>
        <div>
          <dt>{t('lavori.field.nextVerification')}</dt>
          <dd>
            <code>{row.nextVerification}</code>
          </dd>
        </div>
        <div>
          <dt>{t('lavori.field.evidence')}</dt>
          <dd className="clamp-3">{renderInlineCode(fixedValue(row.evidence))}</dd>
        </div>
        {extras(row.extra, extraOpen)}
      </dl>
      <div className="card-actions">
        {signButton(t('lavori.board.changeOwner'), 'btn-quiet', () => setPending({ kind: 'owner', row }))}
        {priorityHeader &&
          signButton(t('lavori.board.changePriority'), 'btn-quiet', () =>
            setPending({ kind: 'priority', row, column: priorityHeader }),
          )}
        {signButton(t('lavori.board.closeUnproven'), 'btn-human-outline', () => setPending({ kind: 'close', row }), closeBlocked ? closeBlockedReason() : null)}
      </div>
    </article>
  );

  const proposalCard = (p: TrackerProposalRow, index: number) => (
    <article key={`${index}:${p.proposal}`} data-key={p.proposal} className={`card kanban-card${nav.ref === p.proposal ? ' is-selected' : ''}`}>
      <p className="card-goal">{renderInlineCode(p.proposal)}</p>
      <p className="card-meta-text">
        {p.by || t('lavori.board.someone')}
        {p.date ? t('lavori.board.onDate', { date: p.date }) : ''}
      </p>
      {p.why && <p className="card-meta-text">{renderInlineCode(p.why)}</p>}
      <div className="card-actions">
        {signButton(t('lavori.board.promote'), 'btn-human-outline', () =>
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
        <span className="muted">{DONE_STATUS_TEXT[row.status] ? t(DONE_STATUS_TEXT[row.status]!) : ''}</span>
      </p>
      <p className="card-goal">{renderInlineCode(row.goal)}</p>
      <dl className="card-meta">
        <div>
          <dt>{t('lavori.field.closed')}</dt>
          <dd>{row.closed}</dd>
        </div>
        <div>
          <dt>{t('lavori.field.criteria')}</dt>
          <dd className="clamp-3">{closureCopy(row.criteriaMet)}</dd>
        </div>
        <div>
          <dt>{t('lavori.field.evidence')}</dt>
          <dd className="clamp-3">{renderInlineCode(fixedValue(row.evidence))}</dd>
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
  const none = <p className="muted">{t('lavori.board.none')}</p>;

  return (
    <section className="view">
      <h1 className="view-title">{t('lavori.title')}</h1>
      <NextStepsCard />
      <div className="toolbar">
        {phaseHeader && phases.length > 0 && (
          <label className="toolbar-field">
            <span>{t('lavori.board.phase')}</span>
            <select className="input" value={phase} onChange={(e) => setPhase(e.target.value)}>
              <option value="">{t('lavori.board.allPhases')}</option>
              {phases.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}
        {!signable && <p className="muted">{t('lavori.dialog.signHint')}</p>}
        {closeBlocked && <p className="muted">{closeBlockedReason()}</p>}
      </div>

      <div className="kanban">
        {column(
          t('lavori.col.proposals'),
          null,
          tracker.proposals.length,
          tracker.proposals.length
            ? tracker.proposals.map((p, i) => proposalCard(p, i))
            : none,
        )}
        {column(t('lavori.col.todo'), '⚪', byStatus('⚪').length, byStatus('⚪').length ? byStatus('⚪').map(openCard) : none)}
        {column(t('lavori.col.doing'), '🟡', byStatus('🟡').length, byStatus('🟡').length ? byStatus('🟡').map(openCard) : none)}
        {column(t('lavori.col.blocked'), '🔴', byStatus('🔴').length, byStatus('🔴').length ? byStatus('🔴').map(openCard) : none)}
        {column(t('lavori.col.other'), null, otherOpen.length, otherOpen.length ? otherOpen.map(openCard) : none)}
        <section className="kanban-col">
          <h2 className="kanban-title">
            <span className="status-icon" aria-hidden="true">
              🟢 ⚫
            </span>
            {t('lavori.col.closed')} <span className="kanban-count">{closed.length}</span>
          </h2>
          <button
            type="button"
            className="btn btn-quiet"
            aria-expanded={showClosed}
            onClick={() => setShowClosed((v) => !v)}
          >
            {showClosed ? t('lavori.board.hideClosed') : t('lavori.board.showClosed')}
          </button>
          {showClosed && (closed.length ? closed.map(doneCard) : none)}
        </section>
      </div>

      {pending?.kind === 'promote' && (
        <PromoteDialog
          proposal={pending.proposal}
          onClose={() => setPending(null)}
          onDone={(id) => finish(t('lavori.toast.promoted', { id }), id)}
        />
      )}
      {pending?.kind === 'close' && (
        <CloseDialog
          row={pending.row}
          onClose={() => setPending(null)}
          onDone={(id) => finish(t('lavori.toast.closed'), id, () => setShowClosed(true))}
        />
      )}
      {pending?.kind === 'owner' && (
        <FieldDialog
          row={pending.row}
          column="owner"
          label={t('lavori.field.owner')}
          title={t('lavori.board.changeOwner')}
          initial={pending.row.owner}
          onClose={() => setPending(null)}
          onDone={(id) => finish(t('lavori.toast.ownerUpdated'), id)}
        />
      )}
      {pending?.kind === 'priority' && (
        <FieldDialog
          row={pending.row}
          column={pending.column}
          label={t('lavori.field.priority')}
          title={t('lavori.board.changePriority')}
          initial={pending.row.extra[pending.column] ?? ''}
          onClose={() => setPending(null)}
          onDone={(id) => finish(t('lavori.toast.priorityUpdated'), id)}
        />
      )}
    </section>
  );
}
