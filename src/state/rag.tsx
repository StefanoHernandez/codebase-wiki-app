import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { onWikiChanged } from '../api';
import { reduceRagProgress, shouldAutoIndex, type IndexStatus, type RagJobState } from '../lib/rag-format';
import { useProject } from './project';

const AUTO_INDEX_KEY = 'cw.rag.autoIndex';
type RepoJobs = RagJobState & { downloadId: string | null };

type RagContextValue = {
  jobFor(repo: string | null): RagJobState & { downloading: boolean };
  noteIndexStart(repo: string): void;
  noteDownloadStart(repo: string, modelId: string): void;
  autoIndex: boolean;
  setAutoIndex(v: boolean): void;
  parseStatus(raw: Record<string, unknown>): IndexStatus;
};

const RagContext = createContext<RagContextValue | null>(null);

function emptyJob(): RepoJobs {
  return { running: false, progress: null, error: null, downloadId: null };
}

export function RagProvider({ children }: { children: ReactNode }) {
  const project = useProject();
  const repo = project.snapshot?.repoPath ?? null;
  const [jobs, setJobs] = useState<Record<string, RepoJobs>>({});
  const [autoIndex, setAutoIndexState] = useState(() => {
    try {
      const v = localStorage.getItem(AUTO_INDEX_KEY);
      return v === null ? true : v === '1';
    } catch {
      return true;
    }
  });
  const lastWikiBump = useRef<number>(Date.now());
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusCache = useRef<Record<string, IndexStatus>>({});

  const setAutoIndex = useCallback((v: boolean) => {
    setAutoIndexState(v);
    try {
      localStorage.setItem(AUTO_INDEX_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  const parseStatus = useCallback((raw: Record<string, unknown>): IndexStatus => {
    return {
      model: String(raw.model ?? ''),
      indexed: raw.indexed === true,
      indexedModel: (raw.indexedModel as string) ?? (raw.indexed_model as string) ?? null,
      error: (raw.error as string) ?? null,
      files: Number(raw.files ?? 0),
      chunks: Number(raw.chunks ?? 0),
      indexedHead: (raw.indexedHead as string) ?? (raw.indexed_head as string) ?? null,
      head: (raw.head as string) ?? null,
      changedSinceIndex: Number(raw.changedSinceIndex ?? raw.changed_since_index ?? 0),
      staleInstall: Boolean(raw.staleInstall ?? raw.stale_install),
    };
  }, []);

  const noteIndexStart = useCallback((targetRepo: string) => {
    setJobs((prev) => ({
      ...prev,
      [targetRepo]: { ...(prev[targetRepo] ?? emptyJob()), running: true, error: null, progress: null },
    }));
  }, []);

  const noteDownloadStart = useCallback((targetRepo: string, modelId: string) => {
    setJobs((prev) => ({
      ...prev,
      [targetRepo]: {
        ...(prev[targetRepo] ?? emptyJob()),
        running: true,
        downloadId: modelId,
        error: null,
      },
    }));
  }, []);

  useEffect(() => {
    const un = listen<string>('rag://progress', (e) => {
      let repoKey = repo ?? '';
      try {
        const j = JSON.parse(e.payload) as { repo?: string; event?: string; message?: string };
        if (j.repo) repoKey = j.repo;
        setJobs((prev) => {
          const cur = { ...(prev[repoKey] ?? emptyJob()) };
          const reduced = reduceRagProgress(cur.progress, e.payload);
          if (reduced.error) {
            cur.error = reduced.error;
            cur.running = false;
            cur.downloadId = null;
          } else if (reduced.done) {
            cur.running = false;
            cur.downloadId = null;
          } else if (reduced.progress) {
            cur.progress = reduced.progress;
            cur.running = true;
          }
          if (j.event === 'download') {
            cur.running = true;
          }
          return { ...prev, [repoKey]: cur };
        });
      } catch {
        /* ignore */
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, [repo]);

  useEffect(() => {
    const un = onWikiChanged(() => {
      lastWikiBump.current = Date.now();
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  const scheduleAutoIndex = useCallback(
    (targetRepo: string, status: IndexStatus) => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
      const job = jobs[targetRepo] ?? emptyJob();
      if (
        !shouldAutoIndex(status, job.running, job.downloadId !== null, autoIndex)
      ) {
        return;
      }
      autoTimer.current = setTimeout(() => {
        if (Date.now() - lastWikiBump.current < 5000) return;
        const j = jobs[targetRepo] ?? emptyJob();
        if (j.running || j.downloadId) return;
        void invoke('rag_index_start', { repo: targetRepo }).then(() => {
          setJobs((prev) => ({
            ...prev,
            [targetRepo]: { ...(prev[targetRepo] ?? emptyJob()), running: true, error: null },
          }));
        });
      }, 5000);
    },
    [autoIndex, jobs],
  );

  useEffect(() => {
    if (!repo) return;
    let alive = true;
    (async () => {
      try {
        const raw = (await invoke('rag_status', { repo })) as Record<string, unknown>;
        if (!alive) return;
        const status = parseStatus(raw);
        statusCache.current[repo] = status;
        scheduleAutoIndex(repo, status);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, [repo, parseStatus, scheduleAutoIndex]);

  const jobFor = useCallback(
    (r: string | null) => {
      if (!r) return { running: false, progress: null, error: null, downloading: false };
      const j = jobs[r] ?? emptyJob();
      return {
        running: j.running,
        progress: j.progress,
        error: j.error,
        downloading: j.downloadId !== null,
      };
    },
    [jobs],
  );

  const value = useMemo(
    () => ({ jobFor, noteIndexStart, noteDownloadStart, autoIndex, setAutoIndex, parseStatus }),
    [jobFor, noteIndexStart, noteDownloadStart, autoIndex, setAutoIndex, parseStatus],
  );

  return <RagContext.Provider value={value}>{children}</RagContext.Provider>;
}

export function useRag() {
  const ctx = useContext(RagContext);
  if (!ctx) throw new Error('useRag outside RagProvider');
  return ctx;
}
