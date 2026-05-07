"use client";

import { createPortal } from "react-dom";
import { Loader2, MailPlus, PencilLine, X } from "lucide-react";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { useErrorToast, useErrorToastEffect } from "@/components/error-toast-provider";
import styles from "./campaign-follow-up-editor.module.css";

type FollowUpSendMode = "SAME_THREAD" | "NEW_EMAIL";

type TemplateOption = {
  description?: string;
  id: string;
  label: string;
  subject?: string;
};

type FollowUpDraft = {
  delayDays: string;
  enabled: boolean;
  sendMode: FollowUpSendMode;
  templateId: string;
};

function createDraft(settings: {
  delayDays: number;
  enabled: boolean;
  sendMode: FollowUpSendMode;
  templateId: string;
}): FollowUpDraft {
  return {
    delayDays: String(settings.delayDays || 3),
    enabled: settings.enabled,
    sendMode: settings.sendMode,
    templateId: settings.templateId
  };
}

export function CampaignFollowUpEditor(props: {
  ariaLabel?: string;
  campaignId: string;
  canEdit: boolean;
  disabledMessage: string;
  enableOnOpen?: boolean;
  initialSettings: {
    delayDays: number;
    enabled: boolean;
    sendMode: FollowUpSendMode;
    templateId: string;
  };
  label?: string;
  templateOptions: TemplateOption[];
}) {
  const router = useRouter();
  const titleId = useId();
  const templateId = useId();
  const delayId = useId();
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<FollowUpDraft>(() => createDraft(props.initialSettings));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showError } = useErrorToast();
  useErrorToastEffect(error, "Follow-up update failed");

  const selectedTemplate = useMemo(
    () => props.templateOptions.find((option) => option.id === draft.templateId),
    [draft.templateId, props.templateOptions]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      return;
    }

    setDraft(createDraft(props.initialSettings));
    setError(null);
    setPending(false);
  }, [isOpen, props.initialSettings]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        setIsOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, pending]);

  function openEditor() {
    if (!props.canEdit) {
      showError(props.disabledMessage, { title: "Follow-up update unavailable" });
      return;
    }

    setDraft({
      ...createDraft(props.initialSettings),
      enabled: props.enableOnOpen ? true : props.initialSettings.enabled
    });
    setError(null);
    setIsOpen(true);
  }

  function closeEditor() {
    if (!pending) {
      setIsOpen(false);
      setError(null);
    }
  }

  function updateDraft<K extends keyof FollowUpDraft>(key: K, value: FollowUpDraft[K]) {
    setDraft((current) => ({
      ...current,
      [key]: value
    }));
    setError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }

    const delayDays = Number.parseInt(draft.delayDays, 10);

    if (draft.enabled) {
      if (!draft.templateId) {
        setError("Select a follow-up template.");
        return;
      }

      if (!Number.isInteger(delayDays) || delayDays < 1) {
        setError("Enter a delay of at least 1 day.");
        return;
      }

      if (!draft.sendMode) {
        setError("Choose how the follow-up should be sent.");
        return;
      }

      if (draft.sendMode === "NEW_EMAIL" && !selectedTemplate?.subject?.trim()) {
        setError("New email follow-ups require a subject.");
        return;
      }
    }

    setPending(true);
    setError(null);

    const formData = new FormData();
    formData.set("followUpSettings", "true");
    formData.set("followUpEnabled", String(draft.enabled));
    formData.set("followUpTemplateId", draft.enabled ? draft.templateId : "");
    formData.set("followUpDelayDays", draft.enabled ? String(delayDays) : "");
    formData.set("followUpSendMode", draft.enabled ? draft.sendMode : "");

    try {
      const response = await fetch(`/api/campaigns/${props.campaignId}`, {
        method: "PATCH",
        body: formData
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(payload.error ?? "Could not save the follow-up settings.");
        setPending(false);
        return;
      }

      setIsOpen(false);
      setPending(false);
      router.refresh();
    } catch {
      setError("Could not save the follow-up settings.");
      setPending(false);
    }
  }

  const modal = (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={closeEditor}>
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.modalCard}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2 id={titleId}>Edit follow-up</h2>
            <p>Update the follow-up email for this sequence.</p>
          </div>
          <button
            aria-label="Close edit follow-up dialog"
            className={styles.modalClose}
            disabled={pending}
            onClick={closeEditor}
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <form className={styles.modalForm} onSubmit={onSubmit}>
          <div className={styles.modalBody}>
            <div className={styles.followUpHeader}>
              <div className={styles.followUpTitle}>
                <MailPlus aria-hidden="true" />
                <span>Enable follow-up email</span>
              </div>
              <label className={styles.followUpSwitch}>
                <input
                  aria-label="Enable follow-up email"
                  checked={draft.enabled}
                  onChange={(event) => updateDraft("enabled", event.target.checked)}
                  type="checkbox"
                />
                <span className={styles.switchTrack} aria-hidden="true">
                  <span className={styles.switchThumb} />
                </span>
                <span className={styles.switchText}>{draft.enabled ? "On" : "Off"}</span>
              </label>
            </div>

            {draft.enabled ? (
              <>
                <div className={styles.followUpGrid}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor={templateId}>
                      Follow-up template
                    </label>
                    <select
                      aria-invalid={error === "Select a follow-up template."}
                      className={styles.control}
                      id={templateId}
                      value={draft.templateId}
                      onChange={(event) => updateDraft("templateId", event.target.value)}
                    >
                      <option value="">Choose the follow-up email</option>
                      {props.templateOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                          {option.description ? ` - ${option.description}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor={delayId}>
                      Send follow-up after
                    </label>
                    <div className={styles.delayControl}>
                      <input
                        aria-invalid={error === "Enter a delay of at least 1 day."}
                        id={delayId}
                        inputMode="numeric"
                        max="60"
                        min="1"
                        onChange={(event) => updateDraft("delayDays", event.target.value)}
                        type="number"
                        value={draft.delayDays}
                      />
                      <span>days after first email</span>
                    </div>
                  </div>
                </div>

                <fieldset className={styles.sendModeField}>
                  <legend className={styles.sendModeLabel}>Send as</legend>
                  <div className={styles.sendModeGroup}>
                    <label className={`${styles.sendModeCard}${draft.sendMode === "SAME_THREAD" ? ` ${styles.sendModeCardSelected}` : ""}`}>
                      <input
                        checked={draft.sendMode === "SAME_THREAD"}
                        className={styles.sendModeInput}
                        name="followUpSendMode"
                        onChange={() => updateDraft("sendMode", "SAME_THREAD")}
                        type="radio"
                        value="SAME_THREAD"
                      />
                      <span className={styles.sendModeIndicator} aria-hidden="true" />
                      <span className={styles.sendModeCopy}>
                        <span className={styles.sendModeTitle}>Same email thread</span>
                        <span className={styles.sendModeHelp}>Send as a reply in the original Gmail thread.</span>
                      </span>
                    </label>
                    <label className={`${styles.sendModeCard}${draft.sendMode === "NEW_EMAIL" ? ` ${styles.sendModeCardSelected}` : ""}`}>
                      <input
                        checked={draft.sendMode === "NEW_EMAIL"}
                        className={styles.sendModeInput}
                        name="followUpSendMode"
                        onChange={() => updateDraft("sendMode", "NEW_EMAIL")}
                        type="radio"
                        value="NEW_EMAIL"
                      />
                      <span className={styles.sendModeIndicator} aria-hidden="true" />
                      <span className={styles.sendModeCopy}>
                        <span className={styles.sendModeTitle}>New email</span>
                        <span className={styles.sendModeHelp}>Send as a separate email with its own subject.</span>
                      </span>
                    </label>
                  </div>
                </fieldset>
              </>
            ) : (
              <p className={styles.disabledHint}>Future unsent follow-ups will be disabled. Sent follow-ups stay in recipient history.</p>
            )}

            {error ? (
              <div className={styles.modalError} role="alert">
                {error}
              </div>
            ) : null}
          </div>

          <div className={styles.modalActions}>
            <button className={`button secondary ${styles.modalButton}`} type="button" onClick={closeEditor} disabled={pending}>
              Cancel
            </button>
            <button className={`button ${styles.modalButton}`} type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 aria-hidden="true" className={styles.spin} />
                  Saving...
                </>
              ) : (
                "Save changes"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <>
      <button
        aria-disabled={!props.canEdit}
        aria-label={props.ariaLabel ?? props.label ?? "Edit follow-up"}
        className={`${styles.trigger}${!props.canEdit ? ` ${styles.triggerBlocked}` : ""}`}
        onClick={openEditor}
        title={props.canEdit ? props.ariaLabel ?? props.label ?? "Edit follow-up" : props.disabledMessage}
        type="button"
      >
        <PencilLine aria-hidden="true" className={styles.triggerIcon} />
        {props.label ?? "Edit follow-up"}
      </button>
      {mounted && isOpen ? createPortal(modal, document.body) : null}
    </>
  );
}
