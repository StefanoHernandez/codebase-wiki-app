import { parseFrontmatter, parseMapBody, toAttribution } from './frontmatter.ts';
import {
  parseTrackerMarkdown,
  computeNextTrackerId,
  OPEN_COLUMNS,
  PROPOSAL_COLUMNS,
  DONE_COLUMNS,
} from './markdown-tables.ts';
import type { Attribution, TrackerDoneRow, TrackerOpenRow } from '../types/wiki.ts';
import { todayLocal } from './dates.ts';
import {
  parseDoc,
  renderDoc,
  fenceMask,
  findSection,
  findTable,
  setCells,
  insertRow,
  removeLine,
  insertLines,
  StaleError,
  type Doc,
  type TableLoc,
} from './md-edit.ts';

export { StaleError } from './md-edit.ts';

// Human actions never write `updated:` or `source_commit`: a status change is not a source review.

const DISALLOWED_ACTORS = new Set([
  'agent',
  'coding agent',
  'ai',
  'unknown',
  'pending',
  'todo',
  'tbd',
  'n/a',
  'na',
  'none',
]);

const OPEN_KEYS: Record<string, keyof TrackerOpenRow | 'extra'> = {
  id: 'id',
  status: 'status',
  goal: 'goal',
  'done when': 'doneWhen',
  owner: 'owner',
  'next verification': 'nextVerification',
  evidence: 'evidence',
};

const PROPOSAL_COLS = ['proposal', 'by', 'date', 'why'] as const;
const DONE_KEYS: Record<string, keyof TrackerDoneRow | 'extra'> = {
  id: 'id',
  status: 'status',
  goal: 'goal',
  closed: 'closed',
  'criteria met': 'criteriaMet',
  evidence: 'evidence',
};

const OPEN_PROPS: (keyof TrackerOpenRow)[] = [
  'id',
  'status',
  'goal',
  'doneWhen',
  'owner',
  'nextVerification',
  'evidence',
];
const DONE_PROPS: (keyof TrackerDoneRow)[] = ['id', 'status', 'goal', 'closed', 'criteriaMet', 'evidence'];

function headersMatchCanonical(header: string[], columns: readonly string[]): boolean {
  return columns.every((c) => header.some((h) => h.trim().toLowerCase() === c.toLowerCase()));
}

function canonicalOpenFieldIndex(field: string): number | undefined {
  const wanted = field.trim().toLowerCase();
  for (let i = 0; i < OPEN_COLUMNS.length; i++) {
    const col = OPEN_COLUMNS[i]!.toLowerCase();
    const key = OPEN_KEYS[col];
    if (col === wanted || key === wanted) return i;
  }
  return undefined;
}

function openColumnKey(
  header: string[],
  index: number,
): keyof TrackerOpenRow | 'extra' {
  if (headersMatchCanonical(header, OPEN_COLUMNS)) {
    const key = OPEN_KEYS[header[index]!.trim().toLowerCase()];
    return key ?? 'extra';
  }
  return index < OPEN_PROPS.length ? OPEN_PROPS[index]! : 'extra';
}

function doneColumnKey(header: string[], index: number): keyof TrackerDoneRow | 'extra' {
  if (headersMatchCanonical(header, DONE_COLUMNS)) {
    const key = DONE_KEYS[header[index]!.trim().toLowerCase()];
    return key ?? 'extra';
  }
  return index < DONE_PROPS.length ? DONE_PROPS[index]! : 'extra';
}

export function validateHumanActor(person: string): void {
  if (!person || typeof person !== 'string' || !person.trim()) {
    throw new Error('Human authority required: person must be a non-empty human name');
  }
  const trimmed = person.trim();
  if (/^<.*>$/.test(trimmed)) {
    throw new Error(`Human authority required: person cannot be a placeholder ('${trimmed}')`);
  }
  if (DISALLOWED_ACTORS.has(trimmed.toLowerCase())) {
    throw new Error(`Human authority required: '${trimmed}' is not an authorized human person`);
  }
}

export function validateNotProvenReason(reason: string): void {
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    throw new Error('Closure requires a non-empty notProvenReason');
  }
  const trimmed = reason.trim().replace(/^`+|`+$/g, '').trim();
  if (/^<.*>$/.test(trimmed)) {
    throw new Error(`notProvenReason cannot be a placeholder ('${trimmed}')`);
  }
  if (DISALLOWED_ACTORS.has(trimmed.toLowerCase())) {
    throw new Error(`notProvenReason cannot be '${trimmed}'`);
  }
}

/** Lowercase id for `human:<id>`: only [a-z0-9._-], other runs become a single dash. */
export function personId(person: string): string {
  return person
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const DATE_LOG_HEADING = /^## \d{4}-\d{2}-\d{2}\b/;

/** Appends one `## date · title · human` entry (oldest-first at EOF, or newest-first above the first dated heading). */
export function appendLogEntry(params: {
  logMarkdown: string;
  date: string;
  title: string;
  what: string;
  evidence: string;
  ids: string[];
  order?: 'oldest-first' | 'newest-first';
}): string {
  const order = params.order ?? 'oldest-first';
  const entryLines = [
    `## ${params.date} · ${params.title} · human`,
    `- What: ${params.what}`,
    `- Evidence: ${params.evidence}`,
    `- IDs: ${params.ids.length > 0 ? params.ids.join(', ') : 'none'}`,
    '',
  ];
  const entry = entryLines.join('\n');

  if (order === 'oldest-first') {
    const previous = params.logMarkdown.trimEnd();
    return previous ? `${previous}\n\n${entry}` : entry;
  }

  const doc = parseDoc(params.logMarkdown);
  const masked = fenceMask(doc.lines);
  let insertAt = doc.lines.length;
  for (let i = 0; i < doc.lines.length; i++) {
    if (masked[i]) continue;
    if (DATE_LOG_HEADING.test(doc.lines[i]!.trim())) {
      insertAt = i;
      break;
    }
  }
  const prefix = doc.lines.slice(0, insertAt);
  const suffix = doc.lines.slice(insertAt);
  const merged =
    prefix.length > 0
      ? [...prefix, ...(prefix[prefix.length - 1]?.trim() ? ['', ...entryLines] : entryLines), ...suffix]
      : [...entryLines, ...suffix];
  return renderDoc({ ...doc, lines: merged });
}

const PROPOSAL_FIELD_INDEX: Record<(typeof PROPOSAL_COLS)[number], number> = {
  proposal: 0,
  by: 1,
  date: 2,
  why: 3,
};

function proposalColIndex(header: string[], field: (typeof PROPOSAL_COLS)[number]): number {
  const canonical = PROPOSAL_COLUMNS[PROPOSAL_FIELD_INDEX[field]];
  const named = header.some((h) => h.trim().toLowerCase() === canonical.toLowerCase());
  if (named) {
    return header.findIndex((h) => h.trim().toLowerCase() === canonical.toLowerCase());
  }
  return PROPOSAL_FIELD_INDEX[field];
}

function idColumnIndex(header: string[]): number {
  const idx = header.findIndex((h) => h.trim().toLowerCase() === 'id');
  return idx >= 0 ? idx : 0;
}

function assertRowWidth(table: TableLoc, row: { line: number; cells: string[] }, idLabel: string): void {
  if (row.cells.length > table.header.length) {
    throw new Error(`La riga ${idLabel} ha una | non protetta: correggila nel file (scrivi \\|)`);
  }
}

function findOpenTable(doc: Doc) {
  const section = findSection(doc, 'open', ['Open']);
  if (!section) throw new Error('Open tracker section not found');
  const table = findTable(doc, section);
  if (!table) throw new Error('Open tracker table not found');
  return { section, table };
}

function findProposalTable(doc: Doc) {
  const section = findSection(doc, 'proposals', ['Proposals']);
  if (!section) throw new Error('Proposals section not found');
  const table = findTable(doc, section);
  if (!table) throw new Error('Proposals table not found');
  return { section, table };
}

function findDoneTable(doc: Doc) {
  const section = findSection(doc, 'done', ['Done']);
  if (!section) throw new Error('Done section not found');
  const table = findTable(doc, section);
  if (!table) throw new Error('Done table not found');
  return { section, table };
}

function findUniqueById(table: TableLoc, taskId: string) {
  const idIdx = idColumnIndex(table.header);
  const matches = table.rows.filter((r) => (r.cells[idIdx] ?? '').trim() === taskId);
  if (matches.length !== 1) throw new StaleError();
  return matches[0];
}

function findUniqueProposal(table: TableLoc, proposal: string, by: string, date: string) {
  const pIdx = proposalColIndex(table.header, 'proposal');
  const bIdx = proposalColIndex(table.header, 'by');
  const dIdx = proposalColIndex(table.header, 'date');
  const matches = table.rows.filter(
    (r) =>
      (r.cells[pIdx] ?? '').trim() === proposal.trim() &&
      (r.cells[bIdx] ?? '').trim() === by.trim() &&
      (r.cells[dIdx] ?? '').trim() === date.trim(),
  );
  if (matches.length !== 1) throw new StaleError();
  return matches[0];
}

function openValueForHeader(
  header: string[],
  row: TrackerOpenRow,
  overrides: Partial<TrackerOpenRow> & { id?: string; status?: string },
): string[] {
  return header.map((h, i) => {
    const key = openColumnKey(header, i);
    if (key !== 'extra' && Object.hasOwn(overrides, key)) {
      return String(overrides[key as keyof typeof overrides] ?? '');
    }
    if (key !== 'extra') return String(row[key] ?? '');
    if (Object.hasOwn(overrides.extra ?? {}, h)) return overrides.extra![h]!;
    return row.extra[h] ?? '';
  });
}

function doneValueForHeader(
  header: string[],
  row: TrackerDoneRow,
  openExtra: Record<string, string>,
): string[] {
  return header.map((h, i) => {
    const key = doneColumnKey(header, i);
    if (key !== 'extra') return String(row[key] ?? '');
    const fromOpen = Object.keys(openExtra).find((k) => k.trim().toLowerCase() === h.trim().toLowerCase());
    if (fromOpen !== undefined) return openExtra[fromOpen]!;
    return row.extra[h] ?? '';
  });
}

function openRowFromCells(header: string[], cells: string[]): TrackerOpenRow {
  const row: TrackerOpenRow = {
    id: '',
    status: '⚪',
    goal: '',
    doneWhen: '',
    owner: '',
    nextVerification: '',
    evidence: '',
    extra: {},
  };
  header.forEach((h, i) => {
    const value = (cells[i] ?? '').trim();
    const key = openColumnKey(header, i);
    if (key === 'extra') row.extra[h] = value;
    else if (key === 'status') row.status = value as TrackerOpenRow['status'];
    else if (key === 'id') row.id = value;
    else row[key] = value;
  });
  return row;
}

export function promoteProposalToOpen(params: {
  trackerMarkdown: string;
  logMarkdown: string;
  proposalText: string;
  proposalBy: string;
  proposalDate: string;
  person: string;
  owner: string;
  doneWhen: string;
  nextVerification: string;
  dateIso: string;
}): { trackerMarkdown: string; logMarkdown: string; assignedId: string } {
  validateHumanActor(params.person);
  if (!params.owner?.trim()) throw new Error('owner must be specified');
  if (!params.doneWhen?.trim()) throw new Error('doneWhen must be specified');
  if (!params.nextVerification?.trim()) throw new Error('nextVerification must be specified');

  let doc = parseDoc(params.trackerMarkdown);
  const { table: propTable } = findProposalTable(doc);
  const proposalRow = findUniqueProposal(
    propTable,
    params.proposalText,
    params.proposalBy,
    params.proposalDate,
  );

  const { table: openTable } = findOpenTable(doc);
  const assignedId = computeNextTrackerId(params.trackerMarkdown, params.logMarkdown);
  const person = params.person.trim();

  const proposalCells = proposalRow.cells;
  const pIdx = proposalColIndex(propTable.header, 'proposal');
  const proposalText = (proposalCells[pIdx] ?? '').trim();

  const namedOpen = headersMatchCanonical(openTable.header, OPEN_COLUMNS);
  const template: TrackerOpenRow = {
    id: assignedId,
    status: '⚪',
    goal: proposalText,
    doneWhen: params.doneWhen.trim(),
    owner: params.owner.trim(),
    nextVerification: params.nextVerification.trim(),
    evidence: `promoted by ${person} ${params.dateIso}`,
    extra: {},
  };
  openTable.header.forEach((h, i) => {
    if (namedOpen) {
      if (!OPEN_KEYS[h.trim().toLowerCase()]) template.extra[h] = '';
    } else if (i >= OPEN_COLUMNS.length) {
      template.extra[h] = '';
    }
  });

  const newCells = openValueForHeader(openTable.header, template, template);

  doc = removeLine(doc, proposalRow.line);
  const openAfterRemoval = findOpenTable(doc).table;
  const insertAfter =
    openAfterRemoval.rows.length > 0
      ? openAfterRemoval.rows[openAfterRemoval.rows.length - 1]!.line
      : openAfterRemoval.delimLine;
  doc = insertRow(doc, insertAfter, newCells);

  const logMarkdown = appendLogEntry({
    logMarkdown: params.logMarkdown,
    date: params.dateIso,
    title: `Promote proposal to ${assignedId}`,
    what: `${person} promoted proposal "${proposalText}" to ${assignedId}`,
    evidence: `promoted by ${person} ${params.dateIso}`,
    ids: [assignedId],
  });

  return {
    trackerMarkdown: renderDoc(doc),
    logMarkdown,
    assignedId,
  };
}

export function closeTrackerItemHumanUnproven(params: {
  trackerMarkdown: string;
  logMarkdown: string;
  taskId: string;
  person: string;
  notProvenReason: string;
  closureSource: string;
  dateIso: string;
}): { trackerMarkdown: string; logMarkdown: string } {
  validateHumanActor(params.person);
  validateNotProvenReason(params.notProvenReason);
  if (!params.closureSource?.trim()) {
    throw new Error('Closure requires a closureSource (where the person decided: message, meeting, PR...)');
  }

  let doc = parseDoc(params.trackerMarkdown);
  const tracker = parseTrackerMarkdown(params.trackerMarkdown);
  const { table: openTable } = findOpenTable(doc);
  const openMatch = findUniqueById(openTable, params.taskId);
  assertRowWidth(openTable, openMatch, params.taskId);

  const openRow = openRowFromCells(openTable.header, openMatch.cells);
  const person = params.person.trim();
  const reason = params.notProvenReason.trim();

  const closedExtra: Record<string, string> = {};
  for (const header of tracker.doneHeader) {
    const source = Object.keys(openRow.extra).find((k) => k.trim().toLowerCase() === header.trim().toLowerCase());
    if (source !== undefined) closedExtra[header] = openRow.extra[source];
  }

  const closedRow: TrackerDoneRow = {
    id: openRow.id,
    status: '⚫',
    goal: openRow.goal,
    closed: params.dateIso,
    criteriaMet: `closed by ${person} ${params.dateIso}; not proven: ${reason}`,
    evidence: params.closureSource.trim(),
    extra: closedExtra,
  };

  doc = removeLine(doc, openMatch.line);
  const { table: doneTable } = findDoneTable(doc);
  const doneCells = doneValueForHeader(doneTable.header, closedRow, openRow.extra);
  doc = insertRow(doc, doneTable.delimLine, doneCells);

  const logMarkdown = appendLogEntry({
    logMarkdown: params.logMarkdown,
    date: params.dateIso,
    title: `Close ${openRow.id} without proof`,
    what: `${person} closed ${openRow.id} without proof: ${reason}`,
    evidence: params.closureSource.trim(),
    ids: [openRow.id],
  });

  return { trackerMarkdown: renderDoc(doc), logMarkdown };
}

export function updateOpenRowField(params: {
  trackerMarkdown: string;
  id: string;
  field: string;
  value: string;
}): { trackerMarkdown: string } {
  let doc = parseDoc(params.trackerMarkdown);
  const { table } = findOpenTable(doc);
  const rowMatch = findUniqueById(table, params.id);
  assertRowWidth(table, rowMatch, params.id);

  const wanted = params.field.trim().toLowerCase();
  if (wanted === 'id' || wanted === 'status') {
    throw new Error(`Column '${params.field}' cannot be edited here`);
  }

  const named = headersMatchCanonical(table.header, OPEN_COLUMNS);
  let col: number;
  if (named) {
    col = table.header.findIndex((h) => h.trim().toLowerCase() === wanted);
  } else {
    const positional = canonicalOpenFieldIndex(params.field);
    if (positional !== undefined) col = positional;
    else col = table.header.findIndex((h) => h.trim().toLowerCase() === wanted);
  }
  if (col === -1) throw new Error(`Column '${params.field}' not found in the Open table`);

  const cells = rowMatch.cells.slice();
  while (cells.length < table.header.length) cells.push('');
  cells[col] = params.value.trim();

  doc = setCells(doc, rowMatch.line, cells);
  return { trackerMarkdown: renderDoc(doc) };
}

function appendUnderApproval(doc: Doc, line: string): Doc {
  const section = findSection(doc, 'approval', ['Approval']);
  if (!section) {
    throw new Error('Approval section not found');
  }
  let last = section.end - 1;
  while (last > section.start && !doc.lines[last]?.trim()) last--;
  return insertLines(doc, last + 1, [line]);
}

function decideDecision(
  params: {
    decisionMarkdown: string;
    logMarkdown: string;
    person: string;
    whereContext: string;
    dateIso: string;
  },
  verdict: 'accepted' | 'rejected',
): { decisionMarkdown: string; logMarkdown: string } {
  validateHumanActor(params.person);
  if (!params.whereContext?.trim()) {
    throw new Error('whereContext must be specified');
  }

  const parsed = parseFrontmatter(params.decisionMarkdown);
  if (parsed.fields.status !== 'proposed') {
    throw new Error(
      `Decision can only be ${verdict} from proposed (current status: ${parsed.fields.status || 'none'})`,
    );
  }

  const person = params.person.trim();
  const where = params.whereContext.trim();
  let title = parsed.fields.title || '';
  if (!title) {
    const headingMatch = parsed.body.match(/^#\s+(.*)$/m);
    title = headingMatch ? headingMatch[1].trim() : 'Decision';
  }

  let doc = parseDoc(params.decisionMarkdown);
  const fmEnd = doc.lines.indexOf('---', 1);
  if (doc.lines[0] !== '---' || fmEnd === -1) {
    throw new Error('Decision page has no frontmatter');
  }
  const lines = doc.lines.slice();
  let statusLine = -1;
  for (let i = 1; i < fmEnd; i++) {
    if (/^status:/.test(lines[i]!)) {
      statusLine = i;
      lines[i] = `status: ${verdict}`;
      break;
    }
  }
  if (statusLine === -1) {
    lines.splice(fmEnd, 0, `status: ${verdict}`);
  }
  doc = { ...doc, lines };
  doc = appendUnderApproval(doc, `${verdict}: ${person}, ${where}, ${params.dateIso}`);

  const logMarkdown = appendLogEntry({
    logMarkdown: params.logMarkdown,
    date: params.dateIso,
    title: `${verdict === 'accepted' ? 'Accept' : 'Reject'} decision ${title}`,
    what: `${person} ${verdict} decision ${title}`,
    evidence: where,
    ids: [],
  });

  return { decisionMarkdown: renderDoc(doc), logMarkdown };
}

export function acceptDecisionHuman(params: {
  decisionMarkdown: string;
  logMarkdown: string;
  person: string;
  whereContext: string;
  dateIso: string;
}): { decisionMarkdown: string; logMarkdown: string } {
  return decideDecision(params, 'accepted');
}

export function rejectDecisionHuman(params: {
  decisionMarkdown: string;
  logMarkdown: string;
  person: string;
  whereContext: string;
  dateIso: string;
}): { decisionMarkdown: string; logMarkdown: string } {
  return decideDecision(params, 'rejected');
}

function normalizeAtIso(at: string): string {
  return at.replace(/\.\d{3}Z$/, 'Z');
}

function formatAttribution(a: Attribution): string {
  return `{ by: ${a.by}, at: ${normalizeAtIso(a.at)}${a.commit ? `, commit: ${a.commit}` : ''} }`;
}

function splitFlowMaps(inner: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        entries.push(inner.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return entries;
}

function flowMapsOnVerifiedLine(line: string): string[] {
  const value = line.replace(/^verified:\s*/, '').trim();
  if (!value) return [];
  if (value.startsWith('[')) {
    const close = value.lastIndexOf(']');
  if (close < 0) {
      throw new Error('Il frontmatter verified non è leggibile: correggilo a mano nel file.');
    }
    return splitFlowMaps(value.slice(1, close));
  }
  if (value.startsWith('{')) return [value];
  return [];
}

function verifiedRegionEnd(lines: string[], start: number, fmEnd: number): number {
  let end = start + 1;
  while (end < fmEnd) {
    const line = lines[end]!;
    if (/^\s*-\s/.test(line)) {
      end++;
      while (end < fmEnd && /^\s{2,}\S/.test(lines[end]!) && !/^\s*-\s/.test(lines[end]!)) {
        end++;
      }
      continue;
    }
    if (/^[a-zA-Z0-9_-]+:/.test(line)) break;
    break;
  }
  return end;
}

function blockEntryToFlow(entryLines: string[]): string {
  const first = entryLines[0]!.replace(/^\s*-\s+/, '').trim();
  if (first.startsWith('{')) return first;
  const map: Record<string, string> = {};
  const head = first.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
  if (head) map[head[1]] = head[2].trim();
  for (let i = 1; i < entryLines.length; i++) {
    const cont = entryLines[i]!.match(/^\s+([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (cont) map[cont[1]] = cont[2].trim();
  }
  const parsed = toAttribution(map);
  if (!parsed) {
    throw new Error('Il frontmatter verified non è leggibile: correggilo a mano nel file.');
  }
  return formatAttribution(parsed);
}

function readVerifiedVerbatim(lines: string[], fmEnd: number): string[] {
  const start = lines.findIndex((l, i) => i > 0 && i < fmEnd && /^verified:/.test(l));
  if (start === -1) return [];

  const inline = flowMapsOnVerifiedLine(lines[start]!);
  if (inline.length > 0) return inline;

  const regionEnd = verifiedRegionEnd(lines, start, fmEnd);
  const entries: string[] = [];
  let i = start + 1;
  while (i < regionEnd) {
    if (!/^\s*-\s/.test(lines[i]!)) break;
    const block: string[] = [lines[i]!];
    i++;
    while (i < regionEnd && /^\s{2,}\S/.test(lines[i]!) && !/^\s*-\s/.test(lines[i]!)) {
      block.push(lines[i]!);
      i++;
    }
    entries.push(blockEntryToFlow(block));
  }
  return entries;
}

function setVerifiedFrontmatter(doc: Doc, newEntry: Attribution): Doc {
  const lines = doc.lines;
  const end = lines.indexOf('---', 1);
  if (lines[0] !== '---' || end === -1) {
    throw new Error('Page has no frontmatter to record a review in');
  }

  const existing = readVerifiedVerbatim(lines, end);
  const merged = [...existing, formatAttribution(newEntry)];
  const value = merged.length === 1 ? merged[0]! : `[${merged.join(', ')}]`;
  const block = `verified: ${value}`;

  const start = lines.findIndex((l, i) => i > 0 && i < end && /^verified:/.test(l));
  const newLines = lines.slice();
  if (start === -1) {
    newLines.splice(end, 0, block);
  } else {
    const stop = verifiedRegionEnd(newLines, start, end);
    newLines.splice(start, stop - start, block);
  }
  return { ...doc, lines: newLines };
}

export function markPageReviewed(params: {
  pageMarkdown: string;
  logMarkdown: string;
  person: string;
  atIso: string;
  commit: string;
}): { pageMarkdown: string; logMarkdown: string } {
  validateHumanActor(params.person);
  const person = params.person.trim();
  const commit = params.commit.trim();
  const id = personId(person);
  if (!id) {
    throw new Error('Human authority required: person name yields an empty id');
  }
  const page = parseFrontmatter(params.pageMarkdown);

  const entry: Attribution = { by: `human:${id}`, at: normalizeAtIso(params.atIso) };
  if (commit) entry.commit = commit;

  let doc = parseDoc(params.pageMarkdown);
  doc = setVerifiedFrontmatter(doc, entry);
  const title = page.fields.title || 'page';
  const logMarkdown = appendLogEntry({
    logMarkdown: params.logMarkdown,
    date: todayLocal(),
    title: 'Mark page reviewed',
    what: `${person} marked page "${title}" reviewed`,
    evidence: commit ? `commit ${commit}` : 'human review',
    ids: [],
  });

  return { pageMarkdown: renderDoc(doc), logMarkdown };
}
