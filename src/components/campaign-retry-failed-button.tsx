"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useErrorToast, useErrorToastEffect } from "@/components/error-toast-provider";
import { SequenceLimitDialog } from "@/components/sequence-limit-dialog";
import { SEQUENCE_CONCURRENCY_LIMIT_CODE } from "@/lib/sequence-limit-codes";

export function CampaignRetryFailedButton(props: {
  campaignId: string;
  failedCount: number;
  className?: string;
  iconOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitOpen, setLimitOpen] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const { showSuccess } = useErrorToast();
  useErrorToastEffect(error, "Retry failed");

  async function handleRetry() {
    if (pending) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/campaigns/${props.campaignId}/retry-failed`, {
        method: "POST"
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (payload.code === SEQUENCE_CONCURRENCY_LIMIT_CODE) {
          setLimitOpen(true);
          setPending(false);
          return;
        }
        setError(payload.error ?? "Could not retry failed recipients.");
        setPending(false);
        return;
      }

      // Refresh the server component. The run is now active, so the page no
      // longer renders this button — we deliberately keep `pending` true so it
      // stays disabled/loading until it is unmounted by the refresh.
      router.refresh();
    } catch {
      setError("Could not retry failed recipients.");
      setPending(false);
    }
  }

  async function waitForSlot() {
    if (queueing) return;
    setQueueing(true);
    setQueueError(null);
    try {
      const response = await fetch(`/api/campaigns/${props.campaignId}/retry-failed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waitForSlot: true })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setQueueError(payload.error ?? "Could not queue this retry.");
        setQueueing(false);
        return;
      }
      setLimitOpen(false);
      setQueueing(false);
      showSuccess(
        payload.status === "STARTED"
          ? "A slot became available and the retry started."
          : "Sequence queued. It will start automatically when a slot becomes available."
      );
      router.refresh();
    } catch {
      setQueueError("Could not queue this retry.");
      setQueueing(false);
    }
  }

  const label =
    props.failedCount > 0 ? `Retry ${props.failedCount} failed` : "Retry failed recipients";

  return (
    <>
    <form
      className={props.className}
      onSubmit={(event) => {
        event.preventDefault();
        void handleRetry();
      }}
    >
      <button
        className={props.iconOnly ? "sequence-detail-action" : "button secondary"}
        type="submit"
        disabled={pending}
        aria-label={pending ? "Retrying failed recipients" : label}
        data-action={props.iconOnly ? "retry" : undefined}
      >
        {props.iconOnly ? (
          <>
            <span className="sequence-detail-action__icon">
              {pending ? <span className="button-spinner" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
            </span>
            <span className="sequence-detail-action__label">{pending ? "Retrying…" : label}</span>
          </>
        ) : (
          <>
            {pending ? <span className="button-spinner" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
            <span>{pending ? "Retrying..." : label}</span>
          </>
        )}
      </button>
    </form>
    <SequenceLimitDialog
      open={limitOpen}
      kind="concurrency"
      loading={queueing}
      error={queueError}
      onWaitForSlot={waitForSlot}
      onClose={() => {
        if (!queueing) setLimitOpen(false);
      }}
    />
    </>
  );
}
