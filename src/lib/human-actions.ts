import { parseFrontmatter, updateFrontmatterFields } from './frontmatter.ts';
import {
  parseTrackerMarkdown,
  computeNextTrackerId,
  formatTrackerOpenTable,
  formatTrackerProposalTable,
  formatTrackerDoneTable,
  replaceSectionTable,
} from './markdown-tables.ts';
import type { Attribution, TrackerDoneRow, TrackerOpenRow } from '../types/wiki.ts';

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

/** Lowercase person name with spaces as dashes, used in `human:<id>` attributions. */
export function personId(person: string): string {
  return person.trim().toLowerCase().replace(/\s+/g, '-');
}

/** Appends one `## date · title · human` entry at the end of the log, separated by one blank line. */
export function appendLogEntry(params: {
  logMarkdown: string;
  date: string;
  title: string;
  what: string;
  evidence: string;
  ids: string[];
}): string {
  const entry = [
    `## ${params.date} · ${params.title} · human`,
    `- What: ${params.what}`,
    `- Evidence: ${params.evidence}`,
    `- IDs: ${params.ids.length > 0 ? params.ids.join(', ') : 'none'}`,
    '',
  ].join('\n');
  const previous = params.logMarkdown.trimEnd();
  return previous ? `${previous}\n\n${entry}` : entry;
}

export function promoteProposalToOpen(params: {
  trackerMarkdown: string;
  logMarkdown: string;
  proposalIndex: number;
  person: string;
  owner: string;
  doneWhen: string;
  nextVerification: string;
  dateIso: string;
}): { trackerMarkdown: string; logMarkdown: string; assignedId: string } {
  validateHumanActor(params.person);
  if (!params.owner || !params.owner.trim()) {
    throw new Error('owner must be specified');
  }
  if (!params.doneWhen || !params.doneWhen.trim()) {
    throw new Error('doneWhen must be specified');
  }
  if (!params.nextVerification || !params.nextVerification.trim()) {
    throw new Error('nextVerification must be specified');
  }

  const tracker = parseTrackerMarkdown(params.trackerMarkdown);
  if (params.proposalIndex < 0 || params.proposalIndex >= tracker.proposals.length) {
    throw new Error(
      `Proposal index ${params.proposalIndex} out of bounds (0-${tracker.proposals.length - 1})`
    );
  }

  const person = params.person.trim();
  const proposal = tracker.proposals[params.proposalIndex];
  const assignedId = computeNextTrackerId(params.trackerMarkdown, params.logMarkdown);

  const newOpenRow: TrackerOpenRow = {
    id: assignedId,
    status: '⚪',
    goal: proposal.proposal,
    doneWhen: params.doneWhen.trim(),
    owner: params.owner.trim(),
    nextVerification: params.nextVerification.trim(),
    evidence: `promoted by ${person} ${params.dateIso}`,
    extra: {},
  };

  const updatedOpen = [...tracker.open, newOpenRow];
  const updatedProposals = tracker.proposals.filter((_, idx) => idx !== params.proposalIndex);

  let updatedTracker = replaceSectionTable(
    params.trackerMarkdown,
    'open',
    'Open',
    formatTrackerOpenTable(updatedOpen, tracker.openHeader)
  );
  updatedTracker = replaceSectionTable(
    updatedTracker,
    'proposals',
    'Proposals',
    formatTrackerProposalTable(updatedProposals, tracker.proposalsHeader)
  );

  const logMarkdown = appendLogEntry({
    logMarkdown: params.logMarkdown,
    date: params.dateIso,
    title: `Promote proposal to ${assignedId}`,
    what: `${person} promoted proposal "${proposal.proposal}" to ${assignedId}`,
    evidence: `promoted by ${person} ${params.dateIso}`,
    ids: [assignedId],
  });

  return {
    trackerMarkdown: updatedTracker,
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
  if (!params.closureSource || !params.closureSource.trim()) {
    throw new Error('Closure requires a closureSource (where the person decided: message, meeting, PR...)');
  }

  const tracker = parseTrackerMarkdown(params.trackerMarkdown);
  const openIndex = tracker.open.findIndex((r) => r.id === params.taskId);
  if (openIndex === -1) {
    throw new Error(`Task ${params.taskId} not found in open tracker`);
  }

  const person = params.person.trim();
  const reason = params.notProvenReason.trim();
  const openRow = tracker.open[openIndex];
  const updatedOpen = tracker.open.filter((_, idx) => idx !== openIndex);

  // Copy Open extra values only into Done columns that already exist (headers matched case-insensitively).
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

  const updatedDone = [...tracker.done, closedRow];

  let updatedTracker = replaceSectionTable(
    params.trackerMarkdown,
    'open',
    'Open',
    formatTrackerOpenTable(updatedOpen, tracker.openHeader)
  );
  updatedTracker = replaceSectionTable(
    updatedTracker,
    'done',
    'Done',
    formatTrackerDoneTable(updatedDone, tracker.doneHeader)
  );

  const logMarkdown = appendLogEntry({
    logMarkdown: params.logMarkdown,
    date: params.dateIso,
    title: `Close ${openRow.id} without proof`,
    what: `${person} closed ${openRow.id} without proof: ${reason}`,
    evidence: params.closureSource.trim(),
    ids: [openRow.id],
  });

  return {
    trackerMarkdown: updatedTracker,
    logMarkdown,
  };
}

/** Sets one editable cell of an Open row: `owner`, `goal`, `done when`, `next verification`, `evidence` or an extra column. */
export function updateOpenRowField(params: {
  trackerMarkdown: string;
  id: string;
  field: string;
  value: string;
}): { trackerMarkdown: string } {
  const tracker = parseTrackerMarkdown(params.trackerMarkdown);
  const row = tracker.open.find((r) => r.id === params.id);
  if (!row) {
    throw new Error(`Task ${params.id} not found in open tracker`);
  }

  const wanted = params.field.trim().toLowerCase();
  if (wanted === 'id' || wanted === 'status') {
    throw new Error(`Column '${params.field}' cannot be edited here`);
  }
  const header = tracker.openHeader.find((h) => h.trim().toLowerCase() === wanted);
  if (!header) {
    throw new Error(`Column '${params.field}' not found in the Open table`);
  }

  const value = params.value.trim();
  const fieldProps: Record<string, 'owner' | 'goal' | 'doneWhen' | 'nextVerification' | 'evidence'> = {
    owner: 'owner',
    goal: 'goal',
    'done when': 'doneWhen',
    'next verification': 'nextVerification',
    evidence: 'evidence',
  };
  if (Object.hasOwn(fieldProps, wanted)) {
    row[fieldProps[wanted]] = value;
  } else {
    row.extra[header] = value;
  }

  return {
    trackerMarkdown: replaceSectionTable(
      params.trackerMarkdown,
      'open',
      'Open',
      formatTrackerOpenTable(tracker.open, tracker.openHeader)
    ),
  };
}

function appendUnderApproval(markdown: string, line: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const approvalIdx = lines.findIndex((l) => l.trim().toLowerCase() === '## approval');
  if (approvalIdx === -1) {
    return markdown.trimEnd() + `\n\n## Approval\n${line}\n`;
  }
  let nextHeadingIdx = lines.findIndex((l, idx) => idx > approvalIdx && l.trim().startsWith('## '));
  if (nextHeadingIdx === -1) {
    nextHeadingIdx = lines.length;
  }
  let lastContent = nextHeadingIdx - 1;
  while (lastContent > approvalIdx && !lines[lastContent].trim()) {
    lastContent--;
  }
  lines.splice(lastContent + 1, 0, line);
  return lines.join('\n');
}

function decideDecision(
  params: {
    decisionMarkdown: string;
    logMarkdown: string;
    person: string;
    whereContext: string;
    dateIso: string;
  },
  verdict: 'accepted' | 'rejected'
): { decisionMarkdown: string; logMarkdown: string } {
  validateHumanActor(params.person);
  if (!params.whereContext || !params.whereContext.trim()) {
    throw new Error('whereContext must be specified');
  }

  const parsed = parseFrontmatter(params.decisionMarkdown);
  if (parsed.fields.status !== 'proposed') {
    throw new Error(
      `Decision can only be ${verdict} from proposed (current status: ${parsed.fields.status || 'none'})`
    );
  }

  const person = params.person.trim();
  const where = params.whereContext.trim();
  let title = parsed.fields.title || '';
  if (!title) {
    const headingMatch = parsed.body.match(/^#\s+(.*)$/m);
    title = headingMatch ? headingMatch[1].trim() : 'Decision';
  }

  const decisionMarkdown = appendUnderApproval(
    updateFrontmatterFields(params.decisionMarkdown, { status: verdict }),
    `${verdict}: ${person}, ${where}, ${params.dateIso}`
  );

  const logMarkdown = appendLogEntry({
    logMarkdown: params.logMarkdown,
    date: params.dateIso,
    title: `${verdict === 'accepted' ? 'Accept' : 'Reject'} decision ${title}`,
    what: `${person} ${verdict} decision ${title}`,
    evidence: where,
    ids: [],
  });

  return { decisionMarkdown, logMarkdown };
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

function formatAttribution(a: Attribution): string {
  return `{ by: ${a.by}, at: ${a.at}${a.commit ? `, commit: ${a.commit}` : ''} }`;
}

/** Replaces the `verified:` frontmatter key with a single line (the validator reads one-line values only). */
function setVerifiedFrontmatter(markdown: string, entries: Attribution[]): string {
  const bom = markdown.startsWith('﻿') ? '﻿' : '';
  const lines = markdown.slice(bom.length).replace(/\r\n/g, '\n').split('\n');
  const end = lines.indexOf('---', 1);
  if (lines[0] !== '---' || end === -1) {
    throw new Error('Page has no frontmatter to record a review in');
  }

  // One line: a single inline map, or a flow list when there are several.
  const value =
    entries.length === 1 ? formatAttribution(entries[0]) : `[${entries.map(formatAttribution).join(', ')}]`;
  const block = [`verified: ${value}`];

  const start = lines.findIndex((l, i) => i > 0 && i < end && /^verified:/.test(l));
  if (start === -1) {
    lines.splice(end, 0, ...block);
  } else {
    let stop = start + 1;
    while (stop < end && /^\s+/.test(lines[stop])) stop++;
    lines.splice(start, stop - start, ...block);
  }
  return bom + lines.join('\n');
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
  const page = parseFrontmatter(params.pageMarkdown);

  const entry: Attribution = { by: `human:${personId(person)}`, at: params.atIso };
  if (commit) entry.commit = commit;

  const pageMarkdown = setVerifiedFrontmatter(params.pageMarkdown, [...page.verified, entry]);
  const title = page.fields.title || 'page';
  const logMarkdown = appendLogEntry({
    logMarkdown: params.logMarkdown,
    date: params.atIso.slice(0, 10),
    title: 'Mark page reviewed',
    what: `${person} marked page "${title}" reviewed`,
    evidence: commit ? `commit ${commit}` : 'human review',
    ids: [],
  });

  return { pageMarkdown, logMarkdown };
}
