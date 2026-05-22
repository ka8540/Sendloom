import type { Route } from "next";
import Link from "next/link";
import { Eye, LoaderCircle, Pause, Play, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";

import { useErrorToastEffect } from "@/components/error-toast-provider";
import styles from "./overview-command-center.module.css";

export function SequenceRowActions({
  href,
  campaignId,
  campaignName,
  canRelaunch,
  isActiveRun,
  isPausedRun,
  onRelaunch
}: {
  href: Route;
  campaignId: string;
  campaignName: string;
  canRelaunch: boolean;
  isActiveRun: boolean;
  isPausedRun: boolean;
  onRelaunch: () => void;
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<"launch" | "pause" | "resume" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useErrorToastEffect(error, "Sequence action failed");

  async function handleRelaunch(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!canRelaunch || pendingAction) {
      return;
    }

    setPendingAction("launch");
    setError(null);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/launch`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Could not relaunch the sequence.");
        setPendingAction(null);
        return;
      }

      onRelaunch();
      router.refresh();
      setPendingAction(null);
    } catch {
      setError("Could not relaunch the sequence.");
      setPendingAction(null);
    }
  }

  async function handlePause(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (pendingAction) {
      return;
    }

    setPendingAction("pause");
    setError(null);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/pause`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Could not pause the sequence.");
        setPendingAction(null);
        return;
      }

      router.refresh();
      setPendingAction(null);
    } catch {
      setError("Could not pause the sequence.");
      setPendingAction(null);
    }
  }

  async function handleResume(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (pendingAction) {
      return;
    }

    setPendingAction("resume");
    setError(null);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/resume`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Could not resume the sequence.");
        setPendingAction(null);
        return;
      }

      router.refresh();
      setPendingAction(null);
    } catch {
      setError("Could not resume the sequence.");
      setPendingAction(null);
    }
  }

  async function handleDelete(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (pendingAction) {
      return;
    }

    const confirmed = window.confirm(`Delete "${campaignName}"? This removes the sequence and its run history.`);
    if (!confirmed) {
      return;
    }

    setPendingAction("delete");
    setError(null);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Could not delete the sequence.");
        setPendingAction(null);
        return;
      }

      router.refresh();
      setPendingAction(null);
    } catch {
      setError("Could not delete the sequence.");
      setPendingAction(null);
    }
  }

  return (
    <div className={styles.sequenceActionGroup} onClick={(event) => event.stopPropagation()}>
      <Link
        href={href}
        className={`${styles.sequenceActionButton} ${styles.sequenceActionButtonView} ${styles.sequenceActionView}`}
        aria-label={`View ${campaignName}`}
      >
        <span className={styles.sequenceActionIconWrap}>
          <Eye aria-hidden="true" />
        </span>
        <span className={styles.sequenceActionLabel}>View</span>
      </Link>

      {isActiveRun ? (
        /* Active QUEUED / RUNNING → offer Pause */
        <button
          type="button"
          className={`${styles.sequenceActionButton} ${styles.sequenceActionButtonPause}`}
          onClick={(event) => void handlePause(event)}
          disabled={Boolean(pendingAction)}
          aria-label={`Pause ${campaignName}`}
        >
          <span className={styles.sequenceActionIconWrap}>
            {pendingAction === "pause" ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Pause aria-hidden="true" />}
          </span>
          <span className={styles.sequenceActionLabel}>Pause</span>
        </button>
      ) : isPausedRun ? (
        /* PAUSED → offer Resume (returns to scheduled/queued state without sending immediately) */
        <button
          type="button"
          className={`${styles.sequenceActionButton} ${styles.sequenceActionButtonResume}`}
          onClick={(event) => void handleResume(event)}
          disabled={Boolean(pendingAction)}
          aria-label={`Resume ${campaignName}`}
        >
          <span className={styles.sequenceActionIconWrap}>
            {pendingAction === "resume" ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Play aria-hidden="true" />}
          </span>
          <span className={styles.sequenceActionLabel}>Resume</span>
        </button>
      ) : (
        /* COMPLETED / ready → offer Relaunch */
        <button
          type="button"
          className={`${styles.sequenceActionButton} ${styles.sequenceActionButtonLaunch}`}
          onClick={(event) => void handleRelaunch(event)}
          disabled={!canRelaunch || Boolean(pendingAction)}
          aria-label={canRelaunch ? `Relaunch ${campaignName}` : `${campaignName}`}
        >
          <span className={styles.sequenceActionIconWrap}>
            {pendingAction === "launch" ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Play aria-hidden="true" />}
          </span>
          <span className={styles.sequenceActionLabel}>{canRelaunch ? "Relaunch" : "—"}</span>
        </button>
      )}

      <button
        type="button"
        className={`${styles.sequenceActionButton} ${styles.sequenceActionButtonDelete} ${styles.sequenceActionDanger}`}
        onClick={(event) => void handleDelete(event)}
        disabled={Boolean(pendingAction)}
        aria-label={`Delete ${campaignName}`}
      >
        <span className={styles.sequenceActionIconWrap}>
          {pendingAction === "delete" ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
        </span>
        <span className={styles.sequenceActionLabel}>Delete</span>
      </button>
    </div>
  );
}
