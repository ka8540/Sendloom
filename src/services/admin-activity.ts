import type { Prisma } from "@prisma/client";

import { sanitizeAuditMetadata, type AuditCategory, type AuditSeverity } from "@/lib/audit";
import { isAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const USER_SEARCH_LIMIT = 8;

export const ACTIVITY_PAGE_SIZE = 25;
const ACTIVITY_MAX_PAGE_SIZE = 50;

export type ActivityUserResult = {
  id: string;
  email: string;
  isAdmin: boolean;
  isRestricted: boolean;
  isLoggedIn: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  senderCount: number;
};

const RESTRICTION_FLAGS = [
  "apiAccessDisabled",
  "importsWriteDisabled",
  "templatesWriteDisabled",
  "launchesDisabled",
  "aiEnhancementsDisabled"
] as const;

type RestrictableUser = Record<(typeof RESTRICTION_FLAGS)[number], boolean>;

function isRestrictedUser(user: RestrictableUser) {
  return RESTRICTION_FLAGS.some((flag) => user[flag]);
}

/**
 * Search users by email (partial, case-insensitive) or exact user id. An empty
 * query returns the most recently active accounts so the admin panel has a
 * useful starting list.
 */
export async function searchActivityUsers(query: string): Promise<ActivityUserResult[]> {
  const trimmed = query.trim();
  const now = new Date();

  const users = await prisma.user.findMany({
    where: trimmed
      ? {
          OR: [{ email: { contains: trimmed, mode: "insensitive" } }, { id: trimmed }]
        }
      : undefined,
    orderBy: [{ lastSeenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: USER_SEARCH_LIMIT,
    select: {
      id: true,
      email: true,
      isAdmin: true,
      apiAccessDisabled: true,
      importsWriteDisabled: true,
      templatesWriteDisabled: true,
      launchesDisabled: true,
      aiEnhancementsDisabled: true,
      lastSeenAt: true,
      sessionExpiresAt: true,
      createdAt: true,
      _count: {
        select: {
          senderProfiles: true
        }
      }
    }
  });

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    isAdmin: isAdminUser(user),
    isRestricted: isRestrictedUser(user),
    isLoggedIn: Boolean(user.sessionExpiresAt && user.sessionExpiresAt > now),
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    senderCount: user._count.senderProfiles
  }));
}

function actorFilter(userId: string, email: string): Prisma.AuditLogWhereInput {
  // Legacy rows only carried actorEmail; new rows carry both. Match either so
  // pre-upgrade history still shows up for the same account.
  return {
    OR: [{ actorUserId: userId }, { actorEmail: email }]
  };
}

export async function getActivityUserSummary(userId: string) {
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      isAdmin: true,
      apiAccessDisabled: true,
      importsWriteDisabled: true,
      templatesWriteDisabled: true,
      launchesDisabled: true,
      aiEnhancementsDisabled: true,
      passwordHash: true,
      lastLoginAt: true,
      lastSeenAt: true,
      sessionExpiresAt: true,
      createdAt: true,
      _count: {
        select: {
          imports: true,
          mappings: true,
          templates: true,
          campaigns: true,
          senderProfiles: true,
          suppressions: true
        }
      }
    }
  });

  if (!user) {
    return null;
  }

  const eventScope = actorFilter(user.id, user.email);
  const [totalSends, failedSends, eventCount, firstEvent, lastEvent] = await Promise.all([
    prisma.sendLedger.count({ where: { userId: user.id } }),
    prisma.recipientJob.count({
      where: {
        status: "FAILED",
        campaignRun: {
          campaign: {
            userId: user.id
          }
        }
      }
    }),
    prisma.auditLog.count({ where: eventScope }),
    prisma.auditLog.findFirst({
      where: eventScope,
      orderBy: { createdAt: "asc" },
      select: { createdAt: true }
    }),
    prisma.auditLog.findFirst({
      where: eventScope,
      orderBy: { createdAt: "desc" },
      select: { createdAt: true }
    })
  ]);

  return {
    id: user.id,
    email: user.email,
    isAdmin: isAdminUser(user),
    isRestricted: isRestrictedUser(user),
    isLoggedIn: Boolean(user.sessionExpiresAt && user.sessionExpiresAt > now),
    authProvider: user.passwordHash ? "Password" : "Google",
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    counts: user._count,
    totalSends,
    failedSends,
    eventCount,
    firstEventAt: firstEvent?.createdAt.toISOString() ?? null,
    lastEventAt: lastEvent?.createdAt.toISOString() ?? null
  };
}

export type ActivityUserSummary = NonNullable<Awaited<ReturnType<typeof getActivityUserSummary>>>;

export type ActivityEventFilters = {
  userId: string;
  cursor?: string | null;
  category?: AuditCategory | null;
  severity?: AuditSeverity | null;
  targetType?: string | null;
  search?: string | null;
  from?: Date | null;
  to?: Date | null;
  limit?: number;
};

export type ActivityEvent = {
  id: string;
  action: string;
  category: string;
  severity: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  message: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

export async function listUserActivityEvents(filters: ActivityEventFilters) {
  const user = await prisma.user.findUnique({
    where: { id: filters.userId },
    select: { id: true, email: true }
  });

  if (!user) {
    return null;
  }

  const where: Prisma.AuditLogWhereInput = {
    ...actorFilter(user.id, user.email),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.targetType ? { entityType: filters.targetType } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {})
          }
        }
      : {})
  };

  if (filters.search?.trim()) {
    const term = filters.search.trim();
    where.AND = [
      {
        OR: [
          { action: { contains: term, mode: "insensitive" } },
          { message: { contains: term, mode: "insensitive" } },
          { targetName: { contains: term, mode: "insensitive" } }
        ]
      }
    ];
  }

  const limit = Math.min(Math.max(filters.limit ?? ACTIVITY_PAGE_SIZE, 1), ACTIVITY_MAX_PAGE_SIZE);

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {})
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const events: ActivityEvent[] = page.map((row) => ({
    id: row.id,
    action: row.action,
    category: row.category,
    severity: row.severity,
    targetType: row.entityType,
    targetId: row.entityId,
    targetName: row.targetName,
    message: row.message,
    // Sanitize on the way out too, so rows written before the sanitizer
    // existed can never leak credential-shaped metadata to the client.
    metadata: sanitizeAuditMetadata(row.metadata) ?? null,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString()
  }));

  return {
    events,
    nextCursor: hasMore ? page[page.length - 1].id : null
  };
}
