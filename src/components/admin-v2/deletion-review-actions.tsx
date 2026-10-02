"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import styles from "./deletion-review-actions.module.css";

export function DeletionReviewActions({ requestId, status }: { requestId: string; status: string }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function action(kind: "approve" | "reject") {
    if (working) return;
    setWorking(true); setError(null);
    try {
      const response = await fetch(`/api/admin/deletion-requests/${requestId}/${kind}`, { method: "POST", ...(kind === "reject" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) } : {}) });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) { setError(result.error || "Review action failed."); return; }
      setConfirmOpen(false); router.refresh();
    } catch { setError("Review action failed. Please try again."); }
    finally { setWorking(false); }
  }
  return <section className={styles.panel}><h2>Review action</h2><p>Approval permanently removes private Sendloom workspace and personal account data. Sanitized audit and security records remain.</p><div className={styles.actions}><button type="button" className={styles.approve} onClick={() => { setError(null); setConfirmOpen(true); }}>{status === "FAILED" ? "Retry deletion" : "Approve deletion"}</button>{status === "PENDING_REVIEW" && <div className={styles.reject}><label htmlFor="deletion-review-note">Rejection note</label><div className={styles.rejectControls}><textarea id="deletion-review-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Explain why this request cannot be approved" /><button type="button" className="button secondary" onClick={() => void action("reject")} disabled={!note.trim() || working}>Reject request</button></div></div>}</div>{error && !confirmOpen && <p role="alert" className={styles.error}>{error}</p>}<AppConfirmDialog open={confirmOpen} title="Permanently delete private data?" description="This permanently removes the user's private Sendloom workspace and personal account data, including outreach records and stored files. Sanitized audit and security history remains. This cannot be undone." confirmLabel={status === "FAILED" ? "Retry deletion" : "Approve and delete"} loadingLabel="Deleting…" destructive loading={working} error={error} onConfirm={() => action("approve")} onCancel={() => { if (!working) setConfirmOpen(false); }} /></section>;
}
