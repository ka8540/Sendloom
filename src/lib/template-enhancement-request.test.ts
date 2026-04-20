import { describe, expect, it } from "vitest";

import { enhanceTemplateRequestSchema } from "@/lib/template-enhancement-request";

describe("enhanceTemplateRequestSchema", () => {
  it("accepts AI enhancement requests with no spam analysis", () => {
    const parsed = enhanceTemplateRequestSchema.parse({
      fieldType: "subject",
      currentText: "Quick question"
    });

    expect(parsed.spamAnalysis).toBeUndefined();
  });

  it("treats null spam analysis as missing", () => {
    const parsed = enhanceTemplateRequestSchema.parse({
      fieldType: "body",
      currentText: "Hi there",
      templateFormat: "PLAIN_TEXT",
      spamAnalysis: null
    });

    expect(parsed.spamAnalysis).toBeUndefined();
  });
});
