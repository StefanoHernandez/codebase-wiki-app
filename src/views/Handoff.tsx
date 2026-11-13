import { t } from '../i18n';
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
        toast(t('revisione.handoff.copied'));
      } catch {
        toast(t('revisione.handoff.copyFailed'));
      }
    },
    [toast],
  );

  const copySync = async () => {
    const repo = project.current;
    if (!repo) return;
    try {
      await copyText(await workflowPrompt(repo, 'wiki-sync'));
      toast(t('revisione.handoff.promptCopied'));
    } catch {
      toast(t('revisione.handoff.promptCopyFailed'));
    }
  };

  if (!handoffPage || !handoff) {
    return (
      <section className="view">
        <h1 className="view-title">{t('revisione.handoff.title')}</h1>
        <Empty title={t('revisione.handoff.noPage')} />
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
                {t('revisione.handoff.copy')}
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
      <h1 className="view-title">{t('revisione.handoff.title')}</h1>

      <div className={`handoff-freshness${stale ? ' handoff-freshness--stale' : ''}`}>
        <p className="handoff-freshness-text">
          {behind === 0
            ? t('revisione.handoff.aligned')
            : t('revisione.handoff.behind', { n: behind })}
        </p>
        {stale && (
          <>
            <span className="badge badge-drift">{t('revisione.handoff.needsUpdate')}</span>
            <button type="button" className="btn" onClick={() => void copySync()} disabled={!project.current}>
              {t('revisione.handoff.copySync')}
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
            {t('revisione.handoff.copySync')}
          </button>
        </div>
      )}

      <section className="handoff-section">
        <h2>{t('revisione.handoff.stateTitle')}</h2>
        {Object.keys(handoff.stateBullets).length === 0 ? (
          <p className="muted">{t('revisione.handoff.stateEmpty')}</p>
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
        <h2>{t('revisione.handoff.batonTitle')}</h2>
        {handoff.noOpenWork ? (
          <Empty title={t('revisione.handoff.noOpenWork')} />
        ) : handoff.baton.length === 0 ? (
          <p className="muted">{t('revisione.handoff.batonEmpty')}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('revisione.handoff.colOrder')}</th>
                <th>{t('revisione.handoff.colTask')}</th>
                <th>{t('revisione.handoff.colStartFiles')}</th>
                <th>{t('revisione.handoff.colDoneWhen')}</th>
                <th>{t('revisione.handoff.colVerify')}</th>
                <th>{t('revisione.handoff.colNotes')}</th>
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
        <h2>{t('revisione.handoff.blockersTitle')}</h2>
        {renderTable(
          handoff.blockers.length
            ? {
                header: Object.keys(handoff.blockers[0]),
                rows: handoff.blockers.map((b) => Object.keys(handoff.blockers[0]).map((k) => b[k] ?? '')),
              }
            : null,
          t('revisione.handoff.blockersEmpty'),
        )}
      </section>

      <section className="handoff-section">
        <h2>{t('revisione.handoff.risksTitle')}</h2>
        {renderTable(risks, t('revisione.handoff.risksEmpty'))}
      </section>

      <section className="handoff-section">
        <h2>{t('revisione.handoff.doNotRedoTitle')}</h2>
        {doNotRedo.length === 0 ? (
          <p className="muted">{t('revisione.handoff.doNotRedoEmpty')}</p>
        ) : (
          <ul className="handoff-bullets">
            {doNotRedo.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="handoff-section">
        <h2>{t('revisione.handoff.commandsTitle')}</h2>
        {renderTable(commands, t('revisione.handoff.commandsEmpty'))}
      </section>
    </section>
  );
}

const HANDOFF_INFO_CODES = new Set(['handoff-no-open-work-stale', 'handoff-baton-id-closed']);

/** Localised copy of the validator's two handoff infos. */
function handoffInfoCopy(info: LintInfo): string {
  if (info.code === 'handoff-no-open-work-stale') {
    return t('revisione.handoff.infoNoOpenWork');
  }
  const id = /\b(T[1-9]\d*)\b/.exec(info.message)?.[1];
  return t('revisione.handoff.infoBatonClosed', { id: id ?? t('revisione.handoff.infoUnknownTask') });
}
