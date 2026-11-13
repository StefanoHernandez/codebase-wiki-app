import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { checkAppUpdate, installAppUpdate, pluginState, updaterSupported, type Update } from '../api';
import type { PluginRow } from '../lib/plugin';
import { updateBanner, type AppCheck, type UpdateBanner } from '../lib/updates';

const FIRST_CHECK_MS = 5_000;
const EVERY_MS = 24 * 60 * 60 * 1000;

interface Updates {
  banner: UpdateBanner | null;
  checking: boolean;
  /** undefined = not installing; null = downloading, size unknown; 0–100 = percent. */
  progress: number | null | undefined;
  checkNow(): Promise<void>;
  install(): Promise<void>;
  dismiss(): void;
}

const Ctx = createContext<Updates | null>(null);

/** Checks for a newer app and outdated plugins: 5 s after start, every 24 h, and on request. */
export function UpdatesProvider({ children }: { children: ReactNode }) {
  const [banner, setBanner] = useState<UpdateBanner | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<number | null | undefined>(undefined);
  const update = useRef<Update | null>(null);
  const busy = useRef(false);

  const run = useCallback(async (manual: boolean) => {
    // One check at a time: a timer firing during a manual check would overwrite its answer.
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    let app: AppCheck;
    try {
      const u = await checkAppUpdate();
      update.current = u;
      app = u ? { kind: 'available', version: u.version } : { kind: 'none' };
    } catch (e) {
      app = { kind: 'error', message: e instanceof Error ? e.message : String(e) };
    }
    let plugins: PluginRow[] = [];
    try {
      plugins = await pluginState();
    } catch {
      /* the plugin line is optional */
    }
    const canInstall = await updaterSupported().catch(() => false);
    setBanner(updateBanner(app, plugins, { manual, canInstall }));
    setChecking(false);
    busy.current = false;
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void run(false), FIRST_CHECK_MS);
    const every = setInterval(() => void run(false), EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [run]);

  const install = useCallback(async () => {
    const u = update.current;
    if (!u) return;
    setProgress(null);
    try {
      await installAppUpdate(u, setProgress);
    } catch (e) {
      setProgress(undefined);
      const msg = e instanceof Error ? e.message : String(e);
      setBanner((b) => b && { ...b, error: `Aggiornamento non riuscito: ${msg}` });
    }
  }, []);

  const value: Updates = {
    banner,
    checking,
    progress,
    checkNow: () => run(true),
    install,
    dismiss: () => setBanner(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUpdates(): Updates {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUpdates outside UpdatesProvider');
  return v;
}
