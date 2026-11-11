export const LOG_UNREADABLE = 'Il log non è leggibile: nessuna modifica scritta.';

export interface FileEdit {
  relPath: string;
  apply(current: string): string;
}

export type ReadFn = (relPath: string) => Promise<string>;
export type WriteFn = (relPath: string, content: string) => Promise<void>;

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
  write: WriteFn,
  logRelPath: string,
): Promise<void> {
  const paths = [...new Set(edits.map((e) => e.relPath))];
  const disk: Record<string, string> = {};
  for (const rel of paths) {
    try {
      disk[rel] = await read(rel);
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
  for (const rel of toWrite) {
    await write(rel, disk[rel]!);
  }
}
