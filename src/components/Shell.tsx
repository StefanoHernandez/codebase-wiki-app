import { useEffect, useRef, useState } from 'react';
import { copyText, pickFolder, workflowPrompt } from '../api';
import { useProject } from '../state/project';
import { useNav } from '../state/nav';
import type { RecentProject } from '../types/snapshot';
import { useTheme } from '../state/theme';
import { SECTIONS, type SectionId } from '../views';
import Impostazioni from '../views/Impostazioni';
import { CommandPalette, MOD } from './CommandPalette';
import { Empty } from './Empty';
import { IncompatibleWiki } from './Compat';
import { useToast } from './Toast';
import markUrl from '../assets/mark.svg';

/** Two letters from a folder name: initials of its first two words, else its first two letters. */
function monogram(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_.\-]+/)
    .filter(Boolean);
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function Shell() {
  const project = useProject();
  const nav = useNav();
  const toast = useToast();
  const { theme, setTheme, toggleTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const addProject = async () => {
    try {
      const path = await pickFolder();
      if (path) await project.open(path);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const copyPrompt = async (workflow: 'wiki-sync' | 'wiki-init') => {
    if (!project.current) return;
    try {
      await copyText(await workflowPrompt(project.current, workflow));
      toast(`Prompt /${workflow} copiato`);
    } catch (e) {
      toast(`Copia non riuscita: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };

  const lint = async () => {
    try {
      const report = await project.runLint();
      if (!report) return;
      if (report.error) return toast(`Lint non eseguito: ${report.error}`, 'error');
      const n = report.findings.length;
      toast(n === 0 ? 'Lint eseguito: nessun problema' : `Lint eseguito: ${n} ${n === 1 ? 'problema' : 'problemi'}`);
    } catch (e) {
      toast(`Lint non riuscito: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      // A modal action form owns the keyboard: no palette over it, no section switch under it.
      if (document.querySelector('dialog[open]')) return;
      if (e.code === 'KeyK') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      const digit = /^Digit(\d)$/.exec(e.code) ? Number(e.code.slice(5)) : 0;
      if (digit >= 1 && digit <= SECTIONS.length) {
        e.preventDefault();
        nav.go(SECTIONS[digit - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav.go]);

  // With several projects the app starts on Progetti; with one it stays on Per te.
  const startedOn = useRef(false);
  useEffect(() => {
    if (startedOn.current || project.recent.length === 0) return;
    startedOn.current = true;
    if (project.recent.length > 1) nav.go('progetti');
  }, [project.recent.length, nav.go]);

  const counts = sectionCounts(project.attention);
  const hasWiki = !!project.snapshot?.wikiRoot;

  return (
    <div className="shell">
      <Sidebar
        onAdd={addProject}
        onPalette={() => setPaletteOpen(true)}
        counts={counts}
        hasWiki={hasWiki}
      />

      <main className="content">
        {nav.section === 'impostazioni' ? (
          <div className="content-body">
            <Impostazioni theme={theme} setTheme={setTheme} />
          </div>
        ) : nav.section === 'progetti' ? (
          <div className="content-body">
            <CurrentView section="progetti" />
          </div>
        ) : project.snapshot ? (
          <>
            {project.error && <Banner tone="error">{project.error}</Banner>}
            {project.snapshot.warning && <Banner tone="drift">{project.snapshot.warning}</Banner>}
            {project.compat.pluginOutdated && (
              <Banner tone="drift">La wiki è più nuova del plugin: aggiorna il plugin.</Banner>
            )}
            {project.parseError && (
              <Banner tone="error">Non riesco a leggere la wiki: {project.parseError}. Correggi il file e premi Ricarica.</Banner>
            )}
            <div className={nav.section === 'grafo' ? 'content-body content-bleed' : 'content-body'}>
              {hasWiki && project.compat.incompatible ? (
                <IncompatibleWiki />
              ) : hasWiki ? (
                <CurrentView section={nav.section} />
              ) : (
                <Empty
                  title="Questa cartella non ha una wiki. Avvia /wiki-init in Claude Code o Codex."
                  action={
                    <button type="button" className="btn" onClick={() => copyPrompt('wiki-init')}>
                      Copia prompt /wiki-init
                    </button>
                  }
                >
                  Quando la wiki esiste, questa finestra si aggiorna da sola.
                </Empty>
              )}
            </div>
          </>
        ) : (
          <div className="content-body welcome">
            {project.loading ? (
              <p className="muted">Apertura del progetto…</p>
            ) : (
              <Empty
                title="Apri una repository per vedere cosa aspetta te."
                action={
                  <button type="button" className="btn btn-strong" onClick={addProject} disabled={project.loading}>
                    Aggiungi progetto
                  </button>
                }
              >
                {project.error ? (
                  <p className="error-text">{project.error}</p>
                ) : (
                  'Scegli una cartella git che contiene una wiki Codebase Wiki LLM. L’app la legge e scrive solo quando firmi un’azione.'
                )}
              </Empty>
            )}
          </div>
        )}
      </main>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onLint={lint}
        onCopySync={() => copyPrompt('wiki-sync')}
        onToggleTheme={toggleTheme}
      />
    </div>
  );
}

function CurrentView({ section }: { section: SectionId }) {
  const { View } = SECTIONS.find((s) => s.id === section)!;
  return <View />;
}

type Count = { text: string; tone: 'human' | 'drift' | 'muted' };

function sectionCounts(attention: ReturnType<typeof useProject>['attention']): Partial<Record<SectionId, Count>> {
  const n = (...kinds: string[]) => attention.filter((a) => kinds.includes(a.kind)).length;
  const out: Partial<Record<SectionId, Count>> = {};
  if (attention.length) out['per-te'] = { text: String(attention.length), tone: 'human' };
  const lavori = n('proposal', 'blocked-task');
  if (lavori) out.lavori = { text: String(lavori), tone: 'muted' };
  const decisioni = n('decision-proposed');
  if (decisioni) out.decisioni = { text: String(decisioni), tone: 'muted' };
  if (n('handoff-stale')) out.handoff = { text: '!', tone: 'drift' };
  // Distinct pages, not items: a page with drift and lint counts once; the recovery group adds its pages.
  const salutePages = new Set(
    attention.filter((a) => ['page-drift', 'reverify', 'lint-error'].includes(a.kind)).map((a) => a.target.ref),
  ).size;
  const legacy = attention.find((a) => a.kind === 'lint-legacy')?.count ?? 0;
  const salute = salutePages + legacy + n('risk-unowned');
  if (salute) out.salute = { text: String(salute), tone: 'muted' };
  return out;
}

function Banner({ tone, children }: { tone: 'error' | 'drift'; children: React.ReactNode }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  );
}

const ICONS: Record<SectionId | 'impostazioni' | 'comandi', string> = {
  progetti: 'M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z',
  'per-te': 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM8 5.5v3l2 1.2',
  lavori: 'M2.5 3.5h3v9h-3zM6.5 3.5h3v6h-3zM10.5 3.5h3v4h-3z',
  decisioni: 'M8 2l5.5 6L8 14 2.5 8z',
  handoff: 'M2.5 5.5h9l-2.5-2.5M13.5 10.5h-9l2.5 2.5',
  salute: 'M2 8.5h3l1.5-4 3 7 1.5-3h3',
  grafo: 'M4 4.5a1.5 1.5 0 1 0 0-.01M12 6a1.5 1.5 0 1 0 0-.01M6.5 12.5a1.5 1.5 0 1 0 0-.01M5.3 5.2l1 5.8M5.4 4.3l5.2 1.4M7.8 11.6l3.4-4.4',
  ricerca: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM10.3 10.3l3.2 3.2',
  impostazioni:
    'M8 5.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4ZM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
  comandi: 'M3 4.5l3 3.5-3 3.5M8 11.5h5',
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
      <path d={ICONS[name]} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Sidebar({
  onAdd,
  onPalette,
  counts,
  hasWiki,
}: {
  onAdd(): void;
  onPalette(): void;
  counts: Partial<Record<SectionId, Count>>;
  hasWiki: boolean;
}) {
  const nav = useNav();
  return (
    <aside className="sidebar" aria-label="Progetto e sezioni">
      <div className="brand">
        <img src={markUrl} alt="" width="20" height="20" />
        <span className="brand-name">Codebase Wiki</span>
      </div>
      <ProjectSwitcher onAdd={onAdd} />
      <nav className="sections" aria-label="Sezioni">
        <ul>
          {SECTIONS.map((s, i) => {
            const count = counts[s.id];
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="section-link"
                  aria-current={nav.section === s.id ? 'page' : undefined}
                  disabled={!hasWiki && s.id !== 'progetti'}
                  onClick={() => nav.go(s.id)}
                  title={`${MOD}${i + 1}`}
                >
                  <Icon name={s.id} />
                  <span>{s.label}</span>
                  {count && <span className={`section-count section-count-${count.tone}`}>{count.text}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="sidebar-bottom">
          <button type="button" className="section-link" onClick={onPalette}>
            <Icon name="comandi" />
            <span>Comandi</span>
            <kbd>{MOD}K</kbd>
          </button>
          <button
            type="button"
            className="section-link"
            aria-current={nav.section === 'impostazioni' ? 'page' : undefined}
            onClick={() => nav.go('impostazioni')}
          >
            <Icon name="impostazioni" />
            <span>Impostazioni</span>
          </button>
        </div>
      </nav>
    </aside>
  );
}

/** Current project with its git state; the menu switches project, adds one, reloads or forgets. */
function ProjectSwitcher({ onAdd }: { onAdd(): void }) {
  const { recent, current, open, forget, attentionCounts, loading, snapshot, reload } = useProject();
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const others = useStableOrder(recent).filter((r) => r.path !== current);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const name = current ? (recent.find((r) => r.path === current)?.name ?? baseName(current)) : null;
  const git = snapshot?.gitState;
  const run = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  return (
    <div className="switcher" ref={ref}>
      <button
        type="button"
        className="switcher-btn"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={snapshot?.repoPath}
        onClick={() => setMenuOpen((o) => !o)}
      >
        <span className={name ? 'monogram' : 'monogram monogram-quiet'}>{name ? monogram(name) : '+'}</span>
        <span>
          <span className="switcher-name">{name ?? 'Nessun progetto'}</span>
          {git ? (
            <span className="switcher-ref">
              <span className="mono">{git.branch || 'HEAD staccato'}</span>
              {git.headSha && <span className="mono">@{git.headSha.slice(0, 7)}</span>}
              {git.isDirty && (
                <span className="dirty" title={git.dirtyFiles.join('\n')}>
                  modificato
                </span>
              )}
            </span>
          ) : (
            <span className="switcher-ref">Apri una repository</span>
          )}
        </span>
        <svg className="switcher-chevron" aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
          <path d="M4.5 6.5 8 10l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {menuOpen && (
        <div className="switcher-menu" role="menu">
          {current && (
            <>
              <button type="button" role="menuitem" disabled={loading} onClick={run(() => void reload())}>
                <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" className={loading ? 'spin' : undefined}>
                  <path
                    d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>{loading ? 'Ricarico…' : 'Ricarica il progetto'}</span>
              </button>
              <button type="button" role="menuitem" onClick={run(() => void forget(current))}>
                <span />
                <span>Rimuovi dai recenti</span>
              </button>
              {others.length > 0 && <hr />}
            </>
          )}
          {others.map((r) => {
            const count = attentionCounts[r.path];
            return (
              <button
                key={r.path}
                type="button"
                role="menuitem"
                title={r.path}
                disabled={loading}
                onClick={run(() => void open(r.path))}
              >
                <span className="monogram monogram-quiet">{monogram(r.name)}</span>
                <span className="switcher-menu-name">{r.name}</span>
                {!!count && <span className="section-count section-count-human">{count}</span>}
              </button>
            );
          })}
          <hr />
          <button type="button" role="menuitem" disabled={loading} onClick={run(onAdd)}>
            <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>Aggiungi progetto</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The backend keeps recents most-recent-first; the rail keeps the order it first showed
 * so tiles do not jump under the pointer when switching. New projects go on top.
 */
function useStableOrder(recent: RecentProject[]): RecentProject[] {
  const order = useRef<string[]>([]);
  const known = new Set(order.current);
  const paths = new Set(recent.map((r) => r.path));
  order.current = [
    ...recent.filter((r) => !known.has(r.path)).map((r) => r.path),
    ...order.current.filter((p) => paths.has(p)),
  ];
  const byPath = new Map(recent.map((r) => [r.path, r]));
  return order.current.map((p) => byPath.get(p)!);
}

