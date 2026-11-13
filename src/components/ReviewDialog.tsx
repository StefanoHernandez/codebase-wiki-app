import { useState } from 'react';
import { t } from '../i18n';
import { Dialog } from './Dialog';
import { useProject } from '../state/project';
import { DEFAULT_CORE_MAP } from '../lib/schema-parser';
import { peer } from '../lib/apply-edits';
import { verifiedAtUtc } from '../lib/dates';
import { markPageReviewed } from '../lib/human-actions';

function errorText(e: unknown): string {
  return t('revisione.dialog.saveError', { error: e instanceof Error ? e.message : String(e) });
}

function useReviewSigned(pageRelPath: string, onDone: () => void) {
  const project = useProject();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (project.actorError) {
      setError(t('lavori.dialog.signHint'));
      return;
    }
    const core = project.schema?.coreMap ?? DEFAULT_CORE_MAP;
    const logPage = project.pages.find((p) => p.relPath === core.log);
    const page = project.pages.find((p) => p.relPath === pageRelPath);
    if (!logPage || !page) {
      setError(t('revisione.dialog.notReady'));
      return;
    }
    const head = project.snapshot?.gitState.headSha?.slice(0, 7) ?? '';
    const atIso = verifiedAtUtc();
    setError(null);
    setBusy(true);
    try {
      let logOut = '';
      await project.act([
        {
          relPath: pageRelPath,
          apply: (currentPage) => {
            const r = markPageReviewed({
              pageMarkdown: currentPage,
              logMarkdown: peer(logPage.relPath),
              person: project.actor,
              atIso,
              commit: head,
              logOrder: project.schema?.logOrder,
            });
            logOut = r.logMarkdown;
            return r.pageMarkdown;
          },
        },
        {
          relPath: logPage.relPath,
          apply: () => logOut,
        },
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
  const { project, error, busy, run } = useReviewSigned(pageRelPath, onDone);
  const head = project.snapshot?.gitState.headSha?.slice(0, 7) ?? '—';
  void pageMarkdown;

  return (
    <Dialog
      open
      title={t('revisione.review.title')}
      confirmLabel={t('revisione.review.title')}
      human
      busy={busy}
      error={error}
      onConfirm={run}
      onCancel={onClose}
    >
      <p className="dialog-note">
        {t('revisione.review.noteBefore')} <span className="mono">{pageRelPath}</span> {t('revisione.review.noteAfter')}{' '}
        <span className="mono">{head}</span>.
      </p>
      <p className="dialog-note">
        {t('revisione.review.sign')} <strong>{project.actor || '—'}</strong>
      </p>
    </Dialog>
  );
}
