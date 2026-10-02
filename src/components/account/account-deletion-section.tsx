"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Heart, ShieldCheck, Trash2, X } from "lucide-react";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { LocalDateTime } from "@/components/local-date-time";
import styles from "./account-deletion-section.module.css";

type DeletionChoice = "ACCOUNT_ONLY" | "ACCOUNT_AND_OUTREACH";
type DeletionRequest = { id: string; status: string; requestedAt: string; completedAt: string | null };

export function AccountDeletionSection() {
  const [request, setRequest] = useState<DeletionRequest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [choice, setChoice] = useState<DeletionChoice | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const closeChoices = useCallback(() => {
    setChoiceOpen(false);
    requestAnimationFrame(() => continueRef.current?.focus());
  }, []);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/account/deletion");
      if (!response.ok) throw new Error("Request status could not be loaded.");
      setRequest(((await response.json()) as { request: DeletionRequest | null }).request);
      setLoaded(true);
    } catch { setError("Deletion options could not be loaded. Refresh the page and try again."); }
  }, []);
  useEffect(() => { setMounted(true); void load(); }, [load]);
  useEffect(() => {
    if (!choiceOpen) return;
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") closeChoices(); };
    window.addEventListener("keydown", onEscape);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", onEscape); };
  }, [choiceOpen, closeChoices]);
  async function submit() {
    if (!choice || working) return;
    setWorking(true); setError(null);
    try {
      const response = await fetch("/api/account/deletion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: choice }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string; id?: string; status?: string; requestedAt?: string };
      if (!response.ok) { setError(data.error || "Deletion could not be processed. Please try again."); return; }
      setChoice(null); setChoiceOpen(false);
      if (choice === "ACCOUNT_ONLY") { window.location.assign("/login"); return; }
      await load();
    } catch { setError("Deletion could not be processed. Please try again."); }
    finally { setWorking(false); }
  }
  async function cancel() {
    if (working) return;
    setWorking(true); setError(null);
    try {
      const response = await fetch("/api/account/deletion/cancel", { method: "POST" });
      if (!response.ok) { setError("This request could not be cancelled."); return; }
      await load();
    } catch { setError("This request could not be cancelled."); }
    finally { setWorking(false); }
  }
  const pending = request?.status === "PENDING_REVIEW";
  return (
    <section className={styles.section} aria-labelledby="delete-account-title">
      <div className={styles.heading}>
        <div className={styles.icon}><ShieldCheck aria-hidden="true" /></div>
        <div><span className={styles.eyebrow}>ACCOUNT / DANGER ZONE</span><h2 id="delete-account-title">Delete your account</h2><p>You can choose whether to keep or permanently remove your outreach data.</p></div>
      </div>
      {pending ? (
        <div className={styles.pending}>
          <span className={styles.status}>Pending review</span>
          <h3>Deletion request pending</h3>
          <p>Requested <LocalDateTime value={request.requestedAt} />. Your private outreach data has not been permanently deleted. An admin will review the request before processing it.</p>
          <button type="button" className="button secondary" onClick={cancel} disabled={working}>Cancel request</button>
        </div>
      ) : request?.status === "PROCESSING" || request?.status === "FAILED" ? (
        <div className={styles.pending}><span className={styles.status}>{request.status === "FAILED" ? "Needs review" : "Processing"}</span><h3>{request.status === "FAILED" ? "Deletion needs another review" : "Deletion is in progress"}</h3><p>Your account access and sending are disabled while the private data cleanup is completed.</p></div>
      ) : (
        <div className={styles.content}>
          <div className={styles.retention}><span className={styles.heart}><Heart aria-hidden="true" /></span><div><h3>Before you go</h3><p>Your Sendloom workspace can hold Discover research, sequences, templates, imports, Gmail senders, and outreach history. You can keep using them if you stay.</p></div></div>
          <div className={styles.actions}><button type="button" className="button secondary" onClick={closeChoices}>Keep using Sendloom</button><button ref={continueRef} type="button" className={styles.continue} onClick={() => { setError(null); setChoiceOpen(true); }} disabled={!loaded}>Continue to deletion <ArrowRight aria-hidden="true" /></button></div>
        </div>
      )}
      {error && !choiceOpen && !choice ? <p className={styles.error} role="alert">{error}</p> : null}
      {mounted && choiceOpen ? createPortal(<div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closeChoices(); }}><div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.modalHeader}><div><span className={styles.eyebrow}>CHOOSE A PATH</span><h2 id={titleId}>Choose what you'd like to delete</h2><p>Both options remove your account access. You choose what happens to your outreach records.</p></div><button ref={closeRef} type="button" className={styles.close} aria-label="Close deletion choices" onClick={closeChoices}><X aria-hidden="true" /></button></div>
        <div className={styles.options}><button type="button" className={styles.option} onClick={() => { setChoice("ACCOUNT_ONLY"); setChoiceOpen(false); }}><span className={styles.optionIcon}><Trash2 aria-hidden="true" /></span><strong>Delete my account</strong><span>Your login and personal account information are removed immediately. Existing outreach workspace records are kept. Audit and security records are retained in sanitized form.</span><b>Delete account <ArrowRight aria-hidden="true" /></b></button><button type="button" className={styles.option} onClick={() => { setChoice("ACCOUNT_AND_OUTREACH"); setChoiceOpen(false); }}><span className={styles.optionIcon}><ShieldCheck aria-hidden="true" /></span><strong>Delete my account and outreach data</strong><span>Request permanent removal of your private Sendloom outreach data and account. An admin must review this irreversible purge. Sanitized audit and security records remain.</span><b>Request full deletion <ArrowRight aria-hidden="true" /></b></button></div>
        <button type="button" className={`button secondary ${styles.modalCancel}`} onClick={closeChoices}>Keep using Sendloom</button>
      </div></div>, document.body) : null}
      <AppConfirmDialog open={choice !== null} title={choice === "ACCOUNT_ONLY" ? "Delete your account now?" : "Request permanent deletion?"} description={choice === "ACCOUNT_ONLY" ? "Your login and personal account information will be removed immediately. Existing outreach records remain under a deleted account reference. Sanitized audit and security history is retained." : "An admin will review this request before your private outreach data is permanently removed. Sanitized audit and security history is retained."} confirmLabel={choice === "ACCOUNT_ONLY" ? "Delete account" : "Request full deletion"} loadingLabel={choice === "ACCOUNT_ONLY" ? "Deleting…" : "Submitting…"} destructive loading={working} error={choice ? error : null} onConfirm={submit} onCancel={() => { if (!working) { setChoice(null); setError(null); requestAnimationFrame(() => continueRef.current?.focus()); } }} />
    </section>
  );
}
