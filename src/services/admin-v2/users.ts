import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

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
  const page = Math.max(1, Math.min(10000, Math.floor(input.page) || 1));
  const query = input.query.trim().slice(0, 120);
  const where: Prisma.UserWhereInput = {
    AND: [
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
  const [total, active, attention, restricted, count, users] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: userStatusWhere("active") }),
      prisma.user.count({ where: userStatusWhere("attention") }),
      prisma.user.count({ where: userStatusWhere("restricted") }),
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * 25,
        take: 25,
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
      }),
    ]);
  return {
    summary: { total, active, attention, restricted },
    count,
    page,
    pages: Math.max(1, Math.ceil(count / 25)),
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
  const [confirmedSends, replies, events] = await Promise.all([
    prisma.sendLedger.count({ where: { userId: id } }),
    prisma.inboundReply.count({
      where: { recipientJob: { campaignRun: { campaign: { userId: id } } } },
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
    events: events.map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}
