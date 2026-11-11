import { copyText } from '../api';
import { adoptPrompt } from '../lib/wiki-compat';
import { useProject } from '../state/project';
import { Empty } from './Empty';
import { useToast } from './Toast';

export function CopyAdoptButton() {
  const project = useProject();
  const toast = useToast();
  const root = project.snapshot?.wikiRoot;
  if (!root) return null;
  const copy = async () => {
    try {
      await copyText(adoptPrompt(root));
      toast('Prompt /wiki-init --adopt copiato');
    } catch (e) {
      toast(`Copia non riuscita: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };
  return (
    <button type="button" className="btn" onClick={(e) => {
        // Inside a <summary> the click would also open/close the notice.
        e.preventDefault();
        void copy();
      }}>
      Copia prompt
    </button>
  );
}

/** Upgrades the current wiki format still needs (validator `upgrade`), with the adopt prompt. */
export function UpgradeBanner() {
  const { compat } = useProject();
  const n = compat.banner.length;
  if (n === 0) return null;
  return (
    <details className="banner banner-drift" role="status">
      <summary>
        <span className="banner-title">
          La wiki usa un formato vecchio: {n} {n === 1 ? 'punto da aggiornare' : 'punti da aggiornare'} con /wiki-init --adopt
        </span>
        <span className="banner-toggle">Mostra</span>
        {compat.banner.some((u) => u.fix === 'adopt') && <CopyAdoptButton />}
      </summary>
      <ul>
        {compat.banner.map((u, i) => (
          <li key={`${u.code}:${i}`}>
            <code>
              {u.wikiRelPath ?? ''}
              {u.line ? `:${u.line}` : ''}
            </code>{' '}
            {u.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Replaces the six sections when the wiki has no Core map (v1). Read-only: no write action here. */
export function IncompatibleWiki() {
  return (
    <Empty title="Wiki non compatibile" action={<CopyAdoptButton />}>
      Questa wiki usa un formato vecchio (manca la Core map) che l’app non legge. Avvia /wiki-init --adopt in Claude
      Code o Codex per portarla al formato attuale: quando ha finito, questa finestra si aggiorna da sola.
    </Empty>
  );
}
