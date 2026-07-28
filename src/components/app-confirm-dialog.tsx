"use client";

import { AlertTriangle, LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import styles from "./app-confirm-dialog.module.css";

export type AppConfirmDialogProps = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Label shown on the confirm button while the action runs. */
  loadingLabel?: string;
  destructive?: boolean;
  /**
   * Acknowledge-only: the dialog reports something rather than asking, so it
   * drops Cancel and shows its single action alone (focused on open, since
   * there is no safer control to land on). Escape and the backdrop still
   * dismiss it, both routed through onCancel like every other dialog.
   */
  acknowledge?: boolean;
  loading?: boolean;
  /** A safe, user-facing error shown inside the dialog (never raw backend detail). */
  error?: string | null;
  /** Confirm-button icon; defaults to a trash icon for destructive actions. */
  confirmIcon?: ReactNode;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

/**
 * The shared in-app confirmation dialog — the Sendloom replacement for every
 * native browser confirmation popup. Portal-rendered with proper alertdialog semantics,
 * Escape/backdrop dismissal (blocked while the action runs), focus moved to the
 * safer Cancel control on open, a loading state with a spinner, and an optional
 * safe error message. Destructive variant uses the app's danger styling and a
 * trash icon. One implementation, reused everywhere — never copy-pasted per page.
 */
export function AppConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  loadingLabel,
  destructive = false,
  acknowledge = false,
  loading = false,
  error = null,
  confirmIcon,
  onConfirm,
  onCancel
}: AppConfirmDialogProps) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Escape closes the dialog, but never while the action is in flight.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading, onCancel]);

  // Move focus to the safer Cancel control on open so Enter never confirms a
  // destructive action by accident.
  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      // An acknowledge-only dialog has no Cancel to land on — focus its one action.
      if (!cancelRef.current) {
        confirmRef.current?.focus();
        return;
      }
      cancelRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  if (!open || !mounted) {
    return null;
  }

  const resolvedLoadingLabel = loadingLabel ?? (destructive ? "Deleting…" : "Working…");
  const resolvedConfirmIcon = confirmIcon ?? (destructive ? <Trash2 aria-hidden="true" /> : null);

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        // Backdrop click closes — never while working, never from inside the card.
        if (event.target === event.currentTarget && !loading) {
          onCancel();
        }
      }}
    >
      <div
        className={styles.card}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.head}>
          <span className={`${styles.icon}${destructive ? ` ${styles.iconDestructive}` : ""}`} aria-hidden="true">
            {destructive ? <Trash2 /> : <AlertTriangle />}
          </span>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
        </div>

        <div id={descId} className={styles.body}>
          {description}
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.actions}>
          {acknowledge ? null : (
            <button
              ref={cancelRef}
              type="button"
              className={`button secondary ${styles.button}`}
              onClick={onCancel}
              disabled={loading}
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            className={`${styles.button} ${styles.confirm}${destructive ? ` ${styles.confirmDestructive}` : ""}`}
            onClick={() => void onConfirm()}
            disabled={loading}
          >
            {loading ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : resolvedConfirmIcon}
            {loading ? resolvedLoadingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
