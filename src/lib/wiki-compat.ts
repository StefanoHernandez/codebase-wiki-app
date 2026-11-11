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
  /** Why no human action may write now, or null. */
  writesBlocked: string | null;
}

export const INCOMPATIBLE_REASON =
  'Questa wiki usa un formato vecchio che l’app non legge: aggiornala con /wiki-init --adopt.';
export const PLUGIN_OUTDATED_REASON =
  'La wiki è più nuova del plugin: aggiorna il plugin prima di firmare azioni.';

const DECISION_CODES = new Set(['decision-status-missing', 'decision-status-invalid', 'decision-approval-missing']);

/**
 * Gating by validator 0.13.0 `upgrade` codes. Pure. A v1 wiki is recognised from the SCHEMA itself,
 * so it is blocked even before the first lint or without Python. A null report blocks nothing else
 * (the transforms re-check their own structure at confirm time).
 */
export function wikiCompat(report: LintReport | null, schema: { hasCoreMap: boolean } | null = null): WikiCompat {
  const upgrades = report?.upgrades ?? [];
  const has = (code: string) => upgrades.some((u) => u.code === code);
  const incompatible = (schema !== null && !schema.hasCoreMap) || has('core-map-missing');
  const pluginOutdated = has('format-version-newer');
  return {
    incompatible,
    pluginOutdated,
    // `update-plugin` lines are shown by the plugin banner, not with the adopt prompt.
    banner: upgrades.filter((u) => u.code !== 'core-map-missing' && u.fix !== 'update-plugin'),
    closeBlocked: has('done-status-missing'),
    decisionBlocked: new Set(
      upgrades.filter((u) => DECISION_CODES.has(u.code) && u.wikiRelPath).map((u) => u.wikiRelPath!),
    ),
    validatorUnavailable: report?.error ?? null,
    // An older plugin must not edit a newer wiki (validator rule); a v1 wiki is not read at all.
    writesBlocked: incompatible ? INCOMPATIBLE_REASON : pluginOutdated ? PLUGIN_OUTDATED_REASON : null,
  };
}

export const CLOSE_BLOCKED_REASON =
  'La tabella Done non ha la colonna Status: la chiusura ⚫ non si può registrare. Aggiorna la wiki con /wiki-init --adopt.';
export const DECISION_BLOCKED_REASON =
  'Questa decisione non ha lo stato nel frontmatter o la sezione ## Approval: aggiorna la wiki con /wiki-init --adopt.';

export function adoptPrompt(wikiRoot: string): string {
  return `/wiki-init --adopt ${wikiRoot}`;
}
