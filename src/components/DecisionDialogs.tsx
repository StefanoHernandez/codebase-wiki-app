import { useState } from 'react';
import { Dialog, Field } from './Dialog';
import { localIsoDate, SIGN_HINT } from './TrackerDialogs';
import { useProject, type ProjectState } from '../state/project';
import { DEFAULT_CORE_MAP } from '../lib/schema-parser';
import { acceptDecisionHuman, rejectDecisionHuman } from '../lib/human-actions';
import { parseFrontmatter } from '../lib/frontmatter';
import type { Decision } from '../types/wiki';

const NOT_READY = 'La wiki non è ancora caricata. Premi Ricarica e riprova.';
const STALE = 'La decisione non è più in attesa. Ricarica.';

class StaleError extends Error {
  constructor() {
    super(STALE);
  }
}

interface DecisionFiles {
  decisionPath: string;
  decisionMarkdown: string;
  logPath: string;
  logMarkdown: string;
}

function decisionFiles(project: ProjectState, relPath: string): DecisionFiles | null {
  const core = project.schema?.coreMap ?? DEFAULT_CORE_MAP;
  const decision = project.pages.find((p) => p.relPath === relPath);
  const log = project.pages.find((p) => p.relPath === core.log);
  if (!decision || !log) return null;
  return {
    decisionPath: decision.relPath,
    decisionMarkdown: decision.markdown,
    logPath: log.relPath,
    logMarkdown: log.markdown,
  };
}

function errorText(e: unknown): string {
  return `Non riesco a salvare. ${e instanceof Error ? e.message : String(e)}`;
}

function useDecisionSigned(onDone: (number: string) => void) {
  const project = useProject();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (
    relPath: string,
    check: string | null,
    write: (files: DecisionFiles, freshMarkdown: string) => Promise<string>,
  ) => {
    if (check) {
      setError(check);
      return;
    }
    const files = decisionFiles(project, relPath);
    if (!files) {
      setError(NOT_READY);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const fresh = project.pages.find((p) => p.relPath === relPath)?.markdown ?? files.decisionMarkdown;
      const id = await write(files, fresh);
      onDone(id);
    } catch (e) {
      if (e instanceof StaleError) setError(e.message);
      else if (e instanceof Error && /only be (accepted|rejected) from proposed/.test(e.message)) setError(STALE);
      else setError(errorText(e));
      setBusy(false);
    }
  };

  return { project, error, busy, run };
}

type Verdict = 'accepted' | 'rejected';

interface DecideDialogProps {
  decision: Decision;
  verdict: Verdict;
  onClose(): void;
  onDone(number: string): void;
}

export function DecideDialog({ decision, verdict, onClose, onDone }: DecideDialogProps) {
  const { project, error, busy, run } = useDecisionSigned(onDone);
  const [where, setWhere] = useState('');
  const accept = verdict === 'accepted';

  const submit = () =>
    run(
      decision.relPath,
      !where.trim() ? "Scrivi dove l'hai decisa: messaggio, riunione, PR…" : null,
      async (files, freshMarkdown) => {
        if (parseFrontmatter(freshMarkdown).fields.status !== 'proposed') throw new StaleError();
        const date = localIsoDate();
        const fn = accept ? acceptDecisionHuman : rejectDecisionHuman;
        const result = fn({
          decisionMarkdown: freshMarkdown,
          logMarkdown: files.logMarkdown,
          person: project.actor,
          whereContext: where.trim(),
          dateIso: date,
        });
        await project.act([
          { relPath: files.decisionPath, content: result.decisionMarkdown },
          { relPath: files.logPath, content: result.logMarkdown },
        ]);
        return decision.number;
      },
    );

  const title = accept ? 'Accetta decisione' : 'Rifiuta decisione';
  const confirm = accept ? 'Accetta decisione' : 'Rifiuta decisione';

  return (
    <Dialog
      open
      title={title}
      confirmLabel={confirm}
      human
      busy={busy}
      error={error}
      onConfirm={submit}
      onCancel={onClose}
    >
      <p className="dialog-note">
        {decision.number} — {decision.title}. Lo firmi come {project.actor || '…'}.
      </p>
      <Field label="Dove è stata decisa" hint={SIGN_HINT}>
        <input value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Messaggio, riunione, PR…" />
      </Field>
    </Dialog>
  );
}

export { SIGN_HINT };
