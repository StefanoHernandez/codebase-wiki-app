import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { t, tn } from "../i18n";
import { copyText, pickFolder, workflowPrompt } from "../api";
import { useProject } from "../state/project";
import { useNav } from "../state/nav";
import type { RecentProject } from "../types/snapshot";
import { useTheme } from "../state/theme";
import { SECTIONS, type SectionId } from "../views";
import { CommandPalette, MOD } from "./CommandPalette";
import { Empty } from "./Empty";
import { ErrorBoundary } from "./ErrorBoundary";
import { IncompatibleWiki } from "./Compat";
import { useToast } from "./Toast";
import { UpdateBanner } from "./UpdateBanner";
import { Guide } from "./Guide";
import { sectionCounts } from "../lib/attention";
import { verifiedShare } from "../lib/trust";
import { firstRunDone } from "../lib/first-run";

const Impostazioni = lazy(() => import("../views/Impostazioni"));
const PrimiPassi = lazy(() => import("../views/PrimiPassi"));

/** Two letters from a folder name: initials of its first two words, else its first two letters. */
function monogram(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s_.\-]+/)
    .filter(Boolean);
  const letters =
    words.length >= 2 ? words[0][0] + words[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function LaunchIntro({
  leaving,
  onDismiss,
}: {
  leaving: boolean;
  onDismiss(): void;
}) {
  return (
    <div
      className={`intro-overlay${leaving ? ' is-leaving' : ''}`}
      role="status"
      aria-label="Codebase Wiki"
      onClick={onDismiss}
    >
      <div className="intro-emblem" aria-hidden="true">
        <svg viewBox="0 0 118 118" width="118" height="118">
          <defs>
            <linearGradient id="cwIntroGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#607CFF" />
              <stop offset="55%" stopColor="#3452DD" />
              <stop offset="100%" stopColor="#142477" />
            </linearGradient>
          </defs>
          <circle
            className="intro-ring-outer"
            cx="59"
            cy="59"
            r="45"
            fill="none"
            stroke="var(--human)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <g className="intro-orbit">
            <circle
              cx="59"
              cy="59"
              r="53"
              fill="none"
              stroke="var(--rule-strong)"
              strokeWidth="1"
              strokeDasharray="4 6"
            />
            <circle cx="59" cy="6" r="3.2" fill="var(--human)" />
            <circle cx="105" cy="85" r="2.6" fill="var(--ink-faint)" />
          </g>
          <rect
            x="33"
            y="33"
            width="52"
            height="52"
            rx="15"
            fill="url(#cwIntroGrad)"
          />
          <text
            x="59"
            y="66"
            textAnchor="middle"
            fill="#ffffff"
            fontFamily="var(--font-read)"
            fontSize="24"
            fontWeight="700"
            letterSpacing="-0.03em"
          >
            cw
          </text>
        </svg>
      </div>
      <div className="intro-wordmark">Codebase Wiki</div>
      <p className="intro-sub">{t('shell.intro.subtitle')}</p>
      <span className="intro-skip">{t('shell.intro.skip')}</span>
    </div>
  );
}

const SPOT_SELECTOR = '.card, .ricerca-hit, .decisioni-detail, .rows, .panel';

export function Shell() {
  const project = useProject();
  const nav = useNav();
  const toast = useToast();
  const { theme, setTheme, toggleTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [railExpanded, setRailExpanded] = useState(() => {
    try {
      return localStorage.getItem('cw.railExpanded') === '1';
    } catch {
      return false;
    }
  });
  const [introState, setIntroState] = useState<'shown' | 'leaving' | 'done'>(() => {
    try {
      const reduced =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (reduced || sessionStorage.getItem('cw.introShown') === '1') {
        return 'done';
      }
    } catch {
      return 'done';
    }
    return 'shown';
  });

  useEffect(() => {
    try {
      localStorage.setItem('cw.railExpanded', railExpanded ? '1' : '0');
    } catch {
      // ignore storage errors
    }
  }, [railExpanded]);

  useEffect(() => {
    if (introState !== 'shown') return;
    try {
      sessionStorage.setItem('cw.introShown', '1');
    } catch {
      // ignore
    }
    const timer = window.setTimeout(() => setIntroState('leaving'), 1750);
    return () => window.clearTimeout(timer);
  }, [introState]);

  useEffect(() => {
    if (introState !== 'leaving') return;
    const timer = window.setTimeout(() => setIntroState('done'), 380);
    return () => window.clearTimeout(timer);
  }, [introState]);

  useEffect(() => {
    if (introState === 'done') return;
    const onKey = () => setIntroState('leaving');
    window.addEventListener('keydown', onKey, { once: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [introState]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    let activeSurface: HTMLElement | null = null;
    let rafId = 0;
    let pending: { target: EventTarget | null; x: number; y: number } | null = null;

    const resetSurface = (el: HTMLElement | null) => {
      if (!el) return;
      el.style.setProperty('--spot-o', '0');
    };
    const flushSpotlight = () => {
      rafId = 0;
      const ev = pending;
      pending = null;
      if (!ev) return;
      const el = (ev.target as HTMLElement | null)?.closest<HTMLElement>(SPOT_SELECTOR) ?? null;
      if (activeSurface && activeSurface !== el) {
        resetSurface(activeSurface);
      }
      activeSurface = el;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const px = (ev.x - rect.left) / rect.width;
      const py = (ev.y - rect.top) / rect.height;
      el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
      el.style.setProperty('--spot-o', '1');
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      pending = { target: e.target, x: e.clientX, y: e.clientY };
      if (!rafId) rafId = window.requestAnimationFrame(flushSpotlight);
    };
    const onPointerLeave = () => {
      pending = null;
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      resetSurface(activeSurface);
      activeSurface = null;
    };
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerleave', onPointerLeave, { passive: true });
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
      resetSurface(activeSurface);
    };
  }, []);

  const addProject = async () => {
    try {
      const path = await pickFolder();
      if (path) await project.open(path);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const copyPrompt = async (workflow: "wiki-sync" | "wiki-init") => {
    if (!project.current) return;
    try {
      await copyText(await workflowPrompt(project.current, workflow));
      toast(t('shell.toast.promptCopied', { workflow }));
    } catch (e) {
      toast(
        t('shell.toast.copyFailed', { error: e instanceof Error ? e.message : String(e) }),
        "error",
      );
    }
  };

  const lint = async () => {
    try {
      const report = await project.runLint();
      if (!report) return;
      if (report.error)
        return toast(t('shell.toast.lintNotRun', { error: report.error }), "error");
      const n = report.findings.length;
      toast(
        n === 0
          ? t('shell.toast.lintClean')
          : tn('shell.toast.lintIssues', n),
      );
    } catch (e) {
      toast(
        t('shell.toast.lintFailed', { error: e instanceof Error ? e.message : String(e) }),
        "error",
      );
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      // A modal action form owns the keyboard: no palette over it, no section switch under it.
      if (document.querySelector("dialog[open]")) return;
      if (e.code === "KeyK") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (
        target?.closest?.(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
        )
      )
        return;
      const m = /^Digit(\d)$/.exec(e.code);
      const digit = m ? Number(m[1]) : -1;
      if (digit >= 0 && digit < SECTIONS.length) {
        e.preventDefault();
        nav.go(SECTIONS[digit].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav.go]);

  // With several projects the app starts on Progetti; with one it stays on Per te.
  // Until the first run is finished or skipped, the app starts on Primi passi.
  const startedOn = useRef(false);
  useEffect(() => {
    if (startedOn.current) return;
    if (!firstRunDone()) {
      startedOn.current = true;
      nav.go("primi-passi");
      return;
    }
    if (project.recent.length === 0) return;
    startedOn.current = true;
    if (project.recent.length > 1) nav.go("progetti");
  }, [project.recent.length, nav.go]);

  const counts = sectionCounts(project.attention);
  const hasWiki = !!project.snapshot?.wikiRoot;
  const viewFallback = <p className="muted">{t('esplora.progetti.reading')}</p>;

  return (
    <div className="shell">
      {introState !== 'done' && (
        <LaunchIntro
          leaving={introState === 'leaving'}
          onDismiss={() => setIntroState('leaving')}
        />
      )}
      <Sidebar
        expanded={railExpanded}
        onToggleExpanded={() => setRailExpanded((e) => !e)}
        onPalette={() => setPaletteOpen(true)}
        counts={counts}
        hasWiki={hasWiki}
      />

      <main className="content">
        <header className="context-header">
          <div className="context-header-left">
            <ProjectSwitcher onAdd={addProject} />
          </div>
          <div className="context-header-actions">
            {project.current && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={project.loading}
                onClick={() => void project.reload()}
                title={project.snapshot?.repoPath ?? project.current}
                aria-label={t('shell.reload')}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M13.5 8a5.5 5.5 0 1 1-1.3-3.55" strokeLinecap="round" />
                  <path d="M13.8 2.4v2.9h-2.9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setPaletteOpen(true)}
            >
              <span>{t('shell.commands')}</span>
              <kbd>{MOD}K</kbd>
            </button>
          </div>
        </header>
        <UpdateBanner />
        {introState === 'done' && (
          <Guide
            section={nav.section}
            showTip={
              nav.section === "progetti" ||
              nav.section === "impostazioni" ||
              (!!project.snapshot && hasWiki && !project.compat.incompatible)
            }
            onStart={() => nav.go("primi-passi")}
          />
        )}
        {nav.section === "primi-passi" ? (
          <div className="content-body">
            <ErrorBoundary resetKey={nav.section}>
              <Suspense fallback={viewFallback}>
                <PrimiPassi />
              </Suspense>
            </ErrorBoundary>
          </div>
        ) : nav.section === "impostazioni" ? (
          <div className="content-body">
            <ErrorBoundary resetKey={nav.section}>
              <Suspense fallback={viewFallback}>
                <Impostazioni theme={theme} setTheme={setTheme} />
              </Suspense>
            </ErrorBoundary>
          </div>
        ) : nav.section === "progetti" ? (
          <div className="content-body">
            <ErrorBoundary resetKey={nav.section}>
              <Suspense fallback={viewFallback}>
                <CurrentView section="progetti" />
              </Suspense>
            </ErrorBoundary>
          </div>
        ) : project.snapshot ? (
          <>
            {project.error && <Banner tone="error">{project.error}</Banner>}
            {project.snapshot.warning && (
              <Banner tone="drift">{project.snapshot.warning}</Banner>
            )}
            {project.watchError && (
              <Banner tone="drift">
                {t('shell.banner.watch', { error: project.watchError })}
              </Banner>
            )}
            {project.compat.pluginOutdated && (
              <Banner tone="drift">
                {t('shell.banner.pluginOutdated')}
              </Banner>
            )}
            {project.parseError && (
              <Banner tone="error">
                {t('shell.banner.parseError', { error: project.parseError })}
              </Banner>
            )}
            <div
              className={
                nav.section === "grafo"
                  ? "content-body content-bleed"
                  : "content-body"
              }
            >
              {hasWiki && project.compat.incompatible ? (
                <IncompatibleWiki />
              ) : hasWiki ? (
                <ErrorBoundary resetKey={nav.section}>
                  <Suspense fallback={viewFallback}>
                    <CurrentView section={nav.section} />
                  </Suspense>
                </ErrorBoundary>
              ) : (
                <Empty
                  title={t('shell.empty.noWiki')}
                  action={
                    <button
                      type="button"
                      className="btn"
                      onClick={() => copyPrompt("wiki-init")}
                    >
                      {t('shell.empty.copyInit')}
                    </button>
                  }
                >
                  {t('shell.empty.noWikiHint')}
                </Empty>
              )}
            </div>
          </>
        ) : (
          <div className="content-body welcome">
            {project.loading ? (
              <p className="muted">{t('shell.opening')}</p>
            ) : (
              <Empty
                title={t('shell.welcome.title')}
                action={
                  <button
                    type="button"
                    className="btn btn-strong"
                    onClick={addProject}
                    disabled={project.loading}
                  >
                    {t('shell.addProject')}
                  </button>
                }
              >
                {project.error ? (
                  <p className="error-text">{project.error}</p>
                ) : (
                  t('shell.welcome.hint')
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
        onCopySync={() => copyPrompt("wiki-sync")}
        onToggleTheme={toggleTheme}
      />
    </div>
  );
}

function CurrentView({ section }: { section: SectionId }) {
  const { View } = SECTIONS.find((s) => s.id === section)!;
  return <View />;
}

function Banner({
  tone,
  children,
}: {
  tone: "error" | "drift";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`banner banner-${tone}`}
      role={tone === "error" ? "alert" : undefined}
    >
      {children}
    </div>
  );
}

const ICONS: Record<SectionId | "impostazioni" | "comandi", string> = {
  "primi-passi":
    "M3 4.5l1.2 1.2 2.3-2.4M3 10.5l1.2 1.2 2.3-2.4M8.5 4.5h5M8.5 10.5h5",
  progetti: "M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z",
  "per-te": "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM8 5.5v3l2 1.2",
  lavori: "M2.5 3.5h3v9h-3zM6.5 3.5h3v6h-3zM10.5 3.5h3v4h-3z",
  decisioni: "M8 2l5.5 6L8 14 2.5 8z",
  handoff: "M2.5 5.5h9l-2.5-2.5M13.5 10.5h-9l2.5 2.5",
  salute: "M2 8.5h3l1.5-4 3 7 1.5-3h3",
  grafo:
    "M4 4.5a1.5 1.5 0 1 0 0-.01M12 6a1.5 1.5 0 1 0 0-.01M6.5 12.5a1.5 1.5 0 1 0 0-.01M5.3 5.2l1 5.8M5.4 4.3l5.2 1.4M7.8 11.6l3.4-4.4",
  ricerca: "M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM10.3 10.3l3.2 3.2",
  impostazioni:
    "M8 5.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4ZM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4",
  comandi: "M3 4.5l3 3.5-3 3.5M8 11.5h5",
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
      <path
        d={ICONS[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Sidebar({
  expanded,
  onToggleExpanded,
  onPalette,
  counts,
  hasWiki,
}: {
  expanded: boolean;
  onToggleExpanded(): void;
  onPalette(): void;
  counts: ReturnType<typeof sectionCounts>;
  hasWiki: boolean;
}) {
  const nav = useNav();
  const railLabel = expanded ? t('shell.sidebar.collapse') : t('shell.sidebar.expand');
  return (
    <aside
      className={expanded ? "sidebar is-expanded" : "sidebar"}
      aria-label={t('shell.sidebar.aria')}
    >
      <button
        type="button"
        className="section-link"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        aria-label={railLabel}
        data-tooltip={railLabel}
        title={railLabel}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          aria-hidden="true"
        >
          <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2.25" />
          <path d="M5.75 2.5v11" />
          {expanded ? (
            <path d="M10.5 6.2 8.7 8l1.8 1.8" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M9 6.2 10.8 8 9 9.8" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
        <span className="rail-label">{railLabel}</span>
      </button>
      <nav className="sections" aria-label={t('shell.sections.aria')}>
        <ul>
          {SECTIONS.map((s, i) => {
            const count = counts[s.id as keyof typeof counts];
            const badgeText =
              count && !expanded && Number(count.text) > 99 ? '99+' : count?.text;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="section-link"
                  aria-current={nav.section === s.id ? "page" : undefined}
                  disabled={!hasWiki && s.id !== "progetti"}
                  onClick={() => nav.go(s.id)}
                  data-tooltip={`${s.label}${count ? ` (${count.text})` : ''} (${MOD}${i})`}
                  title={`${s.label} (${MOD}${i})`}
                >
                  <Icon name={s.id} />
                  <span className="rail-label">{s.label}</span>
                  {count && (
                    <span
                      className={`section-count section-count-${count.tone}`}
                      title={count.title}
                    >
                      <span aria-hidden="true">{badgeText}</span>
                      <span className="visually-hidden">{count.title}</span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="sidebar-bottom">
          {(!firstRunDone() || nav.section === "primi-passi") && (
            <button
              type="button"
              className="section-link"
              aria-current={nav.section === "primi-passi" ? "page" : undefined}
              onClick={() => nav.go("primi-passi")}
              data-tooltip={t('shell.section.primi-passi')}
            >
              <Icon name="primi-passi" />
              <span className="rail-label">{t('shell.section.primi-passi')}</span>
            </button>
          )}
          <button
            type="button"
            className="section-link"
            onClick={onPalette}
            data-hint="palette"
            data-tooltip={`${t('shell.commands')} (${MOD}K)`}
          >
            <Icon name="comandi" />
            <span className="rail-label">{t('shell.commands')}</span>
            <kbd className="rail-kbd">{MOD}K</kbd>
          </button>
          <button
            type="button"
            className="section-link"
            aria-current={nav.section === "impostazioni" ? "page" : undefined}
            onClick={() => nav.go("impostazioni")}
            data-tooltip={t('shell.section.impostazioni')}
          >
            <Icon name="impostazioni" />
            <span className="rail-label">{t('shell.section.impostazioni')}</span>
          </button>
        </div>
      </nav>
    </aside>
  );
}

/** Current project with its git state; the menu switches project, adds one, reloads or forgets. */
function ProjectSwitcher({ onAdd }: { onAdd(): void }) {
  const {
    recent,
    current,
    open,
    forget,
    attentionCounts,
    loading,
    snapshot,
    reload,
    pages,
  } = useProject();
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const others = useStableOrder(recent).filter((r) => r.path !== current);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) =>
      !ref.current?.contains(e.target as Node) && setMenuOpen(false);
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const name = current
    ? (recent.find((r) => r.path === current)?.name ?? baseName(current))
    : null;
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
        {name ? (
          <HealthRing label={monogram(name)} {...verifiedShare(pages)} />
        ) : (
          <span className="monogram monogram-quiet">+</span>
        )}
        <span>
          <span className="switcher-name">{name ?? t('shell.noProject')}</span>
          {git ? (
            <span className="switcher-ref">
              <span className="mono">{git.branch || t('shell.detachedHead')}</span>
              {git.headSha && (
                <span className="mono">@{git.headSha.slice(0, 7)}</span>
              )}
              {git.isDirty && (
                <span className="dirty" title={git.dirtyFiles.join("\n")}>
                  {t('shell.dirty')}
                </span>
              )}
            </span>
          ) : (
            <span className="switcher-ref">{t('shell.openRepo')}</span>
          )}
        </span>
        <svg
          className="switcher-chevron"
          aria-hidden="true"
          viewBox="0 0 16 16"
          width="14"
          height="14"
        >
          <path
            d="M4.5 6.5 8 10l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {menuOpen && (
        <div className="switcher-menu" role="menu">
          {current && (
            <>
              <button
                type="button"
                role="menuitem"
                disabled={loading}
                onClick={run(() => void reload())}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  className={loading ? "spin" : undefined}
                >
                  <path
                    d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>{loading ? t('shell.reloading') : t('shell.reload')}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={run(() => void forget(current))}
              >
                <span />
                <span>{t('shell.forget')}</span>
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
                <span className="monogram monogram-quiet">
                  {monogram(r.name)}
                </span>
                <span className="switcher-menu-name">{r.name}</span>
                {!!count && (
                  <span className="section-count section-count-human">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          <hr />
          <button
            type="button"
            role="menuitem"
            disabled={loading}
            onClick={run(onAdd)}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
              <path
                d="M8 3v10M3 8h10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <span>{t('shell.addProject')}</span>
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

/** Project monogram inside a ring that fills with the pages whose verification still holds. */
function HealthRing({
  label,
  verified,
  total,
}: {
  label: string;
  verified: number;
  total: number;
}) {
  const r = 13.5;
  const c = 2 * Math.PI * r;
  const filled = total ? (verified / total) * c : 0;
  const title = total
    ? t('shell.ring.verified', { verified, total })
    : t('shell.ring.none');
  return (
    <span className="health-ring" title={title}>
      <svg viewBox="0 0 30 30" width="30" height="30" aria-hidden="true">
        <circle
          className="health-ring-track"
          cx="15"
          cy="15"
          r={r}
          fill="none"
          strokeWidth="2.2"
        />
        {filled > 0 && (
          <circle
            className="health-ring-fill"
            cx="15"
            cy="15"
            r={r}
            fill="none"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${c}`}
          />
        )}
      </svg>
      <span aria-hidden="true">{label.toUpperCase()}</span>
      <span className="visually-hidden">{title}</span>
    </span>
  );
}
