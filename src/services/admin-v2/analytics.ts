import { prisma } from "@/lib/db";

export type AdminRange = 7 | 30 | 90;
export function normalizeAdminRange(value: string | undefined): AdminRange {
  return value === "30" ? 30 : value === "90" ? 90 : 7;
}
export function safeRate(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : null;
}

export async function getAdminAnalytics(days: AdminRange) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [
    totalUsers,
    newUsers,
    activeUsers,
    eligibleUsers,
    connectedUsers,
    contactUsers,
    sequenceUsers,
    sendUsers,
    searches,
    allocations,
    expansions,
    templates,
    imports,
    campaigns,
    sends,
    replies,
    skipped,
    failedJobs,
    connectedSenders,
    failedSearches,
    providerBatches,
    discoverUsers,
    importUsers,
    templateUsers,
    campaignUsers,
    newUserTrend,
  ] = await Promise.all([
    prisma.user.count({ where: { isAdmin: false } }),
    prisma.user.count({ where: { isAdmin: false, createdAt: { gte: since } } }),
    prisma.user.count({
      where: { isAdmin: false, lastSeenAt: { gte: since } },
    }),
    prisma.user.count({
      where: {
        isAdmin: false,
        adultVerifiedAt: { not: null },
        termsAcceptedAt: { not: null },
        privacyAcceptedAt: { not: null },
        antiAbuseAcceptedAt: { not: null },
      },
    }),
    prisma.user.count({
      where: {
        isAdmin: false,
        senderProfiles: { some: { oauthRefreshToken: { not: null } } },
      },
    }),
    prisma.user.count({
      where: {
        isAdmin: false,
        OR: [{ imports: { some: {} } }, { prospectPeople: { some: {} } }],
      },
    }),
    prisma.user.count({ where: { isAdmin: false, campaigns: { some: {} } } }),
    prisma.$queryRaw<
      Array<{ count: number }>
    >`SELECT COUNT(DISTINCT u.id)::int AS count FROM "SendLedger" l JOIN "User" u ON u.id = l."userId" WHERE u."isAdmin" = false`,
    prisma.prospectSearch.count({
      where: { createdAt: { gte: since }, user: { isAdmin: false } },
    }),
    prisma.prospectSearchPerson.count({
      where: {
        allocatedAt: { gte: since },
        search: { user: { isAdmin: false } },
      },
    }),
    prisma.discoverSearchExpansion.count({
      where: {
        createdAt: { gte: since },
        search: { user: { isAdmin: false } },
      },
    }),
    prisma.template.count({
      where: { createdAt: { gte: since }, user: { isAdmin: false } },
    }),
    prisma.import.count({
      where: { createdAt: { gte: since }, user: { isAdmin: false } },
    }),
    prisma.campaignRun.count({
      where: {
        createdAt: { gte: since },
        campaign: { user: { isAdmin: false } },
      },
    }),
    prisma.$queryRaw<
      Array<{ count: number }>
    >`SELECT COUNT(*)::int AS count FROM "SendLedger" l JOIN "User" u ON u.id = l."userId" WHERE u."isAdmin" = false AND l."sentAt" >= ${since}`,
    prisma.inboundReply.count({
      where: {
        receivedAt: { gte: since },
        recipientJobId: { not: null },
        recipientJob: {
          campaignRun: { campaign: { user: { isAdmin: false } } },
        },
      },
    }),
    prisma.recipientJob.count({
      where: {
        updatedAt: { gte: since },
        status: { in: ["SUPPRESSED", "INVALID"] },
        campaignRun: { campaign: { user: { isAdmin: false } } },
      },
    }),
    prisma.recipientJob.count({
      where: {
        updatedAt: { gte: since },
        status: "FAILED",
        campaignRun: { campaign: { user: { isAdmin: false } } },
      },
    }),
    prisma.senderProfile.count({
      where: { oauthRefreshToken: { not: null }, user: { isAdmin: false } },
    }),
    prisma.prospectSearch.count({
      where: {
        createdAt: { gte: since },
        status: "FAILED",
        user: { isAdmin: false },
      },
    }),
    prisma.discoverProviderBatch.count({
      where: { createdAt: { gte: since } },
    }),
    prisma.user.count({
      where: {
        isAdmin: false,
        prospectSearches: { some: { createdAt: { gte: since } } },
      },
    }),
    prisma.user.count({
      where: {
        isAdmin: false,
        imports: { some: { createdAt: { gte: since } } },
      },
    }),
    prisma.user.count({
      where: {
        isAdmin: false,
        templates: { some: { createdAt: { gte: since } } },
      },
    }),
    prisma.user.count({
      where: {
        isAdmin: false,
        campaigns: { some: { runs: { some: { createdAt: { gte: since } } } } },
      },
    }),
    prisma.$queryRaw<
      Array<{ day: Date; count: number }>
    >`SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS count FROM "User" WHERE "isAdmin" = false AND "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
  ]);
  const trend = Array.from({ length: days }, (_, offset) => {
    const now = new Date();
    const day = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - days + offset + 1,
      ),
    )
      .toISOString()
      .slice(0, 10);
    return {
      day,
      count:
        newUserTrend.find((row) => row.day.toISOString().slice(0, 10) === day)
          ?.count ?? 0,
    };
  });
  return {
    days,
    totalUsers,
    newUsers,
    activeUsers,
    trend,
    funnel: [
      { label: "Signed up", value: totalUsers },
      { label: "Completed eligibility", value: eligibleUsers },
      { label: "Connected Gmail", value: connectedUsers },
      { label: "Created or imported contacts", value: contactUsers },
      { label: "Created first sequence", value: sequenceUsers },
      { label: "Sent confirmed email", value: sendUsers[0]?.count ?? 0 },
    ],
    adoption: [
      { label: "Discover searches", value: searches, users: discoverUsers },
      { label: "Imports", value: imports, users: importUsers },
      { label: "Templates", value: templates, users: templateUsers },
      { label: "Sequence runs", value: campaigns, users: campaignUsers },
    ],
    outreach: {
      sends: sends[0]?.count ?? 0,
      campaigns,
      replies,
      skipped,
      failedJobs,
      connectedSenders,
    },
    discover: {
      searches,
      allocations,
      expansions,
      failedSearches,
      providerBatches,
    },
  };
}
