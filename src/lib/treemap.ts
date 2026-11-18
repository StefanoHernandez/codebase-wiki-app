import type { FileCoverage } from './coverage.ts';

export interface MapNode {
  name: string;
  /** Folder path, or the file path for a file. */
  path: string;
  kind: 'folder' | 'file' | 'loose';
  children: MapNode[];
  files: FileCoverage[];
  verified: number;
  drifted: number;
  uncovered: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const emptyNode = (name: string, path: string, kind: MapNode['kind']): MapNode => ({
  name,
  path,
  kind,
  children: [],
  files: [],
  verified: 0,
  drifted: 0,
  uncovered: 0,
});

function count(n: MapNode, f: FileCoverage) {
  n.files.push(f);
  if (f.pages.length === 0) n.uncovered += 1;
  else if (f.drift) n.drifted += 1;
  else n.verified += 1;
}

/**
 * Folder tree of the code files. A folder with subfolders keeps its own files in one `loose` child,
 * so the map shows folders side by side; a folder without subfolders shows its files.
 */
export function buildTree(files: FileCoverage[]): MapNode {
  const root = emptyNode('', '', 'folder');
  const folders = new Map<string, MapNode>([['', root]]);
  const folderOf = (dir: string): MapNode => {
    let n = folders.get(dir);
    if (n) return n;
    const cut = dir.lastIndexOf('/');
    const parent = folderOf(cut < 0 ? '' : dir.slice(0, cut));
    n = emptyNode(dir.slice(cut + 1), dir, 'folder');
    parent.children.push(n);
    folders.set(dir, n);
    return n;
  };
  const direct = new Map<MapNode, FileCoverage[]>();
  for (const f of files) {
    const cut = f.path.lastIndexOf('/');
    const dir = cut < 0 ? '' : f.path.slice(0, cut);
    const folder = folderOf(dir);
    direct.set(folder, [...(direct.get(folder) ?? []), f]);
    for (let d: string | null = dir; d !== null; d = d === '' ? null : d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '') {
      count(folders.get(d)!, f);
    }
  }
  for (const [folder, own] of direct) {
    if (folder.children.length === 0) {
      for (const f of own) {
        const leaf = emptyNode(f.path.slice(f.path.lastIndexOf('/') + 1), f.path, 'file');
        count(leaf, f);
        folder.children.push(leaf);
      }
    } else {
      const loose = emptyNode('', folder.path, 'loose');
      for (const f of own) count(loose, f);
      folder.children.push(loose);
    }
  }
  return root;
}

/** Squarified treemap: areas proportional to `values`, rectangles close to square. */
export function squarify(values: number[], rect: Rect): Rect[] {
  const out: Rect[] = new Array(values.length);
  const total = values.reduce((s, v) => s + v, 0);
  if (total <= 0) return values.map(() => ({ ...rect, w: 0, h: 0 }));
  const scale = (rect.w * rect.h) / total;
  const order = values.map((v, i) => ({ i, a: v * scale })).sort((p, q) => q.a - p.a);
  let { x, y, w, h } = rect;
  const worst = (row: number[], side: number) => {
    const s = row.reduce((a, b) => a + b, 0);
    return Math.max(...row.map((a) => Math.max((side * side * a) / (s * s), (s * s) / (side * side * a))));
  };
  let k = 0;
  while (k < order.length) {
    const side = Math.min(w, h);
    const row = [order[k].a];
    let j = k + 1;
    while (j < order.length && worst([...row, order[j].a], side) <= worst(row, side)) row.push(order[j++].a);
    const s = row.reduce((a, b) => a + b, 0);
    const thick = s / side;
    let at = 0;
    for (let m = k; m < j; m++) {
      const len = order[m].a / thick;
      out[order[m].i] = w >= h ? { x, y: y + at, w: thick, h: len } : { x: x + at, y, w: len, h: thick };
      at += len;
    }
    if (w >= h) {
      x += thick;
      w -= thick;
    } else {
      y += thick;
      h -= thick;
    }
    k = j;
  }
  return out;
}
