function getAttachmentIdentity(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function mergeAttachmentFiles(currentAttachments: File[], nextAttachments: Iterable<File>) {
  const mergedAttachments = [...currentAttachments];
  const seenAttachments = new Set(currentAttachments.map((file) => getAttachmentIdentity(file)));

  for (const attachment of nextAttachments) {
    const identity = getAttachmentIdentity(attachment);

    if (seenAttachments.has(identity)) {
      continue;
    }

    seenAttachments.add(identity);
    mergedAttachments.push(attachment);
  }

  return mergedAttachments;
}

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
