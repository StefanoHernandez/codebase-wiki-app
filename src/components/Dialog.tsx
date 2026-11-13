import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';
import { t } from '../i18n';

export interface DialogProps {
  open: boolean;
  title: string;
  /** Form fields. Inputs inside are submitted with Enter. */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Ultramarine confirm button: the action is signed by a person. */
  human?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm(): void;
  onCancel(): void;
}

/** Accessible modal built on <dialog>: focus trap, Escape and inert background come from the platform. */
export function Dialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = t('shell.dialog.cancel'),
  human = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) onConfirm();
  };

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={error ? errorId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      {open && (
        <form onSubmit={submit} className="dialog-form">
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
          {children && <div className="dialog-body">{children}</div>}
          {error && (
            <p id={errorId} className="dialog-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </button>
            <button type="submit" className={human ? 'btn btn-human' : 'btn btn-strong'} disabled={busy}>
              {confirmLabel}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/** Labelled field wrapper for dialog forms. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
