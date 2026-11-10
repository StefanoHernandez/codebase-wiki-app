import type { CoreRole, SchemaConfig, SchemaTopic, SchemaBudgets } from '../types/wiki.ts';
import { extractTableFromLines } from './markdown-tables.ts';

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

/** Data rows of the first table in the lines (header and delimiter excluded), or []. */
function tableRows(lines: string[]): string[][] {
  return extractTableFromLines(lines)?.rows ?? [];
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
  let currentKey = '';
  let currentLines: string[] = [];

  for (const line of lines) {
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

  const profileLines = findSection(sections, ['project profile']);
  if (profileLines.length > 0) {
    for (const row of tableRows(profileLines)) {
      if (row.length < 2) continue;
      const key = row[0].toLowerCase().trim();
      const val = row[1];
      if (key === 'language') {
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

  const budgets: SchemaBudgets = {
    singlePageBytes: 20 * 1024,
    coreReadBytes: 60 * 1024,
    logBytes: 30 * 1024,
  };

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

  const excludedGlobs: string[] = [];
  const excludedLines = findSection(sections, ['excluded paths']);
  for (const line of excludedLines) {
    const match = line.match(/^\s*[-*]\s+(.*)$/);
    if (match) {
      const glob = match[1].trim().replace(/^`+|`+$/g, '');
      if (glob) {
        excludedGlobs.push(glob);
      }
    }
  }

  return {
    language,
    projectDivision,
    sensitiveData,
    agentEntryFile,
    coreMap,
    budgets,
    topics,
    excludedGlobs,
  };
}
