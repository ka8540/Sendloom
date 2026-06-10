import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export const AUDIT_CATEGORIES = [
  "AUTH",
  "USER",
  "IMPORT",
  "MAPPING",
  "TEMPLATE",
  "SEQUENCE",
  "SENDER",
  "EMAIL_SEND",
  "FOLLOW_UP",
  "FILE",
  "HUNTER",
  "ADMIN",
  "SECURITY",
  "SYSTEM"
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_SEVERITIES = ["INFO", "SUCCESS", "WARNING", "ERROR", "SECURITY"] as const;

export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

// Keys that must never reach the audit table, regardless of caller. Covers
// credentials, OAuth material, and raw message content (bodies stay out of
// the audit log by design — only names/counts/status are recorded).
const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|passwd|credential|authorization|cookie|api[._-]?key|apikey|refresh|private|jwt|bearer|body|html|attachmentdata|payload)/i;

const MAX_METADATA_DEPTH = 3;
const MAX_METADATA_KEYS = 24;
const MAX_METADATA_ARRAY_ITEMS = 12;
const MAX_METADATA_STRING_LENGTH = 300;
const MAX_USER_AGENT_LENGTH = 256;

function sanitizeMetadataValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return value.length > MAX_METADATA_STRING_LENGTH
      ? `${value.slice(0, MAX_METADATA_STRING_LENGTH)}…`
      : value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_METADATA_DEPTH) {
      return `[array:${value.length}]`;
    }

    return value.slice(0, MAX_METADATA_ARRAY_ITEMS).map((item) => sanitizeMetadataValue(item, depth + 1));
  }

  if (typeof value === "object") {
    if (depth >= MAX_METADATA_DEPTH) {
      return "[object]";
    }

    const result: Record<string, unknown> = {};
    let keyCount = 0;

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (keyCount >= MAX_METADATA_KEYS) {
        break;
      }

      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = "[redacted]";
        keyCount += 1;
        continue;
      }

      const sanitized = sanitizeMetadataValue(entry, depth + 1);
      if (sanitized !== undefined) {
        result[key] = sanitized;
        keyCount += 1;
      }
    }

    return result;
  }

  return undefined;
}

export function sanitizeAuditMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }

  return sanitizeMetadataValue(metadata, 0) as Record<string, unknown>;
}

function readClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  return headers.get("x-real-ip")?.trim() || null;
}

export type RecordAuditEventArgs = {
  actor: {
    id?: string | null;
    email: string;
    name?: string | null;
  };
  action: string;
  category: AuditCategory;
  severity?: AuditSeverity;
  target?: {
    type: string;
    id?: string | null;
    name?: string | null;
  } | null;
  message?: string | null;
  metadata?: Record<string, unknown>;
  /** Source request, used only for IP / user-agent context. */
  request?: Request | null;
  /**
   * Security-critical events (admin restrictions, data wipes) rethrow write
   * failures so the caller surfaces them. Everything else is best-effort and
   * must never break the action being audited.
   */
  critical?: boolean;
};

export async function recordAuditEvent(args: RecordAuditEventArgs) {
  try {
    const headers = args.request?.headers;

    await prisma.auditLog.create({
      data: {
        actorUserId: args.actor.id ?? null,
        actorEmail: args.actor.email,
        actorName: args.actor.name ?? null,
        action: args.action,
        category: args.category,
        severity: args.severity ?? "INFO",
        entityType: args.target?.type ?? null,
        entityId: args.target?.id ?? null,
        targetName: args.target?.name ?? null,
        message: args.message ?? null,
        metadata: sanitizeAuditMetadata(args.metadata) as Prisma.InputJsonValue | undefined,
        ipAddress: headers ? readClientIp(headers) : null,
        userAgent: headers?.get("user-agent")?.slice(0, MAX_USER_AGENT_LENGTH) ?? null
      }
    });
  } catch (error) {
    if (args.critical) {
      throw error;
    }

    console.error("[audit] Failed to record audit event.", error);
  }
}
