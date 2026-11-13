import { useState } from 'react';
import { t } from '../i18n';
import { Dialog, Field } from './Dialog';
import { todayLocal } from '../lib/dates';
import { useProject, type ProjectState } from '../state/project';
import { DEFAULT_CORE_MAP } from '../lib/schema-parser';
import { peer } from '../lib/apply-edits';
import { acceptDecisionHuman, rejectDecisionHuman } from '../lib/human-actions';
import { parseFrontmatter } from '../lib/frontmatter';
import type { Decision } from '../types/wiki';

class StaleError extends Error {
  constructor() {
    super(t('revisione.decisions.stale'));
  }
}

interface DecisionPaths {
  decisionPath: string;
  logPath: string;
}

function decisionPaths(project: ProjectState, relPath: string): DecisionPaths | null {
  const core = project.schema?.coreMap ?? DEFAULT_CORE_MAP;
  const decision = project.pages.find((p) => p.relPath === relPath);
  const log = project.pages.find((p) => p.relPath === core.log);
  if (!decision || !log) return null;
  return { decisionPath: decision.relPath, logPath: log.relPath };
}

function errorText(e: unknown): string {
  return t('revisione.dialog.saveError', { error: e instanceof Error ? e.message : String(e) });
}

function useDecisionSigned(onDone: (number: string) => void) {
  const project = useProject();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (
    relPath: string,
    check: string | null,
    write: (paths: DecisionPaths) => Promise<string>,
  ) => {
    if (check) {
      setError(check);
      return;
    }
    const paths = decisionPaths(project, relPath);
    if (!paths) {
      setError(t('revisione.dialog.notReady'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const id = await write(paths);
      onDone(id);
    } catch (e) {
      if (e instanceof StaleError) setError(e.message);
      else if (e instanceof Error && /only be (accepted|rejected) from proposed/.test(e.message)) setError(t('revisione.decisions.stale'));
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
      !where.trim() ? t('revisione.decisions.whereRequired') : null,
      async (paths) => {
        let logOut = '';
        await project.act([
          {
            relPath: paths.decisionPath,
            apply: (currentDecision) => {
              if (parseFrontmatter(currentDecision).fields.status !== 'proposed') throw new StaleError();
              const date = todayLocal();
              const fn = accept ? acceptDecisionHuman : rejectDecisionHuman;
              const result = fn({
                decisionMarkdown: currentDecision,
                logMarkdown: peer(paths.logPath),
                person: project.actor,
                whereContext: where.trim(),
                dateIso: date,
                logOrder: project.schema?.logOrder,
              });
              logOut = result.logMarkdown;
              return result.decisionMarkdown;
            },
          },
          {
            relPath: paths.logPath,
            apply: () => logOut,
          },
        ]);
        return decision.number;
      },
    );

  const title = accept ? t('revisione.decisions.accept') : t('revisione.decisions.reject');
  const confirm = title;

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
        {t('revisione.decisions.signNote', { number: decision.number, title: decision.title, actor: project.actor || '…' })}
      </p>
      <Field label={t('revisione.decisions.whereLabel')} hint={t('lavori.dialog.signHint')}>
        <input value={where} onChange={(e) => setWhere(e.target.value)} placeholder={t('revisione.decisions.wherePlaceholder')} />
      </Field>
    </Dialog>
  );
}

