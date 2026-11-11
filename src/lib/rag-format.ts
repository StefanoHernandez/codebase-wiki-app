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
};

export function formatIndexState(status: IndexStatus | null): string {
  if (!status) return 'Indice assente';
  if (status.indexed === false && status.error) return status.error;
  const ih = shortSha(status.indexedHead);
  const h = shortSha(status.head);
  const changed = status.changedSinceIndex ?? 0;
  const model = status.model ?? '—';
  const files = status.files ?? 0;
  const chunks = status.chunks ?? 0;
  return `${model} · ${files} file · ${chunks} chunk · indicizzato a @${ih} · HEAD @${h} · ${changed} file cambiati`;
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
