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

/** What the current wiki format still needs (validator `upgrade`). Never a finding. */
export interface LintUpgrade {
  wikiRelPath?: string | null;
  line?: number | null;
  code: string;
  message: string;
  /** 'adopt' (run /wiki-init --adopt) or 'update-plugin'. */
  fix: string;
}

export interface LintInfo {
  wikiRelPath?: string | null;
  line?: number | null;
  code: string;
  message: string;
}

/** validate-wiki.py `--json` document (0.13.0+). `error` set → the validator did not run; lists are empty. */
export interface LintReport {
  exitCode: number;
  validator?: string | null;
  format?: string | null;
  wiki?: string | null;
  error?: string | null;
  findings: LintFinding[];
  upgrades: LintUpgrade[];
  infos: LintInfo[];
  rawOutput: string;
}

export interface RecentProject {
  path: string;
  name: string;
  /** Epoch ms of the last visit (baseline for news). */
  lastSeenAt?: number | null;
  lastSeenCommit?: string | null;
  lastSeenLogEntries?: number | null;
}

export interface ProjectNews {
  /** Wiki commit subjects since the last visit; null when git cannot tell. */
  commits: string[] | null;
  lastSeenLogEntries: number | null;
  lastSeenAt: number | null;
}

/** One MCP tool call from the activity log. `ts` is epoch ms. */
export interface ActivityLine {
  ts: number;
  repo: string | null;
  agent: string;
  tool: string;
  query: string | null;
  top: string[];
  ms: number;
  error: string | null;
}
