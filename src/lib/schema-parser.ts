import type { CoreRole, PageTypeRule, SchemaConfig, SchemaTopic, SchemaBudgets } from '../types/wiki.ts';
import { extractTableFromLines } from './markdown-tables.ts';
import { fenceMask } from './md-edit.ts';

export const DEFAULT_SCHEMA_BUDGETS: SchemaBudgets = {
  singlePageBytes: 20 * 1024,
  coreReadBytes: 60 * 1024,
  logBytes: 30 * 1024,
};

export const DEFAULT_CORE_MAP: Record<CoreRole, string> = {
  index: 'index.md',
  log: 'log.md',
  'log-archive': 'log/',
  tracker: 'project/work-tracker.md',
  decisions: 'project/decisions/',
  risks: 'project/risks.md',
  context: 'agent/context.md',
  handoff: 'agent/handoff.md',
  troubleshooting: 'troubleshooting.md',
  glossary: 'glossary.md',
};

/** Splits section body into ranges outside fenced code. */
function unfencedChunks(lines: string[]): string[][] {
  const masked = fenceMask(lines);
  const chunks: string[][] = [];
  let current: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (masked[i]) {
      if (current.length > 0) {
        chunks.push(current);
        current = [];
      }
      continue;
    }
    current.push(lines[i]!);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Data rows of tables outside fences (header and delimiter excluded), or []. */
function tableRows(lines: string[]): string[][] {
  const rows: string[][] = [];
  for (const chunk of unfencedChunks(lines)) {
    rows.push(...(extractTableFromLines(chunk)?.rows ?? []));
  }
  return rows;
}

function backtickToken(text: string): string | null {
  const m = text.trim().match(/^`([^`]+)`$/);
  return m ? m[1] : null;
}

function cleanSettingValue(val: string): string {
  const trimmed = val.trim().replace(/^`+|`+$/g, '');
  if (trimmed.includes('(')) {
    const beforeParen = trimmed.split('(')[0].trim();
    return beforeParen || trimmed;
  }
  return trimmed;
}

function parseBudgetBytes(valStr: string, fallback: number): number {
  const match = valStr.match(/(\d+(?:\.\d+)?)\s*(kb|mb|b)?/i);
  if (!match) return fallback;
  const num = parseFloat(match[1]);
  const unit = (match[2] || 'kb').toLowerCase();
  if (unit === 'mb') return Math.round(num * 1024 * 1024);
  if (unit === 'kb') return Math.round(num * 1024);
  return Math.round(num);
}

function getSections(lines: string[]): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  const masked = fenceMask(lines);
  let currentKey = '';
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (masked[i]) {
      if (currentKey) currentLines.push(line);
      continue;
    }
    const headingMatch = line.match(/^##\s+(.+)$/);
    const markerMatch = line.match(/^<!--\s*wiki:([a-zA-Z0-9_-]+)\s*-->$/);

    if (headingMatch || markerMatch) {
      if (currentKey) {
        sections.set(currentKey, currentLines);
      }
      currentKey = markerMatch
        ? markerMatch[1].toLowerCase().replace(/-/g, ' ')
        : headingMatch![1].trim().toLowerCase();
      currentLines = [];
    } else if (currentKey) {
      currentLines.push(line);
    }
  }

  if (currentKey) {
    sections.set(currentKey, currentLines);
  }

  return sections;
}

function findSection(sections: Map<string, string[]>, keys: string[]): string[] {
  for (const [sectionName, lines] of sections.entries()) {
    for (const key of keys) {
      if (sectionName === key) {
        return lines;
      }
    }
  }
  return [];
}

/** `Path | type` rows: every backticked glob in the first cell maps to the type in the second. */
function pageTypeRows(lines: string[]): PageTypeRule[] {
  const rules: PageTypeRule[] = [];
  for (const row of tableRows(lines)) {
    if (row.length < 2) continue;
    const type = row[1]!.trim().replace(/^`+|`+$/g, '').trim();
    if (!/^[A-Za-z][\w-]*$/.test(type)) continue;
    const globs = [...row[0]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.trim());
    if (globs.length === 0) globs.push(...row[0]!.split(',').map((g) => g.trim()).filter(Boolean));
    for (const glob of globs) rules.push({ glob, type });
  }
  return rules;
}

/** fnmatch as the validator uses it: `*` also crosses `/`; a `<placeholder>` matches anything. */
export function wikiGlobMatch(glob: string, relPath: string): boolean {
  const re = glob
    .replace(/<[^>]*>/g, '\u0000')
    .replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\[!/g, '[^')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
    .replace(/\u0000/g, '.*');
  try {
    return new RegExp(`^${re}$`).test(relPath); // `[...]` classes pass through as in fnmatch
  } catch {
    return false;
  }
}

/** First matching `## Page types` row, then the `## Page frontmatter` defaults; null when none matches. */
export function pageTypeFor(relPath: string, rules: PageTypeRule[]): string | null {
  return rules.find((r) => wikiGlobMatch(r.glob, relPath))?.type ?? null;
}

function excludedGlobsFromSection(lines: string[]): string[] {
  const globs: string[] = [];
  const masked = fenceMask(lines);
  for (let i = 0; i < lines.length; i++) {
    if (masked[i]) continue;
    const line = lines[i]!;
    const listMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (listMatch) {
      const glob = backtickToken(listMatch[1]!);
      if (glob) globs.push(glob);
      continue;
    }
  }
  for (const row of tableRows(lines)) {
    for (const cell of row) {
      const glob = backtickToken(cell);
      if (glob) {
        globs.push(glob);
        break;
      }
    }
  }
  return globs;
}

export function parseSchemaMarkdown(markdown: string): SchemaConfig {
  let normalized = markdown;
  if (normalized.startsWith('\uFEFF')) {
    normalized = normalized.slice(1);
  }
  normalized = normalized.replace(/\r\n/g, '\n');

  const lines = normalized.split('\n');
  const sections = getSections(lines);

  let language = 'English';
  let projectDivision = 'none';
  let sensitiveData = false;
  let agentEntryFile = 'none';
  let logOrder: SchemaConfig['logOrder'] = 'oldest-first';

  const profileLines = findSection(sections, ['project profile']);
  if (profileLines.length > 0) {
    for (const row of tableRows(profileLines)) {
      if (row.length < 2) continue;
      const key = row[0].toLowerCase().trim();
      const val = row[1];
      // Same cleanup as validate-wiki.py `profile`: `*` and backticks around the setting.
      if (row[0].replace(/[*`]/g, '').trim().toLowerCase() === 'log order') {
        const order = val.replace(/`/g, '').trim().toLowerCase();
        if (order === 'newest first') logOrder = 'newest-first';
        else if (order === 'oldest first') logOrder = 'oldest-first';
      } else if (key === 'language') {
        language = cleanSettingValue(val) || 'English';
      } else if (key === 'project division') {
        projectDivision = cleanSettingValue(val) || 'none';
      } else if (key === 'sensitive data') {
        sensitiveData = /^(yes|true)$/i.test(val.trim());
      } else if (key === 'agent entry file') {
        agentEntryFile = cleanSettingValue(val) || 'none';
      }
    }
  }

  const parsedCoreMap: Record<string, string> = {};
  const coreMapLines = findSection(sections, ['core map']);
  if (coreMapLines.length > 0) {
    for (const row of tableRows(coreMapLines)) {
      if (row.length < 2) continue;
      const role = row[0].trim();
      const path = row[1].trim().replace(/^`+|`+$/g, '');
      if (role && path) {
        parsedCoreMap[role] = path;
      }
    }
  }
  const coreMap = { ...DEFAULT_CORE_MAP, ...parsedCoreMap };

  const budgets: SchemaBudgets = { ...DEFAULT_SCHEMA_BUDGETS };

  const budgetLines = findSection(sections, ['budgets']);
  if (budgetLines.length > 0) {
    for (const row of tableRows(budgetLines)) {
      if (row.length < 2) continue;
      const name = row[0].toLowerCase().trim();
      const val = row[1];
      if (name.includes('single page')) {
        budgets.singlePageBytes = parseBudgetBytes(val, 20 * 1024);
      } else if (name.includes('core read')) {
        budgets.coreReadBytes = parseBudgetBytes(val, 60 * 1024);
      } else if (name.startsWith('log') || name === 'log') {
        budgets.logBytes = parseBudgetBytes(val, 30 * 1024);
      }
    }
  }

  const topics: SchemaTopic[] = [];
  const topicLines = findSection(sections, ['topics']);
  if (topicLines.length > 0) {
    for (const row of tableRows(topicLines)) {
      if (row.length < 2) continue;
      const name = row[0].trim().replace(/^`+|`+$/g, '');
      const path = row[1].trim().replace(/^`+|`+$/g, '');
      const description = (row[2] || '').trim();
      if (name && path) {
        topics.push({ name, path, description });
      }
    }
  }

  const excludedGlobs = excludedGlobsFromSection(findSection(sections, ['excluded paths']));
  const pageTypes = [
    ...pageTypeRows(findSection(sections, ['page types'])),
    ...pageTypeRows(findSection(sections, ['page frontmatter'])),
  ];

  return {
    language,
    projectDivision,
    sensitiveData,
    agentEntryFile,
    logOrder,
    coreMap,
    hasCoreMap: sections.has('core map'),
    budgets,
    topics,
    excludedGlobs,
    pageTypes,
  };
}
