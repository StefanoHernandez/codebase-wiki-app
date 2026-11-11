import { isDelimiterRow, splitTableRow } from './markdown-tables.ts';

export class StaleError extends Error {
  constructor(message = "Il file è cambiato da quando l'hai aperto: ricarico, riprova.") {
    super(message);
    this.name = 'StaleError';
  }
}

export interface Doc {
  lines: string[];
  eol: '\n' | '\r\n';
  bom: boolean;
  finalNewline: boolean;
}

export interface TableLoc {
  header: string[];
  headerLine: number;
  delimLine: number;
  rows: { line: number; cells: string[] }[];
}

export function parseDoc(text: string): Doc {
  const bom = text.startsWith('\uFEFF');
  const body = bom ? text.slice(1) : text;
  const eol: '\n' | '\r\n' = body.includes('\r\n') ? '\r\n' : '\n';
  const finalNewline = eol === '\r\n' ? body.endsWith('\r\n') : body.endsWith('\n');
  let lines = eol === '\r\n' ? body.split('\r\n') : body.split('\n');
  if (finalNewline && lines.length > 0 && lines[lines.length - 1] === '') {
    lines = lines.slice(0, -1);
  }
  return { lines, eol, bom, finalNewline };
}

export function renderDoc(doc: Doc): string {
  let out = (doc.bom ? '\uFEFF' : '') + doc.lines.join(doc.eol);
  if (doc.finalNewline) out += doc.eol;
  return out;
}

/** CommonMark: same fence char on close, closing run length ≥ opening. */
export function fenceMask(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let open: { char: string; len: number; start: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s{0,3})(`{3,}|~{3,})(.*)$/);
    if (!open) {
      if (m && m[1].length <= 3) {
        const fence = m[2];
        if (fence[0] === '`' && (m[3] ?? '').includes('`')) {
          continue;
        }
        open = { char: fence[0], len: fence.length, start: i };
        mask[i] = true;
      }
      continue;
    }
    mask[i] = true;
    if (m && m[1].length <= 3 && (m[3] ?? '').trim() === '') {
      const fence = m[2];
      if (fence[0] === '`' && (m[3] ?? '').includes('`')) {
        continue;
      }
      if (fence[0] === open.char && fence.length >= open.len) {
        open = null;
      }
    }
  }
  return mask;
}

function headingMatch(line: string, headings: string[]): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('## ')) return false;
  const title = trimmed.slice(3).trim();
  const lower = title.toLowerCase();
  return headings.some((h) => h.toLowerCase() === lower);
}

/** Section body is [start, end) line indices. */
export function findSection(
  doc: Doc,
  marker: string,
  headings: string[],
): { start: number; end: number } | null {
  const { lines } = doc;
  const masked = fenceMask(lines);
  const markerToken = `<!-- wiki:${marker} -->`;

  let anchor = -1;
  for (let i = 0; i < lines.length; i++) {
    if (masked[i]) continue;
    if (lines[i].trim() === markerToken) {
      anchor = i;
      break;
    }
  }
  if (anchor === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (masked[i]) continue;
      if (headingMatch(lines[i], headings)) {
        anchor = i;
        break;
      }
    }
  }
  if (anchor === -1) return null;

  let start = anchor;
  if (lines[anchor].trim() === markerToken) {
    for (let i = anchor - 1; i >= 0; i--) {
      if (masked[i]) continue;
      if (lines[i].trim().startsWith('## ')) {
        start = i;
        break;
      }
    }
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (masked[i]) continue;
    if (lines[i].trim().startsWith('## ')) {
      end = i;
      break;
    }
  }
  return { start, end };
}

export function findTable(doc: Doc, section: { start: number; end: number }): TableLoc | null {
  const { lines } = doc;
  const masked = fenceMask(lines);

  for (let i = section.start; i < section.end - 1; i++) {
    if (masked[i] || masked[i + 1]) continue;
    const headerCells = splitTableRow(lines[i]);
    const delimCells = splitTableRow(lines[i + 1]);
    if (!headerCells || !delimCells || !isDelimiterRow(delimCells)) continue;
    if (headerCells.length !== delimCells.length) continue;

    const rows: TableLoc['rows'] = [];
    for (let r = i + 2; r < section.end; r++) {
      if (masked[r]) break;
      const cells = splitTableRow(lines[r]);
      if (!cells) {
        if (lines[r].trim()) break;
        break;
      }
      rows.push({ line: r, cells });
    }

    return {
      header: headerCells,
      headerLine: i,
      delimLine: i + 1,
      rows,
    };
  }
  return null;
}

export function escapeTableCell(cell: string): string {
  return cell.replace(/\r?\n/g, ' ').replace(/(?<!\\)\|/g, '\\|');
}

function formatTableRow(cells: string[], escapeAll: boolean): string {
  const out = cells.map((c) => (escapeAll ? escapeTableCell(c) : c));
  return `| ${out.join(' | ')} |`;
}

export function setCells(doc: Doc, rowLine: number, cells: string[]): Doc {
  const oldCells = splitTableRow(doc.lines[rowLine]) ?? [];
  const merged = cells.map((c, i) => {
    const prev = oldCells[i] ?? '';
    return c === prev ? prev : escapeTableCell(c);
  });
  const lines = doc.lines.slice();
  lines[rowLine] = formatTableRow(merged, false);
  return { ...doc, lines };
}

export function insertRow(doc: Doc, afterLine: number, cells: string[]): Doc {
  return insertLines(doc, afterLine + 1, [formatTableRow(cells, true)]);
}

export function removeLine(doc: Doc, line: number): Doc {
  const lines = doc.lines.slice();
  lines.splice(line, 1);
  return { ...doc, lines };
}

export function insertLines(doc: Doc, at: number, newLines: string[]): Doc {
  const lines = doc.lines.slice();
  lines.splice(at, 0, ...newLines);
  return { ...doc, lines };
}

/** Indices of lines that differ between two rendered documents (same EOL). */
export function changedLineIndices(before: string, after: string): number[] {
  const a = parseDoc(before);
  const b = parseDoc(after);
  const max = Math.max(a.lines.length, b.lines.length);
  const changed: number[] = [];
  for (let i = 0; i < max; i++) {
    if ((a.lines[i] ?? '') !== (b.lines[i] ?? '')) changed.push(i);
  }
  return changed;
}

export function assertUnchangedLines(before: string, after: string, allowed: Set<number>): void {
  const a = parseDoc(before);
  const b = parseDoc(after);
  if (a.eol !== b.eol || a.bom !== b.bom || a.finalNewline !== b.finalNewline) {
    throw new Error('EOL, BOM, or final newline changed');
  }
  const max = Math.max(a.lines.length, b.lines.length);
  for (let i = 0; i < max; i++) {
    if (allowed.has(i)) continue;
    if ((a.lines[i] ?? '') !== (b.lines[i] ?? '')) {
      throw new Error(`Line ${i} changed unexpectedly`);
    }
  }
}
