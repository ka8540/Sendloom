"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useErrorToast } from "@/components/error-toast-provider";
import { SequenceLimitDialog } from "@/components/sequence-limit-dialog";
import { SEQUENCE_CONCURRENCY_LIMIT_CODE } from "@/lib/sequence-limit-codes";

export function CampaignPauseResumeButton(props: {
  campaignId: string;
  isPaused: boolean;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const { showError, showSuccess } = useErrorToast();
  const [pending, setPending] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  async function toggle() {
    if (pending) return;
    setPending(true);
    const action = props.isPaused ? "resume" : "pause";
    try {
      const response = await fetch(`/api/campaigns/${props.campaignId}/${action}`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload.code === SEQUENCE_CONCURRENCY_LIMIT_CODE) {
          setLimitOpen(true);
        } else {
          showError(payload.error ?? `Could not ${action} the sequence.`, { title: "Sequence action failed" });
        }
        setPending(false);
        return;
      }
      router.refresh();
      setPending(false);
    } catch {
      showError(`Could not ${action} the sequence.`, { title: "Sequence action failed" });
      setPending(false);
    }
  }

  async function waitForSlot() {
    if (queueing) return;
    setQueueing(true);
    setQueueError(null);
    try {
      const response = await fetch(`/api/campaigns/${props.campaignId}/wait-for-slot`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setQueueError(payload.error ?? "Could not queue this sequence.");
        setQueueing(false);
        return;
      }
      setLimitOpen(false);
      setQueueing(false);
      showSuccess(
        payload.status === "STARTED"
          ? "A slot became available and the sequence started."
          : "Sequence queued. It will start automatically when a slot becomes available."
      );
      router.refresh();
    } catch {
      setQueueError("Could not queue this sequence.");
      setQueueing(false);
    }
  }

  return (
    <>
      <button className={`button secondary${props.className ? ` ${props.className}` : ""}`} type="button" onClick={() => void toggle()} disabled={pending}>
        {pending ? "Working…" : props.label}
      </button>
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
