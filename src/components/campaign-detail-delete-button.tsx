"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppConfirmDialog } from "@/components/app-confirm-dialog";

const DELETE_SEQUENCE_ERROR = "This sequence could not be deleted. Please try again.";

export function CampaignDetailDeleteButton(props: {
  campaignId: string;
  campaignName: string;
  iconOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    if (pending) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/campaigns/${props.campaignId}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        setError(DELETE_SEQUENCE_ERROR);
        setPending(false);
        return;
      }
    } catch {
      setError(DELETE_SEQUENCE_ERROR);
      setPending(false);
      return;
    }

    router.push("/campaigns");
    router.refresh();
  }

  return (
    <div className="campaign-detail-delete">
      <button
        type="button"
        className={
          props.iconOnly
            ? "field-icon-button field-icon-button--danger campaign-detail-delete__button"
            : "button secondary campaign-detail-delete__button"
        }
        onClick={() => {
          setError(null);
          setConfirmOpen(true);
        }}
        disabled={pending}
        aria-label={
          props.iconOnly
            ? pending
              ? `Deleting ${props.campaignName}`
              : "Delete sequence"
            : `Delete ${props.campaignName}`
        }
        data-tooltip={props.iconOnly ? (pending ? "Deleting sequence…" : "Delete sequence") : undefined}
        title={props.iconOnly ? "Delete sequence" : undefined}
      >
        {pending ? <span className="button-spinner" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
        {props.iconOnly ? null : <span>{pending ? "Deleting..." : "Delete sequence"}</span>}
      </button>

      <AppConfirmDialog
        open={confirmOpen}
        title="Delete this sequence?"
        description={`Deleting “${props.campaignName}” will remove the sequence and all of its runs. This action cannot be undone.`}
        confirmLabel="Delete sequence"
        loadingLabel="Deleting…"
        destructive
        loading={pending}
        error={error}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (!pending) {
            setConfirmOpen(false);
          }
        }}
      />
    </div>
  );
}
