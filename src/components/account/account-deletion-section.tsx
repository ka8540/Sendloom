"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowRight, BarChart3, Compass, Mail, Workflow, X } from "lucide-react";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { LocalDateTime } from "@/components/local-date-time";
import styles from "./account-deletion-section.module.css";

type DeletionChoice = "ACCOUNT_ONLY" | "ACCOUNT_AND_OUTREACH";
type DeletionRequest = { id: string; status: string; requestedAt: string; completedAt: string | null };

export function AccountDeletionSection() {
  const [request, setRequest] = useState<DeletionRequest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [selection, setSelection] = useState<DeletionChoice | null>(null);
  const [choice, setChoice] = useState<DeletionChoice | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const optionGroupName = useId();

  const closeChoices = useCallback(() => {
    setChoiceOpen(false);
    setSelection(null);
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeChoices();
      } else if (event.key === "Tab") {
        const controls = Array.from(modalRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? []);
        if (!controls.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", onKeyDown); };
  }, [choiceOpen, closeChoices]);

  async function submit() {
    if (!choice || working) return;
    setWorking(true); setError(null);
    try {
      const response = await fetch("/api/account/deletion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: choice }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) { setError(data.error || "Deletion could not be processed. Please try again."); return; }
      setChoice(null);
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
    <div className={styles.section}>
      {pending ? (
        <div className={styles.pending}>
          <span className={styles.status}>Pending review</span>
          <h3>Deletion request pending</h3>
          <p>Requested <LocalDateTime value={request.requestedAt} />. Your request to delete your account and outreach data is waiting for review. No irreversible data deletion has been performed yet.</p>
          <button type="button" className="button secondary" onClick={cancel} disabled={working}>Cancel deletion request</button>
        </div>
      ) : request?.status === "PROCESSING" || request?.status === "FAILED" ? (
        <div className={styles.pending}><span className={styles.status}>{request.status === "FAILED" ? "Needs review" : "Processing"}</span><h3>{request.status === "FAILED" ? "Deletion needs another review" : "Deletion in progress"}</h3><p>Your account access and sending are disabled while the private data cleanup is completed.</p></div>
      ) : (
        <div className={styles.content}>
          <div className={styles.intro}><h3>Before you go</h3><p>Deleting your account removes access to Sendloom. Here are the parts of your workspace you can keep using if you stay.</p></div>
          <div className={styles.benefits}>
            <div><Compass aria-hidden="true" /><span><strong>Discover</strong><small>Find the right people for outreach.</small></span></div>
            <div><Workflow aria-hidden="true" /><span><strong>Sequences</strong><small>Build and manage personalized outreach.</small></span></div>
            <div><BarChart3 aria-hidden="true" /><span><strong>Analytics</strong><small>Track sends, replies, and performance.</small></span></div>
            <div><Mail aria-hidden="true" /><span><strong>Gmail</strong><small>Send from connected Gmail accounts.</small></span></div>
          </div>
          <div className={styles.actions}><button ref={continueRef} type="button" className={styles.continue} onClick={() => { setError(null); setSelection(null); setChoiceOpen(true); }} disabled={!loaded}>Delete account <ArrowRight aria-hidden="true" /></button></div>
          <p className={styles.legalLinks}>How deleted account data is handled: <Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Service</Link></p>
        </div>
      )}
      {error && !choiceOpen && !choice ? <p className={styles.error} role="alert">{error}</p> : null}
      {mounted && choiceOpen ? createPortal(
        <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closeChoices(); }}>
          <div ref={modalRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <div className={styles.modalHeader}><div><span className={styles.eyebrow}>ACCOUNT DELETION</span><h2 id={titleId}>What would you like to delete?</h2><p>Choose what happens to your existing outreach workspace.</p></div><button ref={closeRef} type="button" className={styles.close} aria-label="Close deletion choices" onClick={closeChoices}><X aria-hidden="true" /></button></div>
            <div className={styles.options} role="radiogroup" aria-label="Deletion options">
              <label className={`${styles.option}${selection === "ACCOUNT_ONLY" ? ` ${styles.optionSelected}` : ""}`}>
                <input type="radio" name={optionGroupName} value="ACCOUNT_ONLY" checked={selection === "ACCOUNT_ONLY"} onChange={() => setSelection("ACCOUNT_ONLY")} />
                <span className={styles.optionCopy}><span className={styles.optionHeading}><strong>Delete my account</strong><em>Immediate</em></span><span>Remove your Sendloom account and sign-in access. Existing outreach workspace data stays. Required sanitized audit and security history is retained.</span></span>
              </label>
              <label className={`${styles.option}${selection === "ACCOUNT_AND_OUTREACH" ? ` ${styles.optionSelected}` : ""}`}>
                <input type="radio" name={optionGroupName} value="ACCOUNT_AND_OUTREACH" checked={selection === "ACCOUNT_AND_OUTREACH"} onChange={() => setSelection("ACCOUNT_AND_OUTREACH")} />
                <span className={styles.optionCopy}><span className={styles.optionHeading}><strong>Delete my account and outreach data</strong><em>Requires review</em></span><span>Request permanent removal of private sequences, imports, templates, attachments, and Discover activity. An admin reviews the request before the irreversible purge.</span></span>
              </label>
            </div>
            <div className={styles.modalActions}><div className={styles.cancelWrap}><button type="button" className={styles.cancelButton} aria-describedby={`${titleId}-cancel-tip`} onClick={closeChoices}>Cancel</button><span id={`${titleId}-cancel-tip`} className={styles.cancelTooltip} role="tooltip"><span aria-hidden="true">💚</span> Keep using Sendloom</span></div><button type="button" className={styles.modalContinue} disabled={!selection} onClick={() => { setChoice(selection); setChoiceOpen(false); }}>Continue <ArrowRight aria-hidden="true" /></button></div>
          </div>
        </div>, document.body
      ) : null}
      <AppConfirmDialog open={choice !== null} title={choice === "ACCOUNT_ONLY" ? "Delete your account now?" : "Request permanent deletion?"} description={choice === "ACCOUNT_ONLY" ? "Your account and sign-in access will be removed immediately, and you will be signed out. We'll try to send a farewell email. Existing outreach records remain; sanitized audit and security history is retained. This cannot be undone." : "You are requesting deletion of your account and private outreach data. A Sendloom admin will review it before permanent removal. We'll try to email you confirmation. Sanitized audit and security history remains."} confirmLabel={choice === "ACCOUNT_ONLY" ? "Delete account" : "Request deletion"} loadingLabel={choice === "ACCOUNT_ONLY" ? "Deleting…" : "Submitting…"} destructive loading={working} error={choice ? error : null} onConfirm={submit} onCancel={() => { if (!working) { setChoice(null); setError(null); requestAnimationFrame(() => continueRef.current?.focus()); } }} />
    </div>
  );
}
