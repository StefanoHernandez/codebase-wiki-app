import { useState } from 'react';
import { Dialog } from './Dialog';
import { SIGN_HINT } from './TrackerDialogs';
import { useProject } from '../state/project';
import { DEFAULT_CORE_MAP } from '../lib/schema-parser';
import { markPageReviewed } from '../lib/human-actions';

const NOT_READY = 'La wiki non è ancora caricata. Premi Ricarica e riprova.';
const STALE = 'La pagina è cambiata. Ricarica e riprova.';

function errorText(e: unknown): string {
  return `Non riesco a salvare. ${e instanceof Error ? e.message : String(e)}`;
}

function useReviewSigned(pageRelPath: string, pageMarkdown: string, onDone: () => void) {
  const project = useProject();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (project.actorError) {
      setError(SIGN_HINT);
      return;
    }
    const core = project.schema?.coreMap ?? DEFAULT_CORE_MAP;
    const logPage = project.pages.find((p) => p.relPath === core.log);
    const page = project.pages.find((p) => p.relPath === pageRelPath);
    if (!logPage || !page) {
      setError(NOT_READY);
      return;
    }
    if (page.markdown !== pageMarkdown) {
      setError(STALE);
      return;
    }
    const head = project.snapshot?.gitState.headSha?.slice(0, 7) ?? '';
    const atIso = new Date().toISOString();
    setError(null);
    setBusy(true);
    try {
      const r = markPageReviewed({
        pageMarkdown: page.markdown,
        logMarkdown: logPage.markdown,
        person: project.actor,
        atIso,
        commit: head,
      });
      await project.act([
        { relPath: pageRelPath, content: r.pageMarkdown },
        { relPath: logPage.relPath, content: r.logMarkdown },
      ]);
      onDone();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return { project, error, busy, run };
}

export function ReviewDialog({
  pageRelPath,
  pageMarkdown,
  onClose,
  onDone,
}: {
  pageRelPath: string;
  pageMarkdown: string;
  onClose(): void;
  onDone(): void;
}) {
  const { project, error, busy, run } = useReviewSigned(pageRelPath, pageMarkdown, onDone);
  const head = project.snapshot?.gitState.headSha?.slice(0, 7) ?? '—';

  return (
    <Dialog
      open
      title="Segna come rivista"
      confirmLabel="Segna come rivista"
      human
      busy={busy}
      error={error}
      onConfirm={run}
      onCancel={onClose}
    >
      <p className="dialog-note">
        Registri che hai letto e confermato <span className="mono">{pageRelPath}</span> alla revisione{' '}
        <span className="mono">{head}</span>.
      </p>
      <p className="dialog-note">
        Firma: <strong>{project.actor || '—'}</strong>
      </p>
    </Dialog>
  );
}
