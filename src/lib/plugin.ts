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
  if (!r.agentFound) return 'agente non trovato';
  if (r.error) return 'CLI non funzionante';
  if (r.status === 'missing') return 'non installato';
  if (r.status === 'outdated') return `${r.installed} → ${r.latest}`;
  if (r.status === 'current') return `${r.installed} ✓`;
  return r.installed ?? '';
}

/** True when one agent has both the plugin (any version) and the search server connected. */
export function agentReady(mcp: Array<{ id: string; status: string }>, plugins: PluginRow[]): boolean {
  return plugins.some((p) => p.installed && mcp.some((m) => m.id === p.id && m.status !== 'absent'));
}
