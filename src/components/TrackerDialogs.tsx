import { useState, type ReactNode } from 'react';
import { Dialog, Field } from './Dialog';
import { useToast } from './Toast';
import { copyText, workflowPrompt } from '../api';
import { useProject, type ProjectState } from '../state/project';
import { handoffLag, type HandoffLagAction } from '../lib/handoff-lag';
import { DEFAULT_CORE_MAP } from '../lib/schema-parser';
import { peer } from '../lib/apply-edits';
import { todayLocal } from '../lib/dates';
import {
  closeTrackerItemHumanUnproven,
  promoteProposalToOpen,
  updateOpenRowField,
  appendLogEntry,
  StaleError,
} from '../lib/human-actions';
import { parseTrackerMarkdown } from '../lib/markdown-tables';
import type { TrackerOpenRow, TrackerProposalRow } from '../types/wiki';

/** Shown on every human action that is disabled because no signing name is set. */
export const SIGN_HINT = 'Imposta il tuo nome nelle impostazioni per firmare.';

const NOT_READY = 'La wiki non è ancora caricata. Premi Ricarica e riprova.';
const STALE_PROPOSAL = 'La proposta è cambiata o non c\'è più. Ricarica e riprova.';
const STALE_ROW = 'Il lavoro non è più aperto. Ricarica.';

interface TrackerPaths {
  trackerPath: string;
  logPath: string;
}

/** Paths to tracker and log in the open wiki, or null when either page is missing. */
function trackerPaths(project: ProjectState): TrackerPaths | null {
  const core = project.schema?.coreMap ?? DEFAULT_CORE_MAP;
  const tracker = project.pages.find((p) => p.relPath === core.tracker);
  const log = project.pages.find((p) => p.relPath === core.log);
  if (!tracker || !log) return null;
  return { trackerPath: tracker.relPath, logPath: log.relPath };
}

function errorText(e: unknown): string {
  return `Non riesco a salvare. ${e instanceof Error ? e.message : String(e)}`;
}

interface Handlers {
  onClose(): void;
  /** Called after the write succeeded, with the ID of the row that changed or was created. */
  onDone(id: string): void;
}

/** Runs one signed write: busy and error state shared by all tracker dialogs. */
function useSigned(onDone: (id: string) => void) {
  const project = useProject();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (
    check: string | null,
    write: (paths: TrackerPaths) => Promise<string>,
  ) => {
    if (check) {
      setError(check);
      return;
    }
    const paths = trackerPaths(project);
    if (!paths) {
      setError(NOT_READY);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      onDone(await write(paths));
    } catch (e) {
      if (e instanceof StaleError) setError(e.message);
      else if (e instanceof Error && /not found in open tracker/.test(e.message)) setError(STALE_ROW);
      else setError(errorText(e));
      setBusy(false);
    }
  };

  return { project, error, busy, run };
}

function Note({ children }: { children: ReactNode }) {
  return <p className="dialog-note">{children}</p>;
}

function HandoffLagNotice({ action }: { action: HandoffLagAction }) {
  const project = useProject();
  const toast = useToast();
  const warning = handoffLag(project.handoff, action);
  if (!warning) return null;

  const copySync = async () => {
    const repo = project.current;
    if (!repo) return;
    try {
      await copyText(await workflowPrompt(repo, 'wiki-sync'));
      toast('Prompt copiato');
    } catch {
      toast('Non riesco a copiare il prompt');
    }
  };

  return (
    <div className="handoff-freshness handoff-freshness--stale">
      <p className="handoff-freshness-text">{warning}</p>
      <button type="button" className="btn btn-human" onClick={() => void copySync()} disabled={!project.current}>
        Copia prompt /wiki-sync
      </button>
    </div>
  );
}

/** Promuovi a lavoro: a proposal becomes an Open row with the next free ID. */
export function PromoteDialog({ proposal, onClose, onDone }: Handlers & { proposal: TrackerProposalRow }) {
  const { project, error, busy, run } = useSigned(onDone);
  const [owner, setOwner] = useState(project.actor);
  const [doneWhen, setDoneWhen] = useState('');
  const [nextVerification, setNextVerification] = useState('');

  const submit = () =>
    run(
      !owner.trim()
        ? 'Scrivi il responsabile.'
        : !doneWhen.trim()
          ? 'Scrivi quando il lavoro è fatto.'
          : !nextVerification.trim()
            ? 'Scrivi come verificherai il lavoro.'
            : null,
      async (paths) => {
        const snap = project.pages.find((p) => p.relPath === paths.trackerPath)?.markdown ?? '';
        const onSnap = parseTrackerMarkdown(snap).proposals.filter(
          (p) => p.proposal === proposal.proposal && p.by === proposal.by && p.date === proposal.date,
        );
        if (onSnap.length !== 1) throw new StaleError(STALE_PROPOSAL);

        let assignedId = '';
        let logOut = '';
        await project.act([
          {
            relPath: paths.trackerPath,
            apply: (currentTracker) => {
              const r = promoteProposalToOpen({
                trackerMarkdown: currentTracker,
                logMarkdown: peer(paths.logPath),
                proposalText: proposal.proposal,
                proposalBy: proposal.by,
                proposalDate: proposal.date,
                person: project.actor,
                owner,
                doneWhen,
                nextVerification,
                dateIso: todayLocal(),
              });
              assignedId = r.assignedId;
              logOut = r.logMarkdown;
              return r.trackerMarkdown;
            },
          },
          {
            relPath: paths.logPath,
            apply: () => logOut,
          },
        ]);
        return assignedId;
      },
    );

  return (
    <Dialog
      open
      title="Promuovi a lavoro"
      confirmLabel="Promuovi a lavoro"
      human
      busy={busy}
      error={error}
      onConfirm={submit}
      onCancel={onClose}
    >
      <Note>
        Proposta: {proposal.proposal}. Diventa un lavoro aperto con il prossimo ID. Lo firmi tu come {project.actor}.
      </Note>
      <HandoffLagNotice action={{ kind: 'promote' }} />
      <Field label="Responsabile">
        <input value={owner} onChange={(e) => setOwner(e.target.value)} />
      </Field>
      <Field label="Fatto quando">
        <input value={doneWhen} onChange={(e) => setDoneWhen(e.target.value)} />
      </Field>
      <Field label="Prossima verifica" hint="Un comando o un controllo, per esempio `npm test`.">
        <input value={nextVerification} onChange={(e) => setNextVerification(e.target.value)} />
      </Field>
    </Dialog>
  );
}

/** Chiudi senza prova ⚫: a person closes an Open row without proof. The app never does this alone. */
export function CloseDialog({ row, onClose, onDone }: Handlers & { row: TrackerOpenRow }) {
  const { project, error, busy, run } = useSigned(onDone);
  const [notProven, setNotProven] = useState('');
  const [source, setSource] = useState('');

  const submit = () =>
    run(
      !notProven.trim()
        ? 'Scrivi cosa non è provato.'
        : !source.trim()
          ? "Scrivi dove l'hai deciso: messaggio, riunione, PR."
          : null,
      async (paths) => {
        let logOut = '';
        await project.act([
          {
            relPath: paths.trackerPath,
            apply: (currentTracker) => {
              const r = closeTrackerItemHumanUnproven({
                trackerMarkdown: currentTracker,
                logMarkdown: peer(paths.logPath),
                taskId: row.id,
                person: project.actor,
                notProvenReason: notProven,
                closureSource: source,
                dateIso: todayLocal(),
              });
              logOut = r.logMarkdown;
              return r.trackerMarkdown;
            },
          },
          {
            relPath: paths.logPath,
            apply: () => logOut,
          },
        ]);
        return row.id;
      },
    );

  return (
    <Dialog
      open
      title={`Chiudi ${row.id} senza prova`}
      confirmLabel="Chiudi senza prova"
      human
      busy={busy}
      error={error}
      onConfirm={submit}
      onCancel={onClose}
    >
      <Note>
        Chiudere a mano registra che sei tu a chiudere {row.goal} senza prova. Il lavoro esce dai lavori aperti come
        ⚫ e non diventa verificato.
      </Note>
      <HandoffLagNotice action={{ kind: 'close', taskId: row.id }} />
      <Field label="Cosa non è provato">
        <input value={notProven} onChange={(e) => setNotProven(e.target.value)} />
      </Field>
      <Field label="Dove l'hai deciso" hint="Messaggio, riunione o PR dove hai preso la decisione.">
        <input value={source} onChange={(e) => setSource(e.target.value)} />
      </Field>
    </Dialog>
  );
}

/** Cambia responsabile / Cambia priorità: one editable cell of an Open row, logged as a human change. */
export function FieldDialog({
  row,
  column,
  label,
  title,
  initial,
  onClose,
  onDone,
}: Handlers & { row: TrackerOpenRow; column: string; label: string; title: string; initial: string }) {
  const { project, error, busy, run } = useSigned(onDone);
  const [value, setValue] = useState(initial);

  const submit = () =>
    run(!value.trim() ? `Scrivi ${label.toLowerCase()}.` : null, async (paths) => {
      const date = todayLocal();
      let logOut = '';
      await project.act([
        {
          relPath: paths.trackerPath,
          apply: (currentTracker) => {
            const next = updateOpenRowField({
              trackerMarkdown: currentTracker,
              id: row.id,
              field: column,
              value,
            });
            logOut = appendLogEntry({
              logMarkdown: peer(paths.logPath),
              date,
              title: `Change ${column.toLowerCase()} of ${row.id}`,
              what: `${project.actor} set ${column.toLowerCase()} of ${row.id} to ${value.trim()}`,
              evidence: `changed by ${project.actor} ${date}`,
              ids: [row.id],
            });
            return next.trackerMarkdown;
          },
        },
        {
          relPath: paths.logPath,
          apply: () => logOut,
        },
      ]);
      return row.id;
    });

  return (
    <Dialog open title={title} confirmLabel={title} human busy={busy} error={error} onConfirm={submit} onCancel={onClose}>
      <Field label={label}>
        <input value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </Field>
    </Dialog>
  );
}
