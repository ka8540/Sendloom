import { prisma } from "@/lib/db";
import { buildUtcSeries, type DailyCount } from "./daily-series";
import { normalizeAdminPage } from "./pagination";

export async function getSendingOperations(requestedPage = 1) {
  const dayAgo = new Date(Date.now() - 86_400_000);
  const now = new Date();
  const weekAgo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6),
  );
  const [
    confirmedSends,
    states,
    failedJobs,
    skippedJobs,
    connectedSenders,
    failureCount,
    senderIssues,
    sendTrend,
    runTrend,
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
    prisma.campaignRun.count({ where: { status: "FAILED" } }),
    prisma.senderProfile.count({
      where: {
        gmailWatchStatus: { in: ["RECONNECT_REQUIRED", "PERMISSION_REQUIRED"] },
      },
    }),
    prisma.$queryRaw<
      DailyCount[]
    >`SELECT date_trunc('day', "sentAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS count FROM "SendLedger" WHERE "sentAt" >= ${weekAgo} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<
      DailyCount[]
    >`SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS count FROM "CampaignRun" WHERE "createdAt" >= ${weekAgo} GROUP BY 1 ORDER BY 1`,
  ]);
  const page = normalizeAdminPage(requestedPage, failureCount, 10);
  const recentFailures = await prisma.campaignRun.findMany({
    where: { status: "FAILED" },
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * 10,
    take: 10,
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
  });
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
    failurePagination: { page, pageSize: 10, count: failureCount },
    trend: buildUtcSeries(7, { sends: sendTrend, runs: runTrend }, now),
    recentFailures: recentFailures.map((row) => ({
      id: row.id,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
      failedCount: row.failedCount,
      campaign: row.campaign,
    })),
  };
}

export async function getDiscoverOperations(requestedPage = 1) {
  const dayAgo = new Date(Date.now() - 86_400_000);
  const now = new Date();
  const weekAgo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6),
  );
  const [
    searches,
    allocations,
    expansions,
    reuse,
    external,
    failures,
    expansionStates,
    failureCount,
    providers,
    searchTrend,
    failureTrend,
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
    prisma.prospectSearch.count({ where: { status: "FAILED" } }),
    prisma.discoverProviderBatch.groupBy({
      by: ["provider"],
      _count: { _all: true },
      where: { createdAt: { gte: dayAgo } },
    }),
    prisma.$queryRaw<
      DailyCount[]
    >`SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS count FROM "ProspectSearch" WHERE "createdAt" >= ${weekAgo} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<
      DailyCount[]
    >`SELECT date_trunc('day', "updatedAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS count FROM "ProspectSearch" WHERE status = 'FAILED' AND "updatedAt" >= ${weekAgo} GROUP BY 1 ORDER BY 1`,
  ]);
  const page = normalizeAdminPage(requestedPage, failureCount, 10);
  const recentFailures = await prisma.prospectSearch.findMany({
    where: { status: "FAILED" },
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * 10,
    take: 10,
    select: { id: true, errorCode: true, updatedAt: true },
  });
  return {
    searches,
    allocations,
    expansions,
    reuse,
    external,
    failures,
    failurePagination: { page, pageSize: 10, count: failureCount },
    trend: buildUtcSeries(
      7,
      { searches: searchTrend, failures: failureTrend },
      now,
    ),
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
