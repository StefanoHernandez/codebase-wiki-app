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
    <button type="button" className="btn" onClick={() => void copy()}>
      Copia prompt
    </button>
  );
}

/** Upgrades the current wiki format still needs (validator `upgrade`), with the adopt prompt. */
export function UpgradeBanner() {
  const { compat } = useProject();
  if (compat.banner.length === 0) return null;
  return (
    <div className="banner banner-drift" role="status">
      <p>La wiki va aggiornata al formato attuale del plugin. Avvia /wiki-init --adopt in Claude Code o Codex:</p>
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
      {compat.banner.some((u) => u.fix === 'adopt') && <CopyAdoptButton />}
    </div>
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
