import { describe, expect, it } from "vitest";

import { buildStructuredValidationChecks, buildValidationReport } from "@/lib/validation";

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

  it("returns a blocker when the sender is missing", async () => {
    const report = buildValidationReport({
      rows: [{ rowIndex: 1, email: "test@example.com", payload: { email: "test@example.com" } }],
      templateSubject: "Hello",
      templateHtml: "<p>Hello</p>",
      suppressedEmails: new Set()
    });

    const checks = await buildStructuredValidationChecks({
      campaignId: "campaign-1",
      importRecord: {
        rowCount: 1,
        rows: [{ rowIndex: 1, email: "test@example.com", normalized: { email: "test@example.com" } }],
        columns: [{ normalized: "email" }]
      },
      mappingRecord: { importId: "import-1" },
      templateRecord: {},
      templateSnapshot: {
        subject: "Hello",
        htmlBody: "<p>Hello</p>",
        format: "HTML"
      },
      mappingSnapshot: {
        reservedFieldMap: { email: "email" }
      },
      scheduleType: "immediate",
      report
    });

    expect(checks).toContainEqual(expect.objectContaining({ code: "GMAIL_PROFILE_DISCONNECTED", severity: "BLOCKER" }));
  });

  it("returns a blocker when the template is missing", async () => {
    const report = buildValidationReport({
      rows: [{ rowIndex: 1, email: "test@example.com", payload: { email: "test@example.com" } }],
      templateSubject: "",
      templateHtml: "",
      suppressedEmails: new Set()
    });

    const checks = await buildStructuredValidationChecks({
      campaignId: "campaign-1",
      senderProfile: { fromEmail: "sender@example.com", oauthRefreshToken: "token" },
      importRecord: {
        rowCount: 1,
        rows: [{ rowIndex: 1, email: "test@example.com", normalized: { email: "test@example.com" } }],
        columns: [{ normalized: "email" }]
      },
      mappingRecord: { importId: "import-1" },
      templateSnapshot: {
        subject: "",
        htmlBody: "",
        format: "HTML"
      },
      mappingSnapshot: {
        reservedFieldMap: { email: "email" }
      },
      scheduleType: "immediate",
      report
    });

    expect(checks).toContainEqual(expect.objectContaining({ code: "MISSING_TEMPLATE", severity: "BLOCKER" }));
  });

  it("detects unresolved merge variables", async () => {
    const report = buildValidationReport({
      rows: [{ rowIndex: 1, email: "test@example.com", payload: { email: "test@example.com" } }],
      templateSubject: "Hello {{firstName}}",
      templateHtml: "<p>Hello {{firstName}}</p>",
      suppressedEmails: new Set()
    });

    const checks = await buildStructuredValidationChecks({
      campaignId: "campaign-1",
      senderProfile: { fromEmail: "sender@example.com", oauthRefreshToken: "token" },
      importRecord: {
        rowCount: 1,
        rows: [{ rowIndex: 1, email: "test@example.com", normalized: { email: "test@example.com" } }],
        columns: [{ normalized: "email" }]
      },
      mappingRecord: { importId: "import-1" },
      templateRecord: {},
      templateSnapshot: {
        subject: "Hello {{firstName}}",
        htmlBody: "<p>Hello {{firstName}}</p>",
        format: "HTML"
      },
      mappingSnapshot: {
        reservedFieldMap: { email: "email" }
      },
      scheduleType: "immediate",
      report
    });

    expect(checks).toContainEqual(expect.objectContaining({ code: "UNRESOLVED_TEMPLATE_VARIABLE", severity: "BLOCKER" }));
  });

  it("detects invalid recipient emails", async () => {
    const report = buildValidationReport({
      rows: [{ rowIndex: 1, email: "not-an-email", payload: { email: "not-an-email" } }],
      templateSubject: "Hello",
      templateHtml: "<p>Hello</p>",
      suppressedEmails: new Set()
    });

    const checks = await buildStructuredValidationChecks({
      campaignId: "campaign-1",
      senderProfile: { fromEmail: "sender@example.com", oauthRefreshToken: "token" },
      importRecord: {
        rowCount: 1,
        rows: [{ rowIndex: 1, email: "not-an-email", normalized: { email: "not-an-email" } }],
        columns: [{ normalized: "email" }]
      },
      mappingRecord: { importId: "import-1" },
      templateRecord: {},
      templateSnapshot: {
        subject: "Hello",
        htmlBody: "<p>Hello</p>",
        format: "HTML"
      },
      mappingSnapshot: {
        reservedFieldMap: { email: "email" }
      },
      scheduleType: "immediate",
      report
    });

    expect(checks).toContainEqual(expect.objectContaining({ code: "INVALID_RECIPIENT_EMAIL", severity: "ERROR" }));
  });
});
