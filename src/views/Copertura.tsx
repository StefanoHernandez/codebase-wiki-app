import { useMemo, useState } from 'react';
import { copyText } from '../api';
import { t } from '../i18n/index.ts';
import type { ModuleCoverage } from '../lib/coverage';
import { LensSwitch, type GraphLens } from './Mappa';

interface Props {
  modules: ModuleCoverage[];
  onLens(lens: GraphLens): void;
  onOpenWiki(wikiRelPath: string): void;
  onOpenSource(relPath: string, fromWikiPath?: string): void;
}

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

/** Prompt that asks an agent to document the undescribed files of one module. */
export function documentPrompt(m: ModuleCoverage): string {
  const files = m.files.filter((f) => f.pages.length === 0).map((f) => `- ${f.path}`);
  return t('esplora.copertura.prompt', { dir: m.dir, files: files.join('\n') });
}

/** Coverage lens: per module, how many files the wiki describes, has in drift, or misses. */
export function Copertura({ modules, onLens, onOpenWiki, onOpenSource }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const total = useMemo(() => {
    let verified = 0;
    let drifted = 0;
    let uncovered = 0;
    for (const m of modules) {
      verified += m.verified;
      drifted += m.drifted;
      uncovered += m.uncovered;
    }
    return { verified, drifted, uncovered, all: verified + drifted + uncovered };
  }, [modules]);

  const copy = async (m: ModuleCoverage) => {
    await copyText(documentPrompt(m));
    setCopied(m.dir);
    setTimeout(() => setCopied((c) => (c === m.dir ? null : c)), 1800);
  };

  return (
    <div className="copertura">
      <div className="copertura-head">
        <LensSwitch value="coverage" onChange={onLens} />
        <p className="copertura-summary">
          {t('esplora.copertura.summary', {
            n: total.all,
            v: pct(total.verified, total.all),
            d: pct(total.drifted, total.all),
            u: pct(total.uncovered, total.all),
          })}
        </p>
        <div className="copertura-key" aria-hidden="true">
          <span><i className="cov-verified" />{t('esplora.copertura.verified')}</span>
          <span><i className="cov-drift" />{t('esplora.copertura.drift')}</span>
          <span><i className="cov-uncovered" />{t('esplora.copertura.uncovered')}</span>
        </div>
      </div>

      {modules.length === 0 ? (
        <p className="muted copertura-empty">{t('esplora.copertura.empty')}</p>
      ) : (
        <ul className="copertura-list">
          {modules.map((m) => {
            const n = m.files.length;
            const isOpen = open === m.dir;
            return (
              <li key={m.dir} className={`copertura-row${isOpen ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="copertura-mod"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : m.dir)}
                >
                  <span className="copertura-dir">{m.dir === '.' ? t('esplora.copertura.root') : m.dir}</span>
                  <span
                    className="copertura-bar"
                    role="img"
                    aria-label={t('esplora.copertura.rowAria', { v: m.verified, d: m.drifted, u: m.uncovered })}
                  >
                    <span className="cov-verified" style={{ flexGrow: m.verified }} />
                    <span className="cov-drift" style={{ flexGrow: m.drifted }} />
                    <span className="cov-uncovered" style={{ flexGrow: m.uncovered }} />
                  </span>
                  <span className="copertura-count">
                    {m.uncovered > 0
                      ? t('esplora.copertura.missing', { u: m.uncovered, n })
                      : m.drifted > 0
                        ? t('esplora.copertura.drifting', { d: m.drifted, n })
                        : t('esplora.copertura.allGood', { n })}
                  </span>
                </button>

                {isOpen && (
                  <div className="copertura-detail">
                    {m.uncovered > 0 && (
                      <button type="button" className="btn btn-sm" onClick={() => copy(m)}>
                        {copied === m.dir ? t('esplora.copertura.copied') : t('esplora.copertura.copyPrompt')}
                      </button>
                    )}
                    <ul className="copertura-files">
                      {m.files.map((f) => (
                        <li key={f.path}>
                          <i
                            className={f.pages.length === 0 ? 'cov-uncovered' : f.drift ? 'cov-drift' : 'cov-verified'}
                            aria-hidden="true"
                          />
                          <button
                            type="button"
                            className="copertura-file"
                            onClick={() => onOpenSource(f.path, f.pages[0])}
                          >
                            {f.path}
                          </button>
                          <span className="copertura-pages">
                            {f.pages.length === 0
                              ? t('esplora.copertura.noPage')
                              : f.pages.map((p) => (
                                  <button key={p} type="button" className="copertura-chip" onClick={() => onOpenWiki(p)}>
                                    {p}
                                  </button>
                                ))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
