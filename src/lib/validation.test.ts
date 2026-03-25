import { describe, expect, it } from "vitest";

import { buildValidationReport } from "@/lib/validation";

describe("validation", () => {
  it("marks missing email rows as invalid", () => {
    const report = buildValidationReport({
      rows: [{ rowIndex: 1, email: null, payload: {} }],
      templateSubject: "Hello {{name}}",
      templateHtml: "<p>Hi {{name}}</p>",
      suppressedEmails: new Set()
    });

    expect(report.invalidRecipients).toBe(1);
    expect(report.validRecipients).toBe(0);
  });

  it("marks suppressed rows", () => {
    const report = buildValidationReport({
      rows: [{ rowIndex: 1, email: "test@example.com", payload: { name: "Test" } }],
      templateSubject: "Hello {{name}}",
      templateHtml: "<p>Hi {{name}}</p>",
      suppressedEmails: new Set(["test@example.com"])
    });

    expect(report.suppressedRecipients).toBe(1);
  });
});
