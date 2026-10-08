import { describe, expect, it } from "vitest";

import {
  buildStructuredValidationChecks,
  buildValidationReport,
  getLaunchBlockingValidationMessage,
  withStructuredValidationChecks
} from "@/lib/validation";

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

    expect(checks).toContainEqual(expect.objectContaining({ code: "UNRESOLVED_TEMPLATE_VARIABLE", severity: "WARNING" }));
  });

  it.each(["FIRST_NAME", "First_Name", "first_name", "FiRsT_NaMe"])(
    "validates a sequence using %s against a first_name mapping",
    async (variable) => {
      const payload = { email: "test@example.com", first_name: "John" };
      const subject = `Hi {{${variable}}}`;
      const report = buildValidationReport({
        rows: [{ rowIndex: 1, email: payload.email, payload }],
        templateSubject: subject,
        templateHtml: `<p>${subject}</p>`,
        suppressedEmails: new Set()
      });
      const checks = await buildStructuredValidationChecks({
        campaignId: "campaign-1",
        senderProfile: { fromEmail: "sender@example.com", oauthRefreshToken: "token" },
        importRecord: {
          rowCount: 1,
          rows: [{ rowIndex: 1, email: payload.email, normalized: payload }],
          columns: [{ normalized: "email" }, { normalized: "first_name" }]
        },
        mappingRecord: { importId: "import-1" },
        templateRecord: {},
        templateSnapshot: { subject, htmlBody: `<p>${subject}</p>`, format: "HTML" },
        mappingSnapshot: {
          reservedFieldMap: { email: "email" },
          variableMap: { first_name: "first_name" }
        },
        scheduleType: "immediate",
        report
      });

      expect(report.issues).not.toContainEqual(expect.objectContaining({ code: "MISSING_VARIABLE" }));
      expect(checks).not.toContainEqual(expect.objectContaining({ code: "MISSING_TEMPLATE_VARIABLE" }));
      expect(checks).not.toContainEqual(expect.objectContaining({ code: "UNRESOLVED_TEMPLATE_VARIABLE" }));
    }
  );

  it("still reports FIRST_NAME as unmapped when only last_name is mapped", async () => {
    const payload = { email: "test@example.com", last_name: "Doe" };
    const report = buildValidationReport({
      rows: [{ rowIndex: 1, email: payload.email, payload }],
      templateSubject: "Hi {{FIRST_NAME}}",
      templateHtml: "<p>Hi {{FIRST_NAME}}</p>",
      suppressedEmails: new Set()
    });
    const checks = await buildStructuredValidationChecks({
      campaignId: "campaign-1",
      senderProfile: { fromEmail: "sender@example.com", oauthRefreshToken: "token" },
      importRecord: {
        rowCount: 1,
        rows: [{ rowIndex: 1, email: payload.email, normalized: payload }],
        columns: [{ normalized: "email" }, { normalized: "last_name" }]
      },
      mappingRecord: { importId: "import-1" },
      templateRecord: {},
      templateSnapshot: { subject: "Hi {{FIRST_NAME}}", htmlBody: "<p>Hi {{FIRST_NAME}}</p>", format: "HTML" },
      mappingSnapshot: { reservedFieldMap: { email: "email" }, variableMap: { last_name: "last_name" } },
      scheduleType: "immediate",
      report
    });

    expect(report.issues).toContainEqual(expect.objectContaining({ code: "MISSING_VARIABLE" }));
    expect(checks).toContainEqual(expect.objectContaining({ code: "MISSING_TEMPLATE_VARIABLE" }));
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

  it("uses the first blocker or error as the launch-blocked message", () => {
    const report = withStructuredValidationChecks(
      buildValidationReport({
        rows: [],
        templateSubject: "",
        templateHtml: "",
        suppressedEmails: new Set()
      }),
      [
        {
          code: "DUPLICATE_RECIPIENT",
          severity: "WARNING",
          source: "VALIDATION",
          message: "The import contains duplicate recipients.",
          retryable: false
        },
        {
          code: "MISSING_MAPPING",
          severity: "BLOCKER",
          source: "IMPORT",
          message: "Recipient email mapping is missing.",
          details: "Map the email field before launching.",
          retryable: false
        }
      ]
    );

    expect(getLaunchBlockingValidationMessage(report)).toBe(
      "Recipient email mapping is missing. Map the email field before launching."
    );
  });
});
