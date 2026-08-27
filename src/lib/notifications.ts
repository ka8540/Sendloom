import { randomUUID } from "node:crypto";

import {
  AppNotificationSeverity,
  AppNotificationType,
  Prisma,
  type AppNotification,
  type PrismaClient
} from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  discoverNotificationHref,
  GMAIL_NOTIFICATION_HREF,
  isSafeInternalNotificationHref,
  sequenceNotificationHref
} from "@/lib/notification-links";

type NotificationDatabase = Pick<
  PrismaClient,
  "appNotification" | "prospectSearch" | "prospectSearchPerson" | "campaignRun" | "senderProfile"
>;

type NotificationWriteInput = {
  userId: string;
  type: AppNotificationType;
  severity: AppNotificationSeverity;
  title: string;
  message: string;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  dedupeKey: string;
  metadata?: Prisma.InputJsonValue | null;
};

export type AppNotificationItem = {
  id: string;
  type: AppNotificationType;
  severity: AppNotificationSeverity;
  title: string;
  message: string;
  href: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Prisma.JsonValue | null;
  readAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type AppNotificationPage = {
  items: AppNotificationItem[];
  unreadCount: number;
  nextCursor: string | null;
};

type NotificationCursor = {
  createdAt: string;
  id: string;
};

const TITLE_MAX_LENGTH = 100;
const MESSAGE_MAX_LENGTH = 280;
const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 50;
const GMAIL_ENTITY_TYPE = "SenderProfile";

export class InvalidNotificationCursorError extends Error {
  constructor() {
    super("Invalid notification cursor.");
    this.name = "InvalidNotificationCursorError";
  }
}

function boundedPlainText(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    ? error.code === "P2002"
    : Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

function serializeNotification(notification: AppNotification): AppNotificationItem {
  return {
    id: notification.id,
    type: notification.type,
    severity: notification.severity,
    title: notification.title,
    message: notification.message,
    href: notification.href,
    entityType: notification.entityType,
    entityId: notification.entityId,
    metadata: notification.metadata,
    readAt: notification.readAt?.toISOString() ?? null,
    resolvedAt: notification.resolvedAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString()
  };
}

function encodeNotificationCursor(notification: Pick<AppNotification, "createdAt" | "id">): string {
  const cursor: NotificationCursor = {
    createdAt: notification.createdAt.toISOString(),
    id: notification.id
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeNotificationCursor(value: string): { createdAt: Date; id: string } {
  try {
    if (value.length > 512) {
      throw new InvalidNotificationCursorError();
    }
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<NotificationCursor>;
    const createdAt = typeof parsed.createdAt === "string" ? new Date(parsed.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime()) || typeof parsed.id !== "string" || !parsed.id) {
      throw new InvalidNotificationCursorError();
    }
    return { createdAt, id: parsed.id };
  } catch (error) {
    if (error instanceof InvalidNotificationCursorError) {
      throw error;
    }
    throw new InvalidNotificationCursorError();
  }
}

export async function runNotificationSideEffect(operation: string, action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error("[notifications] In-app notification side effect failed.", {
      operation,
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown"
    });
  }
}

export async function createNotificationOnce(
  input: NotificationWriteInput,
  db: NotificationDatabase = prisma
): Promise<AppNotification> {
  if (input.href && !isSafeInternalNotificationHref(input.href)) {
    throw new Error("Unsafe notification destination.");
  }

  return db.appNotification.upsert({
    where: {
      userId_dedupeKey: {
        userId: input.userId,
        dedupeKey: input.dedupeKey
      }
    },
    create: {
      userId: input.userId,
      type: input.type,
      severity: input.severity,
      title: boundedPlainText(input.title, TITLE_MAX_LENGTH),
      message: boundedPlainText(input.message, MESSAGE_MAX_LENGTH),
      href: input.href ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      dedupeKey: input.dedupeKey,
      metadata: input.metadata ?? Prisma.JsonNull
    },
    update: {}
  });
}

export async function createDiscoverSearchCompletedNotification(
  searchId: string,
  db: NotificationDatabase = prisma
): Promise<AppNotification | null> {
  const search = await db.prospectSearch.findUnique({
    where: { id: searchId },
    select: {
      id: true,
      userId: true,
      requestedCompany: true,
      status: true
    }
  });

  if (!search || search.status !== "READY") {
    return null;
  }

  const resultCount = await db.prospectSearchPerson.count({
    where: { searchId: search.id, userId: search.userId }
  });
  const company = boundedPlainText(search.requestedCompany, 100) || "your company search";

  return createNotificationOnce(
    {
      userId: search.userId,
      type: AppNotificationType.DISCOVER_SEARCH_COMPLETED,
      severity: AppNotificationSeverity.SUCCESS,
      title: "Discover search completed",
      message: `Your search for ${company} is ready with ${resultCount} ${resultCount === 1 ? "person" : "people"}.`,
      href: discoverNotificationHref(search.id),
      entityType: "ProspectSearch",
      entityId: search.id,
      dedupeKey: `discover-search-completed:${search.id}`,
      metadata: {
        searchId: search.id,
        resultCount
      }
    },
    db
  );
}

export async function createSequenceCompletedNotification(
  campaignRunId: string,
  db: NotificationDatabase = prisma
): Promise<AppNotification | null> {
  const run = await db.campaignRun.findUnique({
    where: { id: campaignRunId },
    select: {
      id: true,
      status: true,
      sentCount: true,
      failedCount: true,
      suppressedCount: true,
      campaign: {
        select: {
          id: true,
          name: true,
          userId: true
        }
      }
    }
  });

  if (!run || run.status !== "COMPLETED" || !run.campaign.userId) {
    return null;
  }

  const name = boundedPlainText(run.campaign.name, 100) || "Your sequence";
  const exceptions = [
    run.failedCount > 0 ? `${run.failedCount} failed` : null,
    run.suppressedCount > 0 ? `${run.suppressedCount} suppressed` : null
  ].filter((part): part is string => Boolean(part));
  const message = exceptions.length
    ? `“${name}” finished — ${run.sentCount} sent, ${exceptions.join(", ")}.`
    : `“${name}” has finished. ${run.sentCount} sent successfully.`;

  return createNotificationOnce(
    {
      userId: run.campaign.userId,
      type: AppNotificationType.SEQUENCE_COMPLETED,
      severity: AppNotificationSeverity.SUCCESS,
      title: "Sequence completed",
      message,
      href: sequenceNotificationHref(run.campaign.id),
      entityType: "CampaignRun",
      entityId: run.id,
      dedupeKey: `sequence-completed:${run.id}`,
      metadata: {
        campaignId: run.campaign.id,
        campaignRunId: run.id,
        sentCount: run.sentCount,
        failedCount: run.failedCount,
        suppressedCount: run.suppressedCount
      }
    },
    db
  );
}

async function findActiveGmailWarning(userId: string, senderProfileId: string, db: NotificationDatabase) {
  return db.appNotification.findFirst({
    where: {
      userId,
      type: AppNotificationType.GMAIL_RECONNECT_REQUIRED,
      entityType: GMAIL_ENTITY_TYPE,
      entityId: senderProfileId,
      resolvedAt: null
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });
}

export async function resolveGmailReconnectNotification(
  senderProfileId: string,
  db: NotificationDatabase = prisma
): Promise<number> {
  const sender = await db.senderProfile.findUnique({
    where: { id: senderProfileId },
    select: { id: true, userId: true }
  });
  if (!sender?.userId) {
    return 0;
  }
  const result = await db.appNotification.updateMany({
    where: {
      userId: sender.userId,
      type: AppNotificationType.GMAIL_RECONNECT_REQUIRED,
      entityType: GMAIL_ENTITY_TYPE,
      entityId: sender.id,
      resolvedAt: null
    },
    data: { resolvedAt: new Date() }
  });
  return result.count;
}

export async function syncGmailReconnectNotification(
  senderProfileId: string,
  db: NotificationDatabase = prisma
): Promise<AppNotification | null> {
  const sender = await db.senderProfile.findUnique({
    where: { id: senderProfileId },
    select: {
      id: true,
      userId: true,
      fromEmail: true,
      oauthRefreshToken: true,
      gmailWatchStatus: true
    }
  });

  if (!sender?.userId) {
    return null;
  }

  const actionable =
    !sender.oauthRefreshToken ||
    sender.gmailWatchStatus === "RECONNECT_REQUIRED" ||
    sender.gmailWatchStatus === "PERMISSION_REQUIRED";

  if (!actionable) {
    if (sender.gmailWatchStatus === "ACTIVE") {
      await resolveGmailReconnectNotification(sender.id, db);
    }
    return null;
  }

  const active = await findActiveGmailWarning(sender.userId, sender.id, db);
  if (active) {
    return active;
  }

  const senderEmail = boundedPlainText(sender.fromEmail, 160);
  try {
    return await db.appNotification.create({
      data: {
        userId: sender.userId,
        type: AppNotificationType.GMAIL_RECONNECT_REQUIRED,
        severity: AppNotificationSeverity.WARNING,
        title: "Reconnect Gmail",
        message: boundedPlainText(
          `Sendloom is having trouble accessing ${senderEmail}. Reconnect Gmail to keep sequences and reply tracking working correctly.`,
          MESSAGE_MAX_LENGTH
        ),
        href: GMAIL_NOTIFICATION_HREF,
        entityType: GMAIL_ENTITY_TYPE,
        entityId: sender.id,
        dedupeKey: `gmail-reconnect-required:${sender.id}:${randomUUID()}`,
        metadata: {
          senderProfileId: sender.id,
          senderEmail
        }
      }
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    return findActiveGmailWarning(sender.userId, sender.id, db);
  }
}

export async function listNotificationsForUser(
  userId: string,
  input: { limit?: number; cursor?: string | null } = {},
  db: NotificationDatabase = prisma
): Promise<AppNotificationPage> {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
  const cursor = input.cursor ? decodeNotificationCursor(input.cursor) : null;
  const activeInboxWhere: Prisma.AppNotificationWhereInput = {
    userId,
    readAt: null,
    resolvedAt: null
  };
  const cursorWhere: Prisma.AppNotificationWhereInput | undefined = cursor
    ? {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } }
        ]
      }
    : undefined;

  const [rows, unreadCount] = await Promise.all([
    db.appNotification.findMany({
      where: {
        ...activeInboxWhere,
        ...(cursorWhere ?? {})
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1
    }),
    db.appNotification.count({ where: activeInboxWhere })
  ]);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: pageRows.map(serializeNotification),
    unreadCount,
    nextCursor: hasMore && pageRows.length > 0 ? encodeNotificationCursor(pageRows[pageRows.length - 1]) : null
  };
}

export async function markNotificationRead(
  userId: string,
  notificationId: string,
  db: NotificationDatabase = prisma
): Promise<boolean> {
  const updated = await db.appNotification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() }
  });
  if (updated.count > 0) {
    return true;
  }
  const existing = await db.appNotification.findFirst({
    where: { id: notificationId, userId },
    select: { id: true }
  });
  return Boolean(existing);
}

export async function markAllNotificationsRead(
  userId: string,
  db: NotificationDatabase = prisma
): Promise<number> {
  const updated = await db.appNotification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() }
  });
  return updated.count;
}
