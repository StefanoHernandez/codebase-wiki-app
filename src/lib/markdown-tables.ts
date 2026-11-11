import type {
  TrackerData,
  TrackerOpenRow,
  TrackerProposalRow,
  TrackerDoneRow,
  HandoffData,
  BatonRow,
} from '../types/wiki.ts';

export const OPEN_COLUMNS = ['ID', 'Status', 'Goal', 'Done when', 'Owner', 'Next verification', 'Evidence'];
export const PROPOSAL_COLUMNS = ['Proposal', 'By', 'Date', 'Why'];
export const DONE_COLUMNS = ['ID', 'Status', 'Goal', 'Closed', 'Criteria met', 'Evidence'];
const BATON_COLUMNS = ['Order', 'Task', 'Start files', 'Done when', 'Verification command', 'Notes / blockers'];

// Header name (lowercased) -> row property, per tracker section.
const OPEN_KEYS: Record<string, string> = {
  id: 'id',
  status: 'status',
  goal: 'goal',
  'done when': 'doneWhen',
  owner: 'owner',
  'next verification': 'nextVerification',
  evidence: 'evidence',
};
const PROPOSAL_KEYS: Record<string, string> = { proposal: 'proposal', by: 'by', date: 'date', why: 'why' };
const DONE_KEYS: Record<string, string> = {
  id: 'id',
  status: 'status',
  goal: 'goal',
  closed: 'closed',
  'criteria met': 'criteriaMet',
  evidence: 'evidence',
};

export function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;
  const cells = trimmed.split(/(?<!\\)\|/);
  if (cells.length <= 1) return null;
  if (cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

export function isDelimiterRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c.trim()));
}

export function escapeTableCell(cell: string): string {
  return cell.replace(/\r?\n/g, ' ').replace(/(?<!\\)\|/g, '\\|');
}

export function findSectionLines(
  lines: string[],
  marker: string,
  heading: string
): { startLine: number; endLine: number; lines: string[] } | null {
  const markerToken = `<!-- wiki:${marker} -->`;
  let startIdx = lines.findIndex((l) => l.trim() === markerToken);
  if (startIdx === -1) {
    startIdx = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  }
  if (startIdx === -1) {
    return null;
  }
  let endIdx = lines.findIndex((l, i) => i > startIdx && l.trim().startsWith('## '));
  if (endIdx === -1) {
    endIdx = lines.length;
  }
  return {
    startLine: startIdx,
    endLine: endIdx,
    lines: lines.slice(startIdx, endIdx),
  };
}

export interface ExtractedTable {
  header: string[];
  rows: string[][];
  headerLineOffset: number;
  tableEndLineOffset: number;
}

export function extractTableFromLines(lines: string[]): ExtractedTable | null {
  const parsedRows: Array<{ offset: number; cells: string[] }> = [];
  for (let i = 0; i < lines.length; i++) {
    const cells = splitTableRow(lines[i]);
    if (cells) {
      parsedRows.push({ offset: i, cells });
    }
  }

  if (parsedRows.length < 2) return null;

  let headerIndex = -1;
  for (let i = 0; i < parsedRows.length - 1; i++) {
    if (
      parsedRows[i + 1].offset === parsedRows[i].offset + 1 &&
      isDelimiterRow(parsedRows[i + 1].cells) &&
      parsedRows[i + 1].cells.length === parsedRows[i].cells.length
    ) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) return null;

  const headerRow = parsedRows[headerIndex];
  const header = headerRow.cells;
  const headerOffset = headerRow.offset;

  let endOffset = lines.length;
  for (let i = headerOffset + 2; i < lines.length; i++) {
    if (!lines[i].trim()) {
      endOffset = i;
      break;
    }
  }

  const dataRows: string[][] = [];
  let tableEndLineOffset = headerOffset + 2;

  for (let i = headerIndex + 2; i < parsedRows.length; i++) {
    const r = parsedRows[i];
    if (r.offset >= endOffset) break;
    dataRows.push(r.cells);
    tableEndLineOffset = r.offset + 1;
  }

  return {
    header,
    rows: dataRows,
    headerLineOffset: headerOffset,
    tableEndLineOffset,
  };
}

interface RawTrackerRecord {
  fields: Record<string, string>;
  extra: Record<string, string>;
}

/**
 * Reads one tracker table. Named headers map known columns by name and keep every other
 * column in `extra` under its original header text. Without the named columns the table is
 * read positionally (`positional`, or `legacy` for a 5-column legacy table) and the canonical
 * header is used when writing back.
 */
function readTrackerRecords(
  lines: string[] | null,
  canonical: string[],
  keys: Record<string, string>,
  positional: string[],
  legacy?: string[]
): { header: string[]; rows: RawTrackerRecord[] } {
  const table = lines ? extractTableFromLines(lines) : null;
  if (!table) return { header: canonical, rows: [] };

  const lower = table.header.map((h) => h.trim().toLowerCase());
  const named = canonical.every((col) => lower.includes(col.toLowerCase()));
  const useLegacy = !named && legacy !== undefined && table.header.length === legacy.length;
  const header = named ? table.header : canonical;
  const positionalKeys = useLegacy ? legacy! : positional;

  const rows = table.rows.map((cells) => {
    const fields: Record<string, string> = {};
    const extra: Record<string, string> = {};
    table.header.forEach((h, i) => {
      const value = (cells[i] ?? '').trim();
      const key = named ? (Object.hasOwn(keys, lower[i]) ? keys[lower[i]] : undefined) : positionalKeys[i];
      if (key) {
        fields[key] = value;
      } else if (named) {
        extra[h] = value;
      }
    });
    return { fields, extra };
  });
  return { header, rows };
}

export function parseTrackerMarkdown(markdown: string): TrackerData {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  const open = readTrackerRecords(
    findSectionLines(lines, 'open', 'Open')?.lines ?? null,
    OPEN_COLUMNS,
    OPEN_KEYS,
    ['id', 'status', 'goal', 'doneWhen', 'owner', 'nextVerification', 'evidence']
  );
  const proposals = readTrackerRecords(
    findSectionLines(lines, 'proposals', 'Proposals')?.lines ?? null,
    PROPOSAL_COLUMNS,
    PROPOSAL_KEYS,
    ['proposal', 'by', 'date', 'why']
  );
  const done = readTrackerRecords(
    findSectionLines(lines, 'done', 'Done')?.lines ?? null,
    DONE_COLUMNS,
    DONE_KEYS,
    ['id', 'status', 'goal', 'closed', 'criteriaMet', 'evidence'],
    ['id', 'goal', 'closed', 'criteriaMet', 'evidence'] // legacy: no Status column (proven 🟢 only)
  );

  return {
    open: open.rows
      .filter((r) => r.fields.id)
      .map((r) => ({
        id: r.fields.id,
        status: (r.fields.status || '⚪') as TrackerOpenRow['status'],
        goal: r.fields.goal || '',
        doneWhen: r.fields.doneWhen || '',
        owner: r.fields.owner || '',
        nextVerification: r.fields.nextVerification || '',
        evidence: r.fields.evidence || '',
        extra: r.extra,
      })),
    proposals: proposals.rows
      .filter((r) => r.fields.proposal)
      .map((r) => ({
        proposal: r.fields.proposal,
        by: r.fields.by || '',
        date: r.fields.date || '',
        why: r.fields.why || '',
        extra: r.extra,
      })),
    done: done.rows
      .filter((r) => r.fields.id)
      .map((r) => ({
        id: r.fields.id,
        status: (r.fields.status || '🟢') as TrackerDoneRow['status'],
        goal: r.fields.goal || '',
        closed: r.fields.closed || '',
        criteriaMet: r.fields.criteriaMet || '',
        evidence: r.fields.evidence || '',
        extra: r.extra,
      })),
    openHeader: open.header,
    proposalsHeader: proposals.header,
    doneHeader: done.header,
  };
}

export function parseHandoffMarkdown(markdown: string): HandoffData {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  // State bullets
  const stateBullets: Record<string, string> = {};
  const stateSection = findSectionLines(lines, 'state', 'Current Work State');
  if (stateSection) {
    for (const line of stateSection.lines) {
      const match = line.match(/^\s*-\s+([^:]+):\s*(.*)$/);
      if (match) {
        stateBullets[match[1].trim()] = match[2].trim();
      }
    }
  }

  // Baton
  const baton: BatonRow[] = [];
  let noOpenWork = false;
  const batonSection = findSectionLines(lines, 'baton', 'Baton For Next Coding Agent');
  if (batonSection) {
    for (const line of batonSection.lines) {
      if (line.trim().toLowerCase() === 'no open work.') {
        noOpenWork = true;
      }
    }

    const table = extractTableFromLines(batonSection.lines);
    if (table) {
      const { header, rows } = table;
      const lowerHeader = header.map((h) => h.toLowerCase());
      const hasNamed = BATON_COLUMNS.every((col) => lowerHeader.includes(col.toLowerCase()));

      const orderIdx = hasNamed ? lowerHeader.indexOf('order') : 0;
      const taskIdx = hasNamed ? lowerHeader.indexOf('task') : 1;
      const startFilesIdx = hasNamed ? lowerHeader.indexOf('start files') : 2;
      const doneWhenIdx = hasNamed ? lowerHeader.indexOf('done when') : 3;
      const verificationCommandIdx = hasNamed ? lowerHeader.indexOf('verification command') : 4;
      const notesIdx = hasNamed
        ? lowerHeader.indexOf('notes / blockers') !== -1
          ? lowerHeader.indexOf('notes / blockers')
          : lowerHeader.indexOf('notes')
        : 5;

      for (const row of rows) {
        const order = (row[orderIdx] || '').trim();
        const task = (row[taskIdx] || '').trim();
        const startFiles = (row[startFilesIdx] || '').trim();
        const doneWhen = (row[doneWhenIdx] || '').trim();
        const verificationCommand = (row[verificationCommandIdx] || '').trim();
        const notes = (row[notesIdx] || '').trim();

        if (order || task) {
          baton.push({ order, task, startFiles, doneWhen, verificationCommand, notes });
        }
      }
    }
    baton.sort((a, b) => (parseInt(a.order, 10) || 0) - (parseInt(b.order, 10) || 0));
  }

  // Blockers
  const blockers: Array<Record<string, string>> = [];
  const blockersSection = findSectionLines(lines, 'blockers', 'Blockers');
  if (blockersSection) {
    const table = extractTableFromLines(blockersSection.lines);
    if (table) {
      const { header, rows } = table;
      for (const row of rows) {
        const item: Record<string, string> = {};
        for (let i = 0; i < header.length; i++) {
          item[header[i]] = (row[i] || '').trim();
        }
        blockers.push(item);
      }
    }
  }

  return {
    stateBullets,
    baton,
    noOpenWork,
    blockers,
  };
}

export function computeNextTrackerId(trackerMarkdown: string, logMarkdown: string): string {
  let maxId = 0;
  const regex = /\bT([1-9]\d*)\b/g;

  for (const text of [trackerMarkdown, logMarkdown]) {
    if (!text) continue;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const num = parseInt(match[1], 10);
      if (num > maxId) {
        maxId = num;
      }
    }
  }

  return `T${maxId + 1}`;
}

