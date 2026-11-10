import type { ReactNode } from 'react';

/** Directive empty state: one sentence of what is (not) here, optional detail and action. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <div className="empty-detail">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}
