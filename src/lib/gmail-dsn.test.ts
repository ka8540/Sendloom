import { describe, expect, it } from "vitest";

import {
  DSN_MAX_MESSAGE_BYTES,
  classifyDeliveryFailure,
  isLikelyDeliveryStatusMessage,
  looksLikeDeliveryNotification,
  parseDeliveryStatusFromGmailMessage,
  safeDeliveryFailureReason,
  type GmailFullMessage,
  type GmailMessagePart
} from "@/lib/gmail-dsn";

function b64(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function textPart(text: string): GmailMessagePart {
  return { mimeType: "text/plain", body: { size: text.length, data: b64(text) } };
}

function deliveryStatusPart(body: string): GmailMessagePart {
  return { mimeType: "message/delivery-status", body: { size: body.length, data: b64(body) } };
}

const GMAIL_DSN_STATUS_BODY = [
  "Reporting-MTA: dns; googlemail.com",
  "X-Original-Message-ID: <sendloom-abc123@techsmail.com>",
  "",
  "Final-Recipient: rfc822; nmarshall@paychex.com",
  "Original-Recipient: rfc822;nmarshall@paychex.com",
  "Action: failed",
  "Status: 5.1.1",
  "Remote-MTA: dns; mx.paychex.com",
  "Diagnostic-Code: smtp; 550 5.1.1 User Unknown"
].join("\r\n");

function gmailBounceMessage(overrides: Partial<GmailFullMessage> = {}): GmailFullMessage {
  return {
    id: "dsn-message-1",
    threadId: "thread-1",
    internalDate: "1782900000000",
    sizeEstimate: 12_000,
    payload: {
      mimeType: "multipart/report",
      headers: [
        { name: "From", value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" },
        { name: "Subject", value: "Delivery Status Notification (Failure)" },
        { name: "Content-Type", value: 'multipart/report; report-type=delivery-status; boundary="x"' },
        { name: "In-Reply-To", value: "<sendloom-abc123@techsmail.com>" },
        { name: "References", value: "<sendloom-abc123@techsmail.com>" },
        { name: "X-Failed-Recipients", value: "nmarshall@paychex.com" }
      ],
      parts: [
        textPart(
          "Address not found\n\nYour message wasn't delivered to nmarshall@paychex.com because the address couldn't be found, or is unable to receive mail.\n\nThe response from the remote server was:\n550 5.1.1 User Unknown"
        ),
        deliveryStatusPart(GMAIL_DSN_STATUS_BODY),
        {
          mimeType: "message/rfc822",
          parts: [
            {
              mimeType: "text/html",
              headers: [{ name: "Message-ID", value: "<sendloom-abc123@techsmail.com>" }]
            }
          ]
        }
      ]
    },
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Detection (narrow message filtering)
// ---------------------------------------------------------------------------

describe("delivery-status detection", () => {
  it("accepts multipart/report with report-type=delivery-status on its own", () => {
    expect(
      isLikelyDeliveryStatusMessage({
        fromHeader: "someone@example.com",
        subject: "anything",
        contentType: 'multipart/report; report-type=delivery-status; boundary="b"',
        autoSubmitted: null
      })
    ).toBe(true);
  });

  it("needs at least two independent signals otherwise", () => {
    // Sender display name alone is never enough.
    expect(
      isLikelyDeliveryStatusMessage({
        fromHeader: "Mail Delivery Subsystem <spoof@evil.example>",
        subject: "hello there",
        contentType: "text/plain",
        autoSubmitted: null
      })
    ).toBe(false);
    // mailer-daemon address + DSN subject = two signals.
    expect(
      isLikelyDeliveryStatusMessage({
        fromHeader: "mailer-daemon@googlemail.com",
        subject: "Delivery Status Notification (Failure)",
        contentType: "text/plain",
        autoSubmitted: null
      })
    ).toBe(true);
  });

  it("ignores ordinary and unrelated automated emails", () => {
    expect(
      isLikelyDeliveryStatusMessage({
        fromHeader: "Nathan Marshall <nathan@paychex.com>",
        subject: "Re: Could my backend experience help?",
        contentType: "text/html",
        autoSubmitted: null
      })
    ).toBe(false);
    expect(
      isLikelyDeliveryStatusMessage({
        fromHeader: "Calendar <calendar-notification@google.com>",
        subject: "Reminder: standup",
        contentType: "text/calendar",
        autoSubmitted: "auto-generated"
      })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Parsing (structured first, text fallback second)
// ---------------------------------------------------------------------------

describe("delivery-status parsing", () => {
  it("parses structured DSN fields from message/delivery-status", () => {
    const parsed = parseDeliveryStatusFromGmailMessage(gmailBounceMessage());
    expect(parsed).not.toBeNull();
    expect(parsed?.structured).toBe(true);
    expect(parsed?.recipients).toEqual([
      {
        email: "nmarshall@paychex.com",
        action: "failed",
        status: "5.1.1",
        diagnosticCode: "smtp; 550 5.1.1 User Unknown",
        remoteMta: "dns; mx.paychex.com"
      }
    ]);
    expect(parsed?.reportingMta).toBe("dns; googlemail.com");
    // The original RFC Message-ID is collected for correlation.
    expect(parsed?.referenceMessageIds).toContain("sendloom-abc123@techsmail.com");
  });

  it("falls back to Original-Recipient when Final-Recipient is absent", () => {
    const body = ["Reporting-MTA: dns; googlemail.com", "", "Original-Recipient: rfc822; someone@example.com", "Action: failed", "Status: 5.1.1"].join("\n");
    const parsed = parseDeliveryStatusFromGmailMessage(
      gmailBounceMessage({ payload: { mimeType: "multipart/report", headers: [], parts: [deliveryStatusPart(body)] } })
    );
    expect(parsed?.recipients[0]?.email).toBe("someone@example.com");
  });

  it("parses Gmail's text bounce when no structured part exists", () => {
    const parsed = parseDeliveryStatusFromGmailMessage(
      gmailBounceMessage({
        payload: {
          mimeType: "multipart/related",
          headers: [{ name: "From", value: "mailer-daemon@googlemail.com" }],
          parts: [
            textPart(
              "Address not found\n\nYour message wasn't delivered to nmarshall@paychex.com because the address couldn't be found, or is unable to receive mail.\n\n550 5.1.1 User Unknown"
            )
          ]
        }
      })
    );
    expect(parsed?.structured).toBe(false);
    expect(parsed?.recipients[0]?.email).toBe("nmarshall@paychex.com");
    expect(parsed?.recipients[0]?.status).toBe("5.1.1");
  });

  it("returns null for ordinary mail (nothing is stored)", () => {
    const parsed = parseDeliveryStatusFromGmailMessage(
      gmailBounceMessage({
        payload: {
          mimeType: "text/plain",
          headers: [{ name: "From", value: "friend@example.com" }],
          parts: [textPart("Hey, are we still on for Thursday?")]
        }
      })
    );
    expect(parsed).toBeNull();
  });

  it("rejects oversized messages and survives malformed parts", () => {
    expect(parseDeliveryStatusFromGmailMessage(gmailBounceMessage({ sizeEstimate: DSN_MAX_MESSAGE_BYTES + 1 }))).toBeNull();
    expect(
      parseDeliveryStatusFromGmailMessage(
        gmailBounceMessage({
          payload: {
            mimeType: "multipart/report",
            headers: [],
            parts: [{ mimeType: "message/delivery-status", body: { size: 10, data: "%%%not-base64%%%" } }]
          }
        })
      )
    ).toBeNull();
  });

  it("never returns raw bodies — only bounded structured fields", () => {
    const parsed = parseDeliveryStatusFromGmailMessage(gmailBounceMessage());
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("wasn't delivered");
    expect(serialized).not.toContain("Address not found");
    for (const recipient of parsed?.recipients ?? []) {
      expect((recipient.diagnosticCode ?? "").length).toBeLessThanOrEqual(500);
    }
  });
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

describe("delivery-failure classification", () => {
  it("5.1.1 user unknown is a permanent recipient failure that suppresses", () => {
    const result = classifyDeliveryFailure({ action: "failed", status: "5.1.1", diagnosticCode: "smtp; 550 5.1.1 User Unknown" });
    expect(result.category).toBe("HARD_BOUNCE_MAILBOX_NOT_FOUND");
    expect(result.permanence).toBe("permanent");
    expect(result.suppressRecipient).toBe(true);
  });

  it("permanent mailbox errors (5.2.1 disabled) are Failed", () => {
    const result = classifyDeliveryFailure({ action: "failed", status: "5.2.1", diagnosticCode: "mailbox disabled" });
    expect(result.permanence).toBe("permanent");
    expect(result.suppressRecipient).toBe(true);
  });

  it("domain-not-found failures classify as domain hard bounces", () => {
    const result = classifyDeliveryFailure({ action: "failed", status: "5.1.2", diagnosticCode: "DNS Error: domain not found" });
    expect(result.category).toBe("HARD_BOUNCE_DOMAIN_NOT_FOUND");
    expect(result.suppressRecipient).toBe(true);
  });

  it("4.x.x stays temporary and never suppresses", () => {
    const result = classifyDeliveryFailure({ action: "delayed", status: "4.4.1", diagnosticCode: "connection timed out" });
    expect(result.permanence).toBe("temporary");
    expect(result.suppressRecipient).toBe(false);
  });

  it("mailbox-full is a soft bounce, even at 5.2.2", () => {
    for (const status of ["4.2.2", "5.2.2"]) {
      const result = classifyDeliveryFailure({ action: "failed", status, diagnosticCode: "mailbox is full" });
      expect(result.category).toBe("SOFT_BOUNCE_MAILBOX_FULL");
      expect(result.suppressRecipient).toBe(false);
    }
  });

  it("quota / auth / policy / spam problems never suppress the recipient", () => {
    expect(
      classifyDeliveryFailure({ action: "failed", status: "5.4.5", diagnosticCode: "Daily sending limit exceeded — quota for the sender" }).suppressRecipient
    ).toBe(false);
    expect(
      classifyDeliveryFailure({ action: "failed", status: "5.7.26", diagnosticCode: "This mail is unauthenticated; SPF/DKIM failed" }).suppressRecipient
    ).toBe(false);
    const policy = classifyDeliveryFailure({ action: "failed", status: "5.7.1", diagnosticCode: "Message rejected due to policy" });
    expect(policy.category).toBe("POLICY_REJECTION");
    expect(policy.suppressRecipient).toBe(false);
    const spam = classifyDeliveryFailure({ action: "failed", status: "5.7.1", diagnosticCode: "Message rejected due to spam content" });
    expect(spam.category).toBe("SPAM_REJECTION");
    expect(spam.suppressRecipient).toBe(false);
  });

  it("unknown ambiguous 5.x.x failures are never auto-suppressed", () => {
    const result = classifyDeliveryFailure({ action: "failed", status: "5.4.0", diagnosticCode: "unspecified routing problem" });
    expect(result.category).toBe("UNKNOWN_DELIVERY_FAILURE");
    expect(result.suppressRecipient).toBe(false);
  });

  it("text-fallback 'Address not found' without a code still classifies as permanent", () => {
    const result = classifyDeliveryFailure({ action: "failed", status: null, diagnosticCode: "Address not found — unable to receive mail" });
    expect(result.permanence).toBe("permanent");
    expect(result.suppressRecipient).toBe(true);
  });

  it("safe reasons never expose provider internals", () => {
    expect(safeDeliveryFailureReason("HARD_BOUNCE_MAILBOX_NOT_FOUND")).toBe("Address not found");
    expect(safeDeliveryFailureReason("HARD_BOUNCE_INVALID_RECIPIENT")).toBe("Invalid recipient");
    expect(safeDeliveryFailureReason("SOFT_BOUNCE_TEMPORARY_FAILURE")).toBe("Temporary delivery problem");
    expect(safeDeliveryFailureReason("SENDER_QUOTA_FAILURE")).toBe("Sender needs attention");
  });
});

// ---------------------------------------------------------------------------
// Regression: the real missed production bounce (550 5.1.0 Address Rejected).
// ---------------------------------------------------------------------------

describe("real Gmail bounce: 550 5.1.0 Address Rejected", () => {
  // Sanitized fixture mirroring the actual Mail Delivery Subsystem message.
  const OPTUM_TEXT = [
    "Address not found",
    "",
    "Your message wasn't delivered to",
    "mohshin.chowdhury@optum.com",
    "because the address couldn't be found, or is unable to receive mail.",
    "",
    "The response from the remote server was:",
    "",
    "550 5.1.0 Address Rejected"
  ].join("\n");

  it("text fallback extracts the recipient, 5.1.0 status, and diagnostic", () => {
    const parsed = parseDeliveryStatusFromGmailMessage(
      gmailBounceMessage({
        payload: {
          mimeType: "multipart/related",
          headers: [
            { name: "From", value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" },
            { name: "Subject", value: "Delivery Status Notification (Failure)" }
          ],
          parts: [textPart(OPTUM_TEXT)]
        }
      })
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.recipients).toHaveLength(1);
    expect(parsed?.recipients[0]).toMatchObject({
      email: "mohshin.chowdhury@optum.com",
      action: "failed",
      status: "5.1.0"
    });
    expect(parsed?.recipients[0]?.diagnosticCode).toContain("550 5.1.0 Address Rejected");
  });

  it("structured 5.1.0 with an address-rejected diagnostic classifies as permanent Failed", () => {
    const result = classifyDeliveryFailure({
      action: "failed",
      status: "5.1.0",
      diagnosticCode: "smtp; 550 5.1.0 Address Rejected"
    });
    expect(result.permanence).toBe("permanent");
    expect(result.suppressRecipient).toBe(true);
    expect(safeDeliveryFailureReason(result.category)).toBe("Address not found");
  });

  it("the text-fallback fields classify the same way end to end", () => {
    const parsed = parseDeliveryStatusFromGmailMessage(
      gmailBounceMessage({
        payload: {
          mimeType: "multipart/related",
          headers: [{ name: "From", value: "mailer-daemon@googlemail.com" }],
          parts: [textPart(OPTUM_TEXT)]
        }
      })
    );
    const result = classifyDeliveryFailure(parsed!.recipients[0]);
    expect(result.permanence).toBe("permanent");
    expect(result.suppressRecipient).toBe(true);
  });

  it("a bare 5.1.0 with no recipient-fault diagnostic is never auto-suppressed", () => {
    const result = classifyDeliveryFailure({ action: "failed", status: "5.1.0", diagnosticCode: null });
    expect(result.category).toBe("UNKNOWN_DELIVERY_FAILURE");
    expect(result.suppressRecipient).toBe(false);
  });

  it("sender-address codes 5.1.7/5.1.8 never suppress the recipient", () => {
    for (const status of ["5.1.7", "5.1.8"]) {
      const result = classifyDeliveryFailure({ action: "failed", status, diagnosticCode: "bad sender address syntax" });
      expect(result.suppressRecipient).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Reply exclusion — a DSN must never look like a human reply.
// ---------------------------------------------------------------------------

describe("looksLikeDeliveryNotification (reply exclusion)", () => {
  it("flags the real bounce by any single automated-delivery signal", () => {
    // Sender address alone.
    expect(
      looksLikeDeliveryNotification({
        fromHeader: "mailer-daemon@googlemail.com",
        subject: null,
        contentType: null,
        autoSubmitted: null
      })
    ).toBe(true);
    // Display name alone (fine for EXCLUDING from replies, unlike bounce intake).
    expect(
      looksLikeDeliveryNotification({
        fromHeader: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
        subject: null,
        contentType: null,
        autoSubmitted: null
      })
    ).toBe(true);
    // DSN subject alone.
    expect(
      looksLikeDeliveryNotification({
        fromHeader: "someone@example.com",
        subject: "Delivery Status Notification (Failure)",
        contentType: null,
        autoSubmitted: null
      })
    ).toBe(true);
    // multipart/report alone.
    expect(
      looksLikeDeliveryNotification({
        fromHeader: null,
        subject: null,
        contentType: 'multipart/report; report-type=delivery-status; boundary="x"',
        autoSubmitted: null
      })
    ).toBe(true);
  });

  it("never flags a genuine human reply", () => {
    expect(
      looksLikeDeliveryNotification({
        fromHeader: "Mohshin Chowdhury <mohshin.personal@gmail.com>",
        subject: "Re: Could my healthcare backend experience contribute?",
        contentType: "multipart/alternative",
        autoSubmitted: null
      })
    ).toBe(false);
  });
});
