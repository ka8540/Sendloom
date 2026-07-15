"use client";

import Link from "next/link";
import type { Route } from "next";
import { ArrowUpRight, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import styles from "./campaign-card-actions.module.css";

const DELETE_SEQUENCE_ERROR = "This sequence could not be deleted. Please try again.";

export function CampaignCardActions(props: {
  campaignId: string;
  campaignName: string;
  detailHref?: Route;
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

    setPending(false);
    setConfirmOpen(false);
    router.refresh();
  }

  return (
    <div className={styles.rail}>
      <Link
        className={`${styles.action} ${styles.open}`}
        href={props.detailHref ?? `/campaigns/${props.campaignId}`}
        data-tooltip="Open sequence"
        aria-label={`Open sequence ${props.campaignName}`}
      >
        <ArrowUpRight aria-hidden="true" />
      </Link>
      <button
        type="button"
        className={`${styles.action} ${styles.delete}`}
        data-tooltip="Delete sequence"
        onClick={() => {
          setError(null);
          setConfirmOpen(true);
        }}
        disabled={pending}
        aria-label={`Delete sequence ${props.campaignName}`}
      >
        <Trash2 aria-hidden="true" />
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
