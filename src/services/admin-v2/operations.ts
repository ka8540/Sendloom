import { prisma } from "@/lib/db";

export async function getSendingOperations() {
  const dayAgo = new Date(Date.now() - 86_400_000);
  const [
    confirmedSends,
    states,
    failedJobs,
    skippedJobs,
    connectedSenders,
    recentFailures,
    senderIssues,
  ] = await Promise.all([
    prisma.sendLedger.count({ where: { sentAt: { gte: dayAgo } } }),
    prisma.campaignRun.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.recipientJob.count({
      where: { status: "FAILED", updatedAt: { gte: dayAgo } },
    }),
    prisma.recipientJob.count({
      where: {
        status: { in: ["SUPPRESSED", "INVALID"] },
        updatedAt: { gte: dayAgo },
      },
    }),
    prisma.senderProfile.count({ where: { oauthRefreshToken: { not: null } } }),
    prisma.campaignRun.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        updatedAt: true,
        failedCount: true,
        campaign: {
          select: {
            id: true,
            name: true,
            user: { select: { id: true, email: true } },
          },
        },
      },
    }),
    prisma.senderProfile.count({
      where: {
        OR: [
          { oauthRefreshToken: null },
          { gmailWatchStatus: "RECONNECT_REQUIRED" },
          { gmailWatchStatus: "PERMISSION_REQUIRED" },
        ],
      },
    }),
  ]);
  return {
    confirmedSends,
    states: states.map((row) => ({
      status: row.status,
      count: row._count._all,
    })),
    failedJobs,
    skippedJobs,
    connectedSenders,
    senderIssues,
    recentFailures: recentFailures.map((row) => ({
      id: row.id,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
      failedCount: row.failedCount,
      campaign: row.campaign,
    })),
  };
}

export async function getDiscoverOperations() {
  const dayAgo = new Date(Date.now() - 86_400_000);
  const [
    searches,
    allocations,
    expansions,
    reuse,
    external,
    failures,
    expansionStates,
    recentFailures,
    providers,
  ] = await Promise.all([
    prisma.prospectSearch.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.prospectSearchPerson.count({
      where: { allocatedAt: { gte: dayAgo } },
    }),
    prisma.discoverSearchExpansion.count({
      where: { createdAt: { gte: dayAgo } },
    }),
    prisma.prospectSearch.count({
      where: { createdAt: { gte: dayAgo }, resultSource: "CACHE" },
    }),
    prisma.prospectSearch.count({
      where: { createdAt: { gte: dayAgo }, resultSource: "PROVIDER" },
    }),
    prisma.prospectSearch.count({
      where: { createdAt: { gte: dayAgo }, status: "FAILED" },
    }),
    prisma.discoverSearchExpansion.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { status: { in: ["PENDING", "PROCESSING", "FAILED"] } },
    }),
    prisma.prospectSearch.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 15,
      select: { id: true, errorCode: true, updatedAt: true },
    }),
    prisma.discoverProviderBatch.groupBy({
      by: ["provider"],
      _count: { _all: true },
      where: { createdAt: { gte: dayAgo } },
    }),
  ]);
  return {
    searches,
    allocations,
    expansions,
    reuse,
    external,
    failures,
    expansionStates: expansionStates.map((row) => ({
      status: row.status,
      count: row._count._all,
    })),
    recentFailures: recentFailures.map((row) => ({
      ...row,
      updatedAt: row.updatedAt.toISOString(),
    })),
    providers: providers.map((row) => ({
      provider: row.provider,
      count: row._count._all,
    })),
  };
}
