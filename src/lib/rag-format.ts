import { locale, t } from '../i18n/index.ts';

export type IndexStatus = {
  model?: string;
  indexed?: boolean;
  indexedModel?: string | null;
  error?: string | null;
  files?: number;
  chunks?: number;
  indexedHead?: string | null;
  head?: string | null;
  changedSinceIndex?: number;
  staleInstall?: boolean;
  /** Per source (`code`, `wiki`): files and chunks. */
  bySource?: Record<string, { files: number; chunks: number }>;
  sizeBytes?: number;
  /** Unix seconds of the last write to the index. */
  indexedAt?: number | null;
  /** Installed reranker id, if any. */
  reranker?: string | null;
};

/** `status --json` (snake_case) → IndexStatus. */
export function parseIndexStatus(raw: Record<string, unknown>): IndexStatus {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    model: str(raw.model) ?? undefined,
    indexed: raw.indexed === true,
    indexedModel: str(raw.indexed_model),
    error: str(raw.error),
    files: Number(raw.files ?? 0),
    chunks: Number(raw.chunks ?? 0),
    indexedHead: str(raw.indexed_head),
    head: str(raw.head),
    changedSinceIndex: Number(raw.changed_since_index ?? 0),
    staleInstall: raw.stale_install === true,
    bySource: (raw.by_source as IndexStatus['bySource']) ?? {},
    sizeBytes: Number(raw.size_bytes ?? 0),
    indexedAt: typeof raw.indexed_at === 'number' ? raw.indexed_at : null,
    reranker: str(raw.reranker),
  };
}

export function formatIndexState(status: IndexStatus | null): string {
  if (!status) return t('esplora.rag.noIndex');
  if (status.indexed === false && status.error) return status.error;
  const ih = shortSha(status.indexedHead);
  const h = shortSha(status.head);
  const changed = status.changedSinceIndex ?? 0;
  const model = status.model ?? '—';
  const files = status.files ?? 0;
  const chunks = status.chunks ?? 0;
  return t('esplora.rag.state', { model, files, chunks, ih, h, changed });
}

function shortSha(s?: string | null): string {
  if (!s) return '—';
  return s.slice(0, 7);
}

export type RagProgress = { phase: string; done: number; total: number };

export type RagJobState = {
  running: boolean;
  progress: RagProgress | null;
  error: string | null;
};

export function reduceRagProgress(prev: RagProgress | null, line: string): { progress: RagProgress | null; error: string | null; done: boolean } {
  try {
    const j = JSON.parse(line) as Record<string, unknown>;
    if (j.event === 'error' && typeof j.message === 'string') {
      return { progress: prev, error: j.message, done: true };
    }
    if (j.event === 'exit') {
      return { progress: prev, error: null, done: true };
    }
    if (j.event === 'done') {
      return { progress: prev, error: null, done: true };
    }
    if (j.event === 'phase' && typeof j.phase === 'string' && typeof j.total === 'number') {
      return {
        progress: { phase: j.phase, done: 0, total: j.total },
        error: null,
        done: false,
      };
    }
    if (j.event === 'progress' && typeof j.phase === 'string' && typeof j.done === 'number') {
      const total = typeof j.total === 'number' ? j.total : prev?.total ?? 0;
      return {
        progress: { phase: j.phase, done: j.done, total },
        error: null,
        done: false,
      };
    }
  } catch {
    return { progress: prev, error: null, done: false };
  }
  return { progress: prev, error: null, done: false };
}

export type AutoIndexStatus = {
  indexed?: boolean;
  changedSinceIndex?: number;
  head?: string | null;
  indexedHead?: string | null;
};

export function shouldAutoIndex(
  status: AutoIndexStatus | null,
  indexRunning: boolean,
  downloadRunning: boolean,
  enabled: boolean,
): boolean {
  if (!enabled || !status || indexRunning || downloadRunning) return false;
  if (status.indexed !== true) return false;
  const changed = status.changedSinceIndex ?? 0;
  if (changed > 0) return true;
  const head = status.head ?? '';
  const indexed = status.indexedHead ?? '';
  return head.length > 0 && indexed.length > 0 && head !== indexed;
}

/** 1 234 567 → "1,2 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString(locale(), { maximumFractionDigits: 1 })} ${units[i]}`;
}

export function isMaskedPrivateQuery(query: string | null | undefined): boolean {
  const q = query?.trim();
  return q === '[riservata]' || q === '[private]';
}

export function pathExtension(path: string): string | null {
  const file = path.split(/[\\/]/).pop() ?? '';
  const dot = file.lastIndexOf('.');
  if (dot <= 0 || dot === file.length - 1) return null;
  return file.slice(dot + 1).toLowerCase();
}

const PROSE_EXTS = new Set(['md', 'mdx', 'markdown', 'rst', 'txt', 'adoc']);

/**
 * Top extensions to offer as search filter chips: from the active hits when present,
 * otherwise from the repository's code files (excluding wiki pages and prose).
 */
export function availableExtensions(
  hits: Array<{ path: string }> | null,
  repoFiles: string[],
  wikiRoot?: string | null,
  limit = 5,
): string[] {
  const counts = new Map<string, number>();
  if (hits && hits.length > 0) {
    for (const h of hits) {
      const ext = pathExtension(h.path);
      if (ext) counts.set(ext, (counts.get(ext) ?? 0) + 1);
    }
  } else {
    const wikiPrefix = wikiRoot ? wikiRoot.replace(/\/+$/, '') + '/' : '';
    for (const f of repoFiles) {
      if (wikiPrefix && f.startsWith(wikiPrefix)) continue;
      const ext = pathExtension(f);
      if (!ext || PROSE_EXTS.has(ext)) continue;
      counts.set(ext, (counts.get(ext) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([ext]) => ext);
}
