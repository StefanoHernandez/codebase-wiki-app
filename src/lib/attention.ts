import type { Decision, TrackerData } from '../types/wiki.ts';
import { unownedSevereRisks, type RiskRow } from './wiki-extras.ts';

export type AttentionKind =
  | 'decision-proposed'
  | 'proposal'
  | 'blocked-task'
  | 'handoff-stale'
  | 'page-drift'
  | 'reverify'
  | 'lint-error'
  | 'lint-legacy'
  | 'risk-unowned';

export type AttentionView = 'lavori' | 'decisioni' | 'handoff' | 'salute';

export interface AttentionItem {
  kind: AttentionKind;
  title: string;
  detail: string;
  target: { view: AttentionView; ref?: string };
  /** Files (drift), findings (lint-error), or pages (lint-legacy) behind this item. */
  count?: number;
  /** lint-legacy only: findings across those pages. */
  findings?: number;
}

export interface AttentionInput {
  tracker: TrackerData | null;
  decisions: Decision[];
  handoffCommitsBehind: number | null;
  pages: Array<{ relPath: string; markdown: string; changedSources: string[] }>;
  lintFindings: Array<{ relPath: string; line: number; message: string }>;
  /** Risk register rows (risks page), if any. */
  risks?: RiskRow[] | null;
  /** Wiki folder, repo-relative (e.g. `wiki`): drift caused only by wiki pages is not counted. */
  wikiRoot?: string;
  /** Core pages, wiki-relative; a path ending in `/` is a folder (decisions). Findings elsewhere are grouped. */
  corePaths?: string[];
}

/** Changed sources that are code or docs outside the wiki: other wiki pages changing is not drift. */
export function codeChangedSources(changed: string[], wikiRoot?: string): string[] {
  if (!wikiRoot) return changed;
  const prefix = wikiRoot.replace(/\/+$/, '') + '/';
  return changed.filter((s) => !s.startsWith(prefix));
}

function isCorePath(relPath: string, corePaths: string[]): boolean {
  if (relPath === 'SCHEMA.md') return true;
  return corePaths.some((p) => (p.endsWith('/') ? relPath.startsWith(p) : relPath === p));
}

const HANDOFF_STALE_COMMITS = 5;
const RE_VERIFY = /⚠️? TO RE-VERIFY/g;

/** What needs a person's attention now, most decision-relevant first. Pure: no I/O. */
export function computeAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const d of input.decisions) {
    if (d.status !== 'proposed') continue;
    items.push({
      kind: 'decision-proposed',
      title: `Decision proposed: ${d.title}`,
      detail: d.approvalLines.join(' · ') || 'No approval recorded',
      target: { view: 'decisioni', ref: d.number },
    });
  }

  for (const p of input.tracker?.proposals ?? []) {
    items.push({
      kind: 'proposal',
      title: `Proposal: ${p.proposal}`,
      detail: [p.by, p.date].filter(Boolean).join(' · '),
      target: { view: 'lavori', ref: p.proposal },
    });
  }

  for (const row of input.tracker?.open ?? []) {
    if (row.status !== '🔴') continue;
    items.push({
      kind: 'blocked-task',
      title: `${row.id} blocked: ${row.goal}`,
      detail: row.owner ? `Owner: ${row.owner}` : 'No owner',
      target: { view: 'lavori', ref: row.id },
    });
  }

  if (input.handoffCommitsBehind !== null && input.handoffCommitsBehind >= HANDOFF_STALE_COMMITS) {
    items.push({
      kind: 'handoff-stale',
      title: 'Handoff is stale',
      detail: `${input.handoffCommitsBehind} commits behind HEAD`,
      target: { view: 'handoff' },
    });
  }

  for (const page of input.pages) {
    const code = codeChangedSources(page.changedSources, input.wikiRoot);
    if (code.length === 0) continue;
    items.push({
      kind: 'page-drift',
      title: `Drift: ${page.relPath}`,
      detail: `${code.length} source file(s) changed: ${code.join(', ')}`,
      target: { view: 'salute', ref: page.relPath },
      count: code.length,
    });
  }

  for (const page of input.pages) {
    const count = (page.markdown.match(RE_VERIFY) || []).length;
    if (count === 0) continue;
    items.push({
      kind: 'reverify',
      title: `Re-verify: ${page.relPath}`,
      detail: `${count} marked ⚠️ TO RE-VERIFY`,
      target: { view: 'salute', ref: page.relPath },
    });
  }

  // One item per core page with findings; findings on every other page (gradual recovery after an
  // adopt: missing frontmatter, sources that moved) are one grouped item, so they do not drown the rest.
  const byPage = new Map<string, number>();
  for (const f of input.lintFindings) byPage.set(f.relPath, (byPage.get(f.relPath) ?? 0) + 1);
  let legacyPages = 0;
  let legacyFindings = 0;
  for (const [relPath, n] of byPage) {
    if (input.corePaths === undefined || isCorePath(relPath, input.corePaths)) {
      items.push({
        kind: 'lint-error',
        title: `Lint error: ${relPath}`,
        detail: `${n} finding(s)`,
        target: { view: 'salute', ref: relPath },
        count: n,
      });
    } else {
      legacyPages++;
      legacyFindings += n;
    }
  }
  if (legacyPages > 0) {
    items.push({
      kind: 'lint-legacy',
      title: `${legacyPages} non-core page(s) to recover`,
      detail: `${legacyFindings} finding(s)`,
      target: { view: 'salute' },
      count: legacyPages,
      findings: legacyFindings,
    });
  }

  for (const r of unownedSevereRisks(input.risks ?? [])) {
    items.push({
      kind: 'risk-unowned',
      title: `Unowned ${r.severity} risk ${r.id}: ${r.risk}`,
      detail: r.trigger,
      target: { view: 'salute', ref: r.id },
    });
  }

  return items;
}
