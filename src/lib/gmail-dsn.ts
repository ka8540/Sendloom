// Delivery-status-notification (DSN) detection, parsing, and classification for
// Gmail bounce monitoring. Pure functions over the Gmail API's already-parsed
// message JSON (format=full payload tree) — no network, no database, so the
// whole module is unit-testable under the node-only vitest setup.
//
// Privacy: these functions return only structured failure fields (recipient,
// action, status, bounded diagnostic). Callers must never persist raw bodies —
// nothing here retains or returns full message content.

import { isInvalidRecipientDiagnosticText } from "@/lib/gmail-errors";

// ---------------------------------------------------------------------------
// Gmail API payload shapes (subset used here).
// ---------------------------------------------------------------------------

export type GmailHeader = { name: string; value: string };

export type GmailMessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string };
  parts?: GmailMessagePart[];
};

export type GmailFullMessage = {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailMessagePart;
};

// Hard limits so a hostile or malformed message can never balloon processing.
export const DSN_MAX_MESSAGE_BYTES = 1_000_000;
export const DSN_MAX_PART_DECODE_BYTES = 64_000;
export const DSN_MAX_PART_DEPTH = 6;
export const DSN_MAX_RECIPIENTS = 25;
export const DSN_MAX_FIELD_LENGTH = 500;

export function getGmailHeader(headers: GmailHeader[] | undefined, name: string): string | null {
  const lowered = name.toLowerCase();
  return headers?.find((header) => header.name.toLowerCase() === lowered)?.value ?? null;
}

function extractEmailAddress(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase() ?? null;
}

function extractRfcMessageIds(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  const matches = value.match(/<[^>]+>/g) ?? [];
  return matches
    .map((entry) => entry.replace(/[<>]/g, "").trim().toLowerCase())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Detection — is this message likely an automated delivery-status report?
// ---------------------------------------------------------------------------

export type DsnDetectionInput = {
  fromHeader: string | null;
  subject: string | null;
  contentType: string | null;
  autoSubmitted: string | null;
  /** True when an X-Failed-Recipients header exists (Gmail sets it on bounces). */
  hasFailedRecipientsHeader?: boolean;
};

const DSN_SENDER_ADDRESS_PATTERN = /^(mailer-daemon|postmaster)@/i;
const DSN_SENDER_NAME_PATTERN = /mail delivery (subsystem|system)|mail administrator/i;
const DSN_SUBJECT_PATTERN =
  /delivery status notification|undeliver|returned mail|failure notice|delivery (has )?failed|delivery incomplete|message not delivered/i;

/**
 * Single-signal automated-delivery check used to EXCLUDE messages from reply
 * storage. Human replies never come from mailer-daemon/postmaster, never carry
 * a delivery-status report type, and never use DSN subjects — any one of those
 * disqualifies a "reply". Deliberately broader than the two-signal bounce
 * filter below: over-excluding an automated message from the reply feed is
 * harmless, while storing a bounce as a human reply corrupts reply metrics and
 * silently swallows the delivery failure.
 */
export function looksLikeDeliveryNotification(input: DsnDetectionInput): boolean {
  const fromAddress = extractEmailAddress(input.fromHeader);
  if (fromAddress && DSN_SENDER_ADDRESS_PATTERN.test(fromAddress)) {
    return true;
  }
  if (input.fromHeader && DSN_SENDER_NAME_PATTERN.test(input.fromHeader)) {
    return true;
  }
  if (input.subject && DSN_SUBJECT_PATTERN.test(input.subject)) {
    return true;
  }
  const contentType = input.contentType?.toLowerCase() ?? "";
  if (contentType.includes("multipart/report")) {
    return true;
  }
  return Boolean(input.hasFailedRecipientsHeader);
}

/**
 * A message is inspected further only when it carries strong delivery-status
 * signals. `multipart/report; report-type=delivery-status` alone is decisive
 * (it is the machine format for DSNs); anything else needs at least two
 * independent signals so a spoofed display name alone never qualifies.
 */
export function isLikelyDeliveryStatusMessage(input: DsnDetectionInput): boolean {
  const contentType = input.contentType?.toLowerCase() ?? "";
  if (contentType.includes("multipart/report") && contentType.includes("delivery-status")) {
    return true;
  }

  let signals = 0;
  const fromAddress = extractEmailAddress(input.fromHeader);
  if (fromAddress && DSN_SENDER_ADDRESS_PATTERN.test(fromAddress)) {
    signals += 1;
  } else if (input.fromHeader && DSN_SENDER_NAME_PATTERN.test(input.fromHeader)) {
    // Display-name match is a weaker signal than the address match, but it
    // still counts as one of the two required signals.
    signals += 1;
  }
  if (input.subject && DSN_SUBJECT_PATTERN.test(input.subject)) {
    signals += 1;
  }
  if (input.autoSubmitted && /auto-(replied|generated)/i.test(input.autoSubmitted)) {
    signals += 1;
  }
  if (input.hasFailedRecipientsHeader) {
    signals += 1;
  }

  return signals >= 2;
}

// ---------------------------------------------------------------------------
// Parsing — structured DSN fields first, bounded Gmail text fallback second.
// ---------------------------------------------------------------------------

export type DsnRecipientReport = {
  /** Normalized (lowercased, trimmed) failed recipient address. */
  email: string;
  /** DSN Action field (failed / delayed / relayed / expanded / delivered). */
  action: string | null;
  /** SMTP enhanced status code, e.g. "5.1.1". */
  status: string | null;
  /** Bounded, sanitized Diagnostic-Code text (never a full body). */
  diagnosticCode: string | null;
  remoteMta: string | null;
};

export type ParsedDeliveryStatus = {
  gmailMessageId: string;
  gmailThreadId: string | null;
  receivedAt: Date;
  /** True when fields came from a structured message/delivery-status part. */
  structured: boolean;
  recipients: DsnRecipientReport[];
  /** RFC Message-IDs referenced by the DSN (In-Reply-To / References / original headers). */
  referenceMessageIds: string[];
  reportingMta: string | null;
};

function decodePartData(part: GmailMessagePart | undefined): string | null {
  const data = part?.body?.data;
  if (!data) {
    return null;
  }
  if ((part.body?.size ?? data.length) > DSN_MAX_PART_DECODE_BYTES) {
    return null;
  }
  try {
    return Buffer.from(data, "base64url").toString("utf8").slice(0, DSN_MAX_PART_DECODE_BYTES);
  } catch {
    return null;
  }
}

function findPartsByMimeType(root: GmailMessagePart | undefined, mimeType: string, depth = 0): GmailMessagePart[] {
  if (!root || depth > DSN_MAX_PART_DEPTH) {
    return [];
  }
  const matches: GmailMessagePart[] = [];
  if ((root.mimeType ?? "").toLowerCase() === mimeType) {
    matches.push(root);
  }
  for (const child of root.parts ?? []) {
    matches.push(...findPartsByMimeType(child, mimeType, depth + 1));
  }
  return matches;
}

function sanitizeField(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const cleaned = value.replace(/\s+/g, " ").trim().slice(0, DSN_MAX_FIELD_LENGTH);
  return cleaned || null;
}

/** Strip the RFC 3464 address-type prefix, e.g. "rfc822; user@host" → address. */
function parseDsnAddress(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const withoutType = value.includes(";") ? value.slice(value.indexOf(";") + 1) : value;
  return extractEmailAddress(withoutType);
}

const ENHANCED_STATUS_PATTERN = /\b([245])\.\d{1,3}\.\d{1,3}\b/;

function extractEnhancedStatus(value: string | null): string | null {
  return value?.match(ENHANCED_STATUS_PATTERN)?.[0] ?? null;
}

/**
 * Parse a message/delivery-status body: header-style fields in blank-line
 * separated groups — the first group is per-message, the rest per-recipient.
 */
function parseDeliveryStatusBody(body: string): {
  reportingMta: string | null;
  originalEnvelopeId: string | null;
  recipients: DsnRecipientReport[];
} {
  const groups = body
    .replace(/\r\n/g, "\n")
    // Unfold continuation lines before splitting fields.
    .replace(/\n[ \t]+/g, " ")
    .split(/\n{2,}/)
    .map((group) => group.trim())
    .filter(Boolean);

  const fieldsOf = (group: string) => {
    const fields = new Map<string, string>();
    for (const line of group.split("\n")) {
      const separator = line.indexOf(":");
      if (separator <= 0) {
        continue;
      }
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (key && value && !fields.has(key)) {
        fields.set(key, value.slice(0, DSN_MAX_FIELD_LENGTH));
      }
    }
    return fields;
  };

  const messageFields = groups.length > 0 ? fieldsOf(groups[0]) : new Map<string, string>();
  const recipients: DsnRecipientReport[] = [];

  for (const group of groups.slice(messageFields.has("reporting-mta") ? 1 : 0)) {
    if (recipients.length >= DSN_MAX_RECIPIENTS) {
      break;
    }
    const fields = fieldsOf(group);
    const email =
      parseDsnAddress(fields.get("final-recipient") ?? null) ??
      parseDsnAddress(fields.get("original-recipient") ?? null);
    if (!email) {
      continue;
    }
    recipients.push({
      email,
      action: sanitizeField(fields.get("action") ?? null)?.toLowerCase() ?? null,
      status: extractEnhancedStatus(fields.get("status") ?? null),
      diagnosticCode: sanitizeField(fields.get("diagnostic-code") ?? null),
      remoteMta: sanitizeField(fields.get("remote-mta") ?? null)
    });
  }

  return {
    reportingMta: sanitizeField(messageFields.get("reporting-mta") ?? null),
    originalEnvelopeId: sanitizeField(messageFields.get("original-envelope-id") ?? null),
    recipients
  };
}

// Gmail bounce text patterns ("Address not found", "550 5.1.1 User Unknown"…).
// Used ONLY when no structured delivery-status part exists.
const TEXT_FALLBACK_REASON_PATTERNS =
  /address not found|user unknown|mailbox unavailable|recipient address rejected|no such user|account (that you tried to reach )?does(n't| not) exist|couldn't be found|unable to receive mail|wasn't delivered/i;

function parseTextFallback(text: string): DsnRecipientReport[] {
  if (!TEXT_FALLBACK_REASON_PATTERNS.test(text)) {
    return [];
  }
  // Gmail phrases the failed address as "…wasn't delivered to <address>…" and/or
  // repeats it in bold near the reason. Take addresses that appear near the
  // failure phrasing, not every address in the body.
  const delivered = text.match(
    /(?:delivered to|couldn't be delivered to|delivery to)\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i
  );
  const candidates = delivered ? [delivered[1]] : (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).slice(0, 1);
  const status = extractEnhancedStatus(text);
  const smtpLine = text.match(/\b([45]\d{2})[ -][^\n]{0,120}/)?.[0] ?? null;

  return candidates
    .map((address) => address.toLowerCase())
    .filter((address) => !DSN_SENDER_ADDRESS_PATTERN.test(address))
    .slice(0, DSN_MAX_RECIPIENTS)
    .map((email) => ({
      email,
      action: "failed",
      status,
      diagnosticCode: sanitizeField(smtpLine),
      remoteMta: null
    }));
}

/**
 * Parse a Gmail full-format message into structured delivery-status data.
 * Returns null when the message is not parseable as a DSN (callers then skip
 * it — nothing is stored). Structured fields always win over text fallback.
 */
export function parseDeliveryStatusFromGmailMessage(message: GmailFullMessage): ParsedDeliveryStatus | null {
  if ((message.sizeEstimate ?? 0) > DSN_MAX_MESSAGE_BYTES) {
    return null;
  }
  const payload = message.payload;
  const headers = payload?.headers;

  const referenceMessageIds = [
    ...extractRfcMessageIds(getGmailHeader(headers, "In-Reply-To")),
    ...extractRfcMessageIds(getGmailHeader(headers, "References"))
  ];

  // The returned original (message/rfc822 part) carries the original RFC
  // Message-ID as a nested header — the strongest correlation key we can get.
  for (const original of findPartsByMimeType(payload, "message/rfc822")) {
    for (const child of original.parts ?? []) {
      referenceMessageIds.push(...extractRfcMessageIds(getGmailHeader(child.headers, "Message-ID")));
    }
    referenceMessageIds.push(...extractRfcMessageIds(getGmailHeader(original.headers, "Message-ID")));
  }

  const failedRecipientsHeader = extractEmailAddress(getGmailHeader(headers, "X-Failed-Recipients"));

  let structured = false;
  let reportingMta: string | null = null;
  let recipients: DsnRecipientReport[] = [];

  const statusParts = findPartsByMimeType(payload, "message/delivery-status");
  for (const statusPart of statusParts) {
    const body = decodePartData(statusPart) ?? decodePartData(statusPart.parts?.[0]);
    if (!body) {
      continue;
    }
    const parsed = parseDeliveryStatusBody(body);
    if (parsed.recipients.length > 0) {
      structured = true;
      reportingMta = parsed.reportingMta;
      recipients = parsed.recipients;
      break;
    }
  }

  if (!structured) {
    const textPart = findPartsByMimeType(payload, "text/plain")[0];
    const text = decodePartData(textPart) ?? message.snippet ?? null;
    if (text) {
      recipients = parseTextFallback(text);
    }
    if (recipients.length === 0 && failedRecipientsHeader) {
      recipients = [
        { email: failedRecipientsHeader, action: "failed", status: null, diagnosticCode: null, remoteMta: null }
      ];
    }
  }

  if (recipients.length === 0) {
    return null;
  }

  const internalDate = message.internalDate ? Number.parseInt(message.internalDate, 10) : NaN;

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId ?? null,
    receivedAt: Number.isFinite(internalDate) ? new Date(internalDate) : new Date(),
    structured,
    recipients,
    referenceMessageIds: [...new Set(referenceMessageIds)],
    reportingMta
  };
}

// ---------------------------------------------------------------------------
// Classification — permanent recipient failures vs everything else.
// ---------------------------------------------------------------------------

export const DELIVERY_FAILURE_CATEGORIES = [
  "HARD_BOUNCE_INVALID_RECIPIENT",
  "HARD_BOUNCE_MAILBOX_NOT_FOUND",
  "HARD_BOUNCE_DOMAIN_NOT_FOUND",
  "HARD_BOUNCE_PERMANENT_MAILBOX_FAILURE",
  "SOFT_BOUNCE_MAILBOX_FULL",
  "SOFT_BOUNCE_TEMPORARY_FAILURE",
  "POLICY_REJECTION",
  "SPAM_REJECTION",
  "SENDER_AUTHENTICATION_FAILURE",
  "SENDER_QUOTA_FAILURE",
  "UNKNOWN_DELIVERY_FAILURE"
] as const;

export type DeliveryFailureCategory = (typeof DELIVERY_FAILURE_CATEGORIES)[number];

export type DeliveryFailureClassification = {
  category: DeliveryFailureCategory;
  /** Permanent = never retry this recipient; temporary = existing retry policy. */
  permanence: "permanent" | "temporary" | "indeterminate";
  /**
   * True only when the RECIPIENT ADDRESS itself is confirmed bad. Policy/spam/
   * sender-account problems are never recipient faults, so they never suppress.
   */
  suppressRecipient: boolean;
};

const DOMAIN_NOT_FOUND_PATTERN = /domain not found|host(?: or domain name)? not found|no mx|nxdomain|domain does not exist/i;
const MAILBOX_FULL_PATTERN = /mailbox (is )?full|over ?quota|quota exceeded|insufficient (system )?storage/i;
const POLICY_PATTERN = /policy|prohibited|not authorized|access denied|blocked|blacklist|denylist|administrative/i;
const SPAM_PATTERN = /spam|content rejected|bulk mail|junk/i;
const AUTH_PATTERN = /dmarc|spf|dkim|authentication|not authenticated/i;
const QUOTA_PATTERN = /sending limit|rate limit|quota for the (sender|user)|too many messages/i;

/**
 * Central delivery-failure classifier. Only clear, recipient-specific 5.x.x
 * outcomes are eligible for suppression; anything ambiguous is UNKNOWN and
 * never blocks a possibly-valid address automatically.
 */
export function classifyDeliveryFailure(input: {
  action?: string | null;
  status?: string | null;
  diagnosticCode?: string | null;
}): DeliveryFailureClassification {
  const status = input.status ?? "";
  const statusClass = status.startsWith("5") ? 5 : status.startsWith("4") ? 4 : status.startsWith("2") ? 2 : null;
  const diagnostic = input.diagnosticCode ?? "";
  const action = input.action?.toLowerCase() ?? null;

  const permanentFailure = (category: DeliveryFailureCategory): DeliveryFailureClassification => ({
    category,
    permanence: "permanent",
    suppressRecipient: true
  });
  const temporary = (category: DeliveryFailureCategory): DeliveryFailureClassification => ({
    category,
    permanence: "temporary",
    suppressRecipient: false
  });

  // Successful/relayed actions are not failures at all — indeterminate no-ops.
  if (action === "delivered" || action === "relayed" || action === "expanded" || statusClass === 2) {
    return { category: "UNKNOWN_DELIVERY_FAILURE", permanence: "indeterminate", suppressRecipient: false };
  }

  // Temporary class first: a 4.x.x is never a permanent recipient failure.
  if (statusClass === 4 || action === "delayed") {
    if (MAILBOX_FULL_PATTERN.test(diagnostic) || /^4\.2\.2$/.test(status)) {
      return temporary("SOFT_BOUNCE_MAILBOX_FULL");
    }
    return temporary("SOFT_BOUNCE_TEMPORARY_FAILURE");
  }

  // Sender-account signals — never the recipient's fault.
  if (QUOTA_PATTERN.test(diagnostic)) {
    return { category: "SENDER_QUOTA_FAILURE", permanence: "temporary", suppressRecipient: false };
  }
  if (AUTH_PATTERN.test(diagnostic) || /^5\.7\.(1|5|9|2[0-9])$/.test(status)) {
    // 5.7.x family: authentication/policy — the address may be perfectly valid.
    if (AUTH_PATTERN.test(diagnostic)) {
      return { category: "SENDER_AUTHENTICATION_FAILURE", permanence: "indeterminate", suppressRecipient: false };
    }
  }

  // A specific permanent RECIPIENT-address rejection wins over generic policy
  // wording in the same diagnostic. For example, Exchange reports a missing
  // recipient as "550 5.4.1 Recipient address rejected: Access denied". The
  // address evidence is authoritative; "access denied" alone remains policy.
  // This uses the same narrow signature helper as synchronous Gmail failures
  // and the persisted-row repair path so all three entry points agree.
  const invalidRecipientDiagnostic = isInvalidRecipientDiagnosticText(`${status} ${diagnostic}`);
  if ((statusClass === 5 || (!status && action === "failed")) && invalidRecipientDiagnostic) {
    return permanentFailure(
      /^5\.1\.2$/.test(status) || DOMAIN_NOT_FOUND_PATTERN.test(diagnostic)
        ? "HARD_BOUNCE_DOMAIN_NOT_FOUND"
        : "HARD_BOUNCE_MAILBOX_NOT_FOUND"
    );
  }

  if (status.startsWith("5.7") || POLICY_PATTERN.test(diagnostic)) {
    if (SPAM_PATTERN.test(diagnostic)) {
      return { category: "SPAM_REJECTION", permanence: "indeterminate", suppressRecipient: false };
    }
    return { category: "POLICY_REJECTION", permanence: "indeterminate", suppressRecipient: false };
  }
  if (SPAM_PATTERN.test(diagnostic)) {
    return { category: "SPAM_REJECTION", permanence: "indeterminate", suppressRecipient: false };
  }

  // Permanent recipient failures identified by code alone. Recipient-specific
  // diagnostics (including all 5.1.x address wordings) were handled above.
  const enhanced = status;
  // Remaining 5.1.x codes are NOT recipient faults by code alone: 5.1.0 is
  // "other address status" and 5.1.7/5.1.8 are SENDER-address problems.
  // Without corroborating recipient diagnostics they fall through to UNKNOWN.
  if (/^5\.2\.1$/.test(enhanced)) {
    // Mailbox disabled — permanent recipient failure.
    return permanentFailure("HARD_BOUNCE_PERMANENT_MAILBOX_FAILURE");
  }
  if (/^5\.2\.2$/.test(enhanced) || MAILBOX_FULL_PATTERN.test(diagnostic)) {
    // Full mailbox: not proof the address is invalid — keep it retryable.
    return temporary("SOFT_BOUNCE_MAILBOX_FULL");
  }
  // Everything else in 5.x.x (or codeless) is ambiguous — never auto-suppress.
  return { category: "UNKNOWN_DELIVERY_FAILURE", permanence: "indeterminate", suppressRecipient: false };
}

/** Short, user-safe reason for a classified failure — never provider internals. */
export function safeDeliveryFailureReason(category: DeliveryFailureCategory): string {
  switch (category) {
    case "HARD_BOUNCE_INVALID_RECIPIENT":
      return "Invalid recipient";
    case "HARD_BOUNCE_MAILBOX_NOT_FOUND":
      return "Address not found";
    case "HARD_BOUNCE_DOMAIN_NOT_FOUND":
      return "Delivery permanently rejected";
    case "HARD_BOUNCE_PERMANENT_MAILBOX_FAILURE":
      return "Mailbox unavailable";
    case "SOFT_BOUNCE_MAILBOX_FULL":
    case "SOFT_BOUNCE_TEMPORARY_FAILURE":
      return "Temporary delivery problem";
    case "POLICY_REJECTION":
    case "SPAM_REJECTION":
      return "Delivery rejected by the receiving server";
    case "SENDER_AUTHENTICATION_FAILURE":
    case "SENDER_QUOTA_FAILURE":
      return "Sender needs attention";
    default:
      return "Delivery failed";
  }
}
