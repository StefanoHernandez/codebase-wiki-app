import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, updateFrontmatterFields, extractMarkdownLinks } from '../src/lib/frontmatter.ts';
import { parseTrackerMarkdown } from '../src/lib/markdown-tables.ts';
import { parseSchemaMarkdown, DEFAULT_CORE_MAP } from '../src/lib/schema-parser.ts';

test('parseFrontmatter handles UTF-8 BOM, CRLF, scalar fields, and indented sources list', () => {
  const raw = '\uFEFF---\r\ntype: Module\r\ntitle: "Auth Service"\r\ngenerated: { by: codex/gpt-5, at: 2026-11-10T09:00:00Z }\r\nsources:\r\n  - src/auth.ts\r\n  - "src/session.ts"\r\nsource_commit: a1b2c3d\r\nconfidence: high\r\n---\r\n\r\n# Auth Service\r\nBody text.';
  const parsed = parseFrontmatter(raw);
  assert.equal(parsed.hasFrontmatter, true);
  assert.equal(parsed.fields.type, 'Module');
  assert.equal(parsed.fields.title, 'Auth Service');
  assert.deepEqual(parsed.sources, ['src/auth.ts', 'src/session.ts']);
  assert.equal(parsed.fields.source_commit, 'a1b2c3d');
  assert.equal(parsed.fields.confidence, 'high');
  assert.match(parsed.body, /# Auth Service/);
});

test('parseFrontmatter handles missing or unterminated frontmatter', () => {
  const noFrontmatter = '# Just a Title\nSome content without frontmatter';
  const parsed1 = parseFrontmatter(noFrontmatter);
  assert.equal(parsed1.hasFrontmatter, false);
  assert.deepEqual(parsed1.fields, {});
  assert.deepEqual(parsed1.sources, []);
  assert.equal(parsed1.body, noFrontmatter);

  const unterminated = '---\ntype: Note\ntitle: Unterminated\n# Not closed';
  const parsed2 = parseFrontmatter(unterminated);
  assert.equal(parsed2.hasFrontmatter, false);
  assert.deepEqual(parsed2.fields, {});
  assert.deepEqual(parsed2.sources, []);
  assert.equal(parsed2.body, unterminated);
});

test('updateFrontmatterFields updates scalar fields and preserves sources and body', () => {
  const raw = '---\ntype: Decision\ntitle: 0001 - Stack\nstatus: proposed\nsources:\n  - README.md\nsource_commit: 1234567\nconfidence: high\n---\n\n# 0001 - Stack\n';
  const updated = updateFrontmatterFields(raw, { status: 'accepted', source_commit: '89abcdef' });
  const reparsed = parseFrontmatter(updated);
  assert.equal(reparsed.fields.status, 'accepted');
  assert.equal(reparsed.fields.source_commit, '89abcdef');
  assert.deepEqual(reparsed.sources, ['README.md']);
  assert.match(reparsed.body, /# 0001 - Stack/);
});

test('updateFrontmatterFields can update sources or create frontmatter if missing', () => {
  const raw = '---\ntitle: Note\n---\n\nContent';
  const updated = updateFrontmatterFields(raw, { confidence: 'medium' }, ['src/index.ts', 'src/utils.ts']);
  const reparsed = parseFrontmatter(updated);
  assert.equal(reparsed.fields.title, 'Note');
  assert.equal(reparsed.fields.confidence, 'medium');
  assert.deepEqual(reparsed.sources, ['src/index.ts', 'src/utils.ts']);
  assert.match(reparsed.body, /Content/);

  const rawNoFm = '# Heading\nParagraph';
  const added = updateFrontmatterFields(rawNoFm, { title: 'Heading', confidence: 'low' }, ['src/a.ts']);
  const reparsedAdded = parseFrontmatter(added);
  assert.equal(reparsedAdded.hasFrontmatter, true);
  assert.equal(reparsedAdded.fields.title, 'Heading');
  assert.equal(reparsedAdded.fields.confidence, 'low');
  assert.deepEqual(reparsedAdded.sources, ['src/a.ts']);
  assert.match(reparsedAdded.body, /# Heading\nParagraph/);
});

test('extractMarkdownLinks ignores fenced code blocks, inline code, and external URLs', () => {
  const md = [
    'See [Tracker](project/work-tracker.md#open) and [Arch](./architecture.md "Title").',
    'Ignore `[inline](ignored.md)` and [ext](https://example.com/a.md).',
    '```markdown',
    '[fenced](should-ignore.md)',
    '```',
    '~~~',
    '[fenced-tilde](should-ignore-tilde.md)',
    '~~~',
    '[ref]: agent/handoff.md'
  ].join('\n');
  const links = extractMarkdownLinks(md);
  assert.deepEqual(links, ['project/work-tracker.md', './architecture.md', 'agent/handoff.md']);
});

test('parseSchemaMarkdown parses Project profile, Core map, Budgets, Topics, and Excluded paths', () => {
  const schemaMd = `---
type: Schema
title: Wiki Schema
confidence: high
---
# Wiki Schema

## Project profile
| Setting | Value |
| --- | --- |
| Language | Italian |
| Project division | releases |
| Sensitive data | yes |
| Agent entry file | AGENTS.md |

## Core map
| Role | Path |
| --- | --- |
| index | \`index.md\` |
| log | \`log.md\` |
| log-archive | \`log/\` |
| tracker | \`project/work-tracker.md\` |
| decisions | \`project/decisions/\` |
| risks | \`project/risks.md\` |
| context | \`agent/context.md\` |
| handoff | \`agent/handoff.md\` |
| troubleshooting | \`troubleshooting.md\` |
| glossary | \`glossary.md\` |

## Budgets
| Budget | Default |
| --- | --- |
| Single page | 25 KB |
| Core read at a new context | 70 KB |
| log | 35 KB |

## Topics
| Topic | Path | What belongs there |
| --- | --- | --- |
| architecture | \`architecture.md\` | system boundaries |

## Excluded paths
- \`reports/**\`
`;
  const config = parseSchemaMarkdown(schemaMd);
  assert.equal(config.language, 'Italian');
  assert.equal(config.projectDivision, 'releases');
  assert.equal(config.sensitiveData, true);
  assert.equal(config.agentEntryFile, 'AGENTS.md');
  assert.equal(config.coreMap.tracker, 'project/work-tracker.md');
  assert.equal(config.coreMap.decisions, 'project/decisions/');
  assert.equal(config.budgets.singlePageBytes, 25 * 1024);
  assert.equal(config.budgets.coreReadBytes, 70 * 1024);
  assert.equal(config.budgets.logBytes, 35 * 1024);
  assert.equal(config.topics.length, 1);
  assert.equal(config.topics[0].name, 'architecture');
  assert.equal(config.topics[0].path, 'architecture.md');
  assert.deepEqual(config.excludedGlobs, ['reports/**']);
});

test('parseSchemaMarkdown applies default fallback values when sections are missing', () => {
  const minimalSchema = `# Empty Schema`;
  const config = parseSchemaMarkdown(minimalSchema);
  assert.equal(config.language, 'English');
  assert.equal(config.projectDivision, 'none');
  assert.equal(config.sensitiveData, false);
  assert.equal(config.agentEntryFile, 'none');
  assert.deepEqual(config.coreMap, DEFAULT_CORE_MAP);
  assert.equal(config.budgets.singlePageBytes, 20 * 1024);
  assert.equal(config.budgets.coreReadBytes, 60 * 1024);
  assert.equal(config.budgets.logBytes, 30 * 1024);
  assert.deepEqual(config.topics, []);
  assert.deepEqual(config.excludedGlobs, []);
});

// Copy of the plugin's v0.13.0 default schema (format 0.12.0), kept as a fixture: the app does not ship it.
test('parseSchemaMarkdown parses the plugin default schema (v0.13.0)', () => {
  const filePath = path.resolve(import.meta.dirname, 'fixtures/default-schema-0.13.0.md');
  const content = fs.readFileSync(filePath, 'utf-8');
  const config = parseSchemaMarkdown(content);
  assert.equal(config.language, 'English');
  assert.equal(config.projectDivision, 'none');
  assert.equal(config.sensitiveData, false);
  assert.equal(config.agentEntryFile, 'none');
  assert.equal(config.coreMap.index, 'index.md');
  assert.equal(config.coreMap.log, 'log.md');
  assert.equal(config.coreMap.tracker, 'project/work-tracker.md');
  assert.equal(config.coreMap.decisions, 'project/decisions/');
  assert.equal(config.budgets.singlePageBytes, 20 * 1024);
  assert.equal(config.budgets.coreReadBytes, 60 * 1024);
  assert.equal(config.budgets.logBytes, 30 * 1024);
  assert.equal(config.topics.length, 1);
  assert.equal(config.topics[0].name, 'architecture');
  assert.equal(config.topics[0].path, 'architecture.md');
  assert.deepEqual(config.excludedGlobs, []);
  assert.equal(config.hasCoreMap, true);
  assert.equal(config.logOrder, 'oldest-first');
});

test('parseSchemaMarkdown reads profile table outside fences only when a fence splits the section', () => {
  const schemaMd = `# Schema

## Project profile

| Setting | Value |
| --- | --- |
| Language | Italian |

\`\`\`
| Setting | Value |
| --- | --- |
| Language | FencedWrong |
\`\`\`

| Setting | Value |
| --- | --- |
| Sensitive data | yes |
`;
  const config = parseSchemaMarkdown(schemaMd);
  assert.equal(config.language, 'Italian');
  assert.equal(config.sensitiveData, true);
});

test('parseSchemaMarkdown ignores example globs inside fenced blocks in SCHEMA fixtures', () => {
  const fixturePath = path.resolve(import.meta.dirname, '../tests/fixtures/wiki-v2/SCHEMA.md');
  const content = fs.readFileSync(fixturePath, 'utf-8');
  const config = parseSchemaMarkdown(content);
  assert.deepEqual(config.excludedGlobs, []);
});

test('parseFrontmatter exposes generated and verified attributions from inline maps', () => {
  const md = `---
title: Auth
generated: { by: claude-code/opus, at: 2026-01-01T00:00:00Z }
verified: { by: human:stefano, at: 2026-02-01T10:00:00Z, commit: abc1234 }
sources:
  - src/auth.ts
---
# Auth`;
  const parsed = parseFrontmatter(md);
  assert.deepEqual(parsed.generated, { by: 'claude-code/opus', at: '2026-01-01T00:00:00Z' });
  assert.deepEqual(parsed.verified, [{ by: 'human:stefano', at: '2026-02-01T10:00:00Z', commit: 'abc1234' }]);
  assert.deepEqual(parsed.sources, ['src/auth.ts']);
  assert.equal(parsed.fields.title, 'Auth');
});

test('parseFrontmatter reads verified as a list of inline or block maps and defaults to empty', () => {
  const listInline = `---
title: A
verified:
  - { by: agent/codex, at: 2026-01-01T00:00:00Z }
  - { by: human:stefano, at: 2026-02-01T00:00:00Z, commit: def5678 }
---
x`;
  assert.deepEqual(parseFrontmatter(listInline).verified, [
    { by: 'agent/codex', at: '2026-01-01T00:00:00Z' },
    { by: 'human:stefano', at: '2026-02-01T00:00:00Z', commit: 'def5678' },
  ]);

  const listBlock = `---
title: B
verified:
  - by: human:mario
    at: 2026-03-01T00:00:00Z
  - by: claude
    at: 2026-03-02T00:00:00Z
    commit: 1a2b3c4
---
x`;
  assert.deepEqual(parseFrontmatter(listBlock).verified, [
    { by: 'human:mario', at: '2026-03-01T00:00:00Z' },
    { by: 'claude', at: '2026-03-02T00:00:00Z', commit: '1a2b3c4' },
  ]);

  const none = parseFrontmatter('---\ntitle: C\n---\nx');
  assert.equal(none.generated, undefined);
  assert.deepEqual(none.verified, []);
});

test('tracker rows keep extra columns and header order through parse', () => {
  const md = `# Tracker

## Open
<!-- wiki:open -->

| ID | Phase | Status | Goal | Done when | Owner | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | Core | 🟡 | Build parser | Tests pass | stefano | \`node --test\` | \`tests/parsers.test.ts\` |
`;
  const data = parseTrackerMarkdown(md);
  assert.deepEqual(data.openHeader, ['ID', 'Phase', 'Status', 'Goal', 'Done when', 'Owner', 'Next verification', 'Evidence']);
  assert.equal(data.open[0].extra.Phase, 'Core');
  assert.equal(data.open[0].status, '🟡');
});

test('parseSchemaMarkdown matches section headings exactly and case-insensitively', () => {
  const schemaMd = `# S

## Core map (legacy)
| Role | Path |
| --- | --- |
| tracker | \`legacy/tracker.md\` |

##   CORE MAP
| Role | Path |
| --- | --- |
| tracker | \`project/new-tracker.md\` |
`;
  assert.equal(parseSchemaMarkdown(schemaMd).coreMap.tracker, 'project/new-tracker.md');
  const onlyLegacy = schemaMd.split('##   CORE MAP')[0];
  assert.equal(parseSchemaMarkdown(onlyLegacy).coreMap.tracker, 'project/work-tracker.md');
});

test('parseFrontmatter reads verified as a one-line flow list of inline maps', () => {
  const md = `---
title: Flow
verified: [{ by: claude-code/opus, at: 2026-01-01T00:00:00Z }, { by: human:stefano, at: 2026-02-01T00:00:00Z, commit: abc1234 }]
---
x`;
  assert.deepEqual(parseFrontmatter(md).verified, [
    { by: 'claude-code/opus', at: '2026-01-01T00:00:00Z' },
    { by: 'human:stefano', at: '2026-02-01T00:00:00Z', commit: 'abc1234' },
  ]);
});

test('page types: Page types rows first, then Page frontmatter defaults; * crosses /', async () => {
  const { parseSchemaMarkdown, pageTypeFor } = await import('../src/lib/schema-parser.ts');
  const schema = parseSchemaMarkdown(`# Schema

## Page types

| Path | type |
| --- | --- |
| \`game/*-plan.md\` | \`Plan\` |

## Page frontmatter

\`\`\`markdown
| \`game/*\` | \`Fake\` |
\`\`\`

| Page | Default \`type\` |
| --- | --- |
| \`overview.md\`, \`overview-<project-slug>.md\` | \`Overview\` |
| \`game/*\` | \`GameCanon\` |
| \`project/adr/[0-9]*.md\` | \`Decision\` |
`);
  const t = (p: string) => pageTypeFor(p, schema.pageTypes);
  assert.equal(t('game/levels/wave-plan.md'), 'Plan');
  assert.equal(t('game/levels/units.md'), 'GameCanon');
  assert.equal(t('overview-gioco-td.md'), 'Overview');
  assert.equal(t('project/adr/0007-x.md'), 'Decision');
  assert.equal(t('project/adr/readme.md'), null);
  assert.equal(t('index.md'), null);
});

test('tracker Depends on: IDs and external conditions', async () => {
  const { parseDependsOn } = await import('../src/lib/markdown-tables.ts');
  assert.deepEqual(parseDependsOn('T17, distribution received'), { ids: ['T17'], external: ['distribution received'] });
  assert.deepEqual(parseDependsOn('—'), { ids: [], external: [] });
  assert.deepEqual(parseDependsOn(''), { ids: [], external: [] });
  assert.deepEqual(parseDependsOn('`T9`'), { ids: [], external: ['`T9`'] });
  const md = `## Open
<!-- wiki:open -->
| ID | Status | Goal | Done when | Owner | Next verification | Evidence | depends ON |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | 🟡 | g | d | o | n | e | T2 |

## Done
<!-- wiki:done -->
| ID | Status | Goal | Closed | Criteria met | Evidence |
| --- | --- | --- | --- | --- | --- |
| T2 | 🟢 | g | 2026-11-01 | c | e |
`;
  const t = parseTrackerMarkdown(md);
  assert.deepEqual(t.open[0].dependsOn, { ids: ['T2'], external: [] });
  assert.equal(t.open[0].extra['depends ON'], 'T2');
  assert.deepEqual(t.done[0].dependsOn, { ids: [], external: [] });
});
