import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as api from '../api';
import type { LintReport, RecentProject, WikiSnapshot } from '../types/snapshot';
import type { Decision, HandoffData, ParsedFrontmatter, SchemaConfig, TrackerData } from '../types/wiki';
import { parseFrontmatter } from '../lib/frontmatter';
import { parseHandoffMarkdown, parseTrackerMarkdown } from '../lib/markdown-tables';
import { DEFAULT_CORE_MAP, parseSchemaMarkdown } from '../lib/schema-parser';
import { listDecisions } from '../lib/decisions';
import { trustTier, type TrustTier } from '../lib/trust';
import { codeChangedSources, computeAttention, type AttentionItem } from '../lib/attention';
import { applyEdits, type FileEdit } from '../lib/apply-edits';
import { personId, validateHumanActor } from '../lib/human-actions';
import { wikiCompat, type WikiCompat } from '../lib/wiki-compat';
import { parseNextSteps, parseRiskRegister, type NextSteps, type RiskRow } from '../lib/wiki-extras';
import { clearNavRef } from './nav';
import { countLogEntries } from '../lib/overview';

export interface WikiPage {
  relPath: string;
  markdown: string;
  sizeBytes: number;
  frontmatter: ParsedFrontmatter;
  /** Sources changed since the page's `source_commit`. */
  changedSources: string[];
  trust: TrustTier;
}

export type { FileEdit };

interface Derived {
  schema: SchemaConfig | null;
  tracker: TrackerData | null;
  handoff: HandoffData | null;
  decisions: Decision[];
  /** Tracker `## Next steps`, if present. */
  nextSteps: NextSteps | null;
  /** Risks page register table, if present. */
  risks: RiskRow[] | null;
  pages: WikiPage[];
  attention: AttentionItem[];
  parseError: string | null;
}

export interface ProjectState extends Derived {
  recent: RecentProject[];
  /** Canonical repo path of the open project. */
  current: string | null;
  snapshot: WikiSnapshot | null;
  lint: LintReport | null;
  lintRunning: boolean;
  /** Last lint call that threw (Python not found, ...); null after a successful run. */
  lintError: string | null;
  lintAt: Date | null;
  /** Gating from the validator's upgrade codes. */
  compat: WikiCompat;
  runLint(): Promise<LintReport | null>;
  /** Signing person, trimmed; '' when unset. Valid only when `actorError` is null. */
  actor: string;
  /** Why the signing actions are disabled now (wiki state or name), or null. */
  actorError: string | null;
  /** Problem with the name typed in settings only. */
  nameError: string | null;
  setActor(name: string): void;
  loading: boolean;
  error: string | null;
  /** Attention counts of projects seen this session, by repo path. */
  attentionCounts: Record<string, number>;
  reload(): Promise<void>;
  /** `markSeen: false` opens without moving the news baseline (startup reopen). */
  open(path: string, opts?: { markSeen?: boolean }): Promise<void>;
  forget(path: string): Promise<void>;
  /** Reads wiki files from disk, applies edits, writes atomically, then reloads. */
  act(edits: FileEdit[]): Promise<void>;
}

const ACTOR_KEY = 'cw.actor';
export const PYTHON_KEY = 'cw.python';
const RELOAD_DEBOUNCE_MS = 300;
const LINT_DEBOUNCE_MS = 600;

const EMPTY: Derived = {
  schema: null,
  tracker: null,
  handoff: null,
  decisions: [],
  nextSteps: null,
  risks: null,
  pages: [],
  attention: [],
  parseError: null,
};

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function readStoredActor(): string {
  try {
    return localStorage.getItem(ACTOR_KEY) ?? '';
  } catch {
    return '';
  }
}

export function readStoredPythonPath(): string {
  try {
    return localStorage.getItem(PYTHON_KEY) ?? '';
  } catch {
    return '';
  }
}

function actorProblem(name: string): string | null {
  try {
    validateHumanActor(name);
    if (!personId(name)) return 'Il nome deve contenere almeno una lettera o una cifra latina (serve per human:<id>).';
    return null;
  } catch (e) {
    return message(e);
  }
}

export function deriveProject(snapshot: WikiSnapshot | null, lint: LintReport | null): Derived {
  if (!snapshot || !snapshot.wikiRoot) return EMPTY;
  try {
    const byPath = new Map(snapshot.pages.map((p) => [p.wikiRelPath, p.content]));
    const schemaMd = byPath.get('SCHEMA.md');
    const schema = schemaMd !== undefined ? parseSchemaMarkdown(schemaMd) : null;
    const core = schema?.coreMap ?? DEFAULT_CORE_MAP;

    const trackerMd = byPath.get(core.tracker);
    const tracker = trackerMd !== undefined ? parseTrackerMarkdown(trackerMd) : null;
    const handoffMd = byPath.get(core.handoff);
    const handoff = handoffMd !== undefined ? parseHandoffMarkdown(handoffMd) : null;
    const nextSteps = trackerMd !== undefined ? parseNextSteps(trackerMd) : null;
    const risksMd = byPath.get(core.risks);
    const risks = risksMd !== undefined ? parseRiskRegister(risksMd) : null;

    const pages: WikiPage[] = snapshot.pages.map((p) => {
      const frontmatter = parseFrontmatter(p.content);
      const changedSources = snapshot.changedFilesByPage[p.wikiRelPath] ?? [];
      const codeDrift = codeChangedSources(changedSources, snapshot.wikiRoot ?? undefined).length > 0;
      return {
        relPath: p.wikiRelPath,
        markdown: p.content,
        sizeBytes: p.sizeBytes,
        frontmatter,
        changedSources,
        trust: trustTier(frontmatter, codeDrift),
      };
    });
    const decisions = listDecisions(
      pages.map((p) => ({ relPath: p.relPath, markdown: p.markdown })),
      core.decisions,
    );
    const attention = computeAttention({
      tracker,
      decisions,
      handoffCommitsBehind: handoffMd !== undefined ? snapshot.gitState.handoffCommitsBehind : null,
      pages,
      lintFindings: (lint?.findings ?? []).map((f) => ({ relPath: f.wikiRelPath, line: f.line, message: f.message })),
      risks,
      wikiRoot: snapshot.wikiRoot ?? undefined,
      // Without a Core map (v1) every page counts as core: nothing is hidden in the recovery group.
      corePaths: schema?.hasCoreMap ? ['SCHEMA.md', ...Object.values(core)] : undefined,
    });
    return { schema, tracker, handoff, decisions, nextSteps, risks, pages, attention, parseError: null };
  } catch (e) {
    return { ...EMPTY, parseError: message(e) };
  }
}

const ProjectContext = createContext<ProjectState | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [snapshot, setSnapshot] = useState<WikiSnapshot | null>(null);
  const [lint, setLint] = useState<LintReport | null>(null);
  const [lintRunning, setLintRunning] = useState(false);
  const [lintError, setLintError] = useState<string | null>(null);
  const [lintAt, setLintAt] = useState<Date | null>(null);
  /** Only the latest lint run may set state. */
  const lintSeq = useRef(0);
  const [actor, setActorState] = useState(readStoredActor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attentionCounts, setAttentionCounts] = useState<Record<string, number>>({});

  const current = snapshot?.repoPath ?? null;
  const currentRef = useRef<string | null>(null);
  /** Only the latest open() may set state: rapid switching must end on the last project asked for. */
  const openSeq = useRef(0);
  currentRef.current = current;

  const derived = useMemo(() => deriveProject(snapshot, lint), [snapshot, lint]);
  const compat = useMemo(() => wikiCompat(lint, derived.schema), [lint, derived.schema]);
  const clearLint = () => {
    lintSeq.current++;
    setLint(null);
    setLintError(null);
    setLintAt(null);
    setLintRunning(false);
  };

  useEffect(() => {
    if (current) setAttentionCounts((c) => ({ ...c, [current]: derived.attention.length }));
  }, [current, derived.attention.length]);

  const refreshRecent = useCallback(async () => {
    try {
      setRecent(await api.listRecent());
    } catch (e) {
      setError(message(e));
    }
  }, []);

  const open = useCallback(
    async (path: string, opts?: { markSeen?: boolean }) => {
      const seq = ++openSeq.current;
      setLoading(true);
      setError(null);
      try {
        const snap = await api.openProject(path);
        if (seq !== openSeq.current) return;
        clearNavRef();
        clearLint();
        setSnapshot(snap);
        if (opts?.markSeen !== false) {
          const seen = deriveProject(snap, null);
          const logMd = snap.pages.find((pg) => pg.wikiRelPath === (seen.schema?.coreMap.log ?? DEFAULT_CORE_MAP.log))?.content;
          // The baseline moves only after the project loaded: news reset on a real visit.
          await api.markProjectSeen(snap.repoPath, logMd !== undefined ? countLogEntries(logMd) : null).catch(() => undefined);
        }
        if (!readStoredActor()) {
          const name = (await api.gitUserName(snap.repoPath).catch(() => null))?.trim();
          if (seq === openSeq.current && name && !actorProblem(name)) setActorState(name);
        }
      } catch (e) {
        if (seq === openSeq.current) setError(message(e));
      } finally {
        if (seq === openSeq.current) setLoading(false);
        await refreshRecent();
      }
    },
    [refreshRecent],
  );

  const reload = useCallback(async () => {
    const repo = currentRef.current;
    if (!repo) return;
    setLoading(true);
    try {
      const snap = await api.loadSnapshot(repo);
      if (currentRef.current === repo) {
        setSnapshot(snap);
        setError(null);
      }
    } catch (e) {
      if (currentRef.current === repo) setError(message(e));
    } finally {
      if (currentRef.current === repo) setLoading(false);
    }
  }, []);

  const forget = useCallback(
    async (path: string) => {
      const seq = openSeq.current;
      try {
        await api.removeRecent(path);
        if (path === currentRef.current) {
          clearNavRef();
          setSnapshot(null);
          clearLint();
          setLoading(false);
        }
      } catch (e) {
        if (seq === openSeq.current) setError(message(e));
      }
      if (seq === openSeq.current) await refreshRecent();
    },
    [refreshRecent],
  );

  const runLint = useCallback(async () => {
    const repo = currentRef.current;
    if (!repo) return null;
    const seq = ++lintSeq.current;
    const latest = () => seq === lintSeq.current && currentRef.current === repo;
    setLintRunning(true);
    try {
      const report = await api.runLint(repo, readStoredPythonPath());
      if (latest()) {
        setLint(report);
        setLintError(null);
        setLintAt(new Date());
      }
      return report;
    } catch (e) {
      if (latest()) {
        // A failed run must not leave an older report driving the gating.
        setLint(null);
        setLintError(message(e));
      }
      throw e;
    } finally {
      if (seq === lintSeq.current) setLintRunning(false);
    }
  }, []);

  // Every successful snapshot load (open, reload after act(), watcher) → debounced lint.
  useEffect(() => {
    if (!snapshot?.wikiRoot) return;
    const timer = setTimeout(() => void runLint().catch(() => {}), LINT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [snapshot, runLint]);

  const act = useCallback(
    async (edits: FileEdit[]) => {
      const repo = currentRef.current;
      if (!repo) throw new Error('Nessun progetto aperto.');
      // Last line of defence: buttons are disabled too, but no write may slip through.
      if (compat.writesBlocked) throw new Error(compat.writesBlocked);
      const logRel = derived.schema?.coreMap.log ?? DEFAULT_CORE_MAP.log;
      let failed: unknown;
      let attempted = false;
      let threw = false;
      try {
        attempted = edits.length > 0;
        await applyEdits(
          edits,
          (relPath) => api.readWikiFile(repo, relPath),
          (files) => api.writeWikiFiles(repo, files),
          logRel,
        );
      } catch (e) {
        threw = true;
        failed = e;
      } finally {
        if (attempted) await reload();
      }
      if (threw) throw failed;
    },
    [reload, derived.schema?.coreMap.log, compat.writesBlocked],
  );

  const setActor = useCallback((name: string) => {
    setActorState(name);
    try {
      localStorage.setItem(ACTOR_KEY, name.trim());
    } catch {
      // Storage unavailable: the name still lives for this session.
    }
  }, []);

  // Startup: list recents and reopen the most recent project (read-only).
  useEffect(() => {
    let cancelled = false;
    api
      .listRecent()
      .then((list) => {
        if (cancelled) return;
        setRecent(list);
        // Reopening at startup is not a visit: the news of that project stay until it is opened.
        if (list.length > 0) void open(list[0].path, { markSeen: false });
      })
      .catch((e) => setError(message(e)));
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Watcher events for the open repo → debounced reload.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: api.UnlistenFn | undefined;
    let disposed = false;
    api
      .onWikiChanged((event) => {
        if (event.repo !== currentRef.current) return;
        clearTimeout(timer);
        timer = setTimeout(() => void reload(), RELOAD_DEBOUNCE_MS);
      })
      .then((fn) => (disposed ? fn() : (unlisten = fn)))
      .catch(() => {});
    return () => {
      disposed = true;
      clearTimeout(timer);
      unlisten?.();
    };
  }, [reload]);

  const value = useMemo<ProjectState>(
    () => ({
      ...derived,
      recent,
      current,
      snapshot,
      lint,
      lintRunning,
      lintError,
      lintAt,
      compat,
      runLint,
      actor: actor.trim(),
      nameError: actor.trim() ? actorProblem(actor.trim()) : 'Imposta il tuo nome nelle impostazioni.',
      actorError:
        compat.writesBlocked ??
        (actor.trim() ? actorProblem(actor.trim()) : 'Imposta il tuo nome nelle impostazioni.'),
      setActor,
      loading,
      error,
      attentionCounts,
      reload,
      open,
      forget,
      act,
    }),
    [
      derived,
      recent,
      current,
      snapshot,
      lint,
      lintRunning,
      lintError,
      lintAt,
      compat,
      runLint,
      actor,
      loading,
      error,
      attentionCounts,
      reload,
      open,
      forget,
      act,
      setActor,
    ],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectState {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used inside ProjectProvider');
  return ctx;
}
