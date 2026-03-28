"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CampaignCardActions(props: { campaignId: string; campaignName: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <Link className="button secondary" href={`/campaigns/${props.campaignId}`}>
        Open
      </Link>
      <button
        type="button"
        className="field-icon-button field-icon-button--danger"
        data-tooltip="Delete sequence"
        onClick={() => void deleteCampaign()}
        disabled={pending}
        aria-label={`Delete ${props.campaignName}`}
      >
        <Trash2 aria-hidden="true" />
      </button>
      {error ? <span className="campaign-card-actions__error">{error}</span> : null}
    </div>
  );
}
