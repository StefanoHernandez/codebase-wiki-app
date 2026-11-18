import test from 'node:test';
import assert from 'node:assert/strict';
import { searchWiki } from '../src/lib/wiki-search.ts';

const pages = [
  { relPath: 'a.md', title: 'Indexing pipeline', markdown: '# Indexing pipeline\nChunks are embedded in batches.' },
  { relPath: 'b.md', title: 'Glossary', markdown: '# Glossary\n- chunk: a piece of a file used for indexing' },
  { relPath: 'c.md', title: 'Release', markdown: '# Release\nTag and publish.' },
];

test('searchWiki ranks title matches first and skips pages without the words', () => {
  const hits = searchWiki(pages, 'indexing chunks');
  assert.deepEqual(hits.map((h) => h.relPath), ['a.md', 'b.md']);
  assert.equal(hits[0].snippet, 'Indexing pipeline');
});

test('searchWiki ignores short words and empty queries', () => {
  assert.deepEqual(searchWiki(pages, 'a to'), []);
  assert.deepEqual(searchWiki(pages, ''), []);
});
