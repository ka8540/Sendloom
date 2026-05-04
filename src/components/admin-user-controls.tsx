"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useErrorToastEffect } from "@/components/error-toast-provider";
import styles from "@/app/(app)/admin/page.module.css";

type AdminUserControlsProps = {
  userId: string;
  email: string;
  isLoggedIn: boolean;
  isSelfProtected: boolean;
  isAdminProtected: boolean;
  initialControls: {
    apiAccessDisabled: boolean;
    importsWriteDisabled: boolean;
    templatesWriteDisabled: boolean;
    launchesDisabled: boolean;
    aiEnhancementsDisabled: boolean;
  };
};

export function AdminUserControls(props: AdminUserControlsProps) {
  const router = useRouter();
  const [isSaving, startSaving] = useTransition();
  const [isDeleting, startDeleting] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [controls, setControls] = useState(props.initialControls);
  useErrorToastEffect(error, "Admin action failed");

  const controlsLocked = props.isSelfProtected || props.isAdminProtected;

  function updateControl<K extends keyof typeof controls>(key: K, value: (typeof controls)[K]) {
    setControls((current) => ({
      ...current,
      [key]: value
    }));
  }

  function saveControls(revokeSession = false) {
    setMessage(null);
    setError(null);

    startSaving(async () => {
      try {
        const response = await fetch(`/api/admin/users/${props.userId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            ...controls,
            revokeSession
          })
        });

        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Could not update this user.");
        }

        setMessage(revokeSession ? "Controls saved and session revoked." : "Controls updated.");
        router.refresh();
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Could not update this user.");
      }
    });
  }

  function deleteUser() {
    const confirmed = window.confirm(
      `Delete ${props.email} and wipe all imports, templates, campaigns, suppressions, senders, and stored files?`
    );

    if (!confirmed) {
      return;
    }

    setMessage(null);
    setError(null);

    startDeleting(async () => {
      try {
        const response = await fetch(`/api/admin/users/${props.userId}`, {
          method: "DELETE"
        });

        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Could not delete this user.");
        }

        setMessage("User deleted.");
        router.refresh();
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Could not delete this user.");
      }
    });
  }

  if (controlsLocked) {
    return (
      <div className={styles.controlPanel}>
        <p className={styles.controlHint}>
          {props.isAdminProtected
            ? "Admin accounts cannot be restricted from this panel."
            : "Your own account is locked from edits here."}
        </p>
        {message ? <p className={styles.successText}>{message}</p> : null}
        {error ? <p className={styles.errorText}>{error}</p> : null}
      </div>
    );
  }

  return (
    <div className={styles.controlPanel}>
      <div className={styles.toggleList}>
        {[
          ["apiAccessDisabled", "Disable all app APIs"],
          ["importsWriteDisabled", "Block import changes"],
          ["templatesWriteDisabled", "Block template saves"],
          ["launchesDisabled", "Block launches and scheduling"],
          ["aiEnhancementsDisabled", "Block AI enhancement API"]
        ].map(([key, label]) => (
          <label key={key} className={styles.toggleItem}>
            <input
              type="checkbox"
              checked={controls[key as keyof typeof controls]}
              onChange={(event) => updateControl(key as keyof typeof controls, event.target.checked)}
              disabled={isSaving || isDeleting}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>

      <div className={styles.controlActions}>
        <button className="button secondary" type="button" onClick={() => saveControls(false)} disabled={isSaving || isDeleting}>
          {isSaving ? "Saving..." : "Save controls"}
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() => saveControls(true)}
          disabled={!props.isLoggedIn || isSaving || isDeleting}
        >
          End session
        </button>
        <button className={styles.deleteButton} type="button" onClick={deleteUser} disabled={isSaving || isDeleting}>
          {isDeleting ? "Deleting..." : "Delete all user data"}
        </button>
      </div>

      {message ? <p className={styles.successText}>{message}</p> : null}
      {error ? <p className={styles.errorText}>{error}</p> : null}
    </div>
  );
}
