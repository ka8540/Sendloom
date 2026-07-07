"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, LoaderCircle, MessageSquare } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CircularCloseButton } from "@/components/circular-close-button";

import { detectBrowserFamily, detectPlatform, generateIdempotencyKey, readCsrfToken } from "./client-diagnostics";
import styles from "./help-report-dialog.module.css";

const MAX_NOTE_LENGTH = 1000;

/**
 * Issue types offered in the manual report form. The `value` is the label stored
 * as the incident `operation`, so it is what an admin sees in the console. Kept
 * as a stable, exported list so the menu, the form, and the tests agree.
 */
export const HELP_REPORT_ISSUE_TYPES = [
  { value: "Bug", label: "Bug" },
  { value: "Confusing UI", label: "Confusing UI" },
  { value: "Wrong data", label: "Wrong data" },
  { value: "Loading/performance", label: "Loading/performance" },
  { value: "Guide/tour issue", label: "Guide/tour issue" },
  { value: "Other", label: "Other" }
] as const;

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "recorded" }
  | { kind: "error" };

export type HelpReportDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Human page/dashboard name shown to the user and stored as the incident feature (e.g. "Discover"). */
  pageLabel: string;
  /** Stable machine context for where the report was opened (e.g. "discover_guide_menu"). */
  guideContext: string;
};

/**
 * Manual "Report issue" dialog, opened from the dashboard help menu — no crash or
 * error boundary required. It reuses the same authenticated `/api/incidents`
 * endpoint and privacy guarantees as the automatic error report: only the issue
 * type, the user's own description, the current pathname, the page label, coarse
 * browser/platform families, and a per-open idempotency key are sent. The server
 * redacts the note and derives everything else. No page data, DOM, cookies,
 * tokens, or contacts are ever attached.
 */
export function HelpReportDialog({ open, onClose, pageLabel, guideContext }: HelpReportDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [issueType, setIssueType] = useState<string>(HELP_REPORT_ISSUE_TYPES[0].value);
  const [note, setNote] = useState("");
  const [route, setRoute] = useState("");
  const [openedAt, setOpenedAt] = useState<Date | null>(null);
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [online, setOnline] = useState(true);
  const idempotencyKeyRef = useRef("");
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const typeId = useId();
  const noteId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fresh idempotency key + clean slate + captured context each time it opens.
  useEffect(() => {
    if (open) {
      idempotencyKeyRef.current = generateIdempotencyKey();
      setIssueType(HELP_REPORT_ISSUE_TYPES[0].value);
      setNote("");
      setState({ kind: "idle" });
      setRoute(typeof window === "undefined" ? "" : window.location.pathname);
      setOpenedAt(new Date());
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

  // Move focus into the dialog when it opens (accessibility).
  useEffect(() => {
    if (open && mounted) {
      const frame = window.requestAnimationFrame(() => selectRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
  }, [open, mounted]);

  const openedAtLabel = useMemo(() => {
    if (!openedAt) {
      return "";
    }
    try {
      return openedAt.toLocaleString();
    } catch {
      return openedAt.toISOString();
    }
  }, [openedAt]);

  if (!open || !mounted) {
    return null;
  }

  const submitting = state.kind === "submitting";
  const noteReady = note.trim().length > 0;
  const isResolved = state.kind === "success" || state.kind === "recorded";

  const submit = async () => {
    if (submitting || !online || !noteReady) {
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
        body: JSON.stringify({
          category: "USER_REPORTED_ISSUE",
          feature: pageLabel,
          operation: issueType,
          route: typeof window !== "undefined" ? window.location.pathname : route,
          currentOperationState: guideContext,
          onlineStatus: typeof navigator !== "undefined" ? navigator.onLine : undefined,
          browserFamily: detectBrowserFamily(),
          platform: detectPlatform(),
          userNote: note.trim(),
          idempotencyKey: idempotencyKeyRef.current
        })
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
        setState({ kind: "success" });
      } else {
        setState({ kind: "error" });
      }
    } catch {
      setState({ kind: "error" });
    }
  };

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
              className={`${styles.icon}${isResolved ? ` ${styles.iconSuccess}` : ""}`}
              aria-hidden="true"
            >
              {isResolved ? <CheckCircle2 /> : <MessageSquare />}
            </span>
            <h2 id={titleId} className={styles.title}>
              {state.kind === "success"
                ? "Report sent"
                : state.kind === "recorded"
                  ? "Already recorded"
                  : "Report an issue"}
            </h2>
          </div>
          <CircularCloseButton label="Close report dialog" onClick={onClose} disabled={submitting} />
        </header>

        {state.kind === "success" ? (
          <p id={descId} className={styles.success} role="status">
            Thanks — your report was sent.
          </p>
        ) : state.kind === "recorded" ? (
          <p id={descId} className={styles.success} role="status">
            This issue has already been recorded. You do not need to submit it again.
          </p>
        ) : (
          <>
            <p id={descId} className={styles.intro}>
              Tell us what went wrong on this page. Your description plus the details below are all we attach — no
              page content, contacts, or account data are included.
            </p>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={typeId}>
                Issue type
              </label>
              <div className={styles.selectWrap}>
                <select
                  ref={selectRef}
                  id={typeId}
                  className={styles.select}
                  value={issueType}
                  onChange={(event) => setIssueType(event.target.value)}
                  disabled={submitting}
                >
                  {HELP_REPORT_ISSUE_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className={styles.selectChevron} aria-hidden="true" />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={noteId}>
                Description
              </label>
              <textarea
                id={noteId}
                className={styles.textarea}
                value={note}
                maxLength={MAX_NOTE_LENGTH}
                rows={4}
                placeholder="What happened? What were you trying to do?"
                onChange={(event) => setNote(event.target.value)}
                disabled={submitting}
              />
              <span className={styles.hint}>
                <span>Please don&apos;t enter personal or confidential information.</span>
                <span aria-hidden="true">
                  {note.length}/{MAX_NOTE_LENGTH}
                </span>
              </span>
            </div>

            <dl className={styles.context} aria-label="Report context">
              <div className={styles.contextRow}>
                <dt>Page</dt>
                <dd>{pageLabel}</dd>
              </div>
              <div className={styles.contextRow}>
                <dt>Location</dt>
                <dd>{route || "—"}</dd>
              </div>
              {openedAtLabel ? (
                <div className={styles.contextRow}>
                  <dt>Time</dt>
                  <dd>{openedAtLabel}</dd>
                </div>
              ) : null}
            </dl>

            {state.kind === "error" ? (
              <p className={styles.error} role="alert">
                We couldn&apos;t send the report. Please try again.
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
              <button
                type="button"
                className={`button secondary ${styles.button}`}
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`button ${styles.button} ${styles.send}`}
                onClick={() => void submit()}
                disabled={submitting || !online || !noteReady}
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
