import type { LintReport, LintUpgrade } from '../types/snapshot.ts';

export interface WikiCompat {
  /** v1 wiki (no Core map): the app does not read it. */
  incompatible: boolean;
  /** The wiki format is newer than the bundled validator. */
  pluginOutdated: boolean;
  /** Upgrades to list in a banner (everything except core-map-missing). */
  banner: LintUpgrade[];
  /** The Done table has no Status column: ⚫ closures cannot be recorded. */
  closeBlocked: boolean;
  /** Decision files (wiki-relative) whose accept/reject is disabled. */
  decisionBlocked: Set<string>;
  /** The validator did not run (`report.error`). */
  validatorUnavailable: string | null;
}

const DECISION_CODES = new Set(['decision-status-missing', 'decision-status-invalid', 'decision-approval-missing']);

/** Gating by validator 0.13.0 `upgrade` codes. Pure. A null report (lint not run yet) blocks nothing. */
export function wikiCompat(report: LintReport | null): WikiCompat {
  const upgrades = report?.upgrades ?? [];
  const has = (code: string) => upgrades.some((u) => u.code === code);
  return {
    incompatible: has('core-map-missing'),
    pluginOutdated: has('format-version-newer'),
    banner: upgrades.filter((u) => u.code !== 'core-map-missing'),
    closeBlocked: has('done-status-missing'),
    decisionBlocked: new Set(
      upgrades.filter((u) => DECISION_CODES.has(u.code) && u.wikiRelPath).map((u) => u.wikiRelPath!),
    ),
    validatorUnavailable: report?.error ?? null,
  };
}

export const CLOSE_BLOCKED_REASON =
  'La tabella Done non ha la colonna Status: la chiusura ⚫ non si può registrare. Aggiorna la wiki con /wiki-init --adopt.';
export const DECISION_BLOCKED_REASON =
  'Questa decisione non ha lo stato nel frontmatter o la sezione ## Approval: aggiorna la wiki con /wiki-init --adopt.';

export function adoptPrompt(wikiRoot: string): string {
  return `/wiki-init --adopt ${wikiRoot}`;
}
