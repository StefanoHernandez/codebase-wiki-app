// Mirrors the camelCase serde output of wiki-core and src-tauri/src/commands.rs.

export interface GitState {
  headSha: string;
  branch: string;
  isDirty: boolean;
  dirtyFiles: string[];
  handoffCommitsBehind: number;
}

export interface WikiPageEntry {
  wikiRelPath: string;
  content: string;
  sizeBytes: number;
  readError?: string | null;
}

export interface WikiSnapshot {
  repoPath: string;
  wikiRoot: string | null;
  isInitialized: boolean;
  warning: string | null;
  gitState: GitState;
  pages: WikiPageEntry[];
  repoFiles: string[];
  changedFilesByPage: Record<string, string[]>;
}

export interface RepoFilePayload {
  relPath: string;
  content: string;
  diff: string;
}

export interface LintFinding {
  wikiRelPath: string;
  line: number;
  message: string;
}

export interface LintReport {
  exitCode: number;
  findings: LintFinding[];
  infos: string[];
  rawOutput: string;
}

export interface RecentProject {
  path: string;
  name: string;
}
