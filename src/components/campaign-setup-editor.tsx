"use client";

import { useEffect, useRef, useState } from "react";
import {
  Download,
  Eye,
  File as FileIcon,
  FilePlus2,
  FileText,
  Image as ImageIcon,
  Info,
  Loader2,
  Lock,
  PencilLine,
  Save,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useRouter } from "next/navigation";

import { AttachmentPreviewModal, type AttachmentPreviewItem } from "@/components/attachment-preview";
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

function getFileTypeLabel(fileName: string) {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1 || lastDot === fileName.length - 1) {
    return "File";
  }
  return fileName.slice(lastDot + 1).toUpperCase();
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(kind: AttachmentPreviewKind) {
  if (kind === "image") {
    return ImageIcon;
  }
  if (kind === "pdf" || kind === "text") {
    return FileText;
  }
  return FileIcon;
}

function InfoTip({ label }: { label: string }) {
  return (
    <button type="button" className={styles.infoTip} aria-label={label} title={label}>
      <Info aria-hidden="true" />
    </button>
  );
}

export function CampaignSetupEditor(props: {
  campaignId: string;
  currentSenderNeedsReconnect: boolean;
  importOptions: SetupOption[];
  initialSetup: SetupState;
  isLocked: boolean;
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
  const [previewId, setPreviewId] = useState<string | null>(null);
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
    setPreviewId(null);
  }, [props.initialSetup]);

  useEffect(() => {
    if (!props.isLocked || !editing) {
      return;
    }

    draftSetup.attachments.forEach((attachment) => {
      if ("file" in attachment) {
        revokeAttachmentPreview(attachment);
      }
    });

    setDraftSetup(cloneSetupState(savedSetup));
    setEditing(false);
    setError("Wait for the current run to finish before editing this sequence.");
    setSuccess(null);
  }, [draftSetup.attachments, editing, props.isLocked, savedSetup]);

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

    if (props.isLocked) {
      setError("Wait for the current run to finish before editing this sequence.");
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

  const previewAttachment = previewId
    ? draftSetup.attachments.find((attachment) => attachment.id === previewId) ?? null
    : null;
  const previewItem: AttachmentPreviewItem | null = previewAttachment
    ? {
        contentType: previewAttachment.contentType ?? null,
        downloadUrl: previewAttachment.downloadUrl,
        fileName: previewAttachment.fileName,
        previewKind: previewAttachment.previewKind,
        previewUrl: previewAttachment.previewUrl
      }
    : null;

  const attachmentCount = draftSetup.attachments.length;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h2>Sequence setup</h2>
          <p>Review and update launch configuration.</p>
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
              data-tooltip={props.isLocked ? "Editing locked while run is active" : "Edit setup"}
              aria-label={props.isLocked ? "Editing locked while run is active" : "Edit setup"}
              onClick={() => {
                setSuccess(null);
                setEditing(true);
              }}
              disabled={props.isLocked}
            >
              <PencilLine aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {props.isLocked ? (
        <div className={styles.noticeLocked}>
          <Lock aria-hidden="true" />
          <span>Setup is locked while the current run is processing.</span>
        </div>
      ) : null}
      {success ? <div className={styles.noticeSuccess}>{success}</div> : null}

      <div className={styles.configList}>
        <label className={styles.configRow}>
          <span className={styles.configLabelRow}>
            <span className={styles.configLabel}>Sequence name</span>
          </span>
          {editing ? (
            <input
              className={styles.fieldControl}
              value={draftSetup.name}
              onChange={(event) => updateDraft("name", event.target.value)}
              placeholder="Name this sequence"
            />
          ) : (
            <span className={styles.configValue}>{savedSetup.name}</span>
          )}
        </label>

        <label className={styles.configRow}>
          <span className={styles.configLabelRow}>
            <span className={styles.configLabel}>Contact list</span>
          </span>
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
              <span className={styles.configValue}>{getOptionLabel(props.importOptions, savedSetup.importId)}</span>
              {currentImportDescription ? <span className={styles.configMeta}>{currentImportDescription}</span> : null}
            </>
          )}
        </label>

        <label className={styles.configRow}>
          <span className={styles.configLabelRow}>
            <span className={styles.configLabel}>Email template</span>
          </span>
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
              <span className={styles.configValue}>{getOptionLabel(props.templateOptions, savedSetup.templateId)}</span>
              {currentTemplateDescription ? <span className={styles.configMeta}>{currentTemplateDescription}</span> : null}
            </>
          )}
        </label>

        <label className={styles.configRow}>
          <span className={styles.configLabelRow}>
            <span className={styles.configLabel}>Sender</span>
          </span>
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
              <span className={styles.configValue}>{getOptionLabel(props.senderOptions, savedSetup.senderProfileId)}</span>
              {currentSenderDescription ? <span className={styles.configMeta}>{currentSenderDescription}</span> : null}
              {props.currentSenderNeedsReconnect ? (
                <span className={styles.warningText}>Reconnect required before the next send.</span>
              ) : null}
            </>
          )}
        </label>

        <div className={styles.configRow}>
          <span className={styles.configLabelRow}>
            <span className={styles.configLabel}>Send timing</span>
            <InfoTip label="Editing setup does not change delivery timing unless you update this field." />
          </span>
          <span className={styles.configValue}>{props.scheduleLabel}</span>
        </div>
      </div>

      <div className={styles.attachmentSection}>
        <div className={styles.attachmentHeader}>
          <div className={styles.attachmentTitleRow}>
            <h3>Attachments</h3>
            <InfoTip label="Files are included with the next launch." />
          </div>
          {editing ? (
            <>
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
                className={styles.addButton}
                onClick={() => addAttachmentInputRef.current?.click()}
              >
                <FilePlus2 aria-hidden="true" />
                Add attachment
              </button>
            </>
          ) : (
            <span className={styles.attachmentCount}>
              {attachmentCount ? `${attachmentCount} file${attachmentCount > 1 ? "s" : ""}` : "No files"}
            </span>
          )}
        </div>

        {attachmentCount ? (
          <div className={styles.attachmentList}>
            {draftSetup.attachments.map((attachment) => {
              const Icon = getFileIcon(attachment.previewKind);
              const isUpload = "file" in attachment;
              const typeLabel = getFileTypeLabel(attachment.fileName);
              return (
                <div key={attachment.id} className={styles.attachmentRow}>
                  <span className={styles.fileIconTile}>
                    <Icon aria-hidden="true" />
                  </span>
                  <div className={styles.attachmentInfo}>
                    <span className={styles.attachmentName} title={attachment.fileName}>
                      {attachment.fileName}
                    </span>
                    <span className={styles.attachmentSub}>
                      {typeLabel}
                      {isUpload ? ` · ${formatFileSize(attachment.file.size)}` : ""}
                      {" · "}
                      {isUpload ? (
                        <span className={styles.attachmentSubPending}>Pending save</span>
                      ) : (
                        "Attached"
                      )}
                    </span>
                  </div>
                  <div className={styles.attachmentActions}>
                    <button
                      type="button"
                      className={styles.rowAction}
                      aria-label={`Preview ${attachment.fileName}`}
                      title="Preview"
                      onClick={() => setPreviewId(attachment.id)}
                    >
                      <Eye aria-hidden="true" />
                    </button>
                    {editing ? (
                      <>
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
                          className={styles.rowAction}
                          aria-label={`Replace ${attachment.fileName}`}
                          title="Replace"
                          onClick={() => replaceAttachmentInputRefs.current[attachment.id]?.click()}
                        >
                          <Upload aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.rowAction} ${styles.rowActionDanger}`}
                          aria-label={`Remove ${attachment.fileName}`}
                          title="Remove"
                          onClick={() => removeAttachment(attachment.id)}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </>
                    ) : (
                      <a
                        className={styles.rowAction}
                        href={attachment.downloadUrl}
                        aria-label={`Download ${attachment.fileName}`}
                        title="Download"
                      >
                        <Download aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.attachmentEmpty}>
            <strong>No attachments added</strong>
            <span>Attach a resume, PDF, DOCX, or supporting file for this sequence.</span>
          </div>
        )}
      </div>

      <AttachmentPreviewModal attachment={previewItem} onClose={() => setPreviewId(null)} />
    </div>
  );
}
