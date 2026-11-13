import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import * as api from '../api';
import { Empty } from '../components/Empty';
import { useToast } from '../components/Toast';
import { buildRow, lastUseByAgent, lastUseOfHarness, relativeTime, type ProjectRow } from '../lib/overview';
import { parseIndexStatus } from '../lib/rag-format';
import { DEFAULT_CORE_MAP } from '../lib/schema-parser';
import { useNav } from '../state/nav';
import { deriveProject, useProject } from '../state/project';
import type { ActivityLine, RecentProject } from '../types/snapshot';
import './progetti.css';

type HarnessRow = { id: string; label: string; status: 'connected' | 'outdated' | 'absent' };

const PAGE = 20;
/** Every line kept on disk (each repo file holds at most 600): last use must not depend on a window. */
const ACTIVITY_ALL = 1_000_000;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One project row: snapshot → attention and log, plus index status and news. */
async function loadRow(recent: RecentProject, activity: ActivityLine[]): Promise<ProjectRow> {
  try {
    const snap = await api.loadSnapshot(recent.path);
    const derived = deriveProject(snap, null);
    const logRel = derived.schema?.coreMap.log ?? DEFAULT_CORE_MAP.log;
    const logMd = snap.pages.find((p) => p.wikiRelPath === logRel)?.content;
    const [status, news] = await Promise.all([
      invoke('rag_status', { repo: recent.path })
        .then((raw) => parseIndexStatus(raw as Record<string, unknown>))
        .catch((e) => ({ indexed: false, error: message(e) })),
      api.projectNews(recent.path).catch(() => null),
    ]);
    return buildRow(recent, {
      attention: snap.wikiRoot ? derived.attention : null,
      log: logMd !== undefined ? { markdown: logMd, order: derived.schema?.logOrder ?? 'oldest-first' } : null,
      git: { branch: snap.gitState.branch, headSha: snap.gitState.headSha },
      status,
      news,
      activity,
      error: snap.wikiRoot ? null : 'nessuna wiki in questa cartella',
    });
  } catch (e) {
    return buildRow(recent, { attention: null, log: null, git: null, status: null, news: null, activity, error: message(e) });
  }
}

function indexText(r: ProjectRow): string {
  if (r.index === 'aggiornato') return 'indice aggiornato';
  if (r.index === 'indietro') return `indice indietro (${r.behindFiles} file)`;
  if (r.index === 'assente') return 'indice assente';
  return 'indice non leggibile';
}

export default function Progetti() {
  const project = useProject();
  const nav = useNav();
  const toast = useToast();
  const [rows, setRows] = useState<Record<string, ProjectRow>>({});
  const [activity, setActivity] = useState<ActivityLine[]>([]);
  const [harness, setHarness] = useState<HarnessRow[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [filter, setFilter] = useState('');
  const [openNews, setOpenNews] = useState<string | null>(null);
  // Relative times move while the view stays open.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const recentKey = project.recent.map((r) => r.path).join('\n');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const act = await api.agentActivity(ACTIVITY_ALL).catch(() => [] as ActivityLine[]);
      if (cancelled) return;
      setActivity(act);
      // One repo at a time: each snapshot walks the repo.
      for (const r of project.recent) {
        const row = await loadRow(r, act);
        if (cancelled) return;
        setRows((prev) => ({ ...prev, [r.path]: row }));
      }
    })();
    invoke<HarnessRow[]>('rag_harness_state')
      .then((h) => !cancelled && setHarness(h))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentKey]);

  const lastUse = useMemo(() => lastUseByAgent(activity), [activity]);
  const filtered = activity.filter((a) => !filter || a.repo === filter);
  const nameOf = (path: string | null) => project.recent.find((r) => r.path === path)?.name ?? (path ? path.split(/[\\/]/).pop() : '—');

  const addProject = async () => {
    try {
      const path = await api.pickFolder();
      if (path) await project.open(path);
    } catch (e) {
      toast(message(e), 'error');
    }
  };

  const go = async (path: string) => {
    if (await project.open(path)) nav.go('per-te');
    else toast('Progetto non aperto: vedi il messaggio in alto', 'error');
  };

  if (project.recent.length === 0) {
    return (
      <Empty
        title="Apri una cartella con una wiki"
        action={
          <button type="button" className="btn btn-strong" onClick={() => void addProject()}>
            Apri cartella
          </button>
        }
      />
    );
  }

  return (
    <div className="progetti">
      <div className="progetti-head">
        <h1 className="view-title">Progetti</h1>
        <button type="button" className="btn" onClick={() => void addProject()}>
          Apri cartella
        </button>
      </div>

      <ul className="rows">
        {project.recent.map((r) => {
          const row = rows[r.path];
          return (
            <li key={r.path} className="row progetti-row">
              <button type="button" className="row-main row-link" onClick={() => void go(r.path)}>
                <span className="row-title">
                  {r.name}
                  {row?.branch && (
                    <span className="progetti-git mono">
                      {row.branch} @{row.head}
                    </span>
                  )}
                </span>
                {!row ? (
                  <span className="row-detail">Lettura…</span>
                ) : row.error ? (
                  <span className="row-detail error-text">{row.error}</span>
                ) : (
                  <span className="row-detail">
                    <span className={row.attention ? 'progetti-human' : undefined}>{row.attention ? `${row.attention} per te` : 'niente per te'}</span>
                    {' · '}
                    <span className={row.index === 'indietro' ? 'progetti-drift' : undefined}>{indexText(row)}</span>
                    {' · '}
                    {row.lastAgent ? `ultimo agente: ${row.lastAgent.agent} ${relativeTime(row.lastAgent.ts, now)}` : 'nessun agente'}
                  </span>
                )}
              </button>
              {row && !row.error && (
                <button
                  type="button"
                  className="btn btn-link"
                  aria-expanded={openNews === r.path}
                  disabled={row.news.length === 0}
                  onClick={() => setOpenNews(openNews === r.path ? null : r.path)}
                >
                  {row.news.length ? `${row.news.length} novità` : 'nessuna novità'}
                </button>
              )}
              <span className="row-chevron" aria-hidden="true">
                ›
              </span>
              {openNews === r.path && row && (
                <ul className="progetti-news">
                  {row.news.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <section className="group">
        <div className="progetti-head">
          <h2 className="group-title">Attività degli agenti</h2>
          <select className="input" value={filter} onChange={(e) => (setFilter(e.target.value), setShown(PAGE))} aria-label="Filtra per progetto">
            <option value="">Tutti i progetti</option>
            {project.recent.map((r) => (
              <option key={r.path} value={r.path}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        {filtered.length === 0 ? (
          <p className="muted">
            {filter ? 'Nessuna chiamata degli agenti su questo progetto.' : 'Nessun agente ha ancora cercato: collegane uno dalle Impostazioni'}
          </p>
        ) : (
          <ul className="rows">
            {filtered.slice(0, shown).map((a, i) => (
              <li key={`${a.ts}-${i}`} className="row progetti-call">
                <span className="progetti-time">{new Date(a.ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
                <div className="row-main">
                  <p className="row-title">
                    {a.agent} <span className="muted">· {nameOf(a.repo)} · {a.tool}</span>
                  </p>
                  {a.query && <p className="row-detail">{a.query === '[riservata]' ? 'query riservata' : `"${a.query}"`}</p>}
                  {a.error ? (
                    <p className="row-detail error-text">{a.error}</p>
                  ) : (
                    a.top.length > 0 && <p className="row-detail mono">→ {a.top.join(', ')}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {filtered.length > shown && (
          <button type="button" className="btn btn-link" onClick={() => setShown(shown + PAGE)}>
            Mostra altre 20
          </button>
        )}
      </section>

      <section className="group">
        <h2 className="group-title">Agenti configurati</h2>
        <ul className="rows">
          {harness.map((h) => {
            const used = lastUseOfHarness(h.id, lastUse);
            return (
              <li key={h.id} className="row">
                <div className="row-main">
                  <p className="row-title">{h.label}</p>
                  <p className="row-detail">
                    {h.status === 'absent' ? '— non collegato' : used ? `✓ ultimo uso ${relativeTime(used, now)}` : '✓ mai usato'}
                  </p>
                </div>
                {h.status === 'absent' && (
                  <button type="button" className="btn btn-link" onClick={() => nav.go('impostazioni')}>
                    Collega
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

