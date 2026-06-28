"use client";

import { AlertTriangle, CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CircularCloseButton } from "@/components/circular-close-button";
import type { NormalizedAppError } from "@/lib/incident/app-error";
import { toReportContext } from "@/lib/incident/normalize-client-error";

import { detectBrowserFamily, detectPlatform, generateIdempotencyKey, readCsrfToken } from "./client-diagnostics";
import styles from "./report-issue-dialog.module.css";

const MAX_NOTE_LENGTH = 1000;

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; reportId: string }
  | { kind: "recorded" }
  | { kind: "error" };

export type ReportIssueDialogProps = {
  open: boolean;
  error: NormalizedAppError;
  onClose: () => void;
  onReported?: (reportId: string) => void;
};

/**
 * The Sendloom report dialog. Opening it creates NO report — only Send does.
 * Attaches safe technical context (built by toReportContext) plus the optional,
 * server-redacted note; the user's name, email, message content, contacts, and
 * credentials are never included. A per-open idempotency key makes a double
 * Send idempotent. Offline disables Send with a clear explanation rather than
 * faking success.
 */
export function ReportIssueDialog({ open, error, onClose, onReported }: ReportIssueDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [note, setNote] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [online, setOnline] = useState(true);
  const idempotencyKeyRef = useRef("");
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fresh idempotency key + clean slate each time the dialog opens.
  useEffect(() => {
    if (open) {
      idempotencyKeyRef.current = generateIdempotencyKey();
      setNote("");
      setState({ kind: "idle" });
      setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && state.kind !== "submitting") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, state.kind, onClose]);

  if (!open || !mounted) {
    return null;
  }

  const submitting = state.kind === "submitting";

  const submit = async () => {
    if (submitting || !online) {
      return;
    }
    setState({ kind: "submitting" });
    try {
      const csrf = readCsrfToken();
      const response = await fetch("/api/incidents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "x-csrf-token": csrf } : {})
        },
        body: JSON.stringify(
          toReportContext(error, {
            userNote: note.trim() || undefined,
            idempotencyKey: idempotencyKeyRef.current,
            browserFamily: detectBrowserFamily(),
            platform: detectPlatform()
          })
        )
      });

      if (response.status === 429) {
        setState({ kind: "recorded" });
        return;
      }
      if (!response.ok) {
        setState({ kind: "error" });
        return;
      }
      const data = (await response.json().catch(() => null)) as { reportId?: string } | null;
      if (data?.reportId) {
        setState({ kind: "success", reportId: data.reportId });
        onReported?.(data.reportId);
      } else {
        setState({ kind: "error" });
      }
    } catch {
      setState({ kind: "error" });
    }
  };

  const isResolved = state.kind === "success" || state.kind === "recorded";

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) {
          onClose();
        }
      }}
    >
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div className={styles.headText}>
            <span
              className={`${styles.icon}${state.kind === "success" ? ` ${styles.iconSuccess}` : ""}`}
              aria-hidden="true"
            >
              {state.kind === "success" ? <CheckCircle2 /> : <ShieldCheck />}
            </span>
            <h2 id={titleId} className={styles.title}>
              {state.kind === "success" ? "Report sent" : state.kind === "recorded" ? "Already recorded" : "Report this issue"}
            </h2>
          </div>
          <CircularCloseButton label="Close report dialog" onClick={onClose} disabled={submitting} />
        </header>

        {state.kind === "success" ? (
          <div id={descId} className={styles.body}>
            <p>Thank you. Our team can now investigate using safe technical details only.</p>
            <p className={styles.reference}>
              Reference: <strong>{state.reportId}</strong>
            </p>
          </div>
        ) : state.kind === "recorded" ? (
          <p id={descId} className={styles.body}>
            This issue has already been recorded. You do not need to submit it again.
          </p>
        ) : (
          <>
            <p id={descId} className={styles.body}>
              Sendloom will attach technical details about the failed action. Your name, email, message content,
              contacts, and account credentials will not be included.
            </p>

            <label className={styles.field}>
              <span className={styles.label}>Optional details</span>
              <textarea
                className={styles.textarea}
                value={note}
                maxLength={MAX_NOTE_LENGTH}
                rows={4}
                placeholder="Describe what you were trying to do…"
                onChange={(event) => setNote(event.target.value)}
                disabled={submitting}
              />
              <span className={styles.hint}>
                <span>Please don&apos;t enter personal or confidential information.</span>
                <span aria-hidden="true">
                  {note.length}/{MAX_NOTE_LENGTH}
                </span>
              </span>
            </label>

            {state.kind === "error" ? (
              <p className={styles.error} role="alert">
                The report could not be sent. Please try again.
              </p>
            ) : null}

            {!online ? (
              <p className={styles.notice} role="status">
                <AlertTriangle aria-hidden="true" />
                You need a connection to send this report. Reconnect, then send it.
              </p>
            ) : null}
          </>
        )}

        <div className={styles.actions}>
          {isResolved ? (
            <button type="button" className={`button ${styles.button}`} onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className={`button secondary ${styles.button}`} onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button
                type="button"
                className={`button ${styles.button} ${styles.send}`}
                onClick={() => void submit()}
                disabled={submitting || !online}
              >
                {submitting ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : null}
                {submitting ? "Sending report…" : "Send report"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
