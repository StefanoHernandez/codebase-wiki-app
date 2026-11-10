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
