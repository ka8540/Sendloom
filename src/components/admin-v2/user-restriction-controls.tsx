"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminUiStyles as styles } from "./admin-ui";
export function UserRestrictionControls({
  userId,
  restricted,
  protectedAccount,
}: {
  userId: string;
  restricted: boolean;
  protectedAccount: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(action: "restrict" | "unrestrict") {
    setError(null);
    if (action === "restrict" && !reason.trim()) {
      setError("Enter a reason for the restriction.");
      return;
    }
    start(async () => {
      try {
        const response = await fetch(`/api/admin/users/${userId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "restrict"
              ? { action, reason: reason.trim() }
              : { action },
          ),
        });
        if (!response.ok) {
          const payload = await response.json();
          throw new Error(
            payload.error || "Could not change account restriction.",
          );
        }
        router.refresh();
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Could not change account restriction.",
        );
      }
    });
  }
  if (protectedAccount)
    return (
      <p className={styles.panel}>
        Admin and self accounts are protected from restriction.
      </p>
    );
  return (
    <div className={styles.panel}>
      {restricted ? (
        <button
          className="button secondary"
          disabled={pending}
          onClick={() => submit("unrestrict")}
        >
          Unrestrict account
        </button>
      ) : (
        <div className={styles.toolbar}>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Reason for restriction"
            aria-label="Restriction reason"
          />
          <button
            className="button secondary"
            disabled={pending}
            onClick={() => submit("restrict")}
          >
            Restrict account
          </button>
        </div>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
