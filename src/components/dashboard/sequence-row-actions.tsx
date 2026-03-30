import type { Route } from "next";
import Link from "next/link";
import { Eye, LoaderCircle, Play, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";

import styles from "./overview-command-center.module.css";

export function SequenceRowActions({
  href,
  campaignId,
  campaignName,
  canRelaunch
}: {
  href: Route;
  campaignId: string;
  campaignName: string;
  canRelaunch: boolean;
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<"launch" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      router.refresh();
      setPendingAction(null);
    } catch {
      setError("Could not relaunch the sequence.");
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
      <button
        type="button"
        className={`${styles.sequenceActionButton} ${styles.sequenceActionButtonLaunch}`}
        onClick={(event) => void handleRelaunch(event)}
        disabled={!canRelaunch || Boolean(pendingAction)}
        aria-label={canRelaunch ? `Relaunch ${campaignName}` : `${campaignName} is busy`}
      >
        <span className={styles.sequenceActionIconWrap}>
          {pendingAction === "launch" ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Play aria-hidden="true" />}
        </span>
        <span className={styles.sequenceActionLabel}>{canRelaunch ? "Relaunch" : "Busy"}</span>
      </button>
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
      {error ? <span className={styles.sequenceActionError}>{error}</span> : null}
    </div>
  );
}
