"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useErrorToast } from "@/components/error-toast-provider";
import { ErrorRecoveryPanel } from "@/components/incident/error-recovery-panel";
import { useErrorRecovery } from "@/components/incident/use-error-recovery";
import { PastScheduleRelaunchModal } from "@/components/past-schedule-relaunch-modal";
import { PAST_SCHEDULE_CONFIRMATION_CODE } from "@/lib/campaign-scheduling";

/**
 * Launch / relaunch action on the sequence detail page. Routes through the launch API so
 * a past "schedule once" sequence surfaces a confirmation modal (offering to switch it to
 * send right away) instead of a hard validation error. All other launch behavior and
 * validation blocking is unchanged — the server still owns eligibility decisions.
 *
 * Validation outcomes (409 past-schedule, launch-blocked, other 4xx) keep their existing
 * toast/modal. Only operational failures (offline / timeout / 5xx) escalate to the shared
 * ErrorRecoveryPanel, whose Retry simply re-runs this same launch call — the server's
 * "already running" guard means a retry never creates a duplicate run.
 */
export function CampaignLaunchButton(props: { campaignId: string; label: string; disabled: boolean }) {
  const router = useRouter();
  const { showError, showSuccess } = useErrorToast();
  const recovery = useErrorRecovery({ feature: "Sequences", operation: "Launch sequence" });
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [converting, setConverting] = useState(false);

  async function launch(options?: { convertPastScheduleToImmediate?: boolean }) {
    const convert = options?.convertPastScheduleToImmediate === true;
    const response = await fetch(`/api/campaigns/${props.campaignId}/launch`, {
      method: "POST",
      ...(convert
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ convertPastScheduleToImmediate: true })
          }
        : {})
    });

    return response;
  }

  async function handleLaunch() {
    if (props.disabled || pending) {
      return;
    }

    setPending(true);
    recovery.clear();

    try {
      const response = await launch();
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (response.status === 409 && payload.code === PAST_SCHEDULE_CONFIRMATION_CODE) {
          setPending(false);
          setConfirmOpen(true);
          return;
        }

        // 5xx / service failures become a recoverable incident; validation 4xx
        // keep their existing inline message.
        const normalized = recovery.failFromResponse(response, payload);
        if (!normalized) {
          showError(payload.error ?? "Could not launch the sequence.", { title: "Sequence launch blocked" });
        }
        setPending(false);
        return;
      }

      // The run is now active — refresh the server component so the page reflects it.
      // Keep `pending` true so the button stays disabled until the refresh unmounts it.
      router.refresh();
    } catch (error) {
      recovery.failFromThrown(error);
      setPending(false);
    }
  }

  async function handleConfirmConvertAndRelaunch() {
    if (converting) {
      return;
    }

    setConverting(true);

    try {
      const response = await launch({ convertPastScheduleToImmediate: true });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        showError(payload.error ?? "Could not launch the sequence.", { title: "Sequence launch blocked" });
        setConverting(false);
        return;
      }

      setConfirmOpen(false);
      setConverting(false);
      showSuccess("Sequence switched to send right away and relaunched.");
      router.refresh();
    } catch {
      showError("Could not launch the sequence.", { title: "Sequence launch blocked" });
      setConverting(false);
    }
  }

  return (
    <>
      <button className="button" type="button" onClick={() => void handleLaunch()} disabled={props.disabled || pending}>
        {props.label}
      </button>

      {recovery.error ? (
        <ErrorRecoveryPanel
          error={recovery.error}
          variant="inline"
          onRetry={async () => {
            await handleLaunch();
          }}
        />
      ) : null}

      <PastScheduleRelaunchModal
        open={confirmOpen}
        pending={converting}
        onCancel={() => {
          if (!converting) {
            setConfirmOpen(false);
          }
        }}
        onConfirm={() => void handleConfirmConvertAndRelaunch()}
      />
    </>
  );
}
