import { prisma } from "@/lib/db";
import { getSystemHealth, type SystemHealthReport } from "@/lib/system-health";

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
  ]);
  const attention = deriveAttention({
    health,
    incidents,
    failedRuns,
    failedNotices,
    failedUpdates,
  });
  const runCount = (status: string) =>
    runStates.find((row) => row.status === status)?._count._all ?? 0;
  const noticeCount = (status: string) =>
    noticeStates.find((row) => row.status === status)?._count._all ?? 0;
  const updateCount = (status: string) =>
    updateStates.find((row) => row.status === status)?._count._all ?? 0;
  const pulse = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - 6 + offset,
      ),
    );
    const key = date.toISOString().slice(0, 10);
    return {
      date: key,
      users:
        newUsers.find((row) => row.day.toISOString().slice(0, 10) === key)
          ?.count ?? 0,
      sends:
        recentSends.find((row) => row.day.toISOString().slice(0, 10) === key)
          ?.count ?? 0,
    };
  });
  return {
    health,
    metrics: {
      totalUsers,
      activeUsers,
      confirmedSends,
      needsAttention: attention.length,
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
  };
}
