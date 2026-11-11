import type { ReactNode } from 'react';

/** Text safe to copy: keeps inline segments, drops wrapping backticks. */
export function textForCopy(raw: string): string {
  const trimmed = raw.trim();
  if (/^`[^`]+`$/.test(trimmed)) return trimmed.slice(1, -1);
  return trimmed.replace(/`([^`]+)`/g, '$1');
}

export function renderInlineCode(raw: string): ReactNode {
  const text = raw.trim();
  if (!text) return '—';
  if (/^`[^`]+`$/.test(text)) return <code>{text.slice(1, -1)}</code>;
  const parts: ReactNode[] = [];
  const re = /`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(<code key={match.index}>{match[1]}</code>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  if (parts.length === 0) return text;
  if (parts.length === 1) return parts[0];
  return <>{parts}</>;
}
