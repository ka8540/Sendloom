"use client";

import { useEffect } from "react";
import { Download, ExternalLink, FileText } from "lucide-react";

import { CircularCloseButton } from "@/components/circular-close-button";

import type { AttachmentPreviewKind } from "@/lib/attachments";
import styles from "./attachment-preview.module.css";

export type AttachmentPreviewItem = {
  contentType?: string | null;
  downloadUrl: string;
  fileName: string;
  previewKind: AttachmentPreviewKind;
  previewUrl: string;
};

function getPreviewLabel(item: AttachmentPreviewItem) {
  if (item.previewKind === "image") {
    return "Image preview";
  }

  if (item.previewKind === "pdf") {
    return "PDF preview";
  }

  if (item.previewKind === "text") {
    return "Text preview";
  }

  return item.contentType ?? "Preview not available in browser";
}

export function AttachmentPreviewModal({
  attachment,
  onClose
}: {
  attachment: AttachmentPreviewItem | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!attachment) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [attachment, onClose]);

  if (!attachment) {
    return null;
  }

  let surface;
  if (attachment.previewKind === "image") {
    surface = (
      <div className={`${styles.viewport} ${styles.viewportImage}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={attachment.previewUrl} alt={attachment.fileName} />
      </div>
    );
  } else if (attachment.previewKind === "pdf" || attachment.previewKind === "text") {
    surface = (
      <div className={styles.viewport}>
        <iframe key={attachment.previewUrl} src={attachment.previewUrl} title={`Preview of ${attachment.fileName}`} />
      </div>
    );
  } else {
    surface = (
      <div className={styles.fallback}>
        <FileText aria-hidden="true" />
        <strong>Browser preview isn’t available for this file type.</strong>
        <span>Open or download the attachment to inspect it directly.</span>
      </div>
    );
  }

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview ${attachment.fileName}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div className={styles.modalMeta}>
            <strong title={attachment.fileName}>{attachment.fileName}</strong>
            <span>{getPreviewLabel(attachment)}</span>
          </div>
          <CircularCloseButton label="Close preview" onClick={onClose} />
        </div>

        {surface}

        <div className={styles.modalActions}>
          <a className="button secondary" href={attachment.previewUrl} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden="true" />
            Open
          </a>
          <a className="button secondary" href={attachment.downloadUrl}>
            <Download aria-hidden="true" />
            Download
          </a>
        </div>
      </div>
    </div>
  );
}
