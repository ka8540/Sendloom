import type { Route } from "next";
import Link from "next/link";
import { Eye, LoaderCircle, Pause, Play, ShieldAlert, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";

import { useErrorToast, useErrorToastEffect } from "@/components/error-toast-provider";
import { PastScheduleRelaunchModal } from "@/components/past-schedule-relaunch-modal";
import { PAST_SCHEDULE_CONFIRMATION_CODE } from "@/lib/campaign-scheduling";
import styles from "./overview-command-center.module.css";

export function SequenceRowActions({
  href,
  campaignId,
  campaignName,
  canRelaunch,
  isActiveRun,
  isPausedRun,
  isDailyLimitBlocked = false,
  onRelaunch
}: {
  href: Route;
  campaignId: string;
  campaignName: string;
  canRelaunch: boolean;
  isActiveRun: boolean;
  isPausedRun: boolean;
  isDailyLimitBlocked?: boolean;
  onRelaunch: () => void;
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<"launch" | "pause" | "resume" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pastScheduleConfirmOpen, setPastScheduleConfirmOpen] = useState(false);
  const [pastScheduleConverting, setPastScheduleConverting] = useState(false);
  const { showSuccess } = useErrorToast();
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
        // A past "schedule once" sequence needs explicit confirmation before we convert it
        // to send right away — surface the modal instead of a raw validation error.
        if (response.status === 409 && payload.code === PAST_SCHEDULE_CONFIRMATION_CODE) {
          setPendingAction(null);
          setPastScheduleConfirmOpen(true);
          return;
        }

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

  async function handleConfirmConvertAndRelaunch() {
    if (pastScheduleConverting) {
      return;
    }

    setPastScheduleConverting(true);
    setError(null);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ convertPastScheduleToImmediate: true })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Could not relaunch the sequence.");
        setPastScheduleConverting(false);
        return;
      }

      setPastScheduleConfirmOpen(false);
      setPastScheduleConverting(false);
      onRelaunch();
      router.refresh();
      showSuccess("Sequence switched to send right away and relaunched.");
    } catch {
      setError("Could not relaunch the sequence.");
      setPastScheduleConverting(false);
    }
  }

  function handleCancelPastScheduleConfirm() {
    if (pastScheduleConverting) {
      return;
    }
    setPastScheduleConfirmOpen(false);
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
    <>
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

      {isDailyLimitBlocked ? (
        /* Auto-paused by daily safety limit — no manual action makes sense; show a clear waiting affordance. */
        <button
          type="button"
          className={`${styles.sequenceActionButton} ${styles.sequenceActionButtonWaiting}`}
          disabled
          aria-label={`${campaignName} waiting for Gmail safety window to reset`}
          title="Waiting for the Gmail safety window to reset"
        >
          <span className={styles.sequenceActionIconWrap}>
            <ShieldAlert aria-hidden="true" />
          </span>
          <span className={styles.sequenceActionLabel}>Wait</span>
        </button>
      ) : isActiveRun ? (
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
    <PastScheduleRelaunchModal
      open={pastScheduleConfirmOpen}
      pending={pastScheduleConverting}
      onCancel={handleCancelPastScheduleConfirm}
      onConfirm={() => void handleConfirmConvertAndRelaunch()}
    />
    </>
  );
}
