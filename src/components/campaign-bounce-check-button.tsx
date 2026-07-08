"use client";

import { MailWarning } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useErrorToast } from "@/components/error-toast-provider";

/**
 * Manual "Check bounces" on the sequence detail page. Reads the connected
 * Gmail sender's delivery-status notifications for already-sent emails and
 * reclassifies confirmed invalid addresses as skipped — it never launches,
 * resends, or edits anything, so it stays available for completed sequences.
 * Distinct from "Refresh validation", which checks the setup before a launch.
 */
export function CampaignBounceCheckButton(props: {
  campaignId: string;
  senderNeedsReconnect: boolean;
  className?: string;
}) {
  const router = useRouter();
  const { showError, showSuccess } = useErrorToast();
  const [pending, setPending] = useState(false);

  async function handleCheck() {
    if (pending) {
      return;
    }
    if (props.senderNeedsReconnect) {
      showError("Reconnect Gmail to check bounces.", { title: "Check bounces" });
      return;
    }

    setPending(true);
    try {
      const response = await fetch(`/api/campaigns/${props.campaignId}/sync-bounces`, {
        method: "POST"
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (payload.code === "SENDER_DISCONNECTED") {
          showError("Reconnect Gmail to check bounces.", { title: "Check bounces" });
        } else {
          showError(payload.error ?? "Couldn't check bounces. Please try again.", { title: "Check bounces" });
        }
        setPending(false);
        return;
      }

      const updated = typeof payload.invalidRecipientsUpdated === "number" ? payload.invalidRecipientsUpdated : 0;
      if (updated > 0) {
        showSuccess(
          `Checked bounces. ${updated} invalid address${updated === 1 ? "" : "es"} marked as skipped.`
        );
      } else {
        showSuccess("No new bounces found.");
      }
      // Refresh the server component so the metric cards and recipient
      // activity reflect the reclassified recipients.
      router.refresh();
      setPending(false);
    } catch {
      showError("Couldn't check bounces. Please try again.", { title: "Check bounces" });
      setPending(false);
    }
  }

  return (
    <form
      className={props.className}
      onSubmit={(event) => {
        event.preventDefault();
        void handleCheck();
      }}
    >
      <button
        className="button secondary"
        type="submit"
        disabled={pending}
        aria-label="Check already-sent emails for bounces"
      >
        {pending ? <span className="button-spinner" aria-hidden="true" /> : <MailWarning aria-hidden="true" />}
        <span>{pending ? "Checking bounces…" : "Check bounces"}</span>
      </button>
    </form>
  );
}
