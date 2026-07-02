"use client";

// Compact bounce-monitoring capability line for a connected Gmail sender.
// Receives only safe, precomputed props from the server (status category +
// label) — never Pub/Sub, history-id, or OAuth internals. The one action it
// offers is the bounded one-time "Sync recent delivery failures" backfill.

import { useState } from "react";
import { CircleCheck, CircleX, LoaderCircle, MailX, TriangleAlert } from "lucide-react";

import styles from "./bounce-monitoring-status.module.css";

export type BounceMonitoringStatusKind =
  | "ACTIVE"
  | "PERMISSION_REQUIRED"
  | "RECONNECT_REQUIRED"
  | "RENEWAL_FAILED"
  | "UNAVAILABLE";

const STATUS_COPY: Record<BounceMonitoringStatusKind, { label: string; detail: string | null }> = {
  ACTIVE: { label: "Bounce monitoring active", detail: null },
  PERMISSION_REQUIRED: {
    label: "Bounce monitoring: permission required",
    detail: "Reconnect Gmail to detect delivery failures automatically."
  },
  RECONNECT_REQUIRED: {
    label: "Bounce monitoring: reconnect required",
    detail: "Reconnect Gmail to detect delivery failures automatically."
  },
  RENEWAL_FAILED: {
    label: "Bounce monitoring: temporarily unavailable",
    detail: "Sending can continue, but recent bounces may take longer to appear."
  },
  UNAVAILABLE: { label: "Bounce monitoring unavailable", detail: null }
};

function StatusIcon({ status }: { status: BounceMonitoringStatusKind }) {
  if (status === "ACTIVE") {
    return <CircleCheck aria-hidden="true" className={styles.iconActive} />;
  }
  if (status === "RENEWAL_FAILED") {
    return <TriangleAlert aria-hidden="true" className={styles.iconWarning} />;
  }
  if (status === "UNAVAILABLE") {
    return <CircleX aria-hidden="true" className={styles.iconMuted} />;
  }
  return <MailX aria-hidden="true" className={styles.iconWarning} />;
}

export function BounceMonitoringStatus({
  senderId,
  status,
  backfillCompleted
}: {
  senderId: string;
  status: BounceMonitoringStatusKind;
  backfillCompleted: boolean;
}) {
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncDone, setSyncDone] = useState(backfillCompleted);

  const copy = STATUS_COPY[status];
  const canSync = status === "ACTIVE" && !syncDone;

  const handleSync = async () => {
    if (syncing) {
      return;
    }
    setSyncing(true);
    setSyncMessage(null);
    try {
      const response = await fetch(`/api/senders/${encodeURIComponent(senderId)}/sync-bounces`, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json" }
      });
      if (!response.ok) {
        setSyncMessage("Could not check recent delivery failures right now. Please try again.");
        return;
      }
      const payload = (await response.json()) as {
        checkedMessages?: number;
        processedBounces?: number;
        alreadyCompleted?: boolean;
      };
      setSyncDone(true);
      setSyncMessage(
        payload.alreadyCompleted
          ? "Recent delivery failures were already checked."
          : `Checked ${payload.checkedMessages ?? 0} delivery notifications · ${payload.processedBounces ?? 0} failed ${
              (payload.processedBounces ?? 0) === 1 ? "recipient" : "recipients"
            } recorded.`
      );
    } catch {
      setSyncMessage("Could not check recent delivery failures right now. Please try again.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className={styles.root} data-bounce-monitoring={status}>
      <span className={styles.statusLine}>
        <StatusIcon status={status} />
        <span>{copy.label}</span>
      </span>
      {copy.detail && <span className={styles.detail}>{copy.detail}</span>}
      {canSync && (
        <button type="button" className={styles.syncButton} onClick={() => void handleSync()} disabled={syncing}>
          {syncing ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : null}
          <span>{syncing ? "Checking recent failures…" : "Sync recent delivery failures"}</span>
        </button>
      )}
      {syncMessage && (
        <span className={styles.detail} role="status">
          {syncMessage}
        </span>
      )}
    </div>
  );
}
