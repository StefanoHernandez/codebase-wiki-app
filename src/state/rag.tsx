import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { onWikiChanged } from '../api';
import {
  parseIndexStatus,
  reduceRagProgress,
  shouldAutoIndex,
  type IndexStatus,
  type RagJobState,
} from '../lib/rag-format';
import { useProject } from './project';
import { t } from '../i18n/index.ts';

const AUTO_INDEX_KEY = 'cw.rag.autoIndex';
const QUIET_MS = 5000;

export type DownloadState = { id: string; file: string; done: number; total: number };

type RagContextValue = {
  indexJob(repo: string | null): RagJobState;
  download: DownloadState | null;
  downloadError: string | null;
  /** Bumped when a job ends: views re-read status and catalog. */
  tick: number;
  startIndex(repo: string): Promise<void>;
  cancelIndex(repo: string): Promise<void>;
  startPull(id: string): Promise<void>;
  autoIndex: boolean;
  setAutoIndex(v: boolean): void;
};

const RagContext = createContext<RagContextValue | null>(null);
const IDLE: RagJobState = { running: false, progress: null, error: null };
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Line = { job?: string; repo?: string; model?: string; event?: string; message?: string; file?: string; done?: number; total?: number };

export function RagProvider({ children }: { children: ReactNode }) {
  const project = useProject();
  const repo = project.snapshot?.repoPath ?? null;
  const [jobs, setJobs] = useState<Record<string, RagJobState>>({});
  const [download, setDownload] = useState<DownloadState | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [autoIndex, setAutoIndexState] = useState(() => {
    try {
      return localStorage.getItem(AUTO_INDEX_KEY) !== '0';
    } catch {
      return true;
    }
  });

  // Refs: the auto-index timer reads the latest values without re-running effects on every event.
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const downloadRef = useRef(download);
  downloadRef.current = download;
  const autoRef = useRef(autoIndex);
  autoRef.current = autoIndex;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const patchJob = useCallback((key: string, patch: Partial<RagJobState>) => {
    setJobs((prev) => ({ ...prev, [key]: { ...(prev[key] ?? IDLE), ...patch } }));
  }, []);

  const setAutoIndex = useCallback((v: boolean) => {
    setAutoIndexState(v);
    try {
      localStorage.setItem(AUTO_INDEX_KEY, v ? '1' : '0');
    } catch {
      /* per-viewer convenience only */
    }
  }, []);

  const startIndex = useCallback(
    async (target: string) => {
      patchJob(target, { running: true, error: null, progress: null });
      try {
        await invoke('rag_index_start', { repo: target });
      } catch (e) {
        patchJob(target, { running: false, error: message(e) });
      }
    },
    [patchJob],
  );

  const cancelIndex = useCallback(async (target: string) => {
    try {
      await invoke('rag_index_cancel', { repo: target });
    } catch {
      /* already finished: the exit event resets the state */
    }
  }, []);

  const startPull = useCallback(async (id: string) => {
    setDownloadError(null);
    setDownload({ id, file: '', done: 0, total: 0 });
    try {
      await invoke('rag_model_pull', { id });
    } catch (e) {
      setDownload(null);
      setDownloadError(message(e));
    }
  }, []);

  useEffect(() => {
    const un = listen<string>('rag://progress', (e) => {
      let j: Line;
      try {
        j = JSON.parse(e.payload) as Line;
      } catch {
        return;
      }
      if (j.job === 'pull') {
        if (j.event === 'download') {
          setDownload({ id: j.model ?? '', file: j.file ?? '', done: j.done ?? 0, total: j.total ?? 0 });
        } else if (j.event === 'error') {
          setDownloadError(j.message ?? t('esplora.rag.downloadFailed'));
        } else if (j.event === 'exit') {
          setDownload(null);
          setTick((t) => t + 1);
        }
        return;
      }
      if (j.job !== 'index' || !j.repo) return;
      const key = j.repo;
      setJobs((prev) => {
        const cur = prev[key] ?? IDLE;
        const r = reduceRagProgress(cur.progress, e.payload);
        const next: RagJobState = r.done
          ? { running: false, progress: null, error: r.error ?? cur.error }
          : { ...cur, running: true, progress: r.progress };
        return { ...prev, [key]: next };
      });
      if (j.event === 'exit') setTick((t) => t + 1);
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // Auto-index: when a project opens and after QUIET_MS without watcher events, if an index
  // already exists and is behind. Never on first use, never while a job or download runs.
  useEffect(() => {
    if (!repo) return;
    const check = async () => {
      if (!autoRef.current || downloadRef.current || jobsRef.current[repo]?.running) return;
      let status: IndexStatus;
      try {
        status = parseIndexStatus((await invoke('rag_status', { repo })) as Record<string, unknown>);
      } catch {
        return;
      }
      const running = jobsRef.current[repo]?.running ?? false;
      if (shouldAutoIndex(status, running, downloadRef.current !== null, autoRef.current)) {
        void startIndex(repo);
      }
    };
    const arm = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void check(), QUIET_MS);
    };
    arm();
    const un = onWikiChanged(arm);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void un.then((f) => f());
    };
  }, [repo, startIndex]);

  const indexJob = useCallback((r: string | null) => (r ? (jobs[r] ?? IDLE) : IDLE), [jobs]);

  const value = useMemo(
    () => ({ indexJob, download, downloadError, tick, startIndex, cancelIndex, startPull, autoIndex, setAutoIndex }),
    [indexJob, download, downloadError, tick, startIndex, cancelIndex, startPull, autoIndex, setAutoIndex],
  );

  return <RagContext.Provider value={value}>{children}</RagContext.Provider>;
}

export function useRag() {
  const ctx = useContext(RagContext);
  if (!ctx) throw new Error('useRag outside RagProvider');
  return ctx;
}
