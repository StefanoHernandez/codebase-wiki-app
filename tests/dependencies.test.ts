import test from 'node:test';
import assert from 'node:assert/strict';
import { taskReadiness } from '../src/lib/dependencies.ts';
import { parseTrackerMarkdown } from '../src/lib/markdown-tables.ts';
import { fieldLabel } from '../src/lib/labels.ts';

const row = (id: string, deps: string) => `| ${id} | 🟡 | g | d | o | n | e | ${deps} |`;
const MD = `## Open
<!-- wiki:open -->
| ID | Status | Goal | Done when | Owner | Next verification | Evidence | Depends on |
| --- | --- | --- | --- | --- | --- | --- | --- |
${row('T1', 'T2, T3')}
${row('T4', 'T5, TRR')}
${row('T5', '—')}
${row('T6', '')}
${row('T7', 'T99')}

## Done
<!-- wiki:done -->
| ID | Status | Goal | Closed | Criteria met | Evidence |
| --- | --- | --- | --- | --- | --- |
| T2 | 🟢 | g | 2026-11-01 | c | e |
| T3 | ⚫ | g | 2026-11-01 | closed by Stefano 2026-11-01; not proven: x | e |
`;

test('dependencies: done 🟢 and ⚫ satisfy, open and external wait', () => {
  const r = taskReadiness(parseTrackerMarkdown(MD));
  assert.deepEqual(r.get('T1'), { ready: true, waitingOn: [], external: [], unknown: [] });
  assert.deepEqual(r.get('T4'), { ready: false, waitingOn: ['T5'], external: ['TRR'], unknown: [] });
  assert.deepEqual(r.get('T6'), { ready: true, waitingOn: [], external: [], unknown: [] });
  assert.deepEqual(r.get('T7'), { ready: false, waitingOn: ['T99'], external: [], unknown: ['T99'] });
});

test('dependencies: header label', () => {
  assert.equal(fieldLabel('Depends on'), 'Dipende da');
});
