// Server-side construction + redaction of the SAFE diagnostic payload stored on
// an incident. The safest strategy (per the privacy spec) is to BUILD the
// diagnostic object from an explicit allow-list of approved fields, not to store
// an arbitrary client object and try to scrub it afterward. Client-supplied
// context is untrusted: we coerce types, cap sizes, and drop anything not on the
// allow-list, then pass the result through the shared audit sanitizer as
// defense-in-depth.

import { sanitizeAuditMetadata } from "@/lib/audit";
import { sanitizeDiagnosticText } from "@/lib/gmail-errors";

const MAX_NOTE_LENGTH = 1000;
const MAX_LABEL_LENGTH = 120;
const MAX_FEATURE_FLAGS = 12;
const MAX_FLAG_KEY_LENGTH = 40;

// Safe, known sequence/run lifecycle states (mirrors CampaignStatus + RunStatus).
// Anything else is dropped, so a raw status string can never leak.
const ALLOWED_SEQUENCE_STATES = new Set([
  "DRAFT",
  "VALIDATED",
  "SCHEDULED",
  "QUEUED",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
  "FAILED"
]);

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Conservative phone matcher: 7+ digits with common separators. Practical, not
// exhaustive — the allow-list is the primary protection; this guards free text.
const PHONE_PATTERN = /(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,5}\d{2,4}/g;

/** Trim, strip control chars + angle brackets (no HTML), and cap length. */
export function sanitizeShortLabel(value: unknown, maxLength = MAX_LABEL_LENGTH): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = value
    // Strip control characters (U+0000–U+001F) and angle brackets so a label can
    // never carry terminal control sequences or HTML, then collapse whitespace.
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return null;
  }
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

/** Pathname only — drop the query string and hash so no query values persist. */
export function toPathnameOnly(value: unknown): string | null {
  const label = sanitizeShortLabel(value, 256);
  if (!label) {
    return null;
  }
  const withoutHash = label.split("#")[0] ?? label;
  const withoutQuery = withoutHash.split("?")[0] ?? withoutHash;
  const trimmed = withoutQuery.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * Collapse dynamic path segments (cuids, uuids, numeric ids, long opaque tokens)
 * to `:id` so the same failure on different records shares one dedup fingerprint.
 * Pure structure, no identifiers retained.
 */
export function toRouteTemplate(pathname: unknown): string | null {
  const path = toPathnameOnly(pathname);
  if (!path) {
    return null;
  }
  return path
    .split("/")
    .map((segment) => {
      if (!segment) {
        return segment;
      }
      const isNumeric = /^\d+$/.test(segment);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment);
      const isCuidLike = /^c[a-z0-9]{20,}$/i.test(segment);
      const isLongOpaque = /^[A-Za-z0-9_-]{16,}$/.test(segment);
      return isNumeric || isUuid || isCuidLike || isLongOpaque ? ":id" : segment;
    })
    .join("/");
}

/** Redact emails, phones, and tokens from optional free text, then cap length. */
export function redactFreeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  // First strip tokens/secrets (shared sanitizer), then emails + phones, then
  // strip angle brackets so the note can never be rendered as HTML.
  let text = sanitizeDiagnosticText(value);
  text = text
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(PHONE_PATTERN, (match) => (match.replace(/\D/g, "").length >= 7 ? "[redacted-phone]" : match))
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return null;
  }
  return text.length > MAX_NOTE_LENGTH ? text.slice(0, MAX_NOTE_LENGTH) : text;
}

export type SafeDiagnosticInput = {
  retryCount?: unknown;
  gmailConnected?: unknown;
  sequenceState?: unknown;
  currentOperationState?: unknown;
  featureFlags?: unknown;
};

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
}

function coerceFeatureFlags(value: unknown): Record<string, boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, boolean> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_FEATURE_FLAGS) {
      break;
    }
    if (!/^[a-zA-Z0-9_.-]{1,40}$/.test(key) || key.length > MAX_FLAG_KEY_LENGTH) {
      continue;
    }
    const bool = coerceBoolean(raw);
    if (bool === undefined) {
      continue;
    }
    out[key] = bool;
    count += 1;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Build the stored `sanitizedContext` strictly from approved keys. Unknown keys
 * in the input are ignored entirely — they are never persisted. Whether Gmail
 * was connected is reduced to a boolean; sequence state is allow-listed; feature
 * flags are reduced to known booleans. The final pass through the audit sanitizer
 * enforces depth/length caps + sensitive-key redaction as a second layer.
 */
export function buildSafeDiagnostics(input: SafeDiagnosticInput): Record<string, unknown> | undefined {
  const context: Record<string, unknown> = {};

  if (input.retryCount !== undefined) {
    const n = Number(input.retryCount);
    if (Number.isFinite(n)) {
      context.retryCount = Math.max(0, Math.min(50, Math.floor(n)));
    }
  }

  const gmailConnected = coerceBoolean(input.gmailConnected);
  if (gmailConnected !== undefined) {
    context.gmailConnected = gmailConnected;
  }

  const sequenceState = sanitizeShortLabel(input.sequenceState, 24)?.toUpperCase();
  if (sequenceState && ALLOWED_SEQUENCE_STATES.has(sequenceState)) {
    context.sequenceState = sequenceState;
  }

  const operationState = sanitizeShortLabel(input.currentOperationState, 48);
  if (operationState) {
    context.currentOperationState = operationState;
  }

  const flags = coerceFeatureFlags(input.featureFlags);
  if (flags) {
    context.featureFlags = flags;
  }

  if (Object.keys(context).length === 0) {
    return undefined;
  }

  return sanitizeAuditMetadata(context);
}
