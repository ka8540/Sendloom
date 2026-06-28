// The ONLY module that reads/writes incident rows and maps them to DTOs. Every
// privacy guarantee is enforced here:
//   - the affected user is represented only by an HMAC pseudonym (identity.ts);
//   - the reversible reference is AES-256-GCM encrypted and NEVER placed on any
//     DTO returned to a client (admin or reporter);
//   - stored diagnostics are allow-list built (diagnostics.ts), never an
//     arbitrary client object;
//   - severity is derived server-side; the client cannot set it, the pseudonym,
//     status, occurrence count, or the public ids.
// Reports are deduplicated (same pseudonym + fingerprint within a short window)
// and rate-limited so a retry loop can never spam the admin dashboard.

import type { Prisma } from "@prisma/client";

import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { appErrorCategory, type AppErrorCategory } from "@/lib/incident/app-error";
import {
  buildSafeDiagnostics,
  redactFreeText,
  sanitizeShortLabel,
  toPathnameOnly,
  toRouteTemplate
} from "@/lib/incident/diagnostics";
import { diagnosticFingerprint } from "@/lib/incident/fingerprint";
import { encryptReporterRef, reporterPseudonym } from "@/lib/incident/identity";
import { newPublicEventId, newPublicReportId } from "@/lib/incident/public-id";
import { deriveSeverity } from "@/lib/incident/severity";
import { INCIDENT_STATUSES, type IncidentStatus } from "@/lib/incident/status";
import { getRedis } from "@/lib/redis";
import { rateLimit } from "@/lib/rate-limit";

// Re-exported for existing server-side callers that import statuses from here.
export { INCIDENT_STATUSES };
export type { IncidentStatus };

const DEDUP_WINDOW_MS = 15 * 60 * 1000;
const REPORT_HOURLY_LIMIT = 5;
const REPORT_DAILY_LIMIT = 20;
const EVENT_HOURLY_LIMIT = 60;
const IDEMPOTENCY_TTL_SECONDS = 600;
const PUBLIC_ID_RETRIES = 4;

const APP_VERSION = process.env.npm_package_version ?? "dev";
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type ErrorContextInput = {
  category?: string | null;
  feature?: string | null;
  operation?: string | null;
  route?: string | null;
  requestMethod?: string | null;
  internalCode?: string | null;
  httpStatus?: number | null;
  correlationId?: string | null;
  appVersion?: string | null;
  browserFamily?: string | null;
  platform?: string | null;
  onlineStatus?: boolean | null;
  retryable?: boolean | null;
  retryCount?: number | null;
  gmailConnected?: boolean | null;
  sequenceState?: string | null;
  currentOperationState?: string | null;
  featureFlags?: Record<string, unknown> | null;
  /** Server-only: a hash of the server stack when captured server-side. */
  serverStackFingerprint?: string | null;
};

export type CreateIncidentReportInput = ErrorContextInput & {
  userNote?: string | null;
  /** Reference a previously captured event instead of re-deriving from context. */
  eventId?: string | null;
  /** Makes an exact double-submit idempotent (same reportId, no extra count). */
  idempotencyKey?: string | null;
};

type Actor = { id: string; email: string };

// ---------------------------------------------------------------------------
// Safe field coercion (defense-in-depth; routes also validate with zod)
// ---------------------------------------------------------------------------

function clampStatus(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const n = Math.floor(value);
  return n >= 100 && n <= 599 ? n : null;
}

function sanitizeMethod(value: string | null | undefined): string | null {
  const method = sanitizeShortLabel(value, 10)?.toUpperCase();
  return method && ALLOWED_METHODS.has(method) ? method : null;
}

type EventBuild = {
  data: Prisma.AppErrorEventCreateInput;
  category: AppErrorCategory;
  fingerprint: string;
};

function buildEventData(input: ErrorContextInput): EventBuild {
  const category = appErrorCategory(input.category ?? null);
  const feature = sanitizeShortLabel(input.feature) ?? "Sendloom";
  const operation = sanitizeShortLabel(input.operation) ?? "Unknown operation";
  const internalCode = sanitizeShortLabel(input.internalCode, 80);
  const route = toPathnameOnly(input.route);
  const routeTemplate = toRouteTemplate(input.route);
  const appVersion = sanitizeShortLabel(input.appVersion, 40) ?? APP_VERSION;
  const serverStackFingerprint = sanitizeShortLabel(input.serverStackFingerprint, 80);

  const fingerprint = diagnosticFingerprint({
    category,
    feature,
    operation,
    internalCode,
    routeTemplate,
    serverStackFingerprint,
    appVersion
  });

  return {
    category,
    fingerprint,
    data: {
      publicEventId: newPublicEventId(),
      category,
      feature,
      operation,
      internalCode: internalCode ?? null,
      httpStatus: clampStatus(input.httpStatus),
      correlationId: sanitizeShortLabel(input.correlationId, 80) ?? null,
      route: route ?? null,
      requestMethod: sanitizeMethod(input.requestMethod),
      appVersion,
      browserFamily: sanitizeShortLabel(input.browserFamily, 60) ?? null,
      platform: sanitizeShortLabel(input.platform, 60) ?? null,
      onlineStatus: typeof input.onlineStatus === "boolean" ? input.onlineStatus : null,
      retryable: Boolean(input.retryable),
      sanitizedContext: (buildSafeDiagnostics({
        retryCount: input.retryCount,
        gmailConnected: input.gmailConnected,
        sequenceState: input.sequenceState,
        currentOperationState: input.currentOperationState,
        featureFlags: input.featureFlags
      }) ?? undefined) as Prisma.InputJsonValue | undefined,
      diagnosticFingerprint: fingerprint,
      serverStackFingerprint: serverStackFingerprint ?? null,
      occurredAt: new Date()
    }
  };
}

async function createEventRow(data: Prisma.AppErrorEventCreateInput) {
  for (let attempt = 0; attempt < PUBLIC_ID_RETRIES; attempt += 1) {
    try {
      return await prisma.appErrorEvent.create({
        data: { ...data, publicEventId: attempt === 0 ? data.publicEventId : newPublicEventId() }
      });
    } catch (error) {
      if (isUniqueViolation(error) && attempt < PUBLIC_ID_RETRIES - 1) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not allocate a unique event id.");
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002");
}

/**
 * Find a recent event with the same fingerprint (so a retry loop reuses one
 * technical event row) or create a new one. Events hold NO identity, so reusing
 * one across users for the same failure is intentional + safe.
 */
async function findOrCreateEvent(build: EventBuild) {
  if (build.fingerprint) {
    const since = new Date(Date.now() - DEDUP_WINDOW_MS);
    const existing = await prisma.appErrorEvent.findFirst({
      where: { diagnosticFingerprint: build.fingerprint, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" }
    });
    if (existing) {
      return existing;
    }
  }
  return createEventRow(build.data);
}

// ---------------------------------------------------------------------------
// Rate limiting + idempotency (keyed by pseudonym, never email/IP)
// ---------------------------------------------------------------------------

async function isRateLimited(pseudonym: string, scope: "report" | "event"): Promise<boolean> {
  if (scope === "event") {
    const hour = await rateLimit({ key: `incident-event:hour:${pseudonym}`, limit: EVENT_HOURLY_LIMIT, windowSeconds: 3600 });
    return !hour.allowed;
  }
  const hour = await rateLimit({ key: `incident-report:hour:${pseudonym}`, limit: REPORT_HOURLY_LIMIT, windowSeconds: 3600 });
  if (!hour.allowed) {
    return true;
  }
  const day = await rateLimit({ key: `incident-report:day:${pseudonym}`, limit: REPORT_DAILY_LIMIT, windowSeconds: 86400 });
  return !day.allowed;
}

function idempotencyRedisKey(pseudonym: string, key: string) {
  return `incident-report:idem:${pseudonym}:${key}`;
}

async function readIdempotentReportId(pseudonym: string, key: string | null | undefined): Promise<string | null> {
  if (!key) {
    return null;
  }
  try {
    return (await getRedis().get(idempotencyRedisKey(pseudonym, key))) ?? null;
  } catch {
    return null; // best-effort; dedup-by-fingerprint still protects against dupes
  }
}

async function storeIdempotentReportId(pseudonym: string, key: string | null | undefined, reportId: string) {
  if (!key) {
    return;
  }
  try {
    await getRedis().set(idempotencyRedisKey(pseudonym, key), reportId, "EX", IDEMPOTENCY_TTL_SECONDS);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Public API: event capture + report creation
// ---------------------------------------------------------------------------

export type CaptureEventResult = { ok: true; eventId: string } | { ok: false; reason: "RATE_LIMITED" };

/** Auto-capture a sanitized technical event. No identity is stored on the event. */
export async function captureErrorEvent(input: ErrorContextInput, actor: Actor): Promise<CaptureEventResult> {
  const pseudonym = reporterPseudonym(actor.id);
  if (await isRateLimited(pseudonym, "event")) {
    return { ok: false, reason: "RATE_LIMITED" };
  }
  const build = buildEventData(input);
  const event = await findOrCreateEvent(build);
  return { ok: true, eventId: event.publicEventId };
}

export type CreateReportResult =
  | { ok: true; reportId: string; status: IncidentStatus; deduplicated: boolean }
  | { ok: false; reason: "RATE_LIMITED" };

/**
 * Create (or dedupe) an incident report for the authenticated user. The user is
 * stored only as a pseudonym + encrypted reference; severity + fingerprint are
 * derived server-side.
 */
export async function createIncidentReport(input: CreateIncidentReportInput, actor: Actor): Promise<CreateReportResult> {
  const pseudonym = reporterPseudonym(actor.id);

  // Idempotent replay of the exact same submission: return the same report
  // without consuming a rate-limit slot or bumping the occurrence count.
  const cachedId = await readIdempotentReportId(pseudonym, input.idempotencyKey);
  if (cachedId) {
    const cached = await prisma.incidentReport.findUnique({ where: { publicReportId: cachedId } });
    if (cached) {
      return { ok: true, reportId: cached.publicReportId, status: cached.status as IncidentStatus, deduplicated: true };
    }
  }

  if (await isRateLimited(pseudonym, "report")) {
    return { ok: false, reason: "RATE_LIMITED" };
  }

  const build = buildEventData(input);
  const event = await findOrCreateEvent(build);
  const note = redactFreeText(input.userNote);
  const now = new Date();

  // Dedup: same reporter + same fingerprint seen within the window updates the
  // existing report instead of creating a new admin row.
  const existing = build.fingerprint
    ? await prisma.incidentReport.findFirst({
        where: {
          reporterPseudonym: pseudonym,
          diagnosticFingerprint: build.fingerprint,
          lastSeenAt: { gte: new Date(now.getTime() - DEDUP_WINDOW_MS) }
        },
        orderBy: { lastSeenAt: "desc" }
      })
    : null;

  if (existing) {
    const occurrenceCount = existing.occurrenceCount + 1;
    const updated = await prisma.incidentReport.update({
      where: { id: existing.id },
      data: {
        occurrenceCount,
        lastSeenAt: now,
        errorEventId: event.id,
        // Escalate severity as the same failure recurs; never downgrade a
        // human-set status, and keep the first meaningful note.
        severity: deriveSeverity(build.category, occurrenceCount),
        userNote: existing.userNote ?? note
      }
    });
    await storeIdempotentReportId(pseudonym, input.idempotencyKey, updated.publicReportId);
    return { ok: true, reportId: updated.publicReportId, status: updated.status as IncidentStatus, deduplicated: true };
  }

  const encrypted = encryptReporterRef(actor.id);
  const created = await createReportRow({
    errorEventId: event.id,
    reporterPseudonym: pseudonym,
    encryptedReporterRef: encrypted.ciphertext,
    encryptedReporterIv: encrypted.iv,
    encryptedReporterTag: encrypted.tag,
    userNote: note,
    severity: deriveSeverity(build.category, 1),
    diagnosticFingerprint: build.fingerprint,
    firstSeenAt: now,
    lastSeenAt: now
  });

  await storeIdempotentReportId(pseudonym, input.idempotencyKey, created.publicReportId);
  return { ok: true, reportId: created.publicReportId, status: created.status as IncidentStatus, deduplicated: false };
}

type ReportRowInput = Omit<Prisma.IncidentReportUncheckedCreateInput, "publicReportId" | "status">;

async function createReportRow(data: ReportRowInput) {
  for (let attempt = 0; attempt < PUBLIC_ID_RETRIES; attempt += 1) {
    try {
      return await prisma.incidentReport.create({
        data: { ...data, publicReportId: newPublicReportId() }
      });
    } catch (error) {
      if (isUniqueViolation(error) && attempt < PUBLIC_ID_RETRIES - 1) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not allocate a unique report id.");
}

// ---------------------------------------------------------------------------
// Admin queries + workflow (DTOs OMIT all identity/PII + encrypted columns)
// ---------------------------------------------------------------------------

export type AdminIncidentListItem = {
  reportId: string;
  reporterPseudonym: string;
  feature: string;
  operation: string;
  category: string;
  severity: string;
  status: string;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  appVersion: string | null;
  createdAt: string;
};

export type AdminIncidentDetail = AdminIncidentListItem & {
  internalCode: string | null;
  httpStatus: number | null;
  correlationId: string | null;
  route: string | null;
  requestMethod: string | null;
  browserFamily: string | null;
  platform: string | null;
  onlineStatus: boolean | null;
  retryable: boolean;
  serverStackFingerprint: string | null;
  diagnosticFingerprint: string | null;
  sanitizedContext: Record<string, unknown> | null;
  userNote: string | null;
  adminNotes: string | null;
  occurredAt: string | null;
};

type ReportWithEvent = Prisma.IncidentReportGetPayload<{ include: { errorEvent: true } }>;

// The single mapping boundary. By construction it can only read safe columns —
// encryptedReporterRef / Iv / Tag are never referenced here, so they can never
// reach an admin response.
function toListItem(report: ReportWithEvent): AdminIncidentListItem {
  const event = report.errorEvent;
  return {
    reportId: report.publicReportId,
    reporterPseudonym: report.reporterPseudonym,
    feature: event?.feature ?? "Unknown",
    operation: event?.operation ?? "Unknown operation",
    category: event?.category ?? "UNKNOWN",
    severity: report.severity,
    status: report.status,
    occurrenceCount: report.occurrenceCount,
    firstSeenAt: report.firstSeenAt.toISOString(),
    lastSeenAt: report.lastSeenAt.toISOString(),
    appVersion: event?.appVersion ?? null,
    createdAt: report.createdAt.toISOString()
  };
}

function toDetail(report: ReportWithEvent): AdminIncidentDetail {
  const event = report.errorEvent;
  return {
    ...toListItem(report),
    internalCode: event?.internalCode ?? null,
    httpStatus: event?.httpStatus ?? null,
    correlationId: event?.correlationId ?? null,
    route: event?.route ?? null,
    requestMethod: event?.requestMethod ?? null,
    browserFamily: event?.browserFamily ?? null,
    platform: event?.platform ?? null,
    onlineStatus: event?.onlineStatus ?? null,
    retryable: event?.retryable ?? false,
    serverStackFingerprint: event?.serverStackFingerprint ?? null,
    diagnosticFingerprint: report.diagnosticFingerprint,
    sanitizedContext: (event?.sanitizedContext as Record<string, unknown> | null) ?? null,
    userNote: report.userNote,
    adminNotes: report.adminNotes,
    occurredAt: event?.occurredAt.toISOString() ?? null
  };
}

export type AdminIncidentFilter = {
  reportId?: string | null;
  reporterPseudonym?: string | null;
  feature?: string | null;
  category?: string | null;
  severity?: string | null;
  status?: string | null;
  from?: Date | null;
  to?: Date | null;
};

export const INCIDENT_PAGE_SIZE = 25;
const INCIDENT_MAX_PAGE_SIZE = 50;

export async function listAdminIncidents(filter: AdminIncidentFilter, cursor?: string | null, limit = INCIDENT_PAGE_SIZE) {
  const eventFilter: Prisma.AppErrorEventWhereInput = {};
  if (filter.feature) {
    eventFilter.feature = filter.feature;
  }
  if (filter.category) {
    eventFilter.category = filter.category;
  }

  const where: Prisma.IncidentReportWhereInput = {
    ...(filter.reportId ? { publicReportId: filter.reportId } : {}),
    ...(filter.reporterPseudonym ? { reporterPseudonym: filter.reporterPseudonym } : {}),
    ...(filter.severity ? { severity: filter.severity } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.from || filter.to
      ? { lastSeenAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } }
      : {}),
    ...(Object.keys(eventFilter).length ? { errorEvent: eventFilter } : {})
  };

  const take = Math.min(Math.max(limit, 1), INCIDENT_MAX_PAGE_SIZE);
  const rows = await prisma.incidentReport.findMany({
    where,
    include: { errorEvent: true },
    orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const totalCount = await prisma.incidentReport.count({ where });

  return {
    items: page.map(toListItem),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    totalCount
  };
}

export async function getAdminIncidentDetail(publicReportId: string): Promise<AdminIncidentDetail | null> {
  const report = await prisma.incidentReport.findUnique({
    where: { publicReportId },
    include: { errorEvent: true }
  });
  return report ? toDetail(report) : null;
}

export async function recordIncidentViewed(publicReportId: string, admin: Actor, request?: Request) {
  await recordAuditEvent({
    actor: { id: admin.id, email: admin.email },
    action: "incident.viewed",
    category: "ADMIN",
    severity: "INFO",
    target: { type: "incident", id: publicReportId, name: publicReportId },
    message: `Viewed incident ${publicReportId}.`,
    request
  });
}

export async function updateIncidentStatus(
  publicReportId: string,
  status: IncidentStatus,
  admin: Actor,
  request?: Request
): Promise<AdminIncidentDetail | null> {
  const report = await prisma.incidentReport.findUnique({ where: { publicReportId }, select: { id: true, status: true } });
  if (!report) {
    return null;
  }

  await prisma.incidentReport.update({ where: { id: report.id }, data: { status } });
  await recordAuditEvent({
    actor: { id: admin.id, email: admin.email },
    action: "incident.status_changed",
    category: "ADMIN",
    severity: "INFO",
    target: { type: "incident", id: publicReportId, name: publicReportId },
    message: `Changed incident ${publicReportId} status: ${report.status} -> ${status}.`,
    // Never include the encrypted reporter identity in audit metadata.
    metadata: { fromStatus: report.status, toStatus: status },
    request
  });

  return getAdminIncidentDetail(publicReportId);
}

export async function addIncidentAdminNote(
  publicReportId: string,
  note: string,
  admin: Actor,
  request?: Request
): Promise<AdminIncidentDetail | null> {
  const report = await prisma.incidentReport.findUnique({ where: { publicReportId }, select: { id: true, adminNotes: true } });
  if (!report) {
    return null;
  }

  const stamp = `[${new Date().toISOString()} ${admin.email}]`;
  const appended = report.adminNotes ? `${report.adminNotes}\n${stamp} ${note}` : `${stamp} ${note}`;

  await prisma.incidentReport.update({ where: { id: report.id }, data: { adminNotes: appended } });
  await recordAuditEvent({
    actor: { id: admin.id, email: admin.email },
    action: "incident.note_added",
    category: "ADMIN",
    severity: "INFO",
    target: { type: "incident", id: publicReportId, name: publicReportId },
    message: `Added an internal note to incident ${publicReportId}.`,
    request
  });

  return getAdminIncidentDetail(publicReportId);
}
