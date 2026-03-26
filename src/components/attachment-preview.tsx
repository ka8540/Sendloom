"use client";

import { useMemo, useState } from "react";
import { Download, ExternalLink, Eye, FileText, Image as ImageIcon } from "lucide-react";

import type { AttachmentPreviewKind } from "@/lib/attachments";
import styles from "./attachment-preview.module.css";

type AttachmentPreviewItem = {
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

  return item.contentType ? item.contentType : "Preview not available in browser";
}

export function AttachmentPreview({ attachments }: { attachments: AttachmentPreviewItem[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedAttachment = attachments[selectedIndex] ?? attachments[0];

  const previewSurface = useMemo(() => {
    if (!selectedAttachment) {
      return null;
    }

    if (selectedAttachment.previewKind === "image") {
      return (
        <div className={`${styles.previewViewport} ${styles.previewViewportImage}`}>
          <img src={selectedAttachment.previewUrl} alt={selectedAttachment.fileName} />
        </div>
      );
    }

    if (selectedAttachment.previewKind === "pdf" || selectedAttachment.previewKind === "text") {
      return (
        <div className={styles.previewViewport}>
          <iframe key={selectedAttachment.previewUrl} src={selectedAttachment.previewUrl} title={selectedAttachment.fileName} />
        </div>
      );
    }

    return (
      <div className={styles.previewFallback}>
        <FileText aria-hidden="true" />
        <strong>Browser preview isn’t available for this file type.</strong>
        <span>Open or download the attachment to inspect it directly.</span>
      </div>
    );
  }, [selectedAttachment]);

  if (!selectedAttachment) {
    return null;
  }

  return (
    <div className={styles.root}>
      <div className={styles.tabRow}>
        {attachments.map((attachment, index) => (
          <button
            key={`${attachment.fileName}-${index}`}
            className={`${styles.tab}${selectedIndex === index ? ` ${styles.tabActive}` : ""}`}
            type="button"
            onClick={() => setSelectedIndex(index)}
          >
            {attachment.previewKind === "image" ? <ImageIcon aria-hidden="true" /> : <Eye aria-hidden="true" />}
            <span>{attachment.fileName}</span>
          </button>
        ))}
      </div>

      <section className={styles.previewCard}>
        <div className={styles.previewHeader}>
          <div className={styles.previewMeta}>
            <strong>{selectedAttachment.fileName}</strong>
            <span>{getPreviewLabel(selectedAttachment)}</span>
          </div>
          <div className={styles.previewActions}>
            <a className="button secondary" href={selectedAttachment.previewUrl} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" />
              Open
            </a>
            <a className="button secondary" href={selectedAttachment.downloadUrl}>
              <Download aria-hidden="true" />
              Download
            </a>
          </div>
        </div>

        {previewSurface}
      </section>
    </div>
  );
}
