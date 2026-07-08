"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, FileText, LoaderCircle } from "lucide-react";

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

type FramedPreviewStatus = "idle" | "loading" | "ready" | "error";

export function AttachmentPreviewModal({
  attachment,
  onClose
}: {
  attachment: AttachmentPreviewItem | null;
  onClose: () => void;
}) {
  const previewUrl = attachment?.previewUrl ?? null;
  const previewKind = attachment?.previewKind ?? null;
  const needsFrame = previewKind === "pdf" || previewKind === "text";

  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [frameStatus, setFrameStatus] = useState<FramedPreviewStatus>("idle");

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

  // PDFs/text are served from the authenticated attachment route, which carries
  // the app's `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`. Iframing
  // that URL directly makes the browser refuse to connect. Instead, fetch the
  // file over the normal (cookie-authenticated) session and frame a local
  // `blob:` object URL — which is exempt from the route's anti-framing headers.
  useEffect(() => {
    if (!previewUrl || !needsFrame) {
      setFrameUrl(null);
      setFrameStatus("idle");
      return;
    }

    // Freshly-uploaded (unsaved) attachments already expose a local `blob:`
    // object URL owned by the editor — frame it directly and never revoke it.
    if (previewUrl.startsWith("blob:")) {
      setFrameUrl(previewUrl);
      setFrameStatus("ready");
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;
    setFrameUrl(null);
    setFrameStatus("loading");

    fetch(previewUrl, { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Attachment preview failed with ${response.status}`);
        }
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) {
          return;
        }
        createdUrl = URL.createObjectURL(blob);
        setFrameUrl(createdUrl);
        setFrameStatus("ready");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setFrameStatus("error");
      });

    return () => {
      cancelled = true;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [previewUrl, needsFrame]);

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
  } else if (needsFrame) {
    if (frameStatus === "error") {
      surface = (
        <div className={styles.fallback}>
          <FileText aria-hidden="true" />
          <strong>Preview unavailable.</strong>
          <span>Open or download the file instead.</span>
        </div>
      );
    } else if (frameStatus === "ready" && frameUrl) {
      surface = (
        <div className={styles.viewport}>
          <iframe key={frameUrl} src={frameUrl} title={`Preview of ${attachment.fileName}`} />
        </div>
      );
    } else {
      surface = (
        <div className={`${styles.fallback} ${styles.loading}`} role="status" aria-live="polite">
          <LoaderCircle aria-hidden="true" />
          <span>Loading preview…</span>
        </div>
      );
    }
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
