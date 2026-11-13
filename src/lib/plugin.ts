import { t } from '../i18n/index.ts';

// Codebase Wiki LLM plugin per agent, as returned by the `plugin_state` command.

export type PluginRow = {
  id: string;
  installed: string | null;
  latest: string | null;
  status: 'missing' | 'outdated' | 'current' | 'unknown';
  skillsOnly: boolean;
  agentFound: boolean;
  error: string | null;
  manual: string[];
};

export const AGENT_LABEL: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

export function pluginStateText(r: PluginRow): string {
  if (!r.agentFound) return t('impostazioni.plugin.notFound');
  if (r.error) return t('impostazioni.plugin.cliBroken');
  if (r.status === 'missing') return t('impostazioni.plugin.missing');
  if (r.status === 'outdated') return `${r.installed} → ${r.latest}`;
  if (r.status === 'current') return `${r.installed} ✓`;
  return r.installed ?? '';
}

/** Why the install button is off, or null. Folder agents copy from the latest release, so they need it. */
export function pluginBlocked(r: PluginRow): string | null {
  const copies = r.skillsOnly || r.id === 'antigravity';
  return copies && !r.latest ? t('impostazioni.plugin.needsNetwork') : null;
}

/** True when one agent has both the plugin (any version) and the search server connected. */
export function agentReady(mcp: Array<{ id: string; status: string }>, plugins: PluginRow[]): boolean {
  return plugins.some((p) => p.installed && mcp.some((m) => m.id === p.id && m.status !== 'absent'));
}
