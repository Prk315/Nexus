import { useCallback, useEffect, useRef, useState } from "react";

// In-app confirmation modal.
//
// window.confirm() is suppressed in Tauri's WKWebView (iOS) and silently
// returns undefined there — the same trap PdfViewer's "clear all" already
// works around — so every destructive confirmation in Vault goes through this
// component instead. Tap targets are sized for a finger on iPad.

export interface ConfirmOptions {
  title: string;
  /** Main line. Kept short — the detail list below carries the specifics. */
  message?: string;
  /** Bullet points spelling out exactly what is lost. */
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmDialogProps extends ConfirmOptions {
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title, message, details, confirmLabel = "Delete", cancelLabel = "Cancel",
  onConfirm, onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Cancel is the focused default: Enter/Space on an untouched dialog must
  // never destroy anything.
  useEffect(() => { cancelRef.current?.focus(); }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
    }
    // Capture phase: Vault's global Escape binding would otherwise also fire
    // and close whatever is behind the dialog.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div className="confirm-backdrop" onPointerDown={onCancel}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={e => e.stopPropagation()}
      >
        <div className="confirm-title">{title}</div>
        {message && <div className="confirm-message">{message}</div>}
        {details && details.length > 0 && (
          <ul className="confirm-details">
            {details.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        )}
        <div className="confirm-actions">
          <button ref={cancelRef} className="confirm-btn confirm-btn-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="confirm-btn confirm-btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Promise-based confirmation.
 *
 * `confirm(opts)` resolves true only when the user presses the destructive
 * button, so callers keep reading as a straight `if (!ok) return;` guard and
 * any post-delete cleanup still runs after the user has decided — not before.
 * Render `dialog` once, anywhere in the tree.
 */
export function useConfirm() {
  const [pending, setPending] = useState<
    { opts: ConfirmOptions; resolve: (ok: boolean) => void } | null
  >(null);

  // Latest resolver, so an unmount / replacement can't strand a caller awaiting
  // a promise that will never settle.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      pendingRef.current?.resolve(false);
      setPending({ opts, resolve });
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    pendingRef.current?.resolve(ok);
    pendingRef.current = null;
    setPending(null);
  }, []);

  const dialog = pending ? (
    <ConfirmDialog
      {...pending.opts}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { confirm, dialog };
}
