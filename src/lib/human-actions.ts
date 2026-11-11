import { parseFrontmatter, updateFrontmatterFields } from './frontmatter.ts';
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
  return header.map((h) => {
    const key = OPEN_KEYS[h.trim().toLowerCase()];
    if (key && key !== 'extra' && Object.hasOwn(overrides, key)) {
      return String(overrides[key as keyof typeof overrides] ?? '');
    }
    if (key && key !== 'extra') return String(row[key] ?? '');
    if (Object.hasOwn(overrides.extra ?? {}, h)) return overrides.extra![h];
    return row.extra[h] ?? '';
  });
}

function doneValueForHeader(
  header: string[],
  row: TrackerDoneRow,
  openExtra: Record<string, string>,
): string[] {
  return header.map((h) => {
    const key = DONE_KEYS[h.trim().toLowerCase()];
    if (key && key !== 'extra') return String(row[key] ?? '');
    const fromOpen = Object.keys(openExtra).find((k) => k.trim().toLowerCase() === h.trim().toLowerCase());
    if (fromOpen !== undefined) return openExtra[fromOpen];
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
  const lower = header.map((h) => h.trim().toLowerCase());
  const named = OPEN_COLUMNS.every((c) => lower.includes(c.toLowerCase()));
  header.forEach((h, i) => {
    const value = (cells[i] ?? '').trim();
    const lk = h.trim().toLowerCase();
    if (named) {
      const key = OPEN_KEYS[lk];
      if (key === 'id') row.id = value;
      else if (key === 'status') row.status = value as TrackerOpenRow['status'];
      else if (key === 'goal') row.goal = value;
      else if (key === 'doneWhen') row.doneWhen = value;
      else if (key === 'owner') row.owner = value;
      else if (key === 'nextVerification') row.nextVerification = value;
      else if (key === 'evidence') row.evidence = value;
      else row.extra[h] = value;
    } else {
      const pos = OPEN_COLUMNS.map((c) => c.toLowerCase()).indexOf(lk);
      if (pos >= 0) {
        const prop = ['id', 'status', 'goal', 'doneWhen', 'owner', 'nextVerification', 'evidence'][pos];
        if (prop === 'status') row.status = value as TrackerOpenRow['status'];
        else if (prop === 'id') row.id = value;
        else if (prop === 'goal') row.goal = value;
        else if (prop === 'doneWhen') row.doneWhen = value;
        else if (prop === 'owner') row.owner = value;
        else if (prop === 'nextVerification') row.nextVerification = value;
        else if (prop === 'evidence') row.evidence = value;
      } else row.extra[h] = value;
    }
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

  const namedOpen = OPEN_COLUMNS.every((c) =>
    openTable.header.some((h) => h.trim().toLowerCase() === c.toLowerCase()),
  );
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
  if (!namedOpen) {
    openTable.header.forEach((h, i) => {
      if (!OPEN_KEYS[h.trim().toLowerCase()]) template.extra[h] = '';
    });
  } else {
    openTable.header.forEach((h) => {
      if (!OPEN_KEYS[h.trim().toLowerCase()]) template.extra[h] = '';
    });
  }

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
  const tracker = parseTrackerMarkdown(params.trackerMarkdown);
  const { table } = findOpenTable(doc);
  const rowMatch = findUniqueById(table, params.id);
  assertRowWidth(table, rowMatch, params.id);

  const wanted = params.field.trim().toLowerCase();
  if (wanted === 'id' || wanted === 'status') {
    throw new Error(`Column '${params.field}' cannot be edited here`);
  }
  const header = tracker.openHeader.find((h) => h.trim().toLowerCase() === wanted);
  if (!header) {
    throw new Error(`Column '${params.field}' not found in the Open table`);
  }

  const col = table.header.findIndex((h) => h.trim().toLowerCase() === wanted);
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

  const withStatus = updateFrontmatterFields(params.decisionMarkdown, { status: verdict });
  let doc = parseDoc(withStatus);
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

function setVerifiedFrontmatter(doc: Doc, entries: Attribution[]): Doc {
  const lines = doc.lines;
  const end = lines.indexOf('---', 1);
  if (lines[0] !== '---' || end === -1) {
    throw new Error('Page has no frontmatter to record a review in');
  }

  const value =
    entries.length === 1 ? formatAttribution(entries[0]) : `[${entries.map(formatAttribution).join(', ')}]`;
  const block = `verified: ${value}`;

  const start = lines.findIndex((l, i) => i > 0 && i < end && /^verified:/.test(l));
  const newLines = lines.slice();
  if (start === -1) {
    newLines.splice(end, 0, block);
  } else {
    let stop = start + 1;
    while (stop < end && /^\s+/.test(newLines[stop]!)) stop++;
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
  doc = setVerifiedFrontmatter(doc, [...page.verified, entry]);
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
