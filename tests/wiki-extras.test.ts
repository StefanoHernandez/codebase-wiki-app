import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNextSteps, parseRiskRegister, unownedSevereRisks } from '../src/lib/wiki-extras.ts';
import { computeAttention } from '../src/lib/attention.ts';

const TRACKER = `# Work Tracker

\`\`\`markdown
## Next steps
<!-- wiki:next -->
1. fenced example (T9)
\`\`\`

## Next steps
<!-- wiki:next -->

**In one line:** parser done, watcher next (2026-11-10)

1. Finish the watcher fix (T2)
2. Review the proposals
10) Ship it

## Open
<!-- wiki:open -->

1. not a step
`;

test('parseNextSteps reads the one-line state and the numbered steps, outside fences', () => {
  assert.deepEqual(parseNextSteps(TRACKER), {
    summary: 'parser done, watcher next (2026-11-10)',
    steps: ['Finish the watcher fix (T2)', 'Review the proposals', 'Ship it'],
  });
});

test('parseNextSteps: translated heading with marker; missing section → null', () => {
  const md = '## Prossimi passi\n<!-- wiki:next -->\n\n**In una riga:** fermo\n\n1. Uno (T1)\n';
  assert.deepEqual(parseNextSteps(md), { summary: 'fermo', steps: ['Uno (T1)'] });
  assert.equal(parseNextSteps('# Tracker\n\n## Open\n'), null);
});

test('parseNextSteps: heading without marker still counts; plain summary line', () => {
  assert.deepEqual(parseNextSteps('## Next steps\n\nAll calm.\n'), { summary: 'All calm.', steps: [] });
});

const RISKS = `# Risks

## Register
<!-- wiki:risk-register -->

| ID | Risk | Severity | Trigger | Mitigation | Owner | IDs |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | Data loss | high | writes race | atomic writes | \`unknown\` | T1 |
| R2 | Slow start | low | big repo | cache | | — |
| R3 | Leak | \`critical\` | symlink | confine | stefano | T2 |
| R4 | Drift | critical | stale wiki | sync | | T3 |

## Details
`;

test('parseRiskRegister maps English columns by name', () => {
  const rows = parseRiskRegister(RISKS)!;
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], {
    id: 'R1',
    risk: 'Data loss',
    severity: 'high',
    trigger: 'writes race',
    mitigation: 'atomic writes',
    owner: '`unknown`',
    ids: 'T1',
  });
  assert.equal(rows[2]!.severity, 'critical');
});

test('parseRiskRegister maps a translated header by position', () => {
  const md =
    '## Registro\n<!-- wiki:risk-register -->\n\n| ID | Rischio | Gravità | Innesco | Mitigazione | Responsabile | ID collegati |\n| --- | --- | --- | --- | --- | --- | --- |\n| R1 | Perdita | alta | x | y | | T1 |\n';
  const rows = parseRiskRegister(md)!;
  assert.equal(rows[0]!.risk, 'Perdita');
  assert.equal(rows[0]!.owner, '');
});

test('parseRiskRegister needs the marker', () => {
  assert.equal(parseRiskRegister('## Register\n\n| ID | Risk |\n| --- | --- |\n| R1 | x |\n'), null);
});

test('unownedSevereRisks: critical/high with empty or unknown owner', () => {
  assert.deepEqual(
    unownedSevereRisks(parseRiskRegister(RISKS)!).map((r) => r.id),
    ['R1', 'R4'],
  );
});

test('computeAttention adds one risk-unowned item per severe unowned risk', () => {
  const items = computeAttention({
    tracker: null,
    decisions: [],
    handoffCommitsBehind: null,
    pages: [],
    lintFindings: [],
    risks: parseRiskRegister(RISKS)!,
  });
  assert.deepEqual(
    items.filter((i) => i.kind === 'risk-unowned').map((i) => i.target.ref),
    ['R1', 'R4'],
  );
});
