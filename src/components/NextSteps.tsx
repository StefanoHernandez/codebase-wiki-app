import { renderInlineCode } from '../lib/inline-code';
import { useProject } from '../state/project';

/** Tracker `## Next steps`, read-only. Renders nothing when the tracker has none. */
export function NextStepsCard() {
  const { nextSteps } = useProject();
  if (!nextSteps || (!nextSteps.summary && nextSteps.steps.length === 0)) return null;
  return (
    <section className="card next-steps" aria-label="Prossimi passi">
      <h2 className="group-title">Prossimi passi</h2>
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
