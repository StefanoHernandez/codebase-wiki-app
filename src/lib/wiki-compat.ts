import { t } from '../i18n/index.ts';
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

export const incompatibleReason = () => t('revisione.compat.incompatible');
export const pluginOutdatedReason = () => t('revisione.compat.pluginOutdated');

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
    writesBlocked: incompatible ? incompatibleReason() : pluginOutdated ? pluginOutdatedReason() : null,
  };
}

export const closeBlockedReason = () => t('revisione.compat.closeBlocked');
export const decisionBlockedReason = () => t('revisione.compat.decisionBlocked');

export function adoptPrompt(wikiRoot: string): string {
  return `/wiki-init --adopt ${wikiRoot}`;
}
