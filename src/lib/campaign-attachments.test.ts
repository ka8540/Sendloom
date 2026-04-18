import { describe, expect, it } from "vitest";

import { getAttachmentFilesFromFormData } from "@/lib/campaign-attachments";

describe("getAttachmentFilesFromFormData", () => {
  it("returns every selected attachment from the multi-file field", () => {
    const formData = new FormData();
    formData.append("attachments", new File(["resume"], "resume.pdf", { type: "application/pdf" }));
    formData.append("attachments", new File(["cover-letter"], "cover-letter.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    formData.append("attachments", new File(["portfolio"], "portfolio.txt", { type: "text/plain" }));

    expect(getAttachmentFilesFromFormData(formData).map((file) => file.name)).toEqual([
      "resume.pdf",
      "cover-letter.docx",
      "portfolio.txt"
    ]);
  });

  it("falls back to the legacy single-file field when needed", () => {
    const formData = new FormData();
    formData.set("attachment", new File(["resume"], "resume.pdf", { type: "application/pdf" }));

    expect(getAttachmentFilesFromFormData(formData).map((file) => file.name)).toEqual(["resume.pdf"]);
  });

  it("ignores empty file selections", () => {
    const formData = new FormData();
    formData.append("attachments", new File([], "empty.pdf", { type: "application/pdf" }));

    expect(getAttachmentFilesFromFormData(formData)).toEqual([]);
  });
});
