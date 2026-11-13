import { t } from '../i18n/index.ts';
import type { AttentionItem } from './attention';
import type { LogOrder } from './human-actions';
import type { IndexStatus } from './rag-format';
import type { ActivityLine, ProjectNews, RecentProject } from '../types/snapshot';

const DATED_HEADING = /^## \d{4}-\d{2}-\d{2}\b/;

function datedHeadings(logMd: string): string[] {
  return logMd
    .split(/\r?\n/)
    .filter((l) => DATED_HEADING.test(l))
    .map((l) => l.slice(3).trim());
}

/** Dated `## YYYY-MM-DD …` entries in a log page. */
export function countLogEntries(logMd: string): number {
  return datedHeadings(logMd).length;
}

/** Log entries added since the visit that saw `seen` of them, as heading text. */
export function newLogEntries(logMd: string, seen: number | null, order: LogOrder, seenAt?: number | null): string[] {
  if (seen === null) return [];
  const all = datedHeadings(logMd);
  // Fewer entries than at the last visit: the log was archived, so counting no longer works.
  // Entries dated on or after the visit day are shown (same-day ones may repeat).
  if (all.length < seen) {
    if (!seenAt) return [];
    const day = new Date(seenAt).toISOString().slice(0, 10);
    return all.filter((h) => h.slice(0, 10) >= day);
  }
  const added = Math.max(0, all.length - seen);
  if (added === 0) return [];
  return order === 'newest-first' ? all.slice(0, added) : all.slice(all.length - added);
}

export function relativeTime(ms: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return t('common.relative.now');
  const m = Math.floor(s / 60);
  if (m < 60) return t('common.relative.minutes', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('common.relative.hours', { n: h });
  return t('common.relative.days', { n: Math.floor(h / 24) });
}

export type IndexState = 'aggiornato' | 'indietro' | 'assente' | 'errore';

export interface ProjectRow {
  path: string;
  name: string;
  branch: string | null;
  head: string | null;
  attention: number;
  index: IndexState;
  behindFiles: number;
  news: string[];
  lastAgent: { agent: string; ts: number } | null;
  error: string | null;
}

export interface RowInput {
  attention: AttentionItem[] | null;
  /** Log page markdown and order, for wikis whose news cannot come from git. */
  log: { markdown: string; order: LogOrder } | null;
  git: { branch: string; headSha: string } | null;
  status: IndexStatus | null;
  news: ProjectNews | null;
  activity: ActivityLine[];
  error: string | null;
}

export function indexState(status: IndexStatus | null): IndexState {
  if (!status || status.error) return 'errore';
  if (!status.indexed) return 'assente';
  return (status.changedSinceIndex ?? 0) > 0 ? 'indietro' : 'aggiornato';
}

export function buildRow(recent: RecentProject, input: RowInput): ProjectRow {
  const { news, log } = input;
  let items: string[] = [];
  if (news?.commits) items = news.commits;
  else if (news && log) items = newLogEntries(log.markdown, news.lastSeenLogEntries, log.order, news.lastSeenAt);
  const last = input.activity.filter((a) => a.repo === recent.path).sort((a, b) => b.ts - a.ts)[0];
  return {
    path: recent.path,
    name: recent.name,
    branch: input.git?.branch ?? null,
    head: input.git ? input.git.headSha.slice(0, 7) : null,
    attention: input.attention?.length ?? 0,
    index: indexState(input.status),
    behindFiles: input.status?.changedSinceIndex ?? 0,
    news: items,
    lastAgent: last ? { agent: last.agent, ts: last.ts } : null,
    error: input.error,
  };
}

/** Newest call per agent name. */
export function lastUseByAgent(activity: ActivityLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of activity) out.set(a.agent, Math.max(out.get(a.agent) ?? 0, a.ts));
  return out;
}

/** MCP client names each harness sends at initialize (`claude-code`, `claude-ai`, `codex-mcp-client`…). */
function clientMatches(harnessId: string, client: string): boolean {
  const c = client.toLowerCase();
  if (harnessId === 'claude') return c === 'claude-code';
  if (harnessId === 'claude-desktop') return c === 'claude-ai';
  return c.startsWith(harnessId);
}

/** Last call of a harness, by its id in `rag_harness_state`. */
export function lastUseOfHarness(harnessId: string, uses: Map<string, number>): number | null {
  let best: number | null = null;
  for (const [client, ts] of uses) if (clientMatches(harnessId, client) && (best === null || ts > best)) best = ts;
  return best;
}
