import { useEffect, useRef, type ReactNode } from 'react';

type Props = {
  title: string;
  onClose(): void;
  children: ReactNode;
};

/** Simple side drawer: title, close button, Esc dismisses unless a native `<dialog>` is open. */
export function SidePanel({ title, onClose, children }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      restoreFocus.current?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="salute-side" role="complementary" aria-label={title}>
      <header className="salute-side-head">
        <h2 className="salute-side-title">{title}</h2>
        <button ref={closeRef} type="button" className="btn btn-quiet" onClick={onClose}>
          Chiudi
        </button>
      </header>
      <div className="salute-side-body">{children}</div>
    </aside>
  );
}
