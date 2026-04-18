export function getAttachmentFilesFromFormData(formData: FormData) {
  const attachments = formData
    .getAll("attachments")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (attachments.length) {
    return attachments;
  }

  const legacyAttachment = formData.get("attachment");
  return legacyAttachment instanceof File && legacyAttachment.size > 0 ? [legacyAttachment] : [];
}
