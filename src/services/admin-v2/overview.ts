import { prisma } from "@/lib/db";
import { getSystemHealth, type SystemHealthReport } from "@/lib/system-health";
import { buildUtcSeries, type DailyCount } from "./daily-series";

export type AttentionItem = {
  id: string;
  label: string;
  detail: string;
  href: string;
  tone: "warning" | "danger";
  at?: string;
};

export function deriveAttention(input: {
  health: SystemHealthReport;
  incidents: Array<{
    publicReportId: string;
    severity: string;
    lastSeenAt: Date;
  }>;
  failedRuns: number;
  failedNotices: number;
  failedUpdates: number;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const [name, check] of Object.entries(input.health.checks)) {
    if (check.status === "down" || check.status === "missing")
      items.push({
        id: `health-${name}`,
        label: `${name.replace(/([A-Z])/g, " $1")} ${check.status}`,
        detail: check.message,
        href: "/admin/operations",
        tone: check.status === "down" ? "danger" : "warning",
      });
  }
  for (const incident of input.incidents)
    items.push({
      id: incident.publicReportId,
      label: `${incident.severity.toLowerCase()} incident ${incident.publicReportId}`,
      detail: "Open report requires triage",
      href: "/admin/operations/incidents",
      tone: incident.severity === "CRITICAL" ? "danger" : "warning",
      at: incident.lastSeenAt.toISOString(),
    });
  if (input.failedRuns)
    items.push({
      id: "failed-runs",
      label: `${input.failedRuns} failed sequence run${input.failedRuns === 1 ? "" : "s"}`,
      detail: "Review sending operations",
      href: "/admin/operations/sending",
      tone: "warning",
    });
  if (input.failedNotices)
    items.push({
      id: "failed-notices",
      label: `${input.failedNotices} failed system notice${input.failedNotices === 1 ? "" : "s"}`,
      detail: "Review delivery status",
      href: "/admin/communications/system-notices",
      tone: "warning",
    });
  if (input.failedUpdates)
    items.push({
      id: "failed-updates",
      label: `${input.failedUpdates} failed product update${input.failedUpdates === 1 ? "" : "s"}`,
      detail: "Review delivery status",
      href: "/admin/communications/product-updates",
      tone: "warning",
    });
  return items.slice(0, 8);
}

export async function getAdminOverview() {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const [
    health,
    totalUsers,
    activeUsers,
    confirmedSends,
    incidents,
    attentionIncidentCount,
    openIncidents,
    failedRuns,
    failedNotices,
    failedUpdates,
    runStates,
    noticeStates,
    updateStates,
    recentAdminEvents,
    newUsers,
    recentSends,
    recentRuns,
    recentSearches,
    recentAccounts,
  ] = await Promise.all([
    getSystemHealth(),
    prisma.user.count(),
    prisma.user.count({
      where: { isAdmin: false, lastSeenAt: { gte: dayAgo } },
    }),
    prisma.sendLedger.count({ where: { sentAt: { gte: dayAgo } } }),
    prisma.incidentReport.findMany({
      where: {
        status: { in: ["NEW", "INVESTIGATING"] },
        severity: { in: ["HIGH", "CRITICAL"] },
      },
      orderBy: { lastSeenAt: "desc" },
      take: 4,
      select: { publicReportId: true, severity: true, lastSeenAt: true },
    }),
    prisma.incidentReport.count({
      where: {
        status: { in: ["NEW", "INVESTIGATING"] },
        severity: { in: ["HIGH", "CRITICAL"] },
      },
    }),
    prisma.incidentReport.count({
      where: { status: { in: ["NEW", "INVESTIGATING"] } },
    }),
    prisma.campaignRun.count({ where: { status: "FAILED" } }),
    prisma.systemNotice.count({ where: { status: "FAILED" } }),
    prisma.productUpdateBroadcast.count({ where: { status: "FAILED" } }),
    prisma.campaignRun.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: {
        status: { in: ["RUNNING", "QUEUED", "WAITING_FOR_SLOT", "PAUSED"] },
      },
    }),
    prisma.systemNotice.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { status: { in: ["SCHEDULED", "SENDING"] } },
    }),
    prisma.productUpdateBroadcast.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { status: { in: ["SCHEDULED", "SENDING"] } },
    }),
    prisma.auditLog.findMany({
      where: { category: "ADMIN" },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        action: true,
        message: true,
        createdAt: true,
        severity: true,
      },
    }),
    prisma.$queryRaw<
      Array<{ day: Date; count: number }>
    >`SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS count FROM "User" WHERE "isAdmin" = false AND "createdAt" >= ${weekAgo} GROUP BY 1`,
    prisma.$queryRaw<
      Array<{ day: Date; count: number }>
    >`SELECT date_trunc('day', "sentAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS count FROM "SendLedger" WHERE "sentAt" >= ${weekAgo} GROUP BY 1`,
    prisma.$queryRaw<
      DailyCount[]
    >`SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS count FROM "CampaignRun" WHERE "createdAt" >= ${weekAgo} GROUP BY 1`,
    prisma.$queryRaw<
      DailyCount[]
    >`SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS count FROM "ProspectSearch" WHERE "createdAt" >= ${weekAgo} GROUP BY 1`,
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, email: true, createdAt: true, lastSeenAt: true },
    }),
  ]);
  const attention = deriveAttention({
    health,
    incidents,
    failedRuns,
    failedNotices,
    failedUpdates,
  });
  const unhealthyChecks = Object.values(health.checks).filter(
    (check) => check.status === "down" || check.status === "missing",
  ).length;
  const runCount = (status: string) =>
    runStates.find((row) => row.status === status)?._count._all ?? 0;
  const noticeCount = (status: string) =>
    noticeStates.find((row) => row.status === status)?._count._all ?? 0;
  const updateCount = (status: string) =>
    updateStates.find((row) => row.status === status)?._count._all ?? 0;
  const pulse = buildUtcSeries(
    7,
    {
      users: newUsers,
      sends: recentSends,
      runs: recentRuns,
      searches: recentSearches,
    },
    now,
  );
  return {
    health,
    metrics: {
      totalUsers,
      activeUsers,
      confirmedSends,
      needsAttention:
        unhealthyChecks +
        attentionIncidentCount +
        Number(failedRuns > 0) +
        Number(failedNotices > 0) +
        Number(failedUpdates > 0),
    },
    attention,
    pulse,
    running: [
      { label: "Running sequences", value: runCount("RUNNING") },
      {
        label: "Waiting sequences",
        value: runCount("QUEUED") + runCount("WAITING_FOR_SLOT"),
      },
      { label: "Paused runs", value: runCount("PAUSED") },
      {
        label: "Scheduled communications",
        value: noticeCount("SCHEDULED") + updateCount("SCHEDULED"),
      },
      {
        label: "Delivering communications",
        value: noticeCount("SENDING") + updateCount("SENDING"),
      },
      { label: "Open incidents", value: openIncidents },
    ],
    recentAdminEvents: recentAdminEvents.map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    })),
    recentAccounts: recentAccounts.map((user) => ({
      id: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    })),
  };
}
