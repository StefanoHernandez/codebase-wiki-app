import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { buildWikiCodeGraph } from '../src/lib/graph-builder.ts';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

async function waitForServer(url: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 200 || res.status === 404) {
        return;
      }
    } catch {
      // Retry after delay
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server failed to respond at ${url} within ${timeoutMs}ms`);
}

test('E2E Desktop Server and Obsidian UI', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-e2e-'));
  const port = await getFreePort();
  const binaryPath = path.resolve('src-tauri/target/debug/codebase-wiki-app');

  assert.ok(
    fs.existsSync(binaryPath),
    `Binary not found at ${binaryPath}. Run cargo build first.`
  );

  // 1. Initialize temporary git repository
  execSync('git init -b main', { cwd: tempDir });
  execSync('git config user.name "Stefano"', { cwd: tempDir });
  execSync('git config user.email "stefano@example.com"', { cwd: tempDir });

  fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(tempDir, 'src/index.ts'),
    'export const version = "1.0.0";\n',
    'utf-8'
  );
  execSync('git add . && git commit -m "initial commit"', { cwd: tempDir });
  const initialSha = execSync('git rev-parse --short HEAD', { cwd: tempDir })
    .toString()
    .trim();

  // 2. Spawn codebase-wiki-app server
  const serverProcess: ChildProcess = spawn(
    binaryPath,
    ['--repo', tempDir, '--port', String(port), '--headless'],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  t.after(() => {
    try {
      serverProcess.kill('SIGTERM');
    } catch {
      // ignore
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(`${baseUrl}/api/state`);

  // Step 1: Verify /api/state initially reports is_initialized: false
  await t.test('1. /api/state initially reports is_initialized: false', async () => {
    const res = await fetch(`${baseUrl}/api/state`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.is_initialized, false);
    assert.strictEqual(data.wiki_root, null);
    assert.ok(data.repo_files.includes('src/index.ts'));
  });

  // Step 2: POST /api/init-wiki initializes wiki and passes validate-wiki.py
  await t.test('2. POST /api/init-wiki initializes wiki with exit_code: 0', async () => {
    const initReq = {
      folder: 'wiki',
      language: 'English',
      projectDivision: 'monolith',
      topics: ['architecture', 'api'],
      sensitiveData: false,
      forbiddenTerms: [],
      agentEntryFile: 'CLAUDE.md',
      parallelWork: true,
    };

    const res = await fetch(`${baseUrl}/api/init-wiki`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(initReq),
    });

    assert.strictEqual(res.status, 200);
    const snapshot = await res.json();
    assert.strictEqual(snapshot.is_initialized, true);
    assert.strictEqual(snapshot.wiki_root, 'wiki');
    assert.ok(snapshot.pages.length >= 8);
    assert.strictEqual(snapshot.lint_report?.exit_code, 0);

    // Verify files on disk
    assert.ok(fs.existsSync(path.join(tempDir, 'wiki/SCHEMA.md')));
    assert.ok(fs.existsSync(path.join(tempDir, 'wiki/index.md')));
    assert.ok(fs.existsSync(path.join(tempDir, 'wiki/project/work-tracker.md')));
    assert.ok(fs.existsSync(path.join(tempDir, 'wiki/log.md')));
    assert.ok(fs.existsSync(path.join(tempDir, 'CLAUDE.md')));

    // Verify mapped snapshot constructs valid WikiGraph with nodes and edges
    const graph = buildWikiCodeGraph({
      wikiRoot: snapshot.wiki_root || 'wiki',
      pages: (snapshot.pages || []).map((p: any) => ({
        wikiRelPath: p.wiki_rel_path,
        content: p.content,
        sizeBytes: p.size_bytes,
      })),
      repoFiles: snapshot.repo_files || [],
      changedFilesByPage: snapshot.changed_files_by_page || {},
      dirtyRepoFiles: snapshot.git_state?.dirty_files || [],
      lintFindings: (snapshot.lint_report?.findings || []).map((f: any) => ({
        wikiRelPath: f.wiki_rel_path,
        line: f.line,
        message: f.message,
      })),
    });
    assert.ok(graph.nodes.length >= 8, `Expected at least 8 nodes, got ${graph.nodes.length}`);
    assert.ok(graph.edges.length >= 7, `Expected at least 7 edges, got ${graph.edges.length}`);
  });

  // Step 3: POST /api/human-action promotes proposal to T2 and closes it as ⚫ by Stefano
  await t.test('3. POST /api/human-action promotes to T2 and closes as ⚫ by human Stefano', async () => {
    // 3a. Promote proposal
    const promoteRes = await fetch(`${baseUrl}/api/human-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'promote-proposal',
        proposalIndex: 0,
        person: 'Stefano',
        owner: 'Stefano',
        doneWhen: 'Core documentation completed and verified',
        nextVerification: 'npm test',
      }),
    });

    assert.strictEqual(promoteRes.status, 200);
    const promotedSnapshot = await promoteRes.json();
    assert.strictEqual(promotedSnapshot.lint_report?.exit_code, 0);

    const trackerContent1 = fs.readFileSync(
      path.join(tempDir, 'wiki/project/work-tracker.md'),
      'utf-8'
    );
    assert.ok(trackerContent1.includes('| T2 | ⚪ |'));
    assert.ok(trackerContent1.includes('Stefano'));

    const logContent1 = fs.readFileSync(path.join(tempDir, 'wiki/log.md'), 'utf-8');
    assert.ok(logContent1.includes('Promote proposal to T2'));
    assert.ok(logContent1.includes('By: Stefano'));

    // 3b. Close task as unproven (⚫)
    const closeRes = await fetch(`${baseUrl}/api/human-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'close-unproven',
        taskId: 'T2',
        person: 'Stefano',
        notProvenReason: 'superseded by comprehensive guide',
      }),
    });

    assert.strictEqual(closeRes.status, 200);
    const closedSnapshot = await closeRes.json();
    assert.strictEqual(closedSnapshot.lint_report?.exit_code, 0);

    const trackerContent2 = fs.readFileSync(
      path.join(tempDir, 'wiki/project/work-tracker.md'),
      'utf-8'
    );
    assert.ok(trackerContent2.includes('| T2 | ⚫ |'));
    assert.ok(trackerContent2.includes('closed by Stefano'));
    assert.ok(trackerContent2.includes('not proven: superseded by comprehensive guide'));

    const logContent2 = fs.readFileSync(path.join(tempDir, 'wiki/log.md'), 'utf-8');
    assert.ok(logContent2.includes('Close T2 without proof'));
    assert.ok(logContent2.includes('By: Stefano'));
  });

  // Step 4: Modifying a tracked source file referenced by a wiki page causes /api/state to report Git drift
  await t.test('4. Modifying tracked source file detects Git drift on referencing wiki page', async () => {
    // Commit the wiki state so the git working directory is clean
    execSync('git add . && git commit -m "commit initial wiki"', { cwd: tempDir });
    const currentSha = execSync('git rev-parse --short HEAD', { cwd: tempDir })
      .toString()
      .trim();

    // Point index.md sources: to src/index.ts at currentSha
    const indexMd = `---
type: Core
role: index
title: Wiki Index
description: Repository wiki index.
updated: 2026-11-10
confidence: high
sources:
  - src/index.ts
source_commit: ${currentSha}
---

# Wiki Index

- [Schema](SCHEMA.md)
- [Activity Log](log.md)
- [Work Tracker](project/work-tracker.md)
- [Known Risks](project/risks.md)
- [Agent Context](agent/context.md)
- [Agent Handoff](agent/handoff.md)
- [Troubleshooting](troubleshooting.md)
- [Glossary](glossary.md)
`;

    const writeRes = await fetch(`${baseUrl}/api/write-wiki-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wikiRelPath: 'index.md',
        content: indexMd,
      }),
    });
    assert.strictEqual(writeRes.status, 200);

    // Commit this wiki update
    execSync('git add . && git commit -m "anchor index.md to src/index.ts"', {
      cwd: tempDir,
    });
    const anchoredSha = execSync('git rev-parse --short HEAD', { cwd: tempDir })
      .toString()
      .trim();

    // Update index.md source_commit to anchoredSha
    const updatedIndexMd = indexMd.replace(currentSha, anchoredSha);
    await fetch(`${baseUrl}/api/write-wiki-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wikiRelPath: 'index.md',
        content: updatedIndexMd,
      }),
    });
    execSync('git add . && git commit -m "update source commit"', { cwd: tempDir });

    // Verify clean state initially (no drift)
    const cleanStateRes = await fetch(`${baseUrl}/api/state`);
    const cleanState = await cleanStateRes.json();
    assert.deepStrictEqual(cleanState.changed_files_by_page['index.md'] || [], []);

    // Now modify tracked source file src/index.ts
    fs.appendFileSync(
      path.join(tempDir, 'src/index.ts'),
      'export const extra = "drifted";\n',
      'utf-8'
    );

    // Verify /api/state detects Git drift on index.md
    const driftedStateRes = await fetch(`${baseUrl}/api/state`);
    assert.strictEqual(driftedStateRes.status, 200);
    const driftedState = await driftedStateRes.json();
    const changedForIndex = driftedState.changed_files_by_page['index.md'];
    assert.ok(
      Array.isArray(changedForIndex) && changedForIndex.includes('src/index.ts'),
      `Expected src/index.ts in changed_files_by_page['index.md'], got ${JSON.stringify(changedForIndex)}`
    );
  });

  // Step 5: Verify GET / and GET /app.js serve compiled frontend assets
  await t.test('5. GET / and GET /app.js return 200 OK with compiled UI assets', async () => {
    // 5a. GET /
    const htmlRes = await fetch(`${baseUrl}/`);
    assert.strictEqual(htmlRes.status, 200);
    const htmlContentType = htmlRes.headers.get('content-type') || '';
    assert.ok(htmlContentType.includes('text/html'));
    const htmlBody = await htmlRes.text();
    assert.ok(htmlBody.includes('Codebase Wiki App'));
    assert.ok(htmlBody.includes('id="graph-canvas"'));
    assert.ok(htmlBody.includes('id="repo-browse-btn"'));
    assert.ok(htmlBody.includes('id="folder-browser-modal"'));
    assert.ok(htmlBody.includes('id="btn-maximize-graph"'));
    assert.ok(htmlBody.includes('editor-mode-group'));

    // 5b. GET /app.js
    const jsRes = await fetch(`${baseUrl}/app.js`);
    assert.strictEqual(jsRes.status, 200);
    const jsContentType = jsRes.headers.get('content-type') || '';
    assert.ok(jsContentType.includes('application/javascript'));
    const jsBody = await jsRes.text();
    assert.ok(jsBody.includes('Codebase Wiki Desktop App Bundle'));
    assert.ok(jsBody.includes('class AppController'));

    // 5c. GET /styles.css
    const cssRes = await fetch(`${baseUrl}/styles.css`);
    assert.strictEqual(cssRes.status, 200);
    const cssContentType = cssRes.headers.get('content-type') || '';
    assert.ok(cssContentType.includes('text/css'));
    const cssBody = await cssRes.text();
    assert.ok(cssBody.includes('--bg-primary'));
  });

  // Additional API check: read-file and agent-prompt
  await t.test('6. POST /api/read-file and POST /api/agent-prompt work cleanly', async () => {
    const fileRes = await fetch(`${baseUrl}/api/read-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relPath: 'src/index.ts' }),
    });
    assert.strictEqual(fileRes.status, 200);
    const fileData = await fileRes.json();
    assert.strictEqual(fileData.rel_path, 'src/index.ts');
    assert.ok(fileData.content.includes('export const version'));

    const promptRes = await fetch(`${baseUrl}/api/agent-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow: 'sync', target: 'index.md', runCli: false }),
    });
    assert.strictEqual(promptRes.status, 200);
    const promptData = await promptRes.json();
    assert.ok(promptData.prompt && promptData.prompt.length > 0);
  });

  // Step 7: POST /api/list-dirs and POST /api/pick-folder
  await t.test('7. POST /api/list-dirs lists directories with git/wiki badges and pick-folder responds cleanly', async () => {
    // 7a. Test /api/list-dirs with empty body (defaults to current repo_path)
    const listRes1 = await fetch(`${baseUrl}/api/list-dirs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(listRes1.status, 200);
    const listData1 = await listRes1.json();

    const canonicalTemp = fs.realpathSync(tempDir);
    assert.strictEqual(listData1.currentPath, canonicalTemp);
    assert.strictEqual(listData1.isGitRepo, true);
    assert.strictEqual(listData1.hasWiki, true);
    assert.ok(Array.isArray(listData1.entries));
    // Verify hidden directory .git is excluded
    assert.ok(!listData1.entries.some((e: any) => e.name.startsWith('.')));
    // Verify src directory is present with no git/wiki
    const srcEntry = listData1.entries.find((e: any) => e.name === 'src');
    assert.ok(srcEntry);
    assert.strictEqual(srcEntry.isGitRepo, false);
    assert.strictEqual(srcEntry.hasWiki, false);

    // 7b. Create sub-repo with .git and check isGitRepo detection
    const subRepoDir = path.join(tempDir, 'sub-repo');
    fs.mkdirSync(path.join(subRepoDir, '.git'), { recursive: true });

    const listRes2 = await fetch(`${baseUrl}/api/list-dirs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: tempDir }),
    });
    assert.strictEqual(listRes2.status, 200);
    const listData2 = await listRes2.json();
    const subRepoEntry = listData2.entries.find((e: any) => e.name === 'sub-repo');
    assert.ok(subRepoEntry);
    assert.strictEqual(subRepoEntry.isGitRepo, true);
    assert.strictEqual(subRepoEntry.hasWiki, false);

    // 7c. Test /api/pick-folder in headless mode
    const pickRes = await fetch(`${baseUrl}/api/pick-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.strictEqual(pickRes.status, 200);
    const pickData = await pickRes.json();
    assert.strictEqual(typeof pickData.cancelled, 'boolean');
  });
});
