import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseFrontmatter } from '../lib/frontmatter.ts';
import './markdown.css';

type Props = {
  /** Full page text; frontmatter is stripped before rendering. */
  markdown: string;
  /** Wiki-relative path of the page being shown, used to resolve relative links. */
  pagePath?: string;
  /** Called with a wiki-relative path when an internal `.md` link is clicked. */
  onOpenPage?: (relPath: string) => void;
  /** When set, only these wiki paths are interactive links; others render as plain text. */
  wikiLinkTargets?: string[];
};

/** Resolves `href` against the directory of `pagePath` (both wiki-relative, `/`-separated). */
function resolveRelative(pagePath: string, href: string): string {
  const parts = pagePath.split('/').slice(0, -1);
  for (const seg of href.split('#')[0].split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(decodeURIComponent(seg));
  }
  return parts.join('/');
}

const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href);

/** Renders a wiki page as a document (Newsreader). Raw HTML is never rendered. */
export function Markdown({ markdown, pagePath = '', onOpenPage, wikiLinkTargets }: Props) {
  const body = parseFrontmatter(markdown).body;
  const linkable =
    wikiLinkTargets === undefined ? null : new Set(wikiLinkTargets.map((p) => p.replace(/\\/g, '/')));
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href = '', children }) {
            const internal = !isExternal(href) && /\.md(#.*)?$/i.test(href);
            if (internal && onOpenPage) {
              const target = resolveRelative(pagePath, href);
              if (linkable && !linkable.has(target)) {
                return <span>{children}</span>;
              }
              return (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenPage(target);
                  }}
                >
                  {children}
                </a>
              );
            }
            return (
              <a href={href} rel="noreferrer" target="_blank">
                {children}
              </a>
            );
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
