import { parseFrontmatter, updateFrontmatterFields } from './frontmatter.ts';
import {
  parseTrackerMarkdown,
  computeNextTrackerId,
  formatTrackerOpenTable,
  formatTrackerProposalTable,
  formatTrackerDoneTable,
  replaceSectionTable,
} from './markdown-tables.ts';
import type { TrackerOpenRow, TrackerDoneRow } from '../types/wiki.ts';

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

export function promoteProposalToOpen(params: {
  trackerMarkdown: string;
  logMarkdown: string;
  proposalIndex: number;
  person: string;
  owner: string;
  doneWhen: string;
  nextVerification: string;
  dateIso: string;
  shortSha: string;
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

  const proposal = tracker.proposals[params.proposalIndex];
  const assignedId = computeNextTrackerId(params.trackerMarkdown, params.logMarkdown);

  const newOpenRow: TrackerOpenRow = {
    id: assignedId,
    status: '⚪',
    goal: proposal.proposal,
    doneWhen: params.doneWhen.trim(),
    owner: params.owner.trim(),
    nextVerification: params.nextVerification.trim(),
    evidence: `commit ${params.shortSha}`,
  };

  const updatedOpen = [...tracker.open, newOpenRow];
  const updatedProposals = tracker.proposals.filter((_, idx) => idx !== params.proposalIndex);

  let updatedTracker = replaceSectionTable(
    params.trackerMarkdown,
    'open',
    'Open',
    formatTrackerOpenTable(updatedOpen)
  );
  updatedTracker = replaceSectionTable(
    updatedTracker,
    'proposals',
    'Proposals',
    formatTrackerProposalTable(updatedProposals)
  );

  updatedTracker = updateFrontmatterFields(updatedTracker, {
    source_commit: params.shortSha,
    updated: params.dateIso,
  });

  const logEntry = [
    '',
    `## ${params.dateIso} · Promote proposal to ${assignedId} · human`,
    `- What: Promoted proposal "${proposal.proposal}" to ${assignedId}`,
    `- By: ${params.person}`,
    `- Owner: ${params.owner.trim()}`,
    `- Evidence: manual review @${params.shortSha}`,
    `- IDs: ${assignedId}`,
    '',
  ].join('\n');

  let updatedLog = params.logMarkdown.trimEnd() + '\n' + logEntry;
  updatedLog = updateFrontmatterFields(updatedLog, {
    source_commit: params.shortSha,
    updated: params.dateIso,
  });

  return {
    trackerMarkdown: updatedTracker,
    logMarkdown: updatedLog,
    assignedId,
  };
}

export function closeTrackerItemHumanUnproven(params: {
  trackerMarkdown: string;
  logMarkdown: string;
  taskId: string;
  person: string;
  notProvenReason: string;
  dateIso: string;
  shortSha: string;
}): { trackerMarkdown: string; logMarkdown: string } {
  validateHumanActor(params.person);
  validateNotProvenReason(params.notProvenReason);

  const tracker = parseTrackerMarkdown(params.trackerMarkdown);
  const openIndex = tracker.open.findIndex((r) => r.id === params.taskId);
  if (openIndex === -1) {
    throw new Error(`Task ${params.taskId} not found in open tracker`);
  }

  const openRow = tracker.open[openIndex];
  const updatedOpen = tracker.open.filter((_, idx) => idx !== openIndex);

  const cleanEvidence =
    openRow.evidence && !DISALLOWED_ACTORS.has(openRow.evidence.trim().toLowerCase())
      ? openRow.evidence
      : `manual review @${params.shortSha}`;

  const closedRow: TrackerDoneRow = {
    id: openRow.id,
    status: '⚫',
    goal: openRow.goal,
    closed: params.dateIso,
    criteriaMet: `closed by ${params.person} ${params.dateIso}; not proven: ${params.notProvenReason.trim()}`,
    evidence: cleanEvidence,
  };

  const updatedDone = [...tracker.done, closedRow];

  let updatedTracker = replaceSectionTable(
    params.trackerMarkdown,
    'open',
    'Open',
    formatTrackerOpenTable(updatedOpen)
  );
  updatedTracker = replaceSectionTable(
    updatedTracker,
    'done',
    'Done',
    formatTrackerDoneTable(updatedDone)
  );

  updatedTracker = updateFrontmatterFields(updatedTracker, {
    source_commit: params.shortSha,
    updated: params.dateIso,
  });

  const logEntry = [
    '',
    `## ${params.dateIso} · Close ${params.taskId} without proof · human`,
    `- What: Closed ${params.taskId} without proof (${params.notProvenReason.trim()})`,
    `- By: ${params.person}`,
    `- Evidence: manual review @${params.shortSha}`,
    `- IDs: ${params.taskId}`,
    '',
  ].join('\n');

  let updatedLog = params.logMarkdown.trimEnd() + '\n' + logEntry;
  updatedLog = updateFrontmatterFields(updatedLog, {
    source_commit: params.shortSha,
    updated: params.dateIso,
  });

  return {
    trackerMarkdown: updatedTracker,
    logMarkdown: updatedLog,
  };
}

export function approveDecisionHuman(params: {
  decisionMarkdown: string;
  logMarkdown: string;
  person: string;
  whereContext: string;
  dateIso: string;
  shortSha: string;
}): { decisionMarkdown: string; logMarkdown: string } {
  validateHumanActor(params.person);
  if (!params.whereContext || !params.whereContext.trim()) {
    throw new Error('whereContext must be specified');
  }

  const parsedDecision = parseFrontmatter(params.decisionMarkdown);
  let title = parsedDecision.fields['title'] || '';
  if (!title) {
    const headingMatch = parsedDecision.body.match(/^#\s+(.*)$/m);
    title = headingMatch ? headingMatch[1].trim() : 'Decision';
  }

  let updatedDecision = updateFrontmatterFields(params.decisionMarkdown, {
    status: 'accepted',
    source_commit: params.shortSha,
    updated: params.dateIso,
  });

  const approvalLine = `accepted: approved by ${params.person.trim()} (${params.whereContext.trim()}) on ${params.dateIso}.`;

  const lines = updatedDecision.replace(/\r\n/g, '\n').split('\n');
  const approvalIdx = lines.findIndex((l) => l.trim().toLowerCase() === '## approval');

  if (approvalIdx !== -1) {
    let nextHeadingIdx = lines.findIndex(
      (l, idx) => idx > approvalIdx && l.trim().startsWith('## ')
    );
    if (nextHeadingIdx === -1) {
      nextHeadingIdx = lines.length;
    }
    lines.splice(approvalIdx + 1, nextHeadingIdx - (approvalIdx + 1), approvalLine);
    updatedDecision = lines.join('\n');
  } else {
    updatedDecision = updatedDecision.trimEnd() + `\n\n## Approval\n${approvalLine}\n`;
  }

  const logEntry = [
    '',
    `## ${params.dateIso} · Approve decision ${title} · human`,
    `- What: Approved decision ${title}`,
    `- By: ${params.person} (${params.whereContext.trim()})`,
    `- Evidence: manual review @${params.shortSha}`,
    `- Decisions: ${title}`,
    '',
  ].join('\n');

  let updatedLog = params.logMarkdown.trimEnd() + '\n' + logEntry;
  updatedLog = updateFrontmatterFields(updatedLog, {
    source_commit: params.shortSha,
    updated: params.dateIso,
  });

  return {
    decisionMarkdown: updatedDecision,
    logMarkdown: updatedLog,
  };
}
