import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText, pickFolder, workflowPrompt } from '../api';
import { useProject } from '../state/project';
import { useNav } from '../state/nav';
import type { RecentProject } from '../types/snapshot';
import { useTheme, type ThemeChoice } from '../state/theme';
import { SECTIONS, type SectionId } from '../views';
import { CommandPalette, MOD } from './CommandPalette';
import { Empty } from './Empty';
import { useToast } from './Toast';

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

  const counts = sectionCounts(project.attention);
  const hasWiki = !!project.snapshot?.wikiRoot;

  return (
    <div className="shell">
      <Rail onAdd={addProject} theme={theme} setTheme={setTheme} />

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
                  disabled={!hasWiki}
                  onClick={() => nav.go(s.id)}
                  title={`${MOD}${i + 1}`}
                >
                  <span>{s.label}</span>
                  {count && <span className={`section-count section-count-${count.tone}`}>{count.text}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="palette-hint" onClick={() => setPaletteOpen(true)}>
          <span>Comandi</span>
          <kbd>{MOD}K</kbd>
        </button>
      </nav>

      <main className="content">
        {project.snapshot ? (
          <>
            <Header />
            {project.error && <Banner tone="error">{project.error}</Banner>}
            {project.snapshot.warning && <Banner tone="drift">{project.snapshot.warning}</Banner>}
            {project.parseError && (
              <Banner tone="error">Non riesco a leggere la wiki: {project.parseError}. Correggi il file e premi Ricarica.</Banner>
            )}
            <div className={nav.section === 'grafo' ? 'content-body content-bleed' : 'content-body'}>
              {hasWiki ? (
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
  const salute = n('page-drift', 'reverify', 'lint-error');
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

function Header() {
  const { snapshot, recent, loading, reload } = useProject();
  if (!snapshot) return null;
  const name = recent.find((r) => r.path === snapshot.repoPath)?.name ?? baseName(snapshot.repoPath);
  const git = snapshot.gitState;
  return (
    <header className="content-header">
      <h1 className="project-name" title={snapshot.repoPath}>
        {name}
      </h1>
      <span className="git-ref">
        {git.branch || 'HEAD staccato'}
        {git.headSha && <code className="sha">@{git.headSha.slice(0, 7)}</code>}
      </span>
      {git.isDirty && (
        <span className="dirty" title={git.dirtyFiles.join('\n')}>
          modificato
        </span>
      )}
      <button type="button" className="btn btn-quiet header-reload" onClick={() => void reload()} disabled={loading}>
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
        {loading ? 'Ricarico…' : 'Ricarica'}
      </button>
    </header>
  );
}

function Rail({
  onAdd,
  theme,
  setTheme,
}: {
  onAdd(): void;
  theme: ThemeChoice;
  setTheme(t: ThemeChoice): void;
}) {
  const { recent, current, open, forget, attentionCounts, loading } = useProject();
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    settingsBtnRef.current?.focus();
  }, []);
  const tiles = useStableOrder(recent);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  return (
    <aside className="rail" aria-label="Progetti">
      <ul className="rail-projects">
        {tiles.map((r) => {
          const count = attentionCounts[r.path];
          const isCurrent = r.path === current;
          return (
            <li key={r.path}>
              <button
                type="button"
                className="rail-tile"
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={count ? `${r.name}, ${count} in attesa` : r.name}
                title={`${r.name}\n${r.path}`}
                disabled={loading}
                onClick={() => !isCurrent && void open(r.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const box = e.currentTarget.getBoundingClientRect();
                  setMenu({ path: r.path, x: e.clientX || box.right, y: e.clientY || box.top });
                }}
              >
                {monogram(r.name)}
                {!!count && <span className="rail-badge">{count}</span>}
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            className="rail-tile rail-add"
            aria-label="Aggiungi progetto"
            title="Aggiungi progetto"
            disabled={loading}
            onClick={onAdd}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </li>
      </ul>

      <div className="rail-bottom">
        <button
          ref={settingsBtnRef}
          type="button"
          className="rail-tile rail-settings"
          aria-label="Impostazioni"
          aria-expanded={settingsOpen}
          title="Impostazioni"
          onClick={() => (settingsOpen ? closeSettings() : setSettingsOpen(true))}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
            <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {settingsOpen && <Settings theme={theme} setTheme={setTheme} onClose={closeSettings} />}
      </div>

      {menu && (
        <div className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              void forget(menu.path);
              setMenu(null);
            }}
          >
            Rimuovi dai recenti
          </button>
        </div>
      )}
    </aside>
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

const THEMES: Array<{ id: ThemeChoice; label: string }> = [
  { id: 'system', label: 'Sistema' },
  { id: 'light', label: 'Chiaro' },
  { id: 'dark', label: 'Scuro' },
];

function Settings({ theme, setTheme, onClose }: { theme: ThemeChoice; setTheme(t: ThemeChoice): void; onClose(): void }) {
  const { actor, actorError, setActor } = useProject();
  // Draft keeps what is typed (spaces between names); the context exposes it trimmed.
  const [draft, setDraft] = useState(actor);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      const target = e.target as Node;
      if (el && !el.contains(target) && !(target as Element).closest?.('.rail-settings')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="popover settings" ref={ref} role="dialog" aria-label="Impostazioni">
      <label className="field">
        <span className="field-label">Il tuo nome</span>
        <input
          className="input"
          value={draft}
          autoFocus
          onChange={(e) => {
            setDraft(e.target.value);
            setActor(e.target.value);
          }}
          aria-invalid={!!actorError}
          placeholder="Nome e cognome"
        />
        <span className={actorError ? 'field-hint error-text' : 'field-hint'}>
          {actorError ?? 'Firma le azioni che fai qui (approvato da, chiuso da).'}
        </span>
      </label>
      <fieldset className="field">
        <legend className="field-label">Tema</legend>
        <div className="segmented">
          {THEMES.map((t) => (
            <button key={t.id} type="button" aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
