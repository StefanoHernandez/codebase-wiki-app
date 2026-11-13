import type { Decision, TrackerData } from '../types/wiki.ts';
import { t, tn } from '../i18n/index.ts';
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
      title: t('revisione.attention.decisionProposed.title', { title: d.title }),
      detail: d.approvalLines.join(' · ') || t('revisione.attention.decisionProposed.noApproval'),
      target: { view: 'decisioni', ref: d.number },
    });
  }

  for (const p of input.tracker?.proposals ?? []) {
    items.push({
      kind: 'proposal',
      title: t('revisione.attention.proposal.title', { proposal: p.proposal }),
      detail: [p.by, p.date].filter(Boolean).join(' · '),
      target: { view: 'lavori', ref: p.proposal },
    });
  }

  for (const row of input.tracker?.open ?? []) {
    if (row.status !== '🔴') continue;
    items.push({
      kind: 'blocked-task',
      title: t('revisione.attention.blocked.title', { id: row.id, goal: row.goal }),
      detail: row.owner ? t('revisione.attention.blocked.owner', { owner: row.owner }) : t('revisione.attention.blocked.noOwner'),
      target: { view: 'lavori', ref: row.id },
    });
  }

  if (input.handoffCommitsBehind !== null && input.handoffCommitsBehind >= HANDOFF_STALE_COMMITS) {
    items.push({
      kind: 'handoff-stale',
      title: t('revisione.attention.handoffStale.title'),
      detail: t('revisione.attention.handoffStale.detail', { n: input.handoffCommitsBehind }),
      target: { view: 'handoff' },
    });
  }

  for (const page of input.pages) {
    const code = codeChangedSources(page.changedSources, input.wikiRoot);
    if (code.length === 0) continue;
    items.push({
      kind: 'page-drift',
      title: t('revisione.attention.drift.title', { path: page.relPath }),
      detail: t('revisione.attention.drift.detail', { n: code.length, files: code.join(', ') }),
      target: { view: 'salute', ref: page.relPath },
      count: code.length,
    });
  }

  for (const page of input.pages) {
    const count = (page.markdown.match(RE_VERIFY) || []).length;
    if (count === 0) continue;
    items.push({
      kind: 'reverify',
      title: t('revisione.attention.reverify.title', { path: page.relPath }),
      detail: t('revisione.attention.reverify.detail', { n: count }),
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
        title: t('revisione.attention.lintError.title', { path: relPath }),
        detail: t('revisione.attention.findings', { n }),
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
      title: t('revisione.attention.legacy.title', { n: legacyPages }),
      detail: t('revisione.attention.findings', { n: legacyFindings }),
      target: { view: 'salute' },
      count: legacyPages,
      findings: legacyFindings,
    });
  }

  for (const r of unownedSevereRisks(input.risks ?? [])) {
    items.push({
      kind: 'risk-unowned',
      title: t('revisione.attention.risk.title', { severity: r.severity, id: r.id, risk: r.risk }),
      detail: r.trigger,
      target: { view: 'salute', ref: r.id },
    });
  }

  return items;
}

export type SidebarCount = { text: string; tone: 'human' | 'drift' | 'muted'; title: string };

/** Sidebar badges per section, each with the sentence that says what the number counts. */
export function sectionCounts(
  attention: AttentionItem[],
): Partial<Record<'per-te' | 'lavori' | 'decisioni' | 'handoff' | 'salute', SidebarCount>> {
  const n = (...kinds: AttentionKind[]) => attention.filter((a) => kinds.includes(a.kind)).length;
  const out: ReturnType<typeof sectionCounts> = {};
  if (attention.length)
    out['per-te'] = { text: String(attention.length), tone: 'human', title: tn('revisione.sidebar.perTe', attention.length) };
  const proposals = n('proposal');
  const blocked = n('blocked-task');
  if (proposals + blocked) {
    const parts = [proposals && tn('revisione.sidebar.proposals', proposals), blocked && tn('revisione.sidebar.blocked', blocked)];
    out.lavori = { text: String(proposals + blocked), tone: 'muted', title: t('revisione.sidebar.toEvaluate', { parts: parts.filter(Boolean).join(', ') }) };
  }
  const decisioni = n('decision-proposed');
  if (decisioni)
    out.decisioni = {
      text: String(decisioni),
      tone: 'muted',
      title: t('revisione.sidebar.decisionsTitle', { count: tn('revisione.sidebar.decisions', decisioni) }),
    };
  if (n('handoff-stale')) out.handoff = { text: '!', tone: 'drift', title: t('revisione.sidebar.handoff') };
  // Distinct pages, not items: a page with drift and lint counts once; the recovery group adds its pages.
  const pages = new Set(
    attention.filter((a) => ['page-drift', 'reverify', 'lint-error'].includes(a.kind)).map((a) => a.target.ref),
  ).size;
  const legacy = attention.find((a) => a.kind === 'lint-legacy')?.count ?? 0;
  const risks = n('risk-unowned');
  const salute = pages + legacy + risks;
  if (salute) {
    const what = risks
      ? [pages + legacy && tn('revisione.sidebar.pages', pages + legacy), tn('revisione.sidebar.risks', risks)]
          .filter(Boolean)
          .join(t('revisione.sidebar.joiner'))
      : tn('revisione.sidebar.pages', salute);
    out.salute = { text: String(salute), tone: 'muted', title: t('revisione.sidebar.toCheck', { what }) };
  }
  return out;
}
