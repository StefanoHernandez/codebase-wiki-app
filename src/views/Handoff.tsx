import { fieldLabel, fixedValue } from '../lib/labels';
import { useCallback } from 'react';
import { Empty } from '../components/Empty';
import { useToast } from '../components/Toast';
import { copyText, workflowPrompt } from '../api';
import { DEFAULT_CORE_MAP } from '../lib/schema-parser';
import { extractTableFromLines, findSectionLines } from '../lib/markdown-tables';
import { useProject } from '../state/project';
import { useNav } from '../state/nav';
import type { BatonRow } from '../types/wiki';
import type { LintInfo } from '../types/snapshot';
import { renderInlineCode, textForCopy } from '../lib/inline-code';
import './handoff.css';

function taskId(task: string): string | null {
  const m = /\b(T\d+)\b/.exec(task);
  return m ? m[1] : null;
}

function sectionBullets(markdown: string, marker: string, heading: string): string[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const section = findSectionLines(lines, marker, heading);
  if (!section) return [];
  return section.lines
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim());
}

function sectionTable(markdown: string, marker: string, heading: string): { header: string[]; rows: string[][] } | null {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const section = findSectionLines(lines, marker, heading);
  if (!section) return null;
  const table = extractTableFromLines(section.lines);
  if (!table) return null;
  return { header: table.header, rows: table.rows };
}

export default function Handoff() {
  const project = useProject();
  const nav = useNav();
  const toast = useToast();

  const core = project.schema?.coreMap ?? DEFAULT_CORE_MAP;
  const handoffPage = project.pages.find((p) => p.relPath === core.handoff);
  const handoff = project.handoff;
  const behind = project.snapshot?.gitState.handoffCommitsBehind ?? 0;
  const stale = behind >= 5;

  const copyCmd = useCallback(
    async (text: string) => {
      try {
        await copyText(textForCopy(text));
        toast('Comando copiato');
      } catch {
        toast('Non riesco a copiare');
      }
    },
    [toast],
  );

  const copySync = async () => {
    const repo = project.current;
    if (!repo) return;
    try {
      await copyText(await workflowPrompt(repo, 'wiki-sync'));
      toast('Prompt copiato');
    } catch {
      toast('Non riesco a copiare il prompt');
    }
  };

  if (!handoffPage || !handoff) {
    return (
      <section className="view">
        <h1 className="view-title">Handoff</h1>
        <Empty title="Questa wiki non ha una pagina di handoff." />
      </section>
    );
  }

  const md = handoffPage.markdown;
  const risks = sectionTable(md, 'risks', 'Known Risks');
  const commands = sectionTable(md, 'commands-run', 'Commands Already Run');
  const doNotRedo = sectionBullets(md, 'do-not-redo', 'Do Not Redo');

  const renderBaton = (row: BatonRow) => {
    const id = taskId(row.task);
    return (
      <tr key={`${row.order}:${row.task}`}>
        <td>{row.order}</td>
        <td>
          {id && (
            <button type="button" className="badge handoff-task-id" onClick={() => nav.go('lavori', id)}>
              {id}
            </button>
          )}
          {row.task}
        </td>
        <td>{renderInlineCode(row.startFiles)}</td>
        <td>{row.doneWhen}</td>
        <td>
          {row.verificationCommand ? (
            <div className="handoff-cmd">
              {renderInlineCode(row.verificationCommand)}
              <button type="button" className="btn btn-quiet" onClick={() => void copyCmd(row.verificationCommand)}>
                Copia
              </button>
            </div>
          ) : (
            '—'
          )}
        </td>
        <td>{row.notes || '—'}</td>
      </tr>
    );
  };

  const renderTable = (data: { header: string[]; rows: string[][] } | null, empty: string) => {
    if (!data || data.rows.length === 0) return <p className="muted">{empty}</p>;
    return (
      <table className="table">
        <thead>
          <tr>
            {data.header.map((h) => (
              <th key={h}>{fieldLabel(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell.includes('`') ? renderInlineCode(cell) : fixedValue(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const handoffInfos = (project.lint?.infos ?? []).filter((i) => HANDOFF_INFO_CODES.has(i.code));

  return (
    <section className="view">
      <h1 className="view-title">Handoff</h1>

      <div className={`handoff-freshness${stale ? ' handoff-freshness--stale' : ''}`}>
        <p className="handoff-freshness-text">
          {behind === 0
            ? 'Handoff allineato a HEAD.'
            : `L'handoff è fermo a ${behind} commit fa: gli ultimi lavori non sono nel testimone.`}
        </p>
        {stale && (
          <>
            <span className="badge badge-drift">Handoff da aggiornare</span>
            <button type="button" className="btn" onClick={() => void copySync()} disabled={!project.current}>
              Copia prompt /wiki-sync
            </button>
          </>
        )}
      </div>

      {handoffInfos.length > 0 && (
        <div className="banner banner-drift" role="status">
          <ul>
            {handoffInfos.map((i, n) => (
              <li key={`${i.code}:${n}`}>{handoffInfoCopy(i)}</li>
            ))}
          </ul>
          <button type="button" className="btn" onClick={() => void copySync()} disabled={!project.current}>
            Copia prompt /wiki-sync
          </button>
        </div>
      )}

      <section className="handoff-section">
        <h2>Stato corrente</h2>
        {Object.keys(handoff.stateBullets).length === 0 ? (
          <p className="muted">Nessun dato nello stato.</p>
        ) : (
          <ul className="handoff-state">
            {Object.entries(handoff.stateBullets).map(([key, value]) => (
              <li key={key}>
                <strong>{fieldLabel(key)}</strong>
                <span>{renderInlineCode(fixedValue(value))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="handoff-section">
        <h2>Baton per il prossimo agente</h2>
        {handoff.noOpenWork ? (
          <Empty title="Nessun lavoro aperto." />
        ) : handoff.baton.length === 0 ? (
          <p className="muted">Nessuna riga nel baton.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Ordine</th>
                <th>Task</th>
                <th>File di partenza</th>
                <th>Fatto quando</th>
                <th>Comando di verifica</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {[...handoff.baton]
                .sort((a, b) => (parseInt(a.order, 10) || 0) - (parseInt(b.order, 10) || 0))
                .map(renderBaton)}
            </tbody>
          </table>
        )}
      </section>

      <section className="handoff-section">
        <h2>Blocchi</h2>
        {renderTable(
          handoff.blockers.length
            ? {
                header: Object.keys(handoff.blockers[0]),
                rows: handoff.blockers.map((b) => Object.keys(handoff.blockers[0]).map((k) => b[k] ?? '')),
              }
            : null,
          'Nessun blocco registrato.',
        )}
      </section>

      <section className="handoff-section">
        <h2>Rischi noti</h2>
        {renderTable(risks, 'Nessun rischio elencato.')}
      </section>

      <section className="handoff-section">
        <h2>Non rifare</h2>
        {doNotRedo.length === 0 ? (
          <p className="muted">Nessuna voce.</p>
        ) : (
          <ul className="handoff-bullets">
            {doNotRedo.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="handoff-section">
        <h2>Comandi già eseguiti</h2>
        {renderTable(commands, 'Nessun comando registrato.')}
      </section>
    </section>
  );
}

const HANDOFF_INFO_CODES = new Set(['handoff-no-open-work-stale', 'handoff-baton-id-closed']);

/** Italian copy of the validator's two handoff infos. */
function handoffInfoCopy(info: LintInfo): string {
  if (info.code === 'handoff-no-open-work-stale') {
    return 'L’handoff dice «No open work.» ma il tracker ha lavori aperti: aggiorna l’handoff con /wiki-sync.';
  }
  const id = /\b(T[1-9]\d*)\b/.exec(info.message)?.[1];
  return `Il baton cita ${id ?? 'un lavoro'} che nel tracker è già chiuso: aggiorna l’handoff con /wiki-sync.`;
}
