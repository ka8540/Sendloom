"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useErrorToastEffect } from "@/components/error-toast-provider";

export function CampaignRetryFailedButton(props: {
  campaignId: string;
  failedCount: number;
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const label =
    props.failedCount > 0 ? `Retry ${props.failedCount} failed` : "Retry failed recipients";

  return (
    <form
      className={props.className}
      onSubmit={(event) => {
        event.preventDefault();
        void handleRetry();
      }}
    >
      <button className="button secondary" type="submit" disabled={pending} aria-label="Retry failed recipients">
        {pending ? <span className="button-spinner" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
        <span>{pending ? "Retrying..." : label}</span>
      </button>
    </form>
  );
}
