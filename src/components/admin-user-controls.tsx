"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useErrorToastEffect } from "@/components/error-toast-provider";
import styles from "@/components/admin-v2/admin-user-controls.module.css";

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
          ["apiAccessDisabled", "API access"],
          ["importsWriteDisabled", "Import writes"],
          ["templatesWriteDisabled", "Template writes"],
          ["launchesDisabled", "Sequence launches"],
          ["aiEnhancementsDisabled", "AI enhancements"]
        ].map(([key, label]) => (
          <label key={key} className={styles.toggleItem}>
            <span>{label}</span>
            <span className={styles.toggleState}>{controls[key as keyof typeof controls] ? "Disabled" : "Enabled"}</span>
            <input
              type="checkbox"
              role="switch"
              aria-label={`${label} enabled`}
              checked={!controls[key as keyof typeof controls]}
              onChange={(event) => updateControl(key as keyof typeof controls, !event.target.checked)}
              disabled={isSaving}
            />
          </label>
        ))}
      </div>

      <div className={styles.controlActions}>
        <button className="button secondary" type="button" onClick={() => saveControls(false)} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save controls"}
        </button>
      </div>

      <div className={styles.sessionRow}><div><h3>Session</h3><p>Sign this account out of current sessions.</p></div><button className="button secondary" type="button" onClick={() => saveControls(true)} disabled={!props.isLoggedIn || isSaving}>Revoke all sessions</button></div>

      <div className={styles.dangerZone}><h3>Deletion requests</h3><p>Review account and outreach deletion requests in the Users workspace. Audit and security history is retained.</p><Link className="button secondary" href="/admin/users/deletion-requests">Open deletion requests</Link></div>

      {message ? <p className={styles.successText}>{message}</p> : null}
      {error ? <p className={styles.errorText}>{error}</p> : null}

    </div>
  );
}
