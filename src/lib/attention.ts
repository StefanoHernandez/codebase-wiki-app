import type { Decision, TrackerData } from '../types/wiki.ts';

export type AttentionKind =
  | 'decision-proposed'
  | 'proposal'
  | 'blocked-task'
  | 'handoff-stale'
  | 'page-drift'
  | 'reverify'
  | 'lint-error';

export type AttentionView = 'lavori' | 'decisioni' | 'handoff' | 'salute';

export interface AttentionItem {
  kind: AttentionKind;
  title: string;
  detail: string;
  target: { view: AttentionView; ref?: string };
}

export interface AttentionInput {
  tracker: TrackerData | null;
  decisions: Decision[];
  handoffCommitsBehind: number | null;
  pages: Array<{ relPath: string; markdown: string; changedSources: string[] }>;
  lintFindings: Array<{ relPath: string; line: number; message: string }>;
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
    if (page.changedSources.length === 0) continue;
    items.push({
      kind: 'page-drift',
      title: `Drift: ${page.relPath}`,
      detail: `${page.changedSources.length} source file(s) changed: ${page.changedSources.join(', ')}`,
      target: { view: 'salute', ref: page.relPath },
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

  for (const f of input.lintFindings) {
    items.push({
      kind: 'lint-error',
      title: `Lint error: ${f.relPath}:${f.line}`,
      detail: f.message,
      target: { view: 'salute', ref: f.relPath },
    });
  }

  return items;
}
