import type {
  TrackerData,
  TrackerOpenRow,
  TrackerProposalRow,
  TrackerDoneRow,
  HandoffData,
  BatonRow,
} from '../types/wiki.ts';

const OPEN_COLUMNS = ['ID', 'Status', 'Goal', 'Done when', 'Owner', 'Next verification', 'Evidence'];
const PROPOSAL_COLUMNS = ['Proposal', 'By', 'Date', 'Why'];
const DONE_COLUMNS = ['ID', 'Status', 'Goal', 'Closed', 'Criteria met', 'Evidence'];
const BATON_COLUMNS = ['Order', 'Task', 'Start files', 'Done when', 'Verification command', 'Notes / blockers'];

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

export function parseTrackerMarkdown(markdown: string): TrackerData {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  const openRows: TrackerOpenRow[] = [];
  const proposalRows: TrackerProposalRow[] = [];
  const doneRows: TrackerDoneRow[] = [];

  // 1. Open
  const openSection = findSectionLines(lines, 'open', 'Open');
  if (openSection) {
    const table = extractTableFromLines(openSection.lines);
    if (table) {
      const { header, rows } = table;
      const lowerHeader = header.map((h) => h.toLowerCase());
      const hasNamed = OPEN_COLUMNS.every((col) => lowerHeader.includes(col.toLowerCase()));

      const idIdx = hasNamed ? lowerHeader.indexOf('id') : 0;
      const statusIdx = hasNamed ? lowerHeader.indexOf('status') : 1;
      const goalIdx = hasNamed ? lowerHeader.indexOf('goal') : 2;
      const doneWhenIdx = hasNamed ? lowerHeader.indexOf('done when') : 3;
      const ownerIdx = hasNamed ? lowerHeader.indexOf('owner') : 4;
      const nextVerificationIdx = hasNamed ? lowerHeader.indexOf('next verification') : 5;
      const evidenceIdx = hasNamed ? lowerHeader.indexOf('evidence') : 6;

      for (const row of rows) {
        const id = (row[idIdx] || '').trim();
        const status = (row[statusIdx] || '⚪').trim() as '🟡' | '⚪' | '🔴';
        const goal = (row[goalIdx] || '').trim();
        const doneWhen = (row[doneWhenIdx] || '').trim();
        const owner = (row[ownerIdx] || '').trim();
        const nextVerification = (row[nextVerificationIdx] || '').trim();
        const evidence = (row[evidenceIdx] || '').trim();

        if (id) {
          openRows.push({ id, status, goal, doneWhen, owner, nextVerification, evidence });
        }
      }
    }
  }

  // 2. Proposals
  const proposalSection = findSectionLines(lines, 'proposals', 'Proposals');
  if (proposalSection) {
    const table = extractTableFromLines(proposalSection.lines);
    if (table) {
      const { header, rows } = table;
      const lowerHeader = header.map((h) => h.toLowerCase());
      const hasNamed = PROPOSAL_COLUMNS.every((col) => lowerHeader.includes(col.toLowerCase()));

      const proposalIdx = hasNamed ? lowerHeader.indexOf('proposal') : 0;
      const byIdx = hasNamed ? lowerHeader.indexOf('by') : 1;
      const dateIdx = hasNamed ? lowerHeader.indexOf('date') : 2;
      const whyIdx = hasNamed ? lowerHeader.indexOf('why') : 3;

      for (const row of rows) {
        const proposal = (row[proposalIdx] || '').trim();
        const by = (row[byIdx] || '').trim();
        const date = (row[dateIdx] || '').trim();
        const why = (row[whyIdx] || '').trim();

        if (proposal) {
          proposalRows.push({ proposal, by, date, why });
        }
      }
    }
  }

  // 3. Done
  const doneSection = findSectionLines(lines, 'done', 'Done');
  if (doneSection) {
    const table = extractTableFromLines(doneSection.lines);
    if (table) {
      const { header, rows } = table;
      const lowerHeader = header.map((h) => h.toLowerCase());
      const hasNamed = DONE_COLUMNS.every((col) => lowerHeader.includes(col.toLowerCase()));
      const isLegacy5 = !lowerHeader.includes('status') && header.length === 5;

      let idIdx = 0;
      let statusIdx = 1;
      let goalIdx = 2;
      let closedIdx = 3;
      let criteriaMetIdx = 4;
      let evidenceIdx = 5;

      if (hasNamed) {
        idIdx = lowerHeader.indexOf('id');
        statusIdx = lowerHeader.indexOf('status');
        goalIdx = lowerHeader.indexOf('goal');
        closedIdx = lowerHeader.indexOf('closed');
        criteriaMetIdx = lowerHeader.indexOf('criteria met');
        evidenceIdx = lowerHeader.indexOf('evidence');
      } else if (isLegacy5) {
        idIdx = 0;
        statusIdx = -1;
        goalIdx = 1;
        closedIdx = 2;
        criteriaMetIdx = 3;
        evidenceIdx = 4;
      }

      for (const row of rows) {
        const id = (row[idIdx] || '').trim();
        const status = (statusIdx === -1 ? '🟢' : (row[statusIdx] || '🟢').trim()) as '🟢' | '⚫';
        const goal = (row[goalIdx] || '').trim();
        const closed = (row[closedIdx] || '').trim();
        const criteriaMet = (row[criteriaMetIdx] || '').trim();
        const evidence = (row[evidenceIdx] || '').trim();

        if (id) {
          doneRows.push({ id, status, goal, closed, criteriaMet, evidence });
        }
      }
    }
  }

  return {
    open: openRows,
    proposals: proposalRows,
    done: doneRows,
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

export function formatTrackerOpenTable(rows: TrackerOpenRow[], customHeader?: string[]): string {
  const header = customHeader && customHeader.length === OPEN_COLUMNS.length ? customHeader : OPEN_COLUMNS;
  const lines: string[] = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ];
  for (const r of rows) {
    lines.push(
      `| ${escapeTableCell(r.id)} | ${escapeTableCell(r.status)} | ${escapeTableCell(r.goal)} | ${escapeTableCell(r.doneWhen)} | ${escapeTableCell(r.owner)} | ${escapeTableCell(r.nextVerification)} | ${escapeTableCell(r.evidence)} |`
    );
  }
  return lines.join('\n');
}

export function formatTrackerProposalTable(rows: TrackerProposalRow[], customHeader?: string[]): string {
  const header = customHeader && customHeader.length === PROPOSAL_COLUMNS.length ? customHeader : PROPOSAL_COLUMNS;
  const lines: string[] = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ];
  for (const r of rows) {
    lines.push(
      `| ${escapeTableCell(r.proposal)} | ${escapeTableCell(r.by)} | ${escapeTableCell(r.date)} | ${escapeTableCell(r.why)} |`
    );
  }
  return lines.join('\n');
}

export function formatTrackerDoneTable(rows: TrackerDoneRow[], customHeader?: string[]): string {
  const header = customHeader && customHeader.length === DONE_COLUMNS.length ? customHeader : DONE_COLUMNS;
  const lines: string[] = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ];
  for (const r of rows) {
    lines.push(
      `| ${escapeTableCell(r.id)} | ${escapeTableCell(r.status)} | ${escapeTableCell(r.goal)} | ${escapeTableCell(r.closed)} | ${escapeTableCell(r.criteriaMet)} | ${escapeTableCell(r.evidence)} |`
    );
  }
  return lines.join('\n');
}

export function replaceSectionTable(
  markdown: string,
  marker: string,
  heading: string,
  newTableMarkdown: string
): string {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  const section = findSectionLines(lines, marker, heading);
  const newTableLines = newTableMarkdown.split('\n');

  if (!section) {
    // Append section at end
    const appendLines: string[] = ['', `## ${heading}`, `<!-- wiki:${marker} -->`, '', ...newTableLines, ''];
    return lines.join('\n').trimEnd() + '\n' + appendLines.join('\n');
  }

  const existingTable = extractTableFromLines(section.lines);

  if (existingTable) {
    const absoluteHeaderLine = section.startLine + existingTable.headerLineOffset;
    const absoluteTableEndLine = section.startLine + existingTable.tableEndLineOffset;
    lines.splice(absoluteHeaderLine, absoluteTableEndLine - absoluteHeaderLine, ...newTableLines);
  } else {
    // Insert table after marker line (section.startLine)
    lines.splice(section.startLine + 1, 0, '', ...newTableLines, '');
  }

  return lines.join('\n');
}
