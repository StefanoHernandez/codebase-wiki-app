export const LOG_UNREADABLE = 'Il log non è leggibile: nessuna modifica scritta.';

export interface FileEdit {
  relPath: string;
  apply(current: string): string;
}

export type ReadFn = (relPath: string) => Promise<string>;

export interface WikiWritePayload {
  relPath: string;
  content: string;
  expectedSha256: string;
}

export type WriteBatchFn = (files: WikiWritePayload[]) => Promise<void>;

/** SHA-256 hex of the UTF-8 text. Web Crypto: available in the Tauri webview and in Node ≥ 19. */
export async function wikiContentSha256(content: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

let actDisk: Record<string, string> | null = null;

/** Peeks at another file's disk content while `applyEdits` is running. */
export function peer(relPath: string): string {
  if (!actDisk) {
    throw new Error('peer() is only valid during act()');
  }
  if (!(relPath in actDisk)) {
    throw new Error(`peer: file not in act batch: ${relPath}`);
  }
  return actDisk[relPath]!;
}

/**
 * Reads every edit target from disk, runs each `apply` in order (aborting before any write on error),
 * then writes content files first and the log file last.
 */
export async function applyEdits(
  edits: FileEdit[],
  read: ReadFn,
  writeBatch: WriteBatchFn,
  logRelPath: string,
): Promise<void> {
  const paths = [...new Set(edits.map((e) => e.relPath))];
  const disk: Record<string, string> = {};
  const readSha: Record<string, string> = {};
  for (const rel of paths) {
    try {
      const text = await read(rel);
      disk[rel] = text;
      readSha[rel] = await wikiContentSha256(text);
    } catch (e) {
      if (rel === logRelPath) {
        throw new Error(LOG_UNREADABLE);
      }
      throw e;
    }
  }

  actDisk = disk;
  try {
    for (const edit of edits) {
      disk[edit.relPath] = edit.apply(disk[edit.relPath]!);
    }
  } finally {
    actDisk = null;
  }

  const toWrite = [...paths].sort((a, b) => {
    if (a === logRelPath) return 1;
    if (b === logRelPath) return -1;
    return a.localeCompare(b);
  });
  await writeBatch(
    toWrite.map((rel) => ({
      relPath: rel,
      content: disk[rel]!,
      expectedSha256: readSha[rel]!,
    })),
  );
}
