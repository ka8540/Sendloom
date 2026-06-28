"use client";

import { AlertTriangle, ArrowLeft, LoaderCircle, Mail, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { CircularCloseButton } from "@/components/circular-close-button";
import { deriveRecoveryActions, type NormalizedAppError } from "@/lib/incident/app-error";

import { gmailReconnectHref } from "./client-diagnostics";
import { ReportIssueDialog } from "./report-issue-dialog";
import styles from "./error-recovery-panel.module.css";

export type ErrorRecoveryPanelProps = {
  error: NormalizedAppError;
  /** Re-runs the existing (idempotent) operation. Omit when retry is unsafe. */
  onRetry?: () => void | Promise<void>;
  /** Optional override for the "Go back" action (defaults to history.back()). */
  onGoBack?: () => void;
  variant?: "card" | "inline" | "bare";
  /** Override the Gmail reconnect URL (e.g. to target a specific sender email). */
  reconnectHref?: string;
  /** Show a circular close button (e.g. when embedded in a dismissible surface). */
  dismissible?: boolean;
  onDismiss?: () => void;
  onReported?: (reportId: string) => void;
};

/**
 * The single reusable recovery surface for the whole app. It shows ONLY the
 * actions appropriate to the failure (Retry / Reconnect Gmail / Report issue /
 * Go back), never raw technical detail. Retry is single-flight + disabled while
 * running and while offline; it re-runs the caller's existing idempotent action
 * (the panel never duplicates business logic). Report opens the report dialog;
 * once sent, the button becomes "Reported" and repeat clicks do nothing.
 */
export function ErrorRecoveryPanel({
  error,
  onRetry,
  onGoBack,
  variant = "card",
  reconnectHref,
  dismissible,
  onDismiss,
  onReported
}: ErrorRecoveryPanelProps) {
  const [retrying, setRetrying] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportedId, setReportedId] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const actions = deriveRecoveryActions(error.category, { retryable: error.retryable, reportable: error.reportable });

  const runRetry = useCallback(async () => {
    if (!onRetry || retrying) {
      return;
    }
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }, [onRetry, retrying]);

  const goBack = useCallback(() => {
    if (onGoBack) {
      onGoBack();
      return;
    }
    if (typeof window !== "undefined") {
      window.history.back();
    }
  }, [onGoBack]);

  const showRetry = actions.includes("RETRY") && Boolean(onRetry);
  const showReconnect = actions.includes("RECONNECT_GMAIL");
  const showReport = actions.includes("REPORT");
  const showGoBack = actions.includes("GO_BACK");
  // Offline: keep Retry visible but disabled — a connection is required first.
  const retryDisabled = retrying || (error.category === "NETWORK_OFFLINE" && !online);

  const wrapperClass = [styles.panel, styles[variant] ?? ""].filter(Boolean).join(" ");

  return (
    <div className={wrapperClass} role="alert">
      {dismissible ? (
        <div className={styles.dismiss}>
          <CircularCloseButton label="Dismiss" compact onClick={onDismiss} />
        </div>
      ) : null}

      <div className={styles.header}>
        <span className={styles.icon} aria-hidden="true">
          <AlertTriangle />
        </span>
        <div className={styles.copy}>
          <h3 className={styles.title}>{error.publicTitle}</h3>
          <p className={styles.message}>{error.publicMessage}</p>
        </div>
      </div>

      <div className={styles.actions}>
        {showRetry ? (
          <button type="button" className={`button ${styles.button}`} onClick={() => void runRetry()} disabled={retryDisabled}>
            {retrying ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <RefreshCw aria-hidden="true" />}
            {retrying ? "Retrying…" : "Try again"}
          </button>
        ) : null}

        {showReconnect ? (
          <a className={`button ${styles.button}`} href={reconnectHref ?? gmailReconnectHref()}>
            <Mail aria-hidden="true" />
            Reconnect Gmail
          </a>
        ) : null}

        {showReport ? (
          <button
            type="button"
            className={`button secondary ${styles.button}`}
            onClick={() => setReportOpen(true)}
            disabled={Boolean(reportedId)}
          >
            {reportedId ? "Reported" : "Report issue"}
          </button>
        ) : null}

        {showGoBack ? (
          <button type="button" className={`button secondary ${styles.button}`} onClick={goBack}>
            <ArrowLeft aria-hidden="true" />
            Go back
          </button>
        ) : null}
      </div>

      {error.correlationId ? <p className={styles.reference}>Reference: {error.correlationId}</p> : null}

      <ReportIssueDialog
        open={reportOpen}
        error={error}
        onClose={() => setReportOpen(false)}
        onReported={(reportId) => {
          setReportedId(reportId);
          setReportOpen(false);
          onReported?.(reportId);
        }}
      />
    </div>
  );
}
