export type IndexStatus = {
  model?: string;
  files?: number;
  chunks?: number;
  indexedHead?: string | null;
  head?: string | null;
  changedSinceIndex?: number;
};

export function formatIndexState(status: IndexStatus | null): string {
  if (!status) return 'Indice assente';
  const ih = shortSha(status.indexedHead);
  const h = shortSha(status.head);
  const changed = status.changedSinceIndex ?? 0;
  const model = status.model ?? '—';
  const files = status.files ?? 0;
  const chunks = status.chunks ?? 0;
  return `${model} · ${files} file · ${chunks} chunk · indicizzato @${ih} · HEAD @${h} · ${changed} file cambiati`;
}

function shortSha(s?: string | null): string {
  if (!s) return '—';
  return s.slice(0, 7);
}

export type RagProgress = { phase: string; done: number; total: number };

export function reduceRagProgress(prev: RagProgress | null, line: string): RagProgress | null {
  try {
    const j = JSON.parse(line) as Record<string, unknown>;
    if (j.event === 'phase' && typeof j.phase === 'string' && typeof j.total === 'number') {
      return { phase: j.phase, done: 0, total: j.total };
    }
    if (j.event === 'progress' && typeof j.phase === 'string' && typeof j.done === 'number') {
      const total = typeof j.total === 'number' ? j.total : prev?.total ?? 0;
      return { phase: j.phase, done: j.done, total };
    }
  } catch {
    return prev;
  }
  return prev;
}
