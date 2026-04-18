import { describe, expect, it } from "vitest";

import { getAttachmentFilesFromFormData, mergeAttachmentFiles } from "@/lib/campaign-attachments";

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

describe("mergeAttachmentFiles", () => {
  it("appends newly selected files so the picker can be used more than once", () => {
    const first = new File(["resume"], "resume.pdf", { type: "application/pdf", lastModified: 1 });
    const second = new File(["portfolio"], "portfolio.pdf", { type: "application/pdf", lastModified: 2 });
    const third = new File(["cover-letter"], "cover-letter.pdf", { type: "application/pdf", lastModified: 3 });

    expect(mergeAttachmentFiles([first], [second, third]).map((file) => file.name)).toEqual([
      "resume.pdf",
      "portfolio.pdf",
      "cover-letter.pdf"
    ]);
  });

  it("skips duplicate files when the same file is picked again", () => {
    const first = new File(["resume"], "resume.pdf", { type: "application/pdf", lastModified: 1 });
    const duplicate = new File(["resume"], "resume.pdf", { type: "application/pdf", lastModified: 1 });

    expect(mergeAttachmentFiles([first], [duplicate])).toHaveLength(1);
  });
});
