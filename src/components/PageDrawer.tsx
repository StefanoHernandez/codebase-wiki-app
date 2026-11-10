import { useCallback, useEffect, useMemo, useState } from 'react';
import { Markdown } from './Markdown';
import { readSourceFile, sourceDiff } from '../api';
import type { WikiPage } from '../state/project';
import type { TrustTier } from '../lib/trust';
import './page-drawer.css';

export type PageDrawerTarget =
  | { mode: 'wiki'; wikiRelPath: string }
  | { mode: 'source'; relPath: string; fromWikiPath?: string };

export function trustTierLabel(tier: TrustTier): string {
  switch (tier) {
    case 'unverified':
      return 'Non verificata';
    case 'machine-confirmed':
      return 'Confermata da agente';
    case 'human-reviewed':
      return 'Rivista da persona';
    case 'stale-verified':
      return 'Verifica obsoleta';
  }
}

export type DiffLineKind = 'add' | 'del' | 'hunk' | 'ctx';

export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith('+++') || line.startsWith('---')) return 'ctx';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}

const META_SKIP = new Set(['title', 'confidence', 'source_commit', 'generated', 'verified', 'sources']);

type Props = {
  open: boolean;
  target: PageDrawerTarget | null;
  repo: string;
  pagesByPath: Map<string, WikiPage>;
  onClose(): void;
  onOpenWiki(wikiRelPath: string): void;
  onOpenSource(relPath: string, fromWikiPath?: string): void;
};

export function PageDrawer({ open, target, repo, pagesByPath, onClose, onOpenWiki, onOpenSource }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !target) return null;

  return (
    <aside className="page-drawer" role="dialog" aria-label="Dettaglio pagina o sorgente">
      <header className="page-drawer-head">
        <div className="page-drawer-title-wrap">
          <h2 className="page-drawer-title">
            {target.mode === 'wiki' ? 'Pagina wiki' : 'File sorgente'}
            {target.mode === 'wiki' && (
              <span className="page-drawer-path">{target.wikiRelPath}</span>
            )}
            {target.mode === 'source' && <span className="page-drawer-path">{target.relPath}</span>}
          </h2>
        </div>
        <button type="button" className="btn btn-quiet" onClick={onClose} aria-label="Chiudi pannello">
          Chiudi
        </button>
      </header>
      {target.mode === 'wiki' ? (
        <WikiPanel
          page={pagesByPath.get(target.wikiRelPath)}
          onOpenSource={(rel) => onOpenSource(rel, target.wikiRelPath)}
          onOpenWiki={onOpenWiki}
        />
      ) : (
        <SourcePanel
          repo={repo}
          relPath={target.relPath}
          fromWiki={target.fromWikiPath ? pagesByPath.get(target.fromWikiPath) : undefined}
        />
      )}
    </aside>
  );
}

function WikiPanel({
  page,
  onOpenSource,
  onOpenWiki,
}: {
  page: WikiPage | undefined;
  onOpenSource(rel: string): void;
  onOpenWiki(wikiRelPath: string): void;
}) {
  if (!page) {
    return (
      <div className="page-drawer-body">
        <p className="page-drawer-error">Pagina non trovata nella snapshot.</p>
      </div>
    );
  }

  const fm = page.frontmatter.fields;
  const facts = Object.entries(fm).filter(([k]) => !META_SKIP.has(k) && fm[k]?.trim());

  const sources = page.frontmatter.sources.length ? page.frontmatter.sources : [];

  return (
    <div className="page-drawer-body">
      <div className="page-drawer-meta">
        <span className={`badge badge-${tierBadge(page.trust)}`}>{trustTierLabel(page.trust)}</span>
        {(fm.confidence || fm.source_commit || facts.length > 0) && (
          <dl className="page-drawer-facts">
            {fm.confidence && (
              <>
                <dt>Fiducia</dt>
                <dd>{fm.confidence}</dd>
              </>
            )}
            {fm.source_commit && (
              <>
                <dt>Commit sorgente</dt>
                <dd>
                  <code>{fm.source_commit}</code>
                </dd>
              </>
            )}
            {facts.map(([k, v]) => (
              <span key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </span>
            ))}
          </dl>
        )}
        {sources.length > 0 && (
          <div className="page-drawer-sources">
            <span className="page-drawer-sources-label">Sorgenti</span>
            {sources.map((src) => (
              <button
                key={src}
                type="button"
                className="badge source-chip"
                onClick={() => onOpenSource(src.replace(/^\.\//, '').split('#')[0].replace(/:\d+(?::\d+)?$/, ''))}
              >
                {src}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="page-drawer-doc">
        <Markdown markdown={page.markdown} pagePath={page.relPath} onOpenPage={onOpenWiki} />
      </div>
    </div>
  );
}

function tierBadge(tier: TrustTier): string {
  if (tier === 'human-reviewed') return 'human';
  if (tier === 'stale-verified') return 'drift';
  return 'ok';
}

function SourcePanel({
  repo,
  relPath,
  fromWiki,
}: {
  repo: string;
  relPath: string;
  fromWiki: WikiPage | undefined;
}) {
  const commit = fromWiki?.frontmatter.fields.source_commit?.trim();
  const [tab, setTab] = useState<'file' | 'diff'>('file');
  const [content, setContent] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await readSourceFile(repo, relPath);
      setContent(payload.content);
      if (commit) {
        try {
          setDiff(await sourceDiff(repo, relPath, commit));
        } catch (e) {
          setDiff(`Diff non disponibile: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else {
        setDiff(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setContent(null);
      setDiff(null);
    } finally {
      setLoading(false);
    }
  }, [repo, relPath, commit]);

  useEffect(() => {
    void load();
    setTab('file');
  }, [load]);

  const lines = useMemo(() => (content ?? '').split('\n'), [content]);

  return (
    <>
      {commit && (
        <SourceTabs tab={tab} setTab={setTab} commit={commit} />
      )}
      <div className="page-drawer-body">
        {loading && <p className="page-drawer-loading">Carico il file…</p>}
        {error && <p className="page-drawer-error">{error}</p>}
        {!loading && !error && tab === 'file' && content !== null && (
          <pre className="page-drawer-code">
            <table>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i}>
                    <td className="ln">{i + 1}</td>
                    <td className="lc">{line || ' '}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </pre>
        )}
        {!loading && !error && tab === 'diff' && diff !== null && (
          <pre className="page-drawer-code page-drawer-diff">
            <table>
              <tbody>
                {diff.split('\n').map((line, i) => (
                  <tr key={i}>
                    <td className="ln" />
                    <td className={`lc lc-${diffLineKind(line)}`}>{line || ' '}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </pre>
        )}
      </div>
    </>
  );
}

function SourceTabs({
  tab,
  setTab,
  commit,
}: {
  tab: 'file' | 'diff';
  setTab(t: 'file' | 'diff'): void;
  commit: string;
}) {
  const short = commit.length > 12 ? commit.slice(0, 7) : commit;
  return (
    <div className="page-drawer-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === 'file'} onClick={() => setTab('file')}>
        File
      </button>
      <button type="button" role="tab" aria-selected={tab === 'diff'} onClick={() => setTab('diff')}>
        Diff da {short}
      </button>
    </div>
  );
}
