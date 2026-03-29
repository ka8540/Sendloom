"use client";

import { useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { AlertTriangle, AtSign, FileText, Plus, ShieldAlert, ShieldBan } from "lucide-react";

import { SUPPRESSION_REASON_LABELS } from "@/components/suppressions/suppression-badge";
import type { SuppressionReason, SuppressionRecord } from "@/components/suppressions/types";

import styles from "./suppressions.module.css";

type FormValues = {
  email: string;
  reason: SuppressionReason;
  notes: string;
};

type FormErrors = Partial<Record<keyof FormValues, string>>;

type SuppressionFormCardProps = {
  totalSuppressions: number;
  automatedSuppressions: number;
  criticalSuppressions: number;
  onCreated: (suppression: SuppressionRecord) => void;
};

const INITIAL_VALUES: FormValues = {
  email: "",
  reason: "MANUAL_BLOCK",
  notes: ""
};

const REASON_OPTIONS: SuppressionReason[] = ["MANUAL_BLOCK", "UNSUBSCRIBED", "INVALID_EMAIL", "COMPLAINT", "HARD_BOUNCE"];

function validateEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function SuppressionFormCard(props: SuppressionFormCardProps) {
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<FormErrors>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"success" | "error">("success");
  const [isPending, startTransition] = useTransition();

  function updateValue<Key extends keyof FormValues>(key: Key, nextValue: FormValues[Key]) {
    setValues((current) => ({
      ...current,
      [key]: nextValue
    }));

    setErrors((current) => {
      if (!current[key]) {
        return current;
      }

      const nextErrors = { ...current };
      delete nextErrors[key];
      return nextErrors;
    });
  }

  function validate(valuesToCheck: FormValues) {
    const nextErrors: FormErrors = {};

    if (!valuesToCheck.email.trim()) {
      nextErrors.email = "Email is required.";
    } else if (!validateEmail(valuesToCheck.email.trim().toLowerCase())) {
      nextErrors.email = "Enter a valid email address.";
    }

    if (valuesToCheck.notes.trim().length > 240) {
      nextErrors.notes = "Notes should stay under 240 characters.";
    }

    return nextErrors;
  }

  function onEmailChange(event: ChangeEvent<HTMLInputElement>) {
    updateValue("email", event.target.value);
  }

  function onReasonChange(event: ChangeEvent<HTMLSelectElement>) {
    updateValue("reason", event.target.value as SuppressionReason);
  }

  function onNotesChange(event: ChangeEvent<HTMLTextAreaElement>) {
    updateValue("notes", event.target.value);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validate(values);

    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      setStatusMessage("Review the highlighted fields before saving.");
      setStatusTone("error");
      return;
    }

    setStatusMessage(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/suppressions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: values.email.trim().toLowerCase(),
            reason: values.reason,
            notes: values.notes.trim() || undefined
          })
        });

        const payload = (await response.json().catch(() => ({}))) as SuppressionRecord & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || "Could not save suppression.");
        }

        props.onCreated(payload);
        setValues(INITIAL_VALUES);
        setErrors({});
        setStatusMessage(`Added ${payload.email} to suppressions.`);
        setStatusTone("success");
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Could not save suppression.");
        setStatusTone("error");
      }
    });
  }

  return (
    <section className={styles.formCard}>
      <div className={styles.formCardHeader}>
        <div className={styles.formCardTitleWrap}>
          <span className={styles.sectionEyebrow}>Suppression controls</span>
          <h1 className={styles.formTitle}>Add suppression</h1>
          <p className={styles.formSubtitle}>
            Block a recipient instantly without leaving the sending workflow. Designed for speed when issues surface mid-campaign.
          </p>
        </div>

        <div className={styles.metricStack}>
          <div className={styles.metricPanel}>
            <span>Total</span>
            <strong>{props.totalSuppressions}</strong>
          </div>
          <div className={styles.metricPanel}>
            <span>Automated</span>
            <strong>{props.automatedSuppressions}</strong>
          </div>
          <div className={styles.metricPanel}>
            <span>Critical</span>
            <strong>{props.criticalSuppressions}</strong>
          </div>
        </div>
      </div>

      <form className={styles.formBody} onSubmit={onSubmit}>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor="suppression-email">
            Recipient email
          </label>
          <div className={styles.inputShell}>
            <AtSign className={styles.inputIcon} aria-hidden="true" />
            <input
              id="suppression-email"
              name="email"
              type="email"
              autoComplete="off"
              placeholder="name@company.com"
              value={values.email}
              onChange={onEmailChange}
              className={errors.email ? styles.fieldError : undefined}
            />
          </div>
          {errors.email ? <p className={styles.errorText}>{errors.email}</p> : <p className={styles.fieldHint}>Normalized and applied instantly across future sends.</p>}
        </div>

        <div className={styles.inlineFields}>
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="suppression-reason">
              Reason
            </label>
            <div className={styles.selectShell}>
              <ShieldBan className={styles.inputIcon} aria-hidden="true" />
              <select id="suppression-reason" name="reason" value={values.reason} onChange={onReasonChange}>
                {REASON_OPTIONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {SUPPRESSION_REASON_LABELS[reason]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.guidanceCard}>
            <ShieldAlert aria-hidden="true" />
            <div>
              <strong>Fastest route</strong>
              <p>Use manual block for one-off operator decisions. Automated sources stay preserved in the activity table.</p>
            </div>
          </div>
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor="suppression-notes">
            Context notes
          </label>
          <div className={styles.textareaShell}>
            <FileText className={styles.inputIcon} aria-hidden="true" />
            <textarea
              id="suppression-notes"
              name="notes"
              placeholder="Optional context for teammates, deliverability review, or follow-up."
              value={values.notes}
              onChange={onNotesChange}
              className={errors.notes ? styles.fieldError : undefined}
              rows={5}
            />
          </div>
          <div className={styles.fieldMetaRow}>
            {errors.notes ? <p className={styles.errorText}>{errors.notes}</p> : <p className={styles.fieldHint}>Notes stay attached to the suppression for auditability.</p>}
            <span className={styles.characterCount}>{values.notes.trim().length}/240</span>
          </div>
        </div>

        <div className={styles.formFooter}>
          <button className={styles.primaryButton} type="submit" disabled={isPending}>
            <Plus aria-hidden="true" />
            <span>{isPending ? "Saving suppression..." : "Add suppression"}</span>
          </button>

          {statusMessage ? (
            <p className={statusTone === "success" ? styles.successText : styles.errorText}>
              {statusTone === "success" ? null : <AlertTriangle aria-hidden="true" />}
              <span>{statusMessage}</span>
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
