"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useErrorToastEffect } from "@/components/error-toast-provider";

export function CampaignDetailDeleteButton(props: { campaignId: string; campaignName: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useErrorToastEffect(error, "Sequence delete failed");

  async function handleDelete() {
    if (pending) {
      return;
    }

    const confirmed = window.confirm(`Delete "${props.campaignName}"? This will remove the sequence and all of its runs.`);
    if (!confirmed) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/campaigns/${props.campaignId}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Could not delete the sequence.");
        setPending(false);
        return;
      }

      router.push("/campaigns");
      router.refresh();
    } catch {
      setError("Could not delete the sequence.");
      setPending(false);
    }
  }

  return (
    <div className="campaign-detail-delete">
      <button
        type="button"
        className="button secondary campaign-detail-delete__button"
        onClick={() => void handleDelete()}
        disabled={pending}
        aria-label={`Delete ${props.campaignName}`}
      >
        {pending ? <span className="button-spinner" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
        <span>{pending ? "Deleting..." : "Delete sequence"}</span>
      </button>
    </div>
  );
}
