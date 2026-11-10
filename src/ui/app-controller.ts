import { buildWikiCodeGraph, filterWikiGraph } from '../lib/graph-builder.ts';
import { parseFrontmatter } from '../lib/frontmatter.ts';
import { parseSchemaMarkdown, DEFAULT_CORE_MAP } from '../lib/schema-parser.ts';
import { parseTrackerMarkdown, parseHandoffMarkdown } from '../lib/markdown-tables.ts';
import { GraphCanvas } from './graph-canvas.ts';
import type {
  WikiGraph,
  GraphNode,
  GraphFilterOptions,
  SchemaConfig,
} from '../types/wiki.ts';

export interface WikiPageEntry {
  wiki_rel_path: string;
  content: string;
  size_bytes: number;
}

export interface GitState {
  head_sha: string;
  branch: string;
  is_dirty: boolean;
  dirty_files: string[];
  handoff_commits_behind: number;
}

export interface LintFinding {
  wiki_rel_path: string;
  line: number;
  message: string;
}

export interface LintReport {
  exit_code: number;
  findings: LintFinding[];
  infos: string[];
  raw_output: string;
}

export interface WikiSnapshot {
  repo_path: string;
  wiki_root?: string;
  is_initialized: boolean;
  warning?: string;
  git_state: GitState;
  pages: WikiPageEntry[];
  repo_files: string[];
  changed_files_by_page: Record<string, string[]>;
  lint_report?: LintReport;
}

export interface DirEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
  hasWiki: boolean;
}

export interface ListDirsResponse {
  currentPath: string;
  parentPath?: string | null;
  homePath: string;
  isGitRepo: boolean;
  hasWiki: boolean;
  entries: DirEntry[];
}

export interface PickFolderResponse {
  cancelled: boolean;
  selectedPath?: string;
  snapshot?: WikiSnapshot;
}

export class AppController {
  private snapshot: WikiSnapshot | null = null;
  private graphCanvas: GraphCanvas | null = null;
  private schemaConfig: SchemaConfig | null = null;

  // Folder browser state
  private folderCurrentPath: string = '';
  private folderParentPath: string | null = null;
  private folderHomePath: string = '';

  // View state
  private activeTab: 'workbench' | 'tracker' | 'decisions' | 'baton' | 'lint' = 'workbench';
  private activeWikiPage: WikiPageEntry | null = null;
  private isEditorDirty = false;
  private selectedNodeId: string | null = null;

  // Filter state
  private filterOptions: GraphFilterOptions = {
    includeCodeSources: false,
    onlyDriftOrErrors: false,
    searchQuery: '',
    localGraphHops: undefined,
  };

  // EventSource for live filesystem changes
  private eventSource: EventSource | null = null;

  constructor() {
    this.initElements();
    this.initGraphCanvas();
    this.setupEventListeners();
    this.connectEventSource();
    this.fetchState();
  }

  private initElements(): void {
    // Canvas container sizing
    window.addEventListener('resize', () => {
      if (this.graphCanvas) {
        this.graphCanvas.resizeCanvas();
      }
    });
  }

  private initGraphCanvas(): void {
    const canvas = document.getElementById('graph-canvas') as HTMLCanvasElement | null;
    if (canvas) {
      this.graphCanvas = new GraphCanvas(canvas, {
        onSelectNode: (node: GraphNode) => {
          this.handleNodeClick(node);
        },
      });
    }
  }

  private connectEventSource(): void {
    if (this.eventSource) {
      this.eventSource.close();
    }
    this.eventSource = new EventSource('/api/events');
    this.eventSource.addEventListener('fs-changed', () => {
      this.fetchState(true);
    });
    this.eventSource.onerror = () => {
      // Browser auto-reconnects SSE
    };
  }

  public async fetchState(preserveEditor = false): Promise<void> {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: WikiSnapshot = await res.json();
      this.snapshot = data;
      this.renderAll(preserveEditor);
    } catch (err) {
      console.error('Failed to fetch wiki state:', err);
    }
  }

  private renderAll(preserveEditor = false): void {
    if (!this.snapshot) return;

    this.parseActiveSchema();
    this.renderTopBar();
    this.renderSidebar();
    this.renderGraph();

    if (!preserveEditor || !this.activeWikiPage) {
      if (this.snapshot.is_initialized && this.snapshot.pages.length > 0) {
        const indexPage =
          this.snapshot.pages.find((p) => p.wiki_rel_path === 'index.md') ||
          this.snapshot.pages[0];
        if (!this.activeWikiPage) {
          this.openPage(indexPage.wiki_rel_path);
        }
      }
    }

    this.renderActiveTab();
  }

  private parseActiveSchema(): void {
    if (!this.snapshot || !this.snapshot.is_initialized) {
      this.schemaConfig = null;
      return;
    }
    const schemaPage = this.snapshot.pages.find((p) => p.wiki_rel_path === 'SCHEMA.md');
    if (schemaPage) {
      this.schemaConfig = parseSchemaMarkdown(schemaPage.content);
    } else {
      this.schemaConfig = null;
    }
  }

  private renderTopBar(): void {
    if (!this.snapshot) return;

    // Repo path
    const repoInput = document.getElementById('repo-path-input') as HTMLInputElement | null;
    if (repoInput && document.activeElement !== repoInput) {
      repoInput.value = this.snapshot.repo_path || '';
    }

    // Git Pill
    const gitPill = document.getElementById('git-status-pill');
    if (gitPill) {
      if (this.snapshot.git_state && this.snapshot.git_state.head_sha !== 'unknown') {
        const branch = this.snapshot.git_state.branch || 'detached';
        const sha = this.snapshot.git_state.head_sha || '';
        gitPill.textContent = `${branch} @ ${sha}`;
        gitPill.className = 'pill pill-git';
      } else {
        gitPill.textContent = 'No Git';
        gitPill.className = 'pill pill-dimmed';
      }
    }

    // Drift Badge
    const driftBadge = document.getElementById('drift-badge');
    if (driftBadge) {
      let driftCount = 0;
      if (this.snapshot.changed_files_by_page) {
        for (const files of Object.values(this.snapshot.changed_files_by_page)) {
          if (files.length > 0) driftCount++;
        }
      }
      driftBadge.textContent = `${driftCount} Drift`;
      driftBadge.className = driftCount > 0 ? 'pill pill-drift' : 'pill pill-clean';
    }

    // Lint Badge
    const lintBadge = document.getElementById('lint-badge');
    if (lintBadge) {
      if (this.snapshot.lint_report) {
        const exitCode = this.snapshot.lint_report.exit_code;
        const findingCount = this.snapshot.lint_report.findings.length;
        if (exitCode === 0) {
          lintBadge.textContent = 'Lint PASS';
          lintBadge.className = 'pill pill-pass';
        } else {
          lintBadge.textContent = `Lint FAIL (${findingCount})`;
          lintBadge.className = 'pill pill-fail';
        }
      } else {
        lintBadge.textContent = 'Lint N/A';
        lintBadge.className = 'pill pill-dimmed';
      }
    }

    // Init Wiki Button visibility
    const initBtn = document.getElementById('init-wiki-btn');
    if (initBtn) {
      initBtn.textContent = this.snapshot.is_initialized ? 'Re-init' : '+ Init Wiki';
    }
  }

  private renderSidebar(): void {
    if (!this.snapshot) return;

    // Root label
    const rootLabel = document.getElementById('wiki-root-label');
    if (rootLabel) {
      rootLabel.textContent = this.snapshot.is_initialized
        ? `Root: ${this.snapshot.wiki_root}/`
        : 'Wiki Uninitialized';
    }

    // Read Budget Meter
    const budgetBarFill = document.getElementById('budget-bar-fill');
    const budgetText = document.getElementById('budget-text');
    if (budgetBarFill && budgetText) {
      const coreMap = this.schemaConfig?.coreMap || DEFAULT_CORE_MAP;
      const corePaths = new Set(Object.values(coreMap));
      let coreBytes = 0;

      for (const p of this.snapshot.pages) {
        if (corePaths.has(p.wiki_rel_path)) {
          coreBytes += p.size_bytes;
        }
      }

      const budgetLimit = this.schemaConfig?.budgets.coreReadBytes || 60000;
      const pct = Math.min(100, Math.round((coreBytes / budgetLimit) * 100));
      const kbUsed = (coreBytes / 1024).toFixed(1);
      const kbLimit = (budgetLimit / 1024).toFixed(1);

      budgetBarFill.style.width = `${pct}%`;
      budgetBarFill.className =
        pct > 100 ? 'progress-fill over-budget' : 'progress-fill under-budget';
      budgetText.textContent = `${kbUsed} KB / ${kbLimit} KB (${pct}%)`;
    }

    // Core Map Pages list
    const coreList = document.getElementById('core-map-list');
    if (coreList) {
      coreList.innerHTML = '';
      const coreMap = this.schemaConfig?.coreMap || DEFAULT_CORE_MAP;

      for (const [role, relPath] of Object.entries(coreMap)) {
        const page = this.snapshot.pages.find((p) => p.wiki_rel_path === relPath);
        const li = document.createElement('li');
        li.className = 'sidebar-item' + (this.activeWikiPage?.wiki_rel_path === relPath ? ' active' : '');

        const hasDrift = page && (this.snapshot.changed_files_by_page[page.wiki_rel_path]?.length || 0) > 0;
        const hasLint = page && this.snapshot.lint_report?.findings.some((f) => f.wiki_rel_path === relPath);

        let badgesHtml = '';
        if (hasDrift) badgesHtml += '<span class="dot dot-drift" title="Git drift"></span>';
        if (hasLint) badgesHtml += '<span class="dot dot-lint" title="Lint finding"></span>';

        li.innerHTML = `
          <span class="item-role">${role}</span>
          <span class="item-title">${relPath}</span>
          <span class="item-badges">${badgesHtml}</span>
        `;

        li.addEventListener('click', () => {
          this.switchTab('workbench');
          this.openPage(relPath);
        });

        coreList.appendChild(li);
      }
    }

    // Decisions list
    const decisionsList = document.getElementById('decisions-list');
    if (decisionsList) {
      decisionsList.innerHTML = '';
      const decisionPages = this.snapshot.pages.filter(
        (p) => p.wiki_rel_path.startsWith('project/decisions/') || p.wiki_rel_path.startsWith('decisions/')
      );

      for (const dp of decisionPages) {
        const fm = parseFrontmatter(dp.content);
        const status = fm.fields['status'] || 'proposed';
        const title = fm.fields['title'] || dp.wiki_rel_path.split('/').pop() || 'Decision';

        const li = document.createElement('li');
        li.className = 'sidebar-item' + (this.activeWikiPage?.wiki_rel_path === dp.wiki_rel_path ? ' active' : '');
        li.innerHTML = `
          <span class="badge badge-status-${status}">${status}</span>
          <span class="item-title">${title}</span>
        `;
        li.addEventListener('click', () => {
          this.switchTab('workbench');
          this.openPage(dp.wiki_rel_path);
        });
        decisionsList.appendChild(li);
      }
    }

    // Topics list
    const topicsList = document.getElementById('topics-list');
    if (topicsList) {
      topicsList.innerHTML = '';
      const topics = this.schemaConfig?.topics || [];
      for (const t of topics) {
        const matchingPages = this.snapshot.pages.filter(
          (p) => p.wiki_rel_path.startsWith(t.path) && p.wiki_rel_path !== 'SCHEMA.md'
        );
        const li = document.createElement('li');
        li.className = 'sidebar-item topic-item';
        li.innerHTML = `
          <span class="item-topic">${t.name}</span>
          <span class="item-count">${matchingPages.length}</span>
        `;
        li.addEventListener('click', () => {
          if (matchingPages.length > 0) {
            this.switchTab('workbench');
            this.openPage(matchingPages[0].wiki_rel_path);
          }
        });
        topicsList.appendChild(li);
      }
    }

    // Uncovered repo files
    const uncoveredList = document.getElementById('uncovered-files-list');
    const uncoveredCount = document.getElementById('uncovered-count');
    if (uncoveredList) {
      uncoveredList.innerHTML = '';
      const graph = buildWikiCodeGraph({
        pages: this.snapshot.pages,
        repoFiles: this.snapshot.repo_files,
        changedFilesByPage: this.snapshot.changed_files_by_page,
        lintFindings: this.snapshot.lint_report?.findings,
        schema: this.schemaConfig || undefined,
      });

      if (uncoveredCount) {
        uncoveredCount.textContent = `${graph.uncoveredRepoFiles.length}`;
      }

      for (const f of graph.uncoveredRepoFiles.slice(0, 50)) {
        const li = document.createElement('li');
        li.className = 'sidebar-item uncovered-file';
        li.textContent = f;
        li.addEventListener('click', () => {
          this.openCodeDrawer(f);
        });
        uncoveredList.appendChild(li);
      }
    }
  }

  private renderGraph(): void {
    if (!this.graphCanvas || !this.snapshot) return;

    const fullGraph = buildWikiCodeGraph({
      pages: this.snapshot.pages,
      repoFiles: this.snapshot.repo_files,
      changedFilesByPage: this.snapshot.changed_files_by_page,
      lintFindings: this.snapshot.lint_report?.findings,
      schema: this.schemaConfig || undefined,
    });

    const filtered = filterWikiGraph(fullGraph, {
      ...this.filterOptions,
      focusNodeId: this.selectedNodeId || undefined,
    });

    this.graphCanvas.setData(filtered.nodes, filtered.edges);
    if (this.selectedNodeId) {
      this.graphCanvas.selectNode(this.selectedNodeId);
    }
  }

  private handleNodeClick(node: GraphNode): void {
    this.selectedNodeId = node.id;
    if (node.kind === 'wiki') {
      this.switchTab('workbench');
      this.openPage(node.path);
    } else if (node.kind === 'source') {
      this.openCodeDrawer(node.path);
    }
  }

  public openPage(wikiRelPath: string): void {
    if (!this.snapshot) return;
    const page = this.snapshot.pages.find((p) => p.wiki_rel_path === wikiRelPath);
    if (!page) return;

    this.activeWikiPage = page;
    this.selectedNodeId = `wiki:${wikiRelPath}`;
    if (this.graphCanvas) {
      this.graphCanvas.selectNode(this.selectedNodeId);
    }

    const pathHeader = document.getElementById('editor-file-path');
    if (pathHeader) {
      pathHeader.textContent = page.wiki_rel_path;
    }

    const editor = document.getElementById('editor-textarea') as HTMLTextAreaElement | null;
    if (editor) {
      editor.value = page.content;
      this.isEditorDirty = false;
    }

    this.renderInspector(page.content);
    this.renderPreview(page.content);
    this.renderSidebar(); // highlight active item
  }

  private renderInspector(markdown: string): void {
    const inspector = document.getElementById('frontmatter-inspector');
    if (!inspector) return;

    const fm = parseFrontmatter(markdown);
    let html = '<div class="inspector-fields">';

    if (fm.fields['role']) {
      html += `<span class="chip chip-role">role: ${this.escape(fm.fields['role'])}</span>`;
    }
    if (fm.fields['status']) {
      html += `<span class="chip chip-status">status: ${this.escape(fm.fields['status'])}</span>`;
    }
    if (fm.fields['confidence']) {
      html += `<span class="chip chip-confidence">confidence: ${this.escape(fm.fields['confidence'])}</span>`;
    }
    if (fm.fields['source_commit']) {
      html += `<span class="chip chip-commit">commit: ${this.escape(fm.fields['source_commit'])}</span>`;
    }
    if (fm.fields['updated']) {
      html += `<span class="chip chip-date">updated: ${this.escape(fm.fields['updated'])}</span>`;
    }

    html += '</div>';

    if (fm.sources.length > 0) {
      html += '<div class="inspector-sources"><span class="sources-label">Sources:</span>';
      for (const s of fm.sources) {
        html += `<button class="source-chip" data-source="${this.escape(s)}">${this.escape(s)}</button>`;
      }
      html += '</div>';
    }

    inspector.innerHTML = html;

    inspector.querySelectorAll('.source-chip').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const sourcePath = target.getAttribute('data-source');
        if (sourcePath) {
          const clean = sourcePath.split('#')[0].replace(/:\d+(?::\d+)?$/, '');
          this.openCodeDrawer(clean, fm.fields['source_commit']);
        }
      });
    });
  }

  private renderPreview(markdown: string): void {
    const preview = document.getElementById('editor-preview');
    if (!preview) return;

    const fm = parseFrontmatter(markdown);
    const body = fm.hasFrontmatter ? fm.body : markdown;
    preview.innerHTML = this.markdownToHtml(body);

    preview.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const href = link.getAttribute('href');
        if (href && !href.startsWith('http')) {
          const clean = href.replace(/^\.\//, '').replace(/^wiki\//, '');
          this.openPage(clean);
        }
      });
    });
  }

  private markdownToHtml(md: string): string {
    const lines = md.split('\n');
    let html = '';
    let inTable = false;
    let tableHeaderDone = false;
    let inCode = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.trim().startsWith('```')) {
        if (!inCode) {
          inCode = true;
          html += '<pre><code>';
        } else {
          inCode = false;
          html += '</code></pre>\n';
        }
        continue;
      }

      if (inCode) {
        html += this.escape(line) + '\n';
        continue;
      }

      // Tables
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const cells = line
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());
        const isDelim = cells.every((c) => /^:?-+:?$/.test(c));

        if (!inTable) {
          inTable = true;
          tableHeaderDone = false;
          html += '<table class="wiki-table"><thead><tr>';
          for (const c of cells) {
            html += `<th>${this.inlineMarkdown(c)}</th>`;
          }
          html += '</tr></thead><tbody>\n';
          continue;
        }

        if (isDelim) {
          tableHeaderDone = true;
          continue;
        }

        html += '<tr>';
        for (const c of cells) {
          html += `<td>${this.inlineMarkdown(c)}</td>`;
        }
        html += '</tr>\n';
        continue;
      } else if (inTable) {
        inTable = false;
        html += '</tbody></table>\n';
      }

      // Headings
      if (line.startsWith('# ')) {
        html += `<h1>${this.inlineMarkdown(line.slice(2))}</h1>\n`;
      } else if (line.startsWith('## ')) {
        html += `<h2>${this.inlineMarkdown(line.slice(3))}</h2>\n`;
      } else if (line.startsWith('### ')) {
        html += `<h3>${this.inlineMarkdown(line.slice(4))}</h3>\n`;
      } else if (line.startsWith('- ')) {
        html += `<li>${this.inlineMarkdown(line.slice(2))}</li>\n`;
      } else if (line.trim() === '') {
        html += '<br/>\n';
      } else {
        html += `<p>${this.inlineMarkdown(line)}</p>\n`;
      }
    }

    if (inTable) {
      html += '</tbody></table>\n';
    }

    return html;
  }

  private inlineMarkdown(text: string): string {
    let t = this.escape(text);
    // Code
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Links [title](url)
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return t;
  }

  private escape(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  public async saveCurrentPage(): Promise<void> {
    if (!this.activeWikiPage) return;
    const editor = document.getElementById('editor-textarea') as HTMLTextAreaElement | null;
    if (!editor) return;

    const newContent = editor.value;
    try {
      const res = await fetch('/api/write-wiki-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wikiRelPath: this.activeWikiPage.wiki_rel_path,
          content: newContent,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(`Failed to save: ${err.error || res.statusText}`);
        return;
      }

      const updatedSnapshot: WikiSnapshot = await res.json();
      this.snapshot = updatedSnapshot;
      this.isEditorDirty = false;
      this.renderAll(true);
      this.showToast('Page saved successfully!');
    } catch (err) {
      alert(`Save error: ${err}`);
    }
  }

  public async openCodeDrawer(relPath: string, sourceCommit?: string): Promise<void> {
    const drawer = document.getElementById('code-drawer');
    const pathElem = document.getElementById('code-drawer-path');
    const commitElem = document.getElementById('code-drawer-commit');
    const diffElem = document.getElementById('code-drawer-diff');
    const contentElem = document.getElementById('code-drawer-content');

    if (!drawer) return;
    drawer.classList.add('open');

    if (pathElem) pathElem.textContent = relPath;
    if (commitElem) commitElem.textContent = sourceCommit ? `Commit: ${sourceCommit}` : '';
    if (diffElem) diffElem.innerHTML = '<div class="drawer-loading">Loading diff...</div>';
    if (contentElem) contentElem.textContent = 'Loading content...';

    try {
      const res = await fetch('/api/read-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relPath, sourceCommit }),
      });

      if (!res.ok) {
        if (contentElem) contentElem.textContent = `File not found or blocked (${res.status})`;
        if (diffElem) diffElem.innerHTML = '';
        return;
      }

      const payload = await res.json();
      if (contentElem) contentElem.textContent = payload.content;

      if (diffElem) {
        if (payload.diff && payload.diff.trim()) {
          diffElem.innerHTML = `<h4>Git Diff since ${this.escape(sourceCommit || '')}</h4><pre class="diff-block">${this.highlightDiff(payload.diff)}</pre>`;
        } else {
          diffElem.innerHTML = '<div class="no-diff-msg">No changes since source commit.</div>';
        }
      }
    } catch (err) {
      if (contentElem) contentElem.textContent = `Error reading file: ${err}`;
    }
  }

  private highlightDiff(diff: string): string {
    return diff
      .split('\n')
      .map((line) => {
        const esc = this.escape(line);
        if (line.startsWith('+') && !line.startsWith('+++')) {
          return `<span class="diff-add">${esc}</span>`;
        }
        if (line.startsWith('-') && !line.startsWith('---')) {
          return `<span class="diff-del">${esc}</span>`;
        }
        if (line.startsWith('@@')) {
          return `<span class="diff-hunk">${esc}</span>`;
        }
        return esc;
      })
      .join('\n');
  }

  public closeCodeDrawer(): void {
    const drawer = document.getElementById('code-drawer');
    if (drawer) drawer.classList.remove('open');
  }

  public switchTab(tab: 'workbench' | 'tracker' | 'decisions' | 'baton' | 'lint'): void {
    this.activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('active', p.id === `tab-${tab}`);
    });
    this.renderActiveTab();
  }

  private renderActiveTab(): void {
    if (!this.snapshot) return;

    if (this.activeTab === 'tracker') {
      this.renderTrackerTab();
    } else if (this.activeTab === 'decisions') {
      this.renderDecisionsTab();
    } else if (this.activeTab === 'baton') {
      this.renderBatonTab();
    } else if (this.activeTab === 'lint') {
      this.renderLintTab();
    }
  }

  private renderTrackerTab(): void {
    if (!this.snapshot) return;
    const trackerPage = this.snapshot.pages.find(
      (p) => p.wiki_rel_path === 'project/work-tracker.md' || p.wiki_rel_path === 'work-tracker.md'
    );
    if (!trackerPage) return;

    const tracker = parseTrackerMarkdown(trackerPage.content);

    // Open Table
    const openTbody = document.getElementById('tracker-open-tbody');
    if (openTbody) {
      openTbody.innerHTML = '';
      for (const row of tracker.open) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><code>${this.escape(row.id)}</code></td>
          <td><span class="status-icon">${this.escape(row.status)}</span></td>
          <td>${this.escape(row.goal)}</td>
          <td>${this.escape(row.doneWhen)}</td>
          <td>${this.escape(row.owner)}</td>
          <td><code>${this.escape(row.nextVerification)}</code></td>
          <td>${this.escape(row.evidence)}</td>
          <td>
            <button class="btn btn-sm btn-close-unproven" data-id="${this.escape(row.id)}">Close (⚫)</button>
          </td>
        `;
        openTbody.appendChild(tr);
      }
    }

    // Proposals Table
    const propTbody = document.getElementById('tracker-proposals-tbody');
    if (propTbody) {
      propTbody.innerHTML = '';
      tracker.proposals.forEach((row, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td><strong>${this.escape(row.proposal)}</strong></td>
          <td>${this.escape(row.by)}</td>
          <td>${this.escape(row.date)}</td>
          <td>${this.escape(row.why)}</td>
          <td>
            <button class="btn btn-sm btn-promote-proposal" data-idx="${idx}">Promote</button>
          </td>
        `;
        propTbody.appendChild(tr);
      });
    }

    // Done Table
    const doneTbody = document.getElementById('tracker-done-tbody');
    if (doneTbody) {
      doneTbody.innerHTML = '';
      for (const row of tracker.done) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><code>${this.escape(row.id)}</code></td>
          <td><span class="status-icon">${this.escape(row.status)}</span></td>
          <td>${this.escape(row.goal)}</td>
          <td>${this.escape(row.closed)}</td>
          <td>${this.escape(row.criteriaMet)}</td>
          <td>${this.escape(row.evidence)}</td>
        `;
        doneTbody.appendChild(tr);
      }
    }

    // Wire action buttons
    document.querySelectorAll('.btn-promote-proposal').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt((e.currentTarget as HTMLElement).getAttribute('data-idx') || '0');
        this.openPromoteModal(idx);
      });
    });

    document.querySelectorAll('.btn-close-unproven').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).getAttribute('data-id') || '';
        this.openCloseUnprovenModal(id);
      });
    });
  }

  private renderDecisionsTab(): void {
    if (!this.snapshot) return;
    const grid = document.getElementById('decisions-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const decisions = this.snapshot.pages.filter(
      (p) => p.wiki_rel_path.startsWith('project/decisions/') || p.wiki_rel_path.startsWith('decisions/')
    );

    for (const d of decisions) {
      const fm = parseFrontmatter(d.content);
      const title = fm.fields['title'] || d.wiki_rel_path.split('/').pop() || 'ADR';
      const status = fm.fields['status'] || 'proposed';
      const updated = fm.fields['updated'] || '';
      const confidence = fm.fields['confidence'] || 'high';

      const card = document.createElement('div');
      card.className = `decision-card status-${status}`;
      card.innerHTML = `
        <div class="card-header">
          <span class="badge badge-status-${status}">${status}</span>
          <span class="card-date">${updated}</span>
        </div>
        <h3 class="card-title">${this.escape(title)}</h3>
        <div class="card-path"><code>${this.escape(d.wiki_rel_path)}</code></div>
        <div class="card-confidence">Confidence: ${confidence}</div>
        <div class="card-actions">
          <button class="btn btn-sm btn-open-decision" data-path="${this.escape(d.wiki_rel_path)}">View in Workbench</button>
          ${status === 'proposed' ? `<button class="btn btn-sm btn-primary btn-approve-decision" data-path="${this.escape(d.wiki_rel_path)}">Approve (Human)</button>` : ''}
        </div>
      `;
      grid.appendChild(card);
    }

    grid.querySelectorAll('.btn-open-decision').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const path = (e.currentTarget as HTMLElement).getAttribute('data-path')!;
        this.switchTab('workbench');
        this.openPage(path);
      });
    });

    grid.querySelectorAll('.btn-approve-decision').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const path = (e.currentTarget as HTMLElement).getAttribute('data-path')!;
        this.openApproveDecisionModal(path);
      });
    });
  }

  private renderBatonTab(): void {
    if (!this.snapshot) return;
    const handoffPage = this.snapshot.pages.find(
      (p) => p.wiki_rel_path === 'agent/handoff.md' || p.wiki_rel_path === 'handoff.md'
    );
    if (!handoffPage) return;

    const handoff = parseHandoffMarkdown(handoffPage.content);

    // Staleness warning banner
    const stalenessBanner = document.getElementById('baton-staleness-banner');
    if (stalenessBanner) {
      const behind = this.snapshot.git_state?.handoff_commits_behind || 0;
      if (behind >= 5) {
        stalenessBanner.style.display = 'block';
        stalenessBanner.textContent = `⚠️ Warning: agent/handoff.md is ${behind} commits behind Git HEAD! Run /wiki-sync to refresh context.`;
      } else {
        stalenessBanner.style.display = 'none';
      }
    }

    // State bullets
    const bulletsContainer = document.getElementById('handoff-state-bullets');
    if (bulletsContainer) {
      let html = '<ul class="state-bullets-list">';
      for (const [key, val] of Object.entries(handoff.stateBullets)) {
        html += `<li><strong>${this.escape(key)}:</strong> ${this.escape(val)}</li>`;
      }
      html += '</ul>';
      bulletsContainer.innerHTML = html;
    }

    // Baton Table
    const tbody = document.getElementById('handoff-baton-tbody');
    if (tbody) {
      tbody.innerHTML = '';
      for (const row of handoff.baton) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${this.escape(row.order)}</strong></td>
          <td>${this.escape(row.task)}</td>
          <td><code>${this.escape(row.startFiles)}</code></td>
          <td>${this.escape(row.doneWhen)}</td>
          <td><code>${this.escape(row.verificationCommand)}</code></td>
          <td>${this.escape(row.notes)}</td>
        `;
        tbody.appendChild(tr);
      }
    }

    // Blockers
    const blockersContainer = document.getElementById('handoff-blockers-list');
    if (blockersContainer) {
      if (handoff.blockers.length === 0) {
        blockersContainer.innerHTML = '<div class="no-blockers">No active blockers.</div>';
      } else {
        let html = '<ul class="blockers-list">';
        for (const b of handoff.blockers) {
          html += `<li>${this.escape(JSON.stringify(b))}</li>`;
        }
        html += '</ul>';
        blockersContainer.innerHTML = html;
      }
    }
  }

  private renderLintTab(): void {
    if (!this.snapshot) return;
    const report = this.snapshot.lint_report;
    const exitBadge = document.getElementById('lint-exit-badge');
    const findingsTbody = document.getElementById('lint-findings-tbody');
    const rawOutput = document.getElementById('lint-raw-output');

    if (exitBadge) {
      if (!report) {
        exitBadge.textContent = 'Lint not run';
        exitBadge.className = 'badge badge-dimmed';
      } else if (report.exit_code === 0) {
        exitBadge.textContent = 'Exit 0: PASS';
        exitBadge.className = 'badge badge-pass';
      } else {
        exitBadge.textContent = `Exit ${report.exit_code}: FAIL (${report.findings.length} findings)`;
        exitBadge.className = 'badge badge-fail';
      }
    }

    if (findingsTbody) {
      findingsTbody.innerHTML = '';
      if (report && report.findings.length > 0) {
        for (const f of report.findings) {
          const tr = document.createElement('tr');
          tr.className = 'clickable-row';
          tr.innerHTML = `
            <td><code>${this.escape(f.wiki_rel_path)}</code></td>
            <td><code>${f.line}</code></td>
            <td>${this.escape(f.message)}</td>
          `;
          tr.addEventListener('click', () => {
            this.switchTab('workbench');
            this.openPage(f.wiki_rel_path);
          });
          findingsTbody.appendChild(tr);
        }
      } else {
        findingsTbody.innerHTML = '<tr><td colspan="3" class="empty-state">No lint findings.</td></tr>';
      }
    }

    if (rawOutput && report) {
      rawOutput.textContent = report.raw_output || 'No output.';
    }
  }

  // Modals
  public openPromoteModal(proposalIndex: number): void {
    const modal = document.getElementById('promote-modal');
    const idxInput = document.getElementById('promote-proposal-index') as HTMLInputElement | null;
    if (idxInput) idxInput.value = String(proposalIndex);
    if (modal) modal.classList.add('open');
  }

  public openCloseUnprovenModal(taskId: string): void {
    const modal = document.getElementById('close-unproven-modal');
    const idInput = document.getElementById('close-task-id') as HTMLInputElement | null;
    if (idInput) idInput.value = taskId;
    if (modal) modal.classList.add('open');
  }

  public openApproveDecisionModal(decisionFile: string): void {
    const modal = document.getElementById('approve-decision-modal');
    const fileInput = document.getElementById('approve-decision-file') as HTMLInputElement | null;
    if (fileInput) fileInput.value = decisionFile;
    if (modal) modal.classList.add('open');
  }

  public closeAllModals(): void {
    document.querySelectorAll('.modal').forEach((m) => m.classList.remove('open'));
  }

  public async openRepoPath(repoPath: string): Promise<void> {
    try {
      const res = await fetch('/api/open-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath }),
      });
      if (res.ok) {
        this.snapshot = await res.json();
        this.closeAllModals();
        this.renderAll();
        this.showToast('Repository opened');
      } else {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        alert(`Failed to open repo: ${err.error || res.statusText}`);
      }
    } catch (err) {
      alert(`Failed to open repo: ${err}`);
    }
  }

  public async browseDirectory(targetPath?: string): Promise<void> {
    try {
      const res = await fetch('/api/list-dirs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetPath ? { path: targetPath } : {}),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        alert(`Failed to browse directory: ${err.error || res.statusText}`);
        return;
      }

      const data: ListDirsResponse = await res.json();
      this.folderCurrentPath = data.currentPath;
      this.folderParentPath = data.parentPath || null;
      this.folderHomePath = data.homePath;

      this.renderFolderBrowser(data);
    } catch (err) {
      alert(`Failed to browse directory: ${err}`);
    }
  }

  private renderFolderBrowser(data: ListDirsResponse): void {
    const currentPathEl = document.getElementById('folder-current-path');
    if (currentPathEl) {
      currentPathEl.textContent = data.currentPath;
      currentPathEl.title = data.currentPath;
    }

    const currentBadgesEl = document.getElementById('folder-current-badges');
    if (currentBadgesEl) {
      currentBadgesEl.innerHTML = '';
      if (data.isGitRepo) {
        const gitBadge = document.createElement('span');
        gitBadge.className = 'pill pill-git';
        gitBadge.textContent = 'Git';
        currentBadgesEl.appendChild(gitBadge);
      }
      if (data.hasWiki) {
        const wikiBadge = document.createElement('span');
        wikiBadge.className = 'pill pill-clean';
        wikiBadge.textContent = 'Wiki';
        currentBadgesEl.appendChild(wikiBadge);
      }
    }

    const upBtn = document.getElementById('folder-up-btn') as HTMLButtonElement | null;
    if (upBtn) {
      upBtn.disabled = !data.parentPath || data.parentPath === data.currentPath;
    }

    const listEl = document.getElementById('folder-entries-list');
    if (listEl) {
      listEl.innerHTML = '';
      if (data.entries.length === 0) {
        const emptyLi = document.createElement('li');
        emptyLi.className = 'folder-empty';
        emptyLi.textContent = 'No subdirectories found';
        listEl.appendChild(emptyLi);
      } else {
        for (const entry of data.entries) {
          const li = document.createElement('li');
          li.className = 'folder-entry-item';

          const mainDiv = document.createElement('div');
          mainDiv.className = 'folder-entry-main';

          const icon = document.createElement('span');
          icon.className = 'folder-entry-icon';
          icon.textContent = '📁';

          const name = document.createElement('span');
          name.className = 'folder-entry-name';
          name.textContent = entry.name;
          name.title = entry.name;

          mainDiv.appendChild(icon);
          mainDiv.appendChild(name);

          if (entry.isGitRepo || entry.hasWiki) {
            const badgesDiv = document.createElement('div');
            badgesDiv.className = 'folder-entry-badges';
            if (entry.isGitRepo) {
              const b = document.createElement('span');
              b.className = 'pill pill-git';
              b.textContent = 'Git';
              badgesDiv.appendChild(b);
            }
            if (entry.hasWiki) {
              const b = document.createElement('span');
              b.className = 'pill pill-clean';
              b.textContent = 'Wiki';
              badgesDiv.appendChild(b);
            }
            mainDiv.appendChild(badgesDiv);
          }

          const actionsDiv = document.createElement('div');
          actionsDiv.className = 'folder-entry-actions';

          const selectBtn = document.createElement('button');
          selectBtn.type = 'button';
          selectBtn.className = 'btn btn-sm btn-primary';
          selectBtn.textContent = 'Select';
          selectBtn.title = `Open ${entry.name} as active repository`;
          selectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openRepoPath(entry.path);
          });
          actionsDiv.appendChild(selectBtn);

          li.appendChild(mainDiv);
          li.appendChild(actionsDiv);

          // Clicking item row navigates into that directory
          li.addEventListener('click', () => {
            this.browseDirectory(entry.path);
          });

          listEl.appendChild(li);
        }
      }
    }
  }

  private setupEventListeners(): void {
    // Open repo
    const openRepoBtn = document.getElementById('repo-open-btn');
    const repoInput = document.getElementById('repo-path-input') as HTMLInputElement | null;
    if (openRepoBtn && repoInput) {
      openRepoBtn.addEventListener('click', async () => {
        const repoPath = repoInput.value.trim();
        if (!repoPath) return;
        await this.openRepoPath(repoPath);
      });
      repoInput.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          const repoPath = repoInput.value.trim();
          if (repoPath) {
            this.openRepoPath(repoPath);
          }
        }
      });
    }

    // Browse repository folders
    const browseBtn = document.getElementById('repo-browse-btn');
    if (browseBtn) {
      browseBtn.addEventListener('click', () => {
        document.getElementById('folder-browser-modal')?.classList.add('open');
        const startPath = this.snapshot?.repo_path;
        this.browseDirectory(startPath);
      });
    }

    // Folder browser toolbar navigation
    document.getElementById('folder-up-btn')?.addEventListener('click', () => {
      if (this.folderParentPath) {
        this.browseDirectory(this.folderParentPath);
      }
    });

    document.getElementById('folder-home-btn')?.addEventListener('click', () => {
      if (this.folderHomePath) {
        this.browseDirectory(this.folderHomePath);
      }
    });

    document.getElementById('folder-native-btn')?.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/pick-folder', { method: 'POST' });
        if (res.ok) {
          const data: PickFolderResponse = await res.json();
          if (!data.cancelled && data.snapshot) {
            this.snapshot = data.snapshot;
            this.closeAllModals();
            this.renderAll();
            this.showToast('Repository opened');
          }
        }
      } catch (err) {
        alert(`Native dialog error: ${err}`);
      }
    });

    document.getElementById('folder-select-current-btn')?.addEventListener('click', () => {
      if (this.folderCurrentPath) {
        this.openRepoPath(this.folderCurrentPath);
      }
    });

    // Tabs
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab') as any;
        if (tab) this.switchTab(tab);
      });
    });

    // Editor Save
    const saveBtn = document.getElementById('btn-save-page');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveCurrentPage());
    }

    // Editor dirty detection
    const editor = document.getElementById('editor-textarea') as HTMLTextAreaElement | null;
    if (editor) {
      editor.addEventListener('input', () => {
        this.isEditorDirty = true;
        this.renderPreview(editor.value);
      });
      // Keyboard shortcut Ctrl+S / Cmd+S
      editor.addEventListener('keydown', (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          this.saveCurrentPage();
        }
      });
    }

    // Graph Filters
    const sourcesToggle = document.getElementById('filter-code-sources') as HTMLInputElement | null;
    if (sourcesToggle) {
      sourcesToggle.addEventListener('change', () => {
        this.filterOptions.includeCodeSources = sourcesToggle.checked;
        this.renderGraph();
      });
    }

    const driftToggle = document.getElementById('filter-drift-only') as HTMLInputElement | null;
    if (driftToggle) {
      driftToggle.addEventListener('change', () => {
        this.filterOptions.onlyDriftOrErrors = driftToggle.checked;
        this.renderGraph();
      });
    }

    const localToggle = document.getElementById('filter-local-graph') as HTMLInputElement | null;
    if (localToggle) {
      localToggle.addEventListener('change', () => {
        this.filterOptions.localGraphHops = localToggle.checked ? 1 : undefined;
        this.renderGraph();
      });
    }

    const searchInput = document.getElementById('graph-search-input') as HTMLInputElement | null;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.filterOptions.searchQuery = searchInput.value;
        this.renderGraph();
      });
    }

    // Zoom buttons
    document.getElementById('btn-reset-zoom')?.addEventListener('click', () => {
      this.graphCanvas?.resetView();
    });
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
      this.graphCanvas?.zoomIn();
    });
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
      this.graphCanvas?.zoomOut();
    });

    // Close drawers & modals
    document.getElementById('code-drawer-close')?.addEventListener('click', () => {
      this.closeCodeDrawer();
    });

    document.querySelectorAll('.modal-close').forEach((btn) => {
      btn.addEventListener('click', () => this.closeAllModals());
    });

    // Init Wiki Modal
    document.getElementById('init-wiki-btn')?.addEventListener('click', () => {
      document.getElementById('init-modal')?.classList.add('open');
    });

    document.getElementById('init-wiki-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const folder = (document.getElementById('init-folder') as HTMLInputElement).value || 'wiki';
      const language = (document.getElementById('init-language') as HTMLInputElement).value || 'English';
      const projectDivision = (document.getElementById('init-division') as HTMLInputElement).value || 'monolith';
      const topicsStr = (document.getElementById('init-topics') as HTMLInputElement).value || 'architecture, api';
      const sensitiveData = (document.getElementById('init-sensitive') as HTMLInputElement).checked;
      const forbiddenStr = (document.getElementById('init-forbidden') as HTMLInputElement).value || '';
      const agentEntryFile = (document.getElementById('init-agent-entry') as HTMLInputElement).value || 'CLAUDE.md';
      const parallelWork = (document.getElementById('init-parallel') as HTMLInputElement).checked;

      const topics = topicsStr.split(',').map((s) => s.trim()).filter(Boolean);
      const forbiddenTerms = forbiddenStr.split(',').map((s) => s.trim()).filter(Boolean);

      try {
        const res = await fetch('/api/init-wiki', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folder,
            language,
            projectDivision,
            topics,
            sensitiveData,
            forbiddenTerms,
            agentEntryFile,
            parallelWork,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          alert(`Init failed: ${err.error || res.statusText}`);
          return;
        }

        this.snapshot = await res.json();
        this.closeAllModals();
        this.renderAll();
        this.showToast('Wiki initialized successfully!');
      } catch (err) {
        alert(`Error initializing wiki: ${err}`);
      }
    });

    // Promote Form
    document.getElementById('promote-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const proposalIndex = parseInt(
        (document.getElementById('promote-proposal-index') as HTMLInputElement).value
      );
      const person = (document.getElementById('promote-person') as HTMLInputElement).value;
      const owner = (document.getElementById('promote-owner') as HTMLInputElement).value;
      const doneWhen = (document.getElementById('promote-done-when') as HTMLInputElement).value;
      const nextVerification = (document.getElementById('promote-verification') as HTMLInputElement).value;

      try {
        const res = await fetch('/api/human-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'promote-proposal',
            proposalIndex,
            person,
            owner,
            doneWhen,
            nextVerification,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          alert(`Action failed: ${err.error || res.statusText}`);
          return;
        }

        this.snapshot = await res.json();
        this.closeAllModals();
        this.renderAll(true);
        this.showToast('Proposal promoted to Open task!');
      } catch (err) {
        alert(`Action error: ${err}`);
      }
    });

    // Close Unproven Form
    document.getElementById('close-unproven-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const taskId = (document.getElementById('close-task-id') as HTMLInputElement).value;
      const person = (document.getElementById('close-person') as HTMLInputElement).value;
      const notProvenReason = (document.getElementById('close-reason') as HTMLInputElement).value;

      try {
        const res = await fetch('/api/human-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'close-unproven',
            taskId,
            person,
            notProvenReason,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          alert(`Action failed: ${err.error || res.statusText}`);
          return;
        }

        this.snapshot = await res.json();
        this.closeAllModals();
        this.renderAll(true);
        this.showToast(`Task ${taskId} closed as unproven (⚫)!`);
      } catch (err) {
        alert(`Action error: ${err}`);
      }
    });

    // Approve Decision Form
    document.getElementById('approve-decision-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const decisionFile = (document.getElementById('approve-decision-file') as HTMLInputElement).value;
      const person = (document.getElementById('approve-person') as HTMLInputElement).value;
      const whereContext = (document.getElementById('approve-context') as HTMLInputElement).value;

      try {
        const res = await fetch('/api/human-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'approve-decision',
            decisionFile,
            person,
            whereContext,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          alert(`Action failed: ${err.error || res.statusText}`);
          return;
        }

        this.snapshot = await res.json();
        this.closeAllModals();
        this.renderAll(true);
        this.showToast(`Decision ${decisionFile} approved!`);
      } catch (err) {
        alert(`Action error: ${err}`);
      }
    });

    // Agent Runner Modal
    document.getElementById('agent-runner-btn')?.addEventListener('click', () => {
      document.getElementById('agent-modal')?.classList.add('open');
    });

    document.getElementById('btn-agent-copy-prompt')?.addEventListener('click', async () => {
      const workflow = (document.getElementById('agent-workflow-select') as HTMLSelectElement).value;
      const target = (document.getElementById('agent-target-input') as HTMLInputElement).value;
      const host = (document.getElementById('agent-host-select') as HTMLSelectElement).value;

      try {
        const res = await fetch('/api/agent-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflow, target, host, runCli: false }),
        });

        if (res.ok) {
          const data = await res.json();
          const outArea = document.getElementById('agent-prompt-output') as HTMLTextAreaElement | null;
          if (outArea) outArea.value = data.prompt;
          navigator.clipboard?.writeText(data.prompt);
          this.showToast('Prompt copied to clipboard!');
        }
      } catch (err) {
        alert(`Failed to build prompt: ${err}`);
      }
    });

    document.getElementById('btn-agent-run-cli')?.addEventListener('click', async () => {
      const workflow = (document.getElementById('agent-workflow-select') as HTMLSelectElement).value;
      const target = (document.getElementById('agent-target-input') as HTMLInputElement).value;
      const host = (document.getElementById('agent-host-select') as HTMLSelectElement).value;
      const cliOut = document.getElementById('agent-cli-output') as HTMLTextAreaElement | null;

      if (cliOut) cliOut.value = 'Running CLI in background...';

      try {
        const res = await fetch('/api/agent-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflow, target, host, runCli: true }),
        });

        if (res.ok) {
          const data = await res.json();
          if (cliOut) cliOut.value = data.cliOutput || '(No CLI output returned)';
        } else {
          if (cliOut) cliOut.value = `CLI execution failed: ${res.statusText}`;
        }
      } catch (err) {
        if (cliOut) cliOut.value = `Error running CLI: ${err}`;
      }
    });
  }

  private showToast(msg: string): void {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 400);
    }, 2500);
  }
}
