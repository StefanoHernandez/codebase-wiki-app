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

export interface Attribution {
  by: string;
  at: string;
  commit?: string;
}

export interface ParsedFrontmatter {
  fields: Record<string, string>;
  sources: string[];
  generated?: Attribution;
  verified: Attribution[];
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
  /** SCHEMA Project profile `Log order`; default oldest-first. */
  logOrder: 'oldest-first' | 'newest-first';
  coreMap: Record<string, string>;
  /** SCHEMA has a `## Core map` (or `<!-- wiki:core-map -->`). Without it the wiki is v1. */
  hasCoreMap: boolean;
  budgets: SchemaBudgets;
  topics: SchemaTopic[];
  excludedGlobs: string[];
  /** `Path | type` rows from `## Page types`, then `## Page frontmatter`; first match wins. */
  pageTypes: PageTypeRule[];
}

export interface PageTypeRule {
  glob: string;
  type: string;
}

export interface TrackerOpenRow {
  id: string;
  status: '🟡' | '⚪' | '🔴';
  goal: string;
  doneWhen: string;
  owner: string;
  nextVerification: string;
  evidence: string;
  extra: Record<string, string>;
}

export interface TrackerProposalRow {
  proposal: string;
  by: string;
  date: string;
  why: string;
  extra: Record<string, string>;
}

export interface TrackerDoneRow {
  id: string;
  status: '🟢' | '⚫';
  goal: string;
  closed: string;
  criteriaMet: string;
  evidence: string;
  extra: Record<string, string>;
}

export interface TrackerData {
  open: TrackerOpenRow[];
  proposals: TrackerProposalRow[];
  done: TrackerDoneRow[];
  /** Header of each section as written in the file (extra columns included). */
  openHeader: string[];
  proposalsHeader: string[];
  doneHeader: string[];
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

export type GraphNodeCategory = 'core' | 'decision' | 'tracker' | 'agent' | 'topic' | 'source';

export interface GraphNode {
  id: string;
  label: string;
  path: string;
  kind: 'wiki' | 'source';
  category: GraphNodeCategory;
  role?: string;
  confidence?: string;
  sourceCommit?: string;
  hasDrift: boolean;
  driftFiles: string[];
  hasLintError: boolean;
  lintCount: number;
  needsReverify: boolean;
  isOrphan: boolean;
  sizeBytes: number;
  degree: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: 'markdown-link' | 'source-link';
}

export interface WikiGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  backlinks: Record<string, string[]>;
  uncoveredRepoFiles: string[];
}

export interface GraphFilterOptions {
  includeCodeSources: boolean;
  onlyDriftOrErrors: boolean;
  searchQuery: string;
  focusNodeId?: string;
  localGraphHops?: number;
}


export type DecisionStatus = 'proposed' | 'accepted' | 'rejected' | 'superseded' | 'unknown';

export interface Decision {
  relPath: string;
  number: string;
  slug: string;
  title: string;
  status: DecisionStatus;
  supersededBy?: string;
  approvalLines: string[];
}
