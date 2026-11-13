import { AGENT_LABEL, type PluginRow } from './plugin.ts';

/** Result of asking the updater whether a newer app release exists. */
export type AppCheck =
  | { kind: 'available'; version: string }
  | { kind: 'none' }
  | { kind: 'error'; message: string };

export interface UpdateBanner {
  /** App line, or null when only plugins are behind. */
  title: string | null;
  /** Outdated plugins, or null. */
  pluginLine: string | null;
  /** `install` = updater can replace the app; `download` = open the release page. */
  action: 'install' | 'download' | null;
  error: string | null;
}

/**
 * What the update banner says. Automatic checks stay silent when nothing is new or the check
 * failed; a manual check always answers. Only plugins older than the latest tag count.
 */
export function updateBanner(
  app: AppCheck,
  plugins: PluginRow[],
  opts: { manual: boolean; canInstall: boolean }
): UpdateBanner | null {
  const behind = plugins.filter((p) => p.status === 'outdated' && p.installed && p.latest);
  const pluginLine = behind.length
    ? `Plugin da aggiornare: ${behind
        .map((p) => `${AGENT_LABEL[p.id] ?? p.id} ${p.installed} → ${p.latest}`)
        .join(', ')}`
    : null;

  if (app.kind === 'available') {
    return {
      title: `Codebase Wiki ${app.version} disponibile`,
      pluginLine,
      action: opts.canInstall ? 'install' : 'download',
      error: null,
    };
  }
  if (opts.manual) {
    return {
      title: app.kind === 'none' ? 'Codebase Wiki è aggiornata' : null,
      pluginLine,
      action: null,
      error: app.kind === 'error' ? `Impossibile controllare: ${app.message}` : null,
    };
  }
  return pluginLine ? { title: null, pluginLine, action: null, error: null } : null;
}
