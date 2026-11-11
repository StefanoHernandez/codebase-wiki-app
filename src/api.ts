// The only module that imports @tauri-apps/api or the Tauri plugins.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type {
  LintReport,
  RecentProject,
  RepoFilePayload,
  WikiSnapshot,
} from './types/snapshot';

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

/** Subscribes to `wiki-changed` events emitted by the repo watcher. */
export function onWikiChanged(cb: (event: WikiChangedEvent) => void): Promise<UnlistenFn> {
  return listen<WikiChangedEvent>('wiki-changed', (e) => cb(e.payload));
}
