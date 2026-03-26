const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  webp: "image/webp"
};

export type AttachmentPreviewKind = "download" | "image" | "pdf" | "text";

function getFileExtension(fileName: string) {
  const lastDot = fileName.lastIndexOf(".");

  if (lastDot === -1) {
    return "";
  }

  return fileName.slice(lastDot + 1).toLowerCase();
}

export function getAttachmentContentType(fileName: string, contentType?: string | null) {
  if (contentType) {
    return contentType;
  }

  return CONTENT_TYPE_BY_EXTENSION[getFileExtension(fileName)] ?? "application/octet-stream";
}

export function getAttachmentPreviewKind(fileName: string, contentType?: string | null): AttachmentPreviewKind {
  const normalizedContentType = getAttachmentContentType(fileName, contentType).toLowerCase();

  if (normalizedContentType.startsWith("image/")) {
    return "image";
  }

  if (normalizedContentType === "application/pdf") {
    return "pdf";
  }

  if (normalizedContentType.startsWith("text/")) {
    return "text";
  }

  return "download";
}
