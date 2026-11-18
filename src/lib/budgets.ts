/** Core-map roles an agent reads at a new context, besides SCHEMA.md and the log (plugin `wiki-lint` Budget). */
const CORE_READ_ROLES = ['index', 'context', 'handoff', 'tracker', 'risks', 'troubleshooting', 'glossary'];

const LOG_ENTRY = /\n(?=## \d{4}-\d{2}-\d{2}\b)/;

/** Bytes of the last `n` dated `## YYYY-MM-DD` entries of a log page. */
export function lastLogEntriesBytes(markdown: string, n = 10): number {
  const entries = markdown.split(LOG_ENTRY).filter((p) => /^## \d{4}-\d{2}-\d{2}\b/.test(p));
  // The log may be oldest-first or newest-first: the n newest entries are at one end.
  const firstDate = entries[0]?.slice(3, 13) ?? '';
  const lastDate = entries[entries.length - 1]?.slice(3, 13) ?? '';
  const newest = firstDate > lastDate ? entries.slice(0, n) : entries.slice(-n);
  // Each entry counted with one closing newline, wherever it sits in the file.
  return newest.reduce((sum, e) => sum + new TextEncoder().encode(e.trimEnd()).length + 1, 0);
}

/**
 * What an agent reads at a new context, file by file: SCHEMA.md, the core pages and the last
 * 10 log entries. The agent entry file (CLAUDE.md/AGENTS.md) lives outside the wiki and is not counted.
 */
export function coreRead(
  pages: Array<{ relPath: string; sizeBytes: number; markdown: string }>,
  coreMap: Record<string, string>,
): { items: Array<{ path: string; bytes: number }>; total: number } {
  const byPath = new Map(pages.map((p) => [p.relPath, p]));
  const items: Array<{ path: string; bytes: number }> = [];
  for (const path of ['SCHEMA.md', ...CORE_READ_ROLES.map((r) => coreMap[r]).filter(Boolean)]) {
    const page = byPath.get(path);
    if (page) items.push({ path, bytes: page.sizeBytes });
  }
  const log = coreMap.log ? byPath.get(coreMap.log) : undefined;
  if (log) items.push({ path: log.relPath, bytes: lastLogEntriesBytes(log.markdown) });
  return { items, total: items.reduce((s, i) => s + i.bytes, 0) };
}
