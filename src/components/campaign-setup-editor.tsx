"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, Loader2, PencilLine, Save, Trash2, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { AttachmentPreview } from "@/components/attachment-preview";
import { useErrorToastEffect } from "@/components/error-toast-provider";
import { getAttachmentPreviewKind, type AttachmentPreviewKind } from "@/lib/attachments";
import styles from "./campaign-setup-editor.module.css";

type SetupOption = {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

type ExistingAttachment = {
  contentType?: string | null;
  downloadUrl: string;
  fileName: string;
  id: string;
  previewKind: AttachmentPreviewKind;
  previewUrl: string;
  sourceIndex: number;
};

type UploadAttachment = {
  contentType?: string | null;
  downloadUrl: string;
  file: File;
  fileName: string;
  id: string;
  previewKind: AttachmentPreviewKind;
  previewUrl: string;
};

type DraftAttachment = ExistingAttachment | UploadAttachment;

type SetupState = {
  attachments: DraftAttachment[];
  importId: string;
  name: string;
  senderProfileId: string;
  templateId: string;
};

function createUploadAttachment(file: File): UploadAttachment {
  const objectUrl = URL.createObjectURL(file);
  return {
    id: `upload-${crypto.randomUUID()}`,
    file,
    fileName: file.name,
    contentType: file.type || null,
    previewKind: getAttachmentPreviewKind(file.name, file.type || null),
    previewUrl: objectUrl,
    downloadUrl: objectUrl
  };
}

function cloneSetupState(initial: SetupState): SetupState {
  return {
    ...initial,
    attachments: initial.attachments.slice()
  };
}

function getOptionLabel(options: SetupOption[], id: string) {
  return options.find((option) => option.id === id)?.label ?? "Not available";
}

export function CampaignSetupEditor(props: {
  campaignId: string;
  currentSenderNeedsReconnect: boolean;
  importOptions: SetupOption[];
  initialSetup: SetupState;
  senderOptions: SetupOption[];
  templateOptions: SetupOption[];
  scheduleLabel: string;
}) {
  const router = useRouter();
  const addAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const replaceAttachmentInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const uploadUrls = useRef(new Set<string>());
  const [editing, setEditing] = useState(false);
  const [savedSetup, setSavedSetup] = useState<SetupState>(() => cloneSetupState(props.initialSetup));
  const [draftSetup, setDraftSetup] = useState<SetupState>(() => cloneSetupState(props.initialSetup));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  useErrorToastEffect(error, "Sequence setup failed");

  useEffect(() => {
    return () => {
      uploadUrls.current.forEach((url) => URL.revokeObjectURL(url));
      uploadUrls.current.clear();
    };
  }, []);

  useEffect(() => {
    const nextSetup = cloneSetupState(props.initialSetup);
    setSavedSetup(nextSetup);
    setDraftSetup(nextSetup);
    setEditing(false);
    setPending(false);
    setError(null);
    setSuccess(null);
  }, [props.initialSetup]);

  function revokeAttachmentPreview(attachment: DraftAttachment) {
    if ("file" in attachment) {
      URL.revokeObjectURL(attachment.previewUrl);
      uploadUrls.current.delete(attachment.previewUrl);
    }
  }

  function resetDraft() {
    draftSetup.attachments.forEach((attachment) => {
      if ("file" in attachment) {
        revokeAttachmentPreview(attachment);
      }
    });

    setDraftSetup(cloneSetupState(savedSetup));
    setEditing(false);
    setError(null);
    setSuccess(null);
  }

  function updateDraft<K extends keyof SetupState>(key: K, value: SetupState[K]) {
    setDraftSetup((current) => ({
      ...current,
      [key]: value
    }));
  }

  function addAttachment(file: File) {
    const nextAttachment = createUploadAttachment(file);
    uploadUrls.current.add(nextAttachment.previewUrl);
    setDraftSetup((current) => ({
      ...current,
      attachments: [...current.attachments, nextAttachment]
    }));
    setError(null);
  }

  function replaceAttachment(targetId: string, file: File) {
    const nextAttachment = createUploadAttachment(file);
    uploadUrls.current.add(nextAttachment.previewUrl);

    setDraftSetup((current) => ({
      ...current,
      attachments: current.attachments.map((attachment) => {
        if (attachment.id !== targetId) {
          return attachment;
        }

        revokeAttachmentPreview(attachment);
        return nextAttachment;
      })
    }));
    setError(null);
  }

  function removeAttachment(targetId: string) {
    setDraftSetup((current) => {
      const nextAttachments = current.attachments.filter((attachment) => {
        if (attachment.id !== targetId) {
          return true;
        }

        revokeAttachmentPreview(attachment);
        return false;
      });

      return {
        ...current,
        attachments: nextAttachments
      };
    });
  }

  async function saveSetup() {
    if (pending) {
      return;
    }

    if (!draftSetup.name.trim() || !draftSetup.importId || !draftSetup.templateId || !draftSetup.senderProfileId) {
      setError("Complete every required field before saving.");
      return;
    }

    const selectedSender = props.senderOptions.find((option) => option.id === draftSetup.senderProfileId);
    if (selectedSender?.disabled) {
      setError("Reconnect that Gmail sender or choose a connected sender before saving.");
      return;
    }

    setPending(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.set("name", draftSetup.name.trim());
    formData.set("importId", draftSetup.importId);
    formData.set("templateId", draftSetup.templateId);
    formData.set("senderProfileId", draftSetup.senderProfileId);

    const attachmentsPlan = draftSetup.attachments.map((attachment, index) => {
      if ("file" in attachment) {
        const fieldName = `attachment-${index}`;
        formData.set(fieldName, attachment.file);
        return {
          type: "upload" as const,
          fileField: fieldName
        };
      }

      return {
        type: "existing" as const,
        sourceIndex: attachment.sourceIndex
      };
    });

    formData.set("attachmentsPlan", JSON.stringify(attachmentsPlan));

    try {
      const response = await fetch(`/api/campaigns/${props.campaignId}`, {
        method: "PATCH",
        body: formData
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Could not save the sequence setup.");
        setPending(false);
        return;
      }

      setSavedSetup(cloneSetupState(draftSetup));
      setEditing(false);
      setPending(false);
      setSuccess("Sequence setup saved.");
      router.refresh();
    } catch {
      setError("Could not save the sequence setup.");
      setPending(false);
    }
  }

  const currentImportDescription = props.importOptions.find((option) => option.id === draftSetup.importId)?.description;
  const currentTemplateDescription = props.templateOptions.find((option) => option.id === draftSetup.templateId)?.description;
  const currentSenderDescription = props.senderOptions.find((option) => option.id === draftSetup.senderProfileId)?.description;

  const previewItems = useMemo(
    () =>
      draftSetup.attachments.map((attachment) => ({
        contentType: attachment.contentType ?? null,
        downloadUrl: attachment.downloadUrl,
        fileName: attachment.fileName,
        previewKind: attachment.previewKind,
        previewUrl: attachment.previewUrl
      })),
    [draftSetup.attachments]
  );

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h2>Sequence setup</h2>
          <p>Update the next launch configuration without leaving this page.</p>
        </div>
        <div className={styles.headerActions}>
          {editing ? (
            <>
              <button
                type="button"
                className={`field-icon-button ${styles.headerIconAction}`}
                data-tooltip="Cancel editing"
                aria-label="Cancel editing"
                onClick={resetDraft}
                disabled={pending}
              >
                <X aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`field-icon-button ${styles.headerIconAction} ${styles.headerIconActionPrimary}`}
                data-tooltip="Save changes"
                aria-label="Save changes"
                onClick={() => void saveSetup()}
                disabled={pending}
              >
                {pending ? <Loader2 aria-hidden="true" className={styles.spin} /> : <Save aria-hidden="true" />}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`field-icon-button ${styles.headerIconAction}`}
              data-tooltip="Edit setup"
              aria-label="Edit setup"
              onClick={() => {
                setSuccess(null);
                setEditing(true);
              }}
            >
              <PencilLine aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {success ? <div className={styles.noticeSuccess}>{success}</div> : null}

      <div className={styles.grid}>
        <label className={styles.fieldCard}>
          <span className={styles.fieldLabel}>Sequence name</span>
          {editing ? (
            <input
              className={styles.fieldControl}
              value={draftSetup.name}
              onChange={(event) => updateDraft("name", event.target.value)}
              placeholder="Name this sequence"
            />
          ) : (
            <strong className={styles.fieldValue}>{savedSetup.name}</strong>
          )}
        </label>

        <label className={styles.fieldCard}>
          <span className={styles.fieldLabel}>Contact list</span>
          {editing ? (
            <select
              className={styles.fieldControl}
              value={draftSetup.importId}
              onChange={(event) => updateDraft("importId", event.target.value)}
            >
              {props.importOptions.map((option) => (
                <option key={option.id} value={option.id} disabled={option.disabled}>
                  {option.label}
                  {option.description ? ` — ${option.description}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <>
              <strong className={styles.fieldValue}>{getOptionLabel(props.importOptions, savedSetup.importId)}</strong>
              {currentImportDescription ? <span className={styles.fieldHint}>{currentImportDescription}</span> : null}
            </>
          )}
        </label>

        <label className={styles.fieldCard}>
          <span className={styles.fieldLabel}>Email template</span>
          {editing ? (
            <select
              className={styles.fieldControl}
              value={draftSetup.templateId}
              onChange={(event) => updateDraft("templateId", event.target.value)}
            >
              {props.templateOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                  {option.description ? ` — ${option.description}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <>
              <strong className={styles.fieldValue}>{getOptionLabel(props.templateOptions, savedSetup.templateId)}</strong>
              {currentTemplateDescription ? <span className={styles.fieldHint}>{currentTemplateDescription}</span> : null}
            </>
          )}
        </label>

        <label className={styles.fieldCard}>
          <span className={styles.fieldLabel}>Sender</span>
          {editing ? (
            <select
              className={styles.fieldControl}
              value={draftSetup.senderProfileId}
              onChange={(event) => updateDraft("senderProfileId", event.target.value)}
            >
              {props.senderOptions.map((option) => (
                <option key={option.id} value={option.id} disabled={option.disabled}>
                  {option.label}
                  {option.description ? ` — ${option.description}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <>
              <strong className={styles.fieldValue}>{getOptionLabel(props.senderOptions, savedSetup.senderProfileId)}</strong>
              {currentSenderDescription ? <span className={styles.fieldHint}>{currentSenderDescription}</span> : null}
              {props.currentSenderNeedsReconnect ? (
                <span className={styles.warningText}>Reconnect required before the next send.</span>
              ) : null}
            </>
          )}
        </label>

        <div className={styles.fieldCard}>
          <span className={styles.fieldLabel}>Send timing</span>
          <strong className={styles.fieldValue}>{props.scheduleLabel}</strong>
          <span className={styles.fieldHint}>Timing stays unchanged here so you can adjust delivery safely later.</span>
        </div>
      </div>

      <div className={styles.attachmentSection}>
        <div className={styles.attachmentHeader}>
          <div>
            <h3>Attachments</h3>
            <p>Add, replace, or remove the files included with the next launch.</p>
          </div>
          {editing ? (
            <div className={styles.attachmentToolbar}>
              <input
                ref={addAttachmentInputRef}
                className={styles.hiddenInput}
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    addAttachment(file);
                  }
                  event.currentTarget.value = "";
                }}
              />
              <button
                type="button"
                className="button secondary"
                onClick={() => addAttachmentInputRef.current?.click()}
              >
                <FilePlus2 aria-hidden="true" />
                Add attachment
              </button>
            </div>
          ) : (
            <span className={styles.attachmentCount}>
              {savedSetup.attachments.length ? `${savedSetup.attachments.length} file${savedSetup.attachments.length > 1 ? "s" : ""}` : "No files"}
            </span>
          )}
        </div>

        {draftSetup.attachments.length ? (
          <div className={styles.attachmentList}>
            {draftSetup.attachments.map((attachment) => (
              <div key={attachment.id} className={styles.attachmentRow}>
                <div className={styles.attachmentMeta}>
                  <strong>{attachment.fileName}</strong>
                  <span>
                    {"file" in attachment ? "Ready to upload on save" : "Currently attached"}
                  </span>
                </div>
                {editing ? (
                  <div className={styles.attachmentRowActions}>
                    <input
                      ref={(node) => {
                        replaceAttachmentInputRefs.current[attachment.id] = node;
                      }}
                      className={styles.hiddenInput}
                      type="file"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          replaceAttachment(attachment.id, file);
                        }
                        event.currentTarget.value = "";
                      }}
                    />
                    <button
                      type="button"
                      className="field-icon-button"
                      data-tooltip="Replace file"
                      onClick={() => replaceAttachmentInputRefs.current[attachment.id]?.click()}
                    >
                      <Upload aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="field-icon-button field-icon-button--danger"
                      data-tooltip="Remove file"
                      onClick={() => removeAttachment(attachment.id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyAttachments}>No files are attached yet. Add a resume or supporting file before the next launch.</div>
        )}

        {previewItems.length ? <AttachmentPreview attachments={previewItems} /> : null}
      </div>
    </div>
  );
}
