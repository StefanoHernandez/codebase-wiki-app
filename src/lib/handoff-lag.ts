import { t } from '../i18n/index.ts';
import type { HandoffData } from '../types/wiki.ts';

export type HandoffLagAction = { kind: 'promote' } | { kind: 'close'; taskId: string };

const BATON_ID = /^(T[1-9]\d*)(?:\s*-\s*|\s*:\s*|\s+—\s*)\S/;

function batonTaskId(task: string): string | null {
  const m = BATON_ID.exec(task.trim());
  return m ? m[1] : null;
}

/** Warn before a tracker action when agent/handoff.md no longer matches what you are about to do. */
export function handoffLag(handoff: HandoffData | null, action: HandoffLagAction): string | null {
  if (!handoff) return null;

  if (action.kind === 'promote' && handoff.noOpenWork) {
    return t('revisione.lag.promote');
  }

  if (action.kind === 'close') {
    for (const row of handoff.baton) {
      const id = batonTaskId(row.task);
      if (id === action.taskId) {
        return t('revisione.lag.close', { id });
      }
    }
  }

  return null;
}
