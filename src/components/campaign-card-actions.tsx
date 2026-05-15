"use client";

import Link from "next/link";
import { ArrowUpRight, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useErrorToastEffect } from "@/components/error-toast-provider";

export function CampaignCardActions(props: { campaignId: string; campaignName: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useErrorToastEffect(error, "Sequence delete failed");

  async function deleteCampaign() {
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

      router.refresh();
    } catch {
      setError("Could not delete the sequence.");
      setPending(false);
    }
  }

  return (
    <div className="campaign-card-actions">
      <Link
        className="field-icon-button campaign-card-action campaign-card-action--open"
        href={`/campaigns/${props.campaignId}`}
        data-tooltip="Open sequence"
        aria-label={`Open sequence ${props.campaignName}`}
      >
        <ArrowUpRight aria-hidden="true" />
      </Link>
      <button
        type="button"
        className="field-icon-button campaign-card-action campaign-card-action--delete field-icon-button--danger"
        data-tooltip="Delete sequence"
        onClick={() => void deleteCampaign()}
        disabled={pending}
        aria-label={`Delete sequence ${props.campaignName}`}
      >
        <Trash2 aria-hidden="true" />
      </button>
    </div>
  );
}
