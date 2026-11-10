import * as path from 'node:path';
import { parseFrontmatter, extractMarkdownLinks } from './frontmatter.ts';
import { parseSchemaMarkdown, DEFAULT_CORE_MAP } from './schema-parser.ts';
import type {
  GraphNode,
  GraphEdge,
  WikiGraph,
  GraphFilterOptions,
  GraphNodeCategory,
} from '../types/wiki.ts';

function isPrivateTermsPath(filePath: string): boolean {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts.includes('.private-terms');
}

function normalizeSourcePath(raw: string): string {
  let s = raw.trim().split('#')[0].trim();
  s = s.replace(/:\d+(?::\d+)?$/, '').trim();
  s = s.replace(/^\.\//, '');
  return s;
}

function matchesSource(repoFile: string, source: string): boolean {
  if (repoFile === source) return true;
  if (source.endsWith('/')) {
    return repoFile.startsWith(source);
  }
  return repoFile.startsWith(source + '/');
}

function getWikiCategoryAndRole(
  wikiRelPath: string,
  coreMap: Record<string, string>
): { category: GraphNodeCategory; role?: string } {
  if (wikiRelPath === 'SCHEMA.md') {
    return { category: 'core', role: 'schema' };
  }

  // Exact matches
  for (const [role, mappedPath] of Object.entries(coreMap)) {
    if (!mappedPath.endsWith('/')) {
      if (wikiRelPath === mappedPath) {
        if (role === 'tracker' || role === 'risks') {
          return { category: 'tracker', role };
        }
        if (role === 'decisions') {
          return { category: 'decision', role };
        }
        if (role === 'context' || role === 'handoff') {
          return { category: 'agent', role };
        }
        if (
          role === 'index' ||
          role === 'log' ||
          role === 'log-archive' ||
          role === 'troubleshooting' ||
          role === 'glossary'
        ) {
          return { category: 'core', role };
        }
        return { category: 'topic', role };
      }
    }
  }

  // Directory prefix matches (e.g. decisions/, log/)
  for (const [role, mappedPath] of Object.entries(coreMap)) {
    const dirPrefix = mappedPath.endsWith('/') ? mappedPath : mappedPath + '/';
    if (wikiRelPath.startsWith(dirPrefix)) {
      if (role === 'decisions') {
        return { category: 'decision', role };
      }
      if (role === 'log-archive') {
        return { category: 'core', role };
      }
      if (role === 'tracker' || role === 'risks') {
        return { category: 'tracker', role };
      }
      if (role === 'context' || role === 'handoff') {
        return { category: 'agent', role };
      }
      if (
        role === 'index' ||
        role === 'log' ||
        role === 'troubleshooting' ||
        role === 'glossary'
      ) {
        return { category: 'core', role };
      }
      return { category: 'topic', role };
    }
  }

  // Fallback defaults
  if (wikiRelPath.startsWith('project/decisions/') || wikiRelPath.startsWith('decisions/')) {
    return { category: 'decision', role: 'decisions' };
  }
  if (wikiRelPath.startsWith('log/')) {
    return { category: 'core', role: 'log-archive' };
  }

  return { category: 'topic', role: undefined };
}

function isOrphanException(wikiRelPath: string, coreMap: Record<string, string>): boolean {
  if (wikiRelPath === 'SCHEMA.md') return true;
  if (wikiRelPath === (coreMap['index'] || 'index.md') || wikiRelPath === 'index.md') return true;
  if (wikiRelPath === (coreMap['log'] || 'log.md') || wikiRelPath === 'log.md') return true;

  const logArchive = coreMap['log-archive'] || 'log/';
  if (logArchive) {
    const dir = logArchive.endsWith('/') ? logArchive : logArchive + '/';
    if (wikiRelPath.startsWith(dir)) return true;
  }
  if (wikiRelPath.startsWith('log/')) return true;

  return false;
}

export function buildWikiCodeGraph(input: {
  wikiRoot: string;
  pages: Array<{ wikiRelPath: string; content: string; sizeBytes: number }>;
  repoFiles: string[];
  changedFilesByPage: Record<string, string[]>;
  dirtyRepoFiles: string[];
  lintFindings: Array<{ wikiRelPath: string; line: number; message: string }>;
}): WikiGraph {
  const normWikiRoot = path.posix
    .normalize(input.wikiRoot.replace(/\\/g, '/'))
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');

  // 1. Filter out .private-terms pages
  const validPages = input.pages.filter((p) => !isPrivateTermsPath(p.wikiRelPath));

  // 2. Discover coreMap from SCHEMA.md if available
  const schemaPage = validPages.find((p) => p.wikiRelPath === 'SCHEMA.md');
  const schemaConfig = schemaPage ? parseSchemaMarkdown(schemaPage.content) : null;
  const coreMap = { ...DEFAULT_CORE_MAP, ...(schemaConfig?.coreMap || {}) };

  const validPagesByRel = new Map(validPages.map((p) => [p.wikiRelPath, p]));

  // 3. Parse frontmatter, metadata, and normalized sources for each page
  interface ProcessedPage {
    page: { wikiRelPath: string; content: string; sizeBytes: number };
    fm: ReturnType<typeof parseFrontmatter>;
    label: string;
    category: GraphNodeCategory;
    role?: string;
    confidence?: string;
    sourceCommit?: string;
    needsReverify: boolean;
    hasLintError: boolean;
    lintCount: number;
    normalizedSources: string[];
    driftFiles: string[];
    hasDrift: boolean;
  }

  const processedPages: ProcessedPage[] = [];
  const allNormalizedSources = new Set<string>();

  for (const page of validPages) {
    const fm = parseFrontmatter(page.content);

    // Label determination
    let label = fm.fields.title?.trim();
    if (!label) {
      const h1Match = fm.body.match(/^#\s+(.+)$/m);
      if (h1Match) {
        label = h1Match[1].trim();
      }
    }
    if (!label) {
      label = page.wikiRelPath;
    }

    const { category, role } = getWikiCategoryAndRole(page.wikiRelPath, coreMap);
    const confidence = fm.fields.confidence || undefined;
    const sourceCommit = fm.fields.source_commit || undefined;

    const needsReverify =
      /(?:⚠️\s*)?(?:TO[\s_-]+RE-?VERIFY|NOT[\s_-]+VERIFIED)/i.test(page.content) ||
      fm.fields['needs_reverify'] === 'true';

    const pageLint = (input.lintFindings || []).filter(
      (f) => f.wikiRelPath === page.wikiRelPath
    );
    const lintCount = pageLint.length;
    const hasLintError = lintCount > 0;

    // Normalized sources
    const normalizedSources: string[] = [];
    for (const raw of fm.sources || []) {
      const norm = normalizeSourcePath(raw);
      if (norm && !isPrivateTermsPath(norm)) {
        normalizedSources.push(norm);
        allNormalizedSources.add(norm);
      }
    }

    // Drift calculation
    const driftSet = new Set<string>();
    const pageChanged = (input.changedFilesByPage || {})[page.wikiRelPath];
    if (Array.isArray(pageChanged)) {
      for (const cf of pageChanged) {
        if (cf && !isPrivateTermsPath(cf)) {
          driftSet.add(cf);
        }
      }
    }

    for (const src of normalizedSources) {
      for (const dirty of input.dirtyRepoFiles || []) {
        if (!isPrivateTermsPath(dirty) && matchesSource(dirty, src)) {
          driftSet.add(dirty);
        }
      }
    }

    const driftFiles = Array.from(driftSet);
    const hasDrift = driftFiles.length > 0;

    processedPages.push({
      page,
      fm,
      label,
      category,
      role,
      confidence,
      sourceCommit,
      needsReverify,
      hasLintError,
      lintCount,
      normalizedSources,
      driftFiles,
      hasDrift,
    });
  }

  // 4. Resolve markdown links and build backlinks
  const backlinks: Record<string, string[]> = {};
  for (const page of validPages) {
    backlinks[page.wikiRelPath] = [];
  }

  const markdownEdges: GraphEdge[] = [];
  const seenMarkdownEdges = new Set<string>();

  for (const proc of processedPages) {
    const rawLinks = extractMarkdownLinks(proc.fm.body);
    const fromDir = path.posix.dirname(proc.page.wikiRelPath);

    for (const rawLink of rawLinks) {
      let clean = rawLink.split('#')[0].trim();
      if (clean.startsWith('<') && clean.endsWith('>')) {
        clean = clean.slice(1, -1).trim();
      }
      if (!clean) continue;
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(clean)) continue;
      if (clean.startsWith('//')) continue;

      const candidates = [
        path.posix.normalize(fromDir === '.' ? clean : path.posix.join(fromDir, clean)),
        path.posix.normalize(
          fromDir === '.' ? clean + '.md' : path.posix.join(fromDir, clean + '.md')
        ),
        path.posix.normalize(clean),
        path.posix.normalize(clean + '.md'),
      ];

      let targetRelPath: string | null = null;
      for (const c of candidates) {
        if (validPagesByRel.has(c)) {
          targetRelPath = c;
          break;
        }
      }

      if (targetRelPath && !isPrivateTermsPath(targetRelPath)) {
        const edgeId = `wiki:${proc.page.wikiRelPath}->wiki:${targetRelPath}:markdown-link`;
        if (!seenMarkdownEdges.has(edgeId)) {
          seenMarkdownEdges.add(edgeId);
          markdownEdges.push({
            id: edgeId,
            source: `wiki:${proc.page.wikiRelPath}`,
            target: `wiki:${targetRelPath}`,
            kind: 'markdown-link',
          });

          if (!backlinks[targetRelPath].includes(proc.page.wikiRelPath)) {
            backlinks[targetRelPath].push(proc.page.wikiRelPath);
          }
        }
      }
    }
  }

  // 5. Build source nodes and source edges
  const sourceNodesMap = new Map<string, GraphNode>();
  const sourceEdges: GraphEdge[] = [];
  const seenSourceEdges = new Set<string>();

  for (const proc of processedPages) {
    for (const src of proc.normalizedSources) {
      if (isPrivateTermsPath(src)) continue;

      // If source points to inside wikiRoot and matches a wiki page
      if (normWikiRoot && src.startsWith(normWikiRoot + '/')) {
        const insideWiki = src.slice(normWikiRoot.length + 1);
        if (validPagesByRel.has(insideWiki)) {
          const edgeId = `wiki:${proc.page.wikiRelPath}->wiki:${insideWiki}:source-link`;
          if (!seenSourceEdges.has(edgeId)) {
            seenSourceEdges.add(edgeId);
            sourceEdges.push({
              id: edgeId,
              source: `wiki:${proc.page.wikiRelPath}`,
              target: `wiki:${insideWiki}`,
              kind: 'source-link',
            });
          }
          continue;
        }
      }

      // Repository source file
      const sourceNodeId = `source:${src}`;
      if (!sourceNodesMap.has(sourceNodeId)) {
        // Drift for source node: matches any dirtyRepoFile
        const matchingDirty = (input.dirtyRepoFiles || []).filter(
          (dirty) => !isPrivateTermsPath(dirty) && matchesSource(dirty, src)
        );
        const srcHasDrift = matchingDirty.length > 0;

        sourceNodesMap.set(sourceNodeId, {
          id: sourceNodeId,
          label: src,
          path: src,
          kind: 'source',
          category: 'source',
          hasDrift: srcHasDrift,
          driftFiles: matchingDirty,
          hasLintError: false,
          lintCount: 0,
          needsReverify: false,
          isOrphan: false,
          sizeBytes: 0,
          degree: 0,
        });
      }

      const edgeId = `wiki:${proc.page.wikiRelPath}->${sourceNodeId}:source-link`;
      if (!seenSourceEdges.has(edgeId)) {
        seenSourceEdges.add(edgeId);
        sourceEdges.push({
          id: edgeId,
          source: `wiki:${proc.page.wikiRelPath}`,
          target: sourceNodeId,
          kind: 'source-link',
        });
      }
    }
  }

  // 6. Build wiki nodes
  const wikiNodes: GraphNode[] = [];
  for (const proc of processedPages) {
    const isOrphan =
      !isOrphanException(proc.page.wikiRelPath, coreMap) &&
      (backlinks[proc.page.wikiRelPath]?.length || 0) === 0;

    wikiNodes.push({
      id: `wiki:${proc.page.wikiRelPath}`,
      label: proc.label,
      path: proc.page.wikiRelPath,
      kind: 'wiki',
      category: proc.category,
      role: proc.role,
      confidence: proc.confidence,
      sourceCommit: proc.sourceCommit,
      hasDrift: proc.hasDrift,
      driftFiles: proc.driftFiles,
      hasLintError: proc.hasLintError,
      lintCount: proc.lintCount,
      needsReverify: proc.needsReverify,
      isOrphan,
      sizeBytes: proc.page.sizeBytes,
      degree: 0,
    });
  }

  const allNodes: GraphNode[] = [...wikiNodes, ...sourceNodesMap.values()];
  const allEdges: GraphEdge[] = [...markdownEdges, ...sourceEdges];

  // 7. Compute node degrees
  const incidentCount = new Map<string, number>();
  for (const edge of allEdges) {
    incidentCount.set(edge.source, (incidentCount.get(edge.source) || 0) + 1);
    incidentCount.set(edge.target, (incidentCount.get(edge.target) || 0) + 1);
  }
  for (const node of allNodes) {
    node.degree = incidentCount.get(node.id) || 0;
  }

  // 8. Compute uncoveredRepoFiles
  const uncoveredRepoFiles: string[] = [];
  for (const repoFile of input.repoFiles || []) {
    if (isPrivateTermsPath(repoFile)) continue;
    if (normWikiRoot && (repoFile === normWikiRoot || repoFile.startsWith(normWikiRoot + '/'))) {
      continue;
    }

    let covered = false;
    for (const src of allNormalizedSources) {
      if (matchesSource(repoFile, src)) {
        covered = true;
        break;
      }
    }

    if (!covered) {
      uncoveredRepoFiles.push(repoFile);
    }
  }

  return {
    nodes: allNodes,
    edges: allEdges,
    backlinks,
    uncoveredRepoFiles,
  };
}

export function filterWikiGraph(
  graph: WikiGraph,
  options: GraphFilterOptions
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  // 1. Include code sources filtering
  let candidateNodes = options.includeCodeSources
    ? [...graph.nodes]
    : graph.nodes.filter((n) => n.kind !== 'source');

  const candidateNodeIds = new Set(candidateNodes.map((n) => n.id));

  // Eligible edges based on initial node eligibility
  const eligibleEdges = graph.edges.filter(
    (e) => candidateNodeIds.has(e.source) && candidateNodeIds.has(e.target)
  );

  // 2. Focus node & local graph hops BFS
  if (
    options.focusNodeId &&
    options.localGraphHops !== undefined &&
    options.localGraphHops >= 0
  ) {
    if (!candidateNodeIds.has(options.focusNodeId)) {
      return { nodes: [], edges: [] };
    }

    // Undirected BFS over currently eligible edges
    const adj = new Map<string, string[]>();
    for (const e of eligibleEdges) {
      if (!adj.has(e.source)) adj.set(e.source, []);
      if (!adj.has(e.target)) adj.set(e.target, []);
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }

    const distances = new Map<string, number>();
    distances.set(options.focusNodeId, 0);
    const queue: string[] = [options.focusNodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const d = distances.get(current)!;
      if (d < options.localGraphHops) {
        const neighbors = adj.get(current) || [];
        for (const nbr of neighbors) {
          if (!distances.has(nbr)) {
            distances.set(nbr, d + 1);
            queue.push(nbr);
          }
        }
      }
    }

    candidateNodes = candidateNodes.filter((n) => distances.has(n.id));
  }

  // 3. Filter by onlyDriftOrErrors
  if (options.onlyDriftOrErrors) {
    candidateNodes = candidateNodes.filter(
      (n) => n.hasDrift || n.hasLintError || n.needsReverify
    );
  }

  // 4. Filter by searchQuery (case-insensitive on label or path)
  if (options.searchQuery && options.searchQuery.trim()) {
    const q = options.searchQuery.trim().toLowerCase();
    candidateNodes = candidateNodes.filter(
      (n) => n.label.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)
    );
  }

  // 5. Final edges between kept nodes
  const finalNodeIds = new Set(candidateNodes.map((n) => n.id));
  const finalEdges = eligibleEdges.filter(
    (e) => finalNodeIds.has(e.source) && finalNodeIds.has(e.target)
  );

  return {
    nodes: candidateNodes,
    edges: finalEdges,
  };
}
