import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildUtcSeries, type DailyCount } from "./daily-series";
import { normalizeAdminPage } from "./pagination";

export const ADMIN_USERS_PAGE_SIZE = 20;

export type UserStatusFilter = "all" | "active" | "attention" | "restricted";
export function normalizeUserStatus(value?: string): UserStatusFilter {
  return value === "active" || value === "attention" || value === "restricted"
    ? value
    : "all";
}
export function restrictedWhere(): Prisma.UserWhereInput {
  return {
    OR: [
      { restrictedAt: { not: null } },
      { apiAccessDisabled: true },
      { importsWriteDisabled: true },
      { templatesWriteDisabled: true },
      { launchesDisabled: true },
      { aiEnhancementsDisabled: true },
    ],
  };
}
export function userStatusWhere(
  status: UserStatusFilter,
  now = new Date(),
): Prisma.UserWhereInput {
  if (status === "active")
    return {
      isAdmin: false,
      lastSeenAt: { gte: new Date(now.getTime() - 86_400_000) },
    };
  if (status === "restricted") return restrictedWhere();
  if (status === "attention")
    return {
      OR: [
        { eligibilityBlockedAt: { not: null } },
        {
          senderProfiles: {
            some: {
              gmailWatchStatus: {
                in: ["RECONNECT_REQUIRED", "PERMISSION_REQUIRED"],
              },
            },
          },
        },
      ],
    };
  return {};
}
export async function listUsersWorkspace(input: {
  status: UserStatusFilter;
  query: string;
  page: number;
}) {
  const requestedPage = Math.max(
    1,
    Math.min(10000, Math.floor(input.page) || 1),
  );
  const query = input.query.trim().slice(0, 120);
  const where: Prisma.UserWhereInput = {
    AND: [
      { deletedAt: null },
      userStatusWhere(input.status),
      ...(query
        ? [
            {
              OR: [
                { email: { contains: query, mode: "insensitive" as const } },
                { id: query },
              ],
            },
          ]
        : []),
    ],
  };
  const [total, active, attention, restricted, count] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { AND: [{ deletedAt: null }, userStatusWhere("active")] } }),
    prisma.user.count({ where: { AND: [{ deletedAt: null }, userStatusWhere("attention")] } }),
    prisma.user.count({ where: { AND: [{ deletedAt: null }, userStatusWhere("restricted")] } }),
    prisma.user.count({ where }),
  ]);
  const page = normalizeAdminPage(requestedPage, count, ADMIN_USERS_PAGE_SIZE);
  const users = await prisma.user.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * ADMIN_USERS_PAGE_SIZE,
    take: ADMIN_USERS_PAGE_SIZE,
    select: {
      id: true,
      email: true,
      isAdmin: true,
      lastSeenAt: true,
      createdAt: true,
      restrictedAt: true,
      eligibilityBlockedAt: true,
      apiAccessDisabled: true,
      importsWriteDisabled: true,
      templatesWriteDisabled: true,
      launchesDisabled: true,
      aiEnhancementsDisabled: true,
      _count: {
        select: {
          campaigns: true,
          senderProfiles: true,
          prospectSearches: true,
        },
      },
    },
  });
  return {
    summary: { total, active, attention, restricted },
    count,
    page,
    pageSize: ADMIN_USERS_PAGE_SIZE,
    pages: Math.max(1, Math.ceil(count / ADMIN_USERS_PAGE_SIZE)),
    users: users.map((user) => ({
      ...user,
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      restrictedAt: user.restrictedAt?.toISOString() ?? null,
      eligibilityBlockedAt: user.eligibilityBlockedAt?.toISOString() ?? null,
    })),
  };
}
export async function getUserWorkspace(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      isAdmin: true,
      createdAt: true,
      lastLoginAt: true,
      lastSeenAt: true,
      sessionExpiresAt: true,
      adultVerifiedAt: true,
      termsAcceptedAt: true,
      privacyAcceptedAt: true,
      antiAbuseAcceptedAt: true,
      eligibilityBlockedAt: true,
      restrictedAt: true,
      restrictedReason: true,
      apiAccessDisabled: true,
      importsWriteDisabled: true,
      templatesWriteDisabled: true,
      launchesDisabled: true,
      aiEnhancementsDisabled: true,
      _count: {
        select: {
          campaigns: true,
          imports: true,
          templates: true,
          senderProfiles: true,
          prospectSearches: true,
        },
      },
    },
  });
  if (!user) return null;
  const [
    confirmedSends,
    replies,
    connectedSenders,
    activeRuns,
    pausedRuns,
    events,
  ] = await Promise.all([
    prisma.sendLedger.count({ where: { userId: id } }),
    prisma.inboundReply.count({
      where: { recipientJob: { campaignRun: { campaign: { userId: id } } } },
    }),
    prisma.senderProfile.count({
      where: { userId: id, oauthRefreshToken: { not: null } },
    }),
    prisma.campaignRun.count({
      where: { campaign: { userId: id }, status: "RUNNING" },
    }),
    prisma.campaignRun.count({
      where: { campaign: { userId: id }, status: "PAUSED" },
    }),
    prisma.auditLog.findMany({
      where: { OR: [{ actorUserId: id }, { actorEmail: user.email }] },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        action: true,
        category: true,
        severity: true,
        message: true,
        createdAt: true,
      },
    }),
  ]);
  return {
    ...user,
    confirmedSends,
    replies,
    connectedSenders,
    activeRuns,
    pausedRuns,
    events: events.map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function getUserUsageTrend(userId: string) {
  const now = new Date();
  const since = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29),
  );
  const [sends, runs, searches] = await Promise.all([
    prisma.$queryRaw<
      DailyCount[]
    >`SELECT date_trunc('day', "sentAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS count FROM "SendLedger" WHERE "userId" = ${userId} AND "sentAt" >= ${since} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<
      DailyCount[]
    >`SELECT date_trunc('day', r."createdAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS count FROM "CampaignRun" r JOIN "Campaign" c ON c.id = r."campaignId" WHERE c."userId" = ${userId} AND r."createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<
      DailyCount[]
    >`SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS count FROM "ProspectSearch" WHERE "userId" = ${userId} AND "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
  ]);
  return buildUtcSeries(30, { sends, runs, searches }, now);
}
