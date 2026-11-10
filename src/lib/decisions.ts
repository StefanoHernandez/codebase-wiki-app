import { parseFrontmatter } from './frontmatter.ts';
import { findSectionLines } from './markdown-tables.ts';
import type { Decision, DecisionStatus } from '../types/wiki.ts';

const DECISION_FILE = /^(\d{4})-(.+)\.md$/;

/** Parses one decision page. `relPath` must be a decision file named `NNNN-<slug>.md`. */
export function parseDecision(relPath: string, markdown: string): Decision {
  const normalized = relPath.replace(/\\/g, '/');
  const base = normalized.slice(normalized.lastIndexOf('/') + 1);
  const match = base.match(DECISION_FILE);
  if (!match) {
    throw new Error(`Not a decision file (NNNN-<slug>.md): ${relPath}`);
  }

  const parsed = parseFrontmatter(markdown);
  const headingMatch = parsed.body.match(/^#\s+(.*)$/m);
  const title = parsed.fields.title || headingMatch?.[1].trim() || match[2];

  const statusRaw = (parsed.fields.status || '').trim().toLowerCase();
  const supersededMatch = statusRaw.match(/^superseded by (\d{4})$/);
  let status: DecisionStatus = 'unknown';
  if (statusRaw === 'proposed' || statusRaw === 'accepted' || statusRaw === 'rejected') {
    status = statusRaw;
  } else if (supersededMatch) {
    status = 'superseded';
  }

  const approval = findSectionLines(parsed.body.split('\n'), 'approval', 'Approval');
  const approvalLines = (approval ? approval.lines.slice(1) : [])
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const decision: Decision = {
    relPath: normalized,
    number: match[1],
    slug: match[2],
    title,
    status,
    approvalLines,
  };
  if (supersededMatch) decision.supersededBy = supersededMatch[1];
  return decision;
}

/** Decisions among the wiki pages that sit directly in `decisionsDir` (Core map path) as `NNNN-*.md`. */
export function listDecisions(pages: Array<{ relPath: string; markdown: string }>, decisionsDir: string): Decision[] {
  const dir = decisionsDir.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  return pages
    .map((page) => ({ page, rel: page.relPath.replace(/\\/g, '/') }))
    .filter(({ rel }) => rel.startsWith(dir))
    .filter(({ rel }) => {
      const rest = rel.slice(dir.length);
      return !rest.includes('/') && DECISION_FILE.test(rest);
    })
    .map(({ page }) => parseDecision(page.relPath, page.markdown))
    .sort((a, b) => a.number.localeCompare(b.number));
}
