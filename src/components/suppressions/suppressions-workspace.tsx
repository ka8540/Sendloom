"use client";

import { useState, useTransition } from "react";

import { SuppressionFormCard } from "@/components/suppressions/suppression-form-card";
import { SuppressionsTableCard } from "@/components/suppressions/suppressions-table-card";
import type { SuppressionRecord } from "@/components/suppressions/types";

import styles from "./suppressions.module.css";

type SuppressionsWorkspaceProps = {
  initialSuppressions: SuppressionRecord[];
};

function upsertSuppression(current: SuppressionRecord[], nextSuppression: SuppressionRecord) {
  return [nextSuppression, ...current.filter((entry) => entry.id !== nextSuppression.id && entry.email !== nextSuppression.email)];
}

export function SuppressionsWorkspace({ initialSuppressions }: SuppressionsWorkspaceProps) {
  const [suppressions, setSuppressions] = useState(initialSuppressions);
  const [preferredSelectionId, setPreferredSelectionId] = useState<string | null>(initialSuppressions[0]?.id ?? null);
  const [pendingUndo, setPendingUndo] = useState<SuppressionRecord | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isUndoPending, startUndoTransition] = useTransition();

  const automatedSuppressions = suppressions.filter((entry) => entry.source !== "manual").length;
  const criticalSuppressions = suppressions.filter(
    (entry) => entry.reason === "COMPLAINT" || entry.reason === "HARD_BOUNCE" || entry.reason === "INVALID_EMAIL"
  ).length;

  function handleCreated(suppression: SuppressionRecord) {
    setSuppressions((current) => upsertSuppression(current, suppression));
    setPreferredSelectionId(suppression.id);
    setPendingUndo(null);
    setFeedback({
      tone: "success",
      message: `${suppression.email} was added to suppressions.`
    });
  }

  function handleDelete(suppression: SuppressionRecord) {
    setDeletingId(suppression.id);
    setFeedback(null);

    void (async () => {
      try {
        const response = await fetch(`/api/suppressions/${suppression.id}`, {
          method: "DELETE"
        });

        const payload = (await response.json().catch(() => ({}))) as SuppressionRecord & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Could not delete suppression.");
        }

        setSuppressions((current) => current.filter((entry) => entry.id !== suppression.id));
        setPreferredSelectionId(null);
        setPendingUndo(payload);
        setFeedback({
          tone: "success",
          message: `${suppression.email} was removed from the list.`
        });
      } catch (error) {
        setFeedback({
          tone: "error",
          message: error instanceof Error ? error.message : "Could not delete suppression."
        });
      } finally {
        setDeletingId(null);
      }
    })();
  }

  function handleUndoDelete() {
    if (!pendingUndo) {
      return;
    }

    startUndoTransition(async () => {
      try {
        const response = await fetch("/api/suppressions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: pendingUndo.email,
            reason: pendingUndo.reason,
            notes: pendingUndo.notes ?? undefined,
            source: pendingUndo.source
          })
        });

        const payload = (await response.json().catch(() => ({}))) as SuppressionRecord & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Could not restore suppression.");
        }

        setSuppressions((current) => upsertSuppression(current, payload));
        setPreferredSelectionId(payload.id);
        setPendingUndo(null);
        setFeedback({
          tone: "success",
          message: `${payload.email} was restored.`
        });
      } catch (error) {
        setFeedback({
          tone: "error",
          message: error instanceof Error ? error.message : "Could not restore suppression."
        });
      }
    });
  }

  return (
    <div className={styles.workspacePage}>
      <div className={styles.workspaceGrid}>
        <aside className={styles.leftColumn}>
          <SuppressionFormCard
            totalSuppressions={suppressions.length}
            automatedSuppressions={automatedSuppressions}
            criticalSuppressions={criticalSuppressions}
            onCreated={handleCreated}
          />
        </aside>

        <div className={styles.rightColumn}>
          <SuppressionsTableCard
            suppressions={suppressions}
            preferredSelectionId={preferredSelectionId}
            pendingUndo={pendingUndo}
            feedback={feedback}
            deletingId={deletingId}
            isUndoPending={isUndoPending}
            onDeleteSuppression={handleDelete}
            onUndoDelete={handleUndoDelete}
          />
        </div>
      </div>
    </div>
  );
}
