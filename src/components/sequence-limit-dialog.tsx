"use client";

import { Clock3, Layers3, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import { CircularCloseButton } from "@/components/circular-close-button";
import {
  SEQUENCE_CONCURRENCY_LIMIT_MESSAGE,
  SEQUENCE_STORAGE_LIMIT_MESSAGE
} from "@/lib/sequence-limit-codes";
import styles from "./sequence-limit-dialog.module.css";

type SequenceLimitDialogProps = {
  open: boolean;
  kind: "concurrency" | "storage";
  loading?: boolean;
  error?: string | null;
  onWaitForSlot?: () => void | Promise<void>;
  onClose: () => void;
};

export function SequenceLimitDialog({
  open,
  kind,
  loading = false,
  error = null,
  onWaitForSlot,
  onClose
}: SequenceLimitDialogProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, onClose, open]);

  if (!open || !mounted) return null;

  const isConcurrency = kind === "concurrency";
  const title = isConcurrency ? "All sequence slots are busy" : "Sequence limit reached";
  const description = isConcurrency ? SEQUENCE_CONCURRENCY_LIMIT_MESSAGE : SEQUENCE_STORAGE_LIMIT_MESSAGE;

  function viewSequences() {
    onClose();
    router.push("/campaigns");
  }

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose();
      }}
    >
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.icon} aria-hidden="true">
            {isConcurrency ? <Clock3 /> : <Layers3 />}
          </span>
          <h2 id={titleId}>{title}</h2>
          <CircularCloseButton label="Close sequence limit dialog" onClick={onClose} disabled={loading} />
        </div>
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.actions}>
          {isConcurrency ? (
            <>
              <button type="button" className="button secondary" onClick={viewSequences} disabled={loading}>
                View running sequences
              </button>
              <button type="button" className="button" onClick={() => void onWaitForSlot?.()} disabled={loading}>
                {loading ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : null}
                {loading ? "Queueing…" : "Wait for a slot"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="button secondary" onClick={onClose} disabled={loading}>
                Cancel
              </button>
              <button type="button" className="button" onClick={viewSequences} disabled={loading}>
                View sequences
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
