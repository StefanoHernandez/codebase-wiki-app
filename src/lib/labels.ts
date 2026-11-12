// Italian copy for the fixed English vocabulary of the plugin format. Content written by agents stays as is.

const FIELDS: Record<string, string> = {
  // handoff state
  'tracker ids': 'ID nel tracker',
  goal: 'Obiettivo',
  'last completed step': 'Ultimo passo completato',
  'current branch': 'Branch corrente',
  'last commit': 'Ultimo commit',
  worktree: 'Copia di lavoro',
  // blockers
  blocker: 'Blocco',
  type: 'Tipo',
  'needed from': 'Serve da',
  'current workaround': 'Soluzione temporanea',
  // risks
  id: 'ID',
  risk: 'Rischio',
  impact: 'Impatto',
  mitigation: 'Mitigazione',
  evidence: 'Prova',
  severity: 'Gravità',
  trigger: 'Segnale',
  owner: 'Responsabile',
  ids: 'Lavori',
  // commands run
  command: 'Comando',
  directory: 'Cartella',
  result: 'Risultato',
  'evidence / notes': 'Prova / note',
};

const VALUES: Record<string, string> = {
  high: 'alta',
  medium: 'media',
  low: 'bassa',
  critical: 'critica',
  none: 'nessuno',
  unknown: 'sconosciuto',
  clean: 'pulita',
  dirty: 'con modifiche',
  'approval not recorded.': 'Approvazione non registrata.',
  'alternatives not recorded.': 'Alternative non registrate.',
  'no open work.': 'Nessun lavoro aperto.',
};

const MARKERS: [string, string][] = [
  ['⚠️ NOT VERIFIED', '⚠️ NON VERIFICATO'],
  ['⚠️ TO RE-VERIFY', '⚠️ DA RIVERIFICARE'],
];

/** Column or bullet key from the plugin format, in Italian; unknown keys are returned unchanged. */
export function fieldLabel(key: string): string {
  return FIELDS[key.trim().toLowerCase()] ?? key;
}

/** A cell that is exactly one of the format's fixed values, in Italian; a marker keeps its reason. */
export function fixedValue(text: string): string {
  const t = text.trim();
  const v = VALUES[t.toLowerCase()];
  if (v) return v;
  for (const [en, it] of MARKERS) if (t.startsWith(en)) return it + t.slice(en.length);
  return text;
}
