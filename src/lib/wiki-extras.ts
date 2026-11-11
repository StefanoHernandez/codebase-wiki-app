import { fenceMask, findSection, findTable, parseDoc } from './md-edit.ts';

export interface NextSteps {
  /** The one-line state (bold label like `**In one line:**` removed), or null. */
  summary: string | null;
  steps: string[];
}

/** Tracker `## Next steps` (`<!-- wiki:next -->`): one-line state plus numbered steps. Null when absent. */
export function parseNextSteps(trackerMarkdown: string): NextSteps | null {
  const doc = parseDoc(trackerMarkdown);
  const section = findSection(doc, 'next', ['Next steps']);
  if (!section) return null;
  const masked = fenceMask(doc.lines);
  let summary: string | null = null;
  const steps: string[] = [];
  for (let i = section.start + 1; i < section.end; i++) {
    const line = doc.lines[i]!.trim();
    if (masked[i] || !line || line.startsWith('<!--')) continue;
    const step = /^\d+[.)]\s+(.+)$/.exec(line);
    if (step) steps.push(step[1]!.trim());
    else if (summary === null) summary = line.replace(/^\*\*[^*]+\*\*\s*/, '').trim() || null;
  }
  return { summary, steps };
}

export interface RiskRow {
  id: string;
  risk: string;
  severity: string;
  trigger: string;
  mitigation: string;
  owner: string;
  ids: string;
}

const RISK_COLUMNS = ['id', 'risk', 'severity', 'trigger', 'mitigation', 'owner', 'ids'] as const;

/** Risks page `<!-- wiki:risk-register -->` table. English header by name, translated header by position.
 *  Null when the marker or the table is missing. Severity is lowercased, without backticks. */
export function parseRiskRegister(risksMarkdown: string): RiskRow[] | null {
  const doc = parseDoc(risksMarkdown);
  const section = findSection(doc, 'risk-register', []);
  const table = section ? findTable(doc, section) : null;
  if (!table) return null;
  const header = table.header.map((h) => h.trim().toLowerCase());
  const named = RISK_COLUMNS.every((c) => header.includes(c));
  const index = RISK_COLUMNS.map((c, i) => (named ? header.indexOf(c) : i));
  return table.rows.map(({ cells }) => {
    const [id, risk, severity, trigger, mitigation, owner, ids] = index.map((i) => (cells[i] ?? '').trim());
    return {
      id: id!,
      risk: risk!,
      severity: severity!.replace(/`/g, '').trim().toLowerCase(),
      trigger: trigger!,
      mitigation: mitigation!,
      owner: owner!,
      ids: ids!,
    };
  });
}

/** `critical`/`high` risks whose Owner is empty or `unknown`. */
export function unownedSevereRisks(rows: RiskRow[]): RiskRow[] {
  return rows.filter(
    (r) =>
      (r.severity === 'critical' || r.severity === 'high') &&
      ['', 'unknown'].includes(r.owner.replace(/`/g, '').trim().toLowerCase()),
  );
}
