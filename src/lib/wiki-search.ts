export interface WikiHit {
  relPath: string;
  title: string;
  /** One line of the page around the first match. */
  snippet: string;
  score: number;
}

const terms = (q: string) =>
  q
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((w) => w.length >= 3);

/**
 * Wiki pages that mention the query's words (3+ letters), best first: every word found counts,
 * a word in the title counts five times its body matches (capped), a page missing a word ranks lower.
 * ponytail: plain word counting over pages already in memory; use the RAG index if the wiki grows past a few thousand pages.
 */
export function searchWiki(
  pages: Array<{ relPath: string; markdown: string; title?: string }>,
  query: string,
  limit = 5,
): WikiHit[] {
  const words = [...new Set(terms(query))];
  if (words.length === 0) return [];
  const hits: WikiHit[] = [];
  for (const p of pages) {
    const title = p.title || p.relPath;
    const body = p.markdown.toLowerCase();
    const head = title.toLowerCase();
    let found = 0;
    let score = 0;
    for (const w of words) {
      const inBody = body.split(w).length - 1;
      const inTitle = head.includes(w);
      if (inBody || inTitle) found += 1;
      score += Math.min(inBody, 10) + (inTitle ? 5 : 0);
    }
    if (found === 0) continue;
    score *= found / words.length;
    const line =
      p.markdown.split('\n').find((l) => !l.startsWith('---') && words.some((w) => l.toLowerCase().includes(w))) ?? '';
    hits.push({ relPath: p.relPath, title, snippet: line.replace(/^[#>\-*|\s]+/, '').slice(0, 160), score });
  }
  return hits.sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath)).slice(0, limit);
}
