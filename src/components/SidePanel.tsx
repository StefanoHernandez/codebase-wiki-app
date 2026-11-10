import { useEffect, type ReactNode } from 'react';

type Props = {
  title: string;
  onClose(): void;
  children: ReactNode;
};

/** Simple side drawer: title, close button, Esc dismisses. */
export function SidePanel({ title, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="salute-side" role="complementary" aria-label={title}>
      <header className="salute-side-head">
        <h2 className="salute-side-title">{title}</h2>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Chiudi
        </button>
      </header>
      <div className="salute-side-body">{children}</div>
    </aside>
  );
}
