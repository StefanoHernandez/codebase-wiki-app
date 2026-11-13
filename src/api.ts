// The only module that imports @tauri-apps/api or the Tauri plugins.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import type {
  ActivityLine,
  LintReport,
  ProjectNews,
  RecentProject,
  RepoFilePayload,
  WikiSnapshot,
} from './types/snapshot';
import type { GraphHistory } from './lib/graph-history';
import type { PluginRow } from './lib/plugin';

export type { UnlistenFn };

export interface WikiChangedEvent {
  repo: string;
  paths: string[];
}

export function openProject(path: string): Promise<WikiSnapshot> {
  return invoke('open_project', { path });
}

export function listRecent(): Promise<RecentProject[]> {
  return invoke('list_recent');
}

export function removeRecent(path: string): Promise<void> {
  return invoke('remove_recent', { path });
}

export function markProjectSeen(repo: string, logEntries: number | null): Promise<void> {
  return invoke('mark_project_seen', { repo, logEntries });
}

export function projectNews(repo: string): Promise<ProjectNews> {
  return invoke('project_news', { repo });
}

export function agentActivity(limit: number): Promise<ActivityLine[]> {
  return invoke('agent_activity', { limit });
}

export function graphHistory(repo: string): Promise<GraphHistory> {
  return invoke('graph_history', { repo });
}

export function loadSnapshot(repo: string): Promise<WikiSnapshot> {
  return invoke('load_snapshot', { repo });
}

export function writeWikiFile(repo: string, relPath: string, content: string): Promise<void> {
  return invoke('write_wiki_file', { repo, relPath, content });
}

export interface WikiWriteFile {
  relPath: string;
  content: string;
  expectedSha256: string;
}

export function writeWikiFiles(repo: string, files: WikiWriteFile[]): Promise<void> {
  return invoke('write_wiki_files', { repo, files });
}

export function readWikiFile(repo: string, relPath: string): Promise<string> {
  return invoke('read_wiki_file', { repo, relPath });
}

export function readSourceFile(repo: string, relPath: string): Promise<RepoFilePayload> {
  return invoke('read_source_file', { repo, relPath });
}

export function sourceDiff(repo: string, relPath: string, commit: string): Promise<string> {
  return invoke('source_diff', { repo, relPath, commit });
}

export function runLint(repo: string, pythonPath?: string | null): Promise<LintReport> {
  return invoke('run_lint', { repo, pythonPath: pythonPath?.trim() || null });
}

export function gitUserName(repo: string): Promise<string | null> {
  return invoke('git_user_name', { repo });
}

export function workflowPrompt(repo: string, workflow: string): Promise<string> {
  return invoke('workflow_prompt', { repo, workflow });
}

/** Native folder picker; resolves null when cancelled. */
export async function pickFolder(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false });
  return typeof picked === 'string' ? picked : null;
}

export function copyText(text: string): Promise<void> {
  return writeText(text);
}

/** Subscribes to `wiki-watch-error`: the OS watcher reported errors, live updates may be missing. */
export function onWatchError(cb: (event: { repo: string; message: string }) => void): Promise<UnlistenFn> {
  return listen<{ repo: string; message: string }>('wiki-watch-error', (e) => cb(e.payload));
}

/** Subscribes to `wiki-changed` events emitted by the repo watcher. */
export function onWikiChanged(cb: (event: WikiChangedEvent) => void): Promise<UnlistenFn> {
  return listen<WikiChangedEvent>('wiki-changed', (e) => cb(e.payload));
}

// ---- Updates ----

export type { Update };

export function appVersion(): Promise<string> {
  return getVersion();
}

/** The newer release from `latest.json`, or null when this is the latest. */
export function checkAppUpdate(): Promise<Update | null> {
  return check();
}

/** False on Linux outside an AppImage: the app cannot replace itself there. */
export function updaterSupported(): Promise<boolean> {
  return invoke('updater_supported');
}

export function openReleasePage(): Promise<void> {
  return invoke('open_release_page');
}

export function pluginState(): Promise<PluginRow[]> {
  return invoke('plugin_state');
}

/** Downloads (progress 0–100, null when the size is unknown), installs, restarts. */
export async function installAppUpdate(update: Update, onProgress: (pct: number | null) => void): Promise<void> {
  let total = 0;
  let got = 0;
  await update.downloadAndInstall((e) => {
    if (e.event === 'Started') total = e.data.contentLength ?? 0;
    if (e.event === 'Progress') {
      got += e.data.chunkLength;
      onProgress(total ? Math.min(100, Math.round((got / total) * 100)) : null);
    }
  });
  await relaunch();
}
