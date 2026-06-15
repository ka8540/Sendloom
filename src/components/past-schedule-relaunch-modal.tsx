"use client";

import { CalendarClock, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import styles from "./past-schedule-relaunch-modal.module.css";

/**
 * Confirmation shown when a relaunch targets a "schedule once" sequence whose time has
 * already passed. Confirming switches the sequence to send right away and relaunches it.
 * Purely presentational — the caller owns the launch request and loading state.
 *
 * Rendered through a portal so it escapes clickable containers (e.g. the dashboard
 * sequence rows, which navigate on click) and never bubbles interactions back into them.
 */
export function PastScheduleRelaunchModal(props: {
  open: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { open, pending, onCancel, onConfirm } = props;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        onCancel();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, pending, onCancel]);

  if (!open || !mounted) {
    return null;
  }

  return createPortal(
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onMouseDown={() => {
        if (!pending) {
          onCancel();
        }
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        aria-labelledby="past-schedule-relaunch-title"
        aria-describedby="past-schedule-relaunch-message"
        aria-modal="true"
        className={styles.modalCard}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <span className={styles.modalIcon} aria-hidden="true">
            <CalendarClock />
          </span>
          <h2 id="past-schedule-relaunch-title">This sequence was scheduled in the past</h2>
        </div>

        <div className={styles.modalBody}>
          <p id="past-schedule-relaunch-message">
            The saved schedule time has already passed. Sendloom can switch this run to send right away and relaunch it
            now.
          </p>
        </div>

        <div className={styles.modalActions}>
          <button
            className={`button secondary ${styles.modalButton}`}
            type="button"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </button>
          <button className={`button ${styles.modalButton}`} type="button" onClick={onConfirm} disabled={pending}>
            {pending ? (
              <>
                <Loader2 aria-hidden="true" className={styles.spin} />
                Launching...
              </>
            ) : (
              "Send right away"
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
