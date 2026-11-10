export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type CoreRole =
  | 'index'
  | 'log'
  | 'log-archive'
  | 'tracker'
  | 'decisions'
  | 'risks'
  | 'context'
  | 'handoff'
  | 'troubleshooting'
  | 'glossary';

export interface ParsedFrontmatter {
  fields: Record<string, string>;
  sources: string[];
  hasFrontmatter: boolean;
  bodyOffsetLine: number;
  body: string;
}

export interface SchemaBudgets {
  singlePageBytes: number;
  coreReadBytes: number;
  logBytes: number;
}

export interface SchemaTopic {
  name: string;
  path: string;
  description: string;
}

export interface SchemaConfig {
  language: string;
  projectDivision: string;
  sensitiveData: boolean;
  agentEntryFile: string;
  coreMap: Record<string, string>;
  budgets: SchemaBudgets;
  topics: SchemaTopic[];
  excludedGlobs: string[];
}

export interface TrackerOpenRow {
  id: string;
  status: '🟡' | '⚪' | '🔴';
  goal: string;
  doneWhen: string;
  owner: string;
  nextVerification: string;
  evidence: string;
}

export interface TrackerProposalRow {
  proposal: string;
  by: string;
  date: string;
  why: string;
}

export interface TrackerDoneRow {
  id: string;
  status: '🟢' | '⚫';
  goal: string;
  closed: string;
  criteriaMet: string;
  evidence: string;
}

export interface TrackerData {
  open: TrackerOpenRow[];
  proposals: TrackerProposalRow[];
  done: TrackerDoneRow[];
}

export interface BatonRow {
  order: string;
  task: string;
  startFiles: string;
  doneWhen: string;
  verificationCommand: string;
  notes: string;
}

export interface HandoffData {
  stateBullets: Record<string, string>;
  baton: BatonRow[];
  noOpenWork: boolean;
  blockers: Array<Record<string, string>>;
}
