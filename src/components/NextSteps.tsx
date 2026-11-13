import { renderInlineCode } from '../lib/inline-code';
import { useProject } from '../state/project';
import { t } from '../i18n';

/** Tracker `## Next steps`, read-only. Renders nothing when the tracker has none. */
export function NextStepsCard() {
  const { nextSteps } = useProject();
  if (!nextSteps || (!nextSteps.summary && nextSteps.steps.length === 0)) return null;
  return (
    <section className="card next-steps" aria-label={t('lavori.next.title')}>
      <h2 className="group-title">{t('lavori.next.title')}</h2>
      {nextSteps.summary && <p>{renderInlineCode(nextSteps.summary)}</p>}
      {nextSteps.steps.length > 0 && (
        <ol>
          {nextSteps.steps.map((s, i) => (
            <li key={i}>{renderInlineCode(s)}</li>
          ))}
        </ol>
      )}
    </section>
  );
}
