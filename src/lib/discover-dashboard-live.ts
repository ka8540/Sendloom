import { buildActivityItems } from "@/components/dashboard/activity-builder";
import type { ActivityItem } from "@/components/dashboard/types";
import { prisma } from "@/lib/db";

export type DiscoverDashboardLiveSnapshot = {
  active: boolean;
  items: ActivityItem[];
};

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * The dashboard's narrow Discover-only read model. It deliberately excludes
 * campaigns, imports, templates, Gmail, people rows, evidence, and providers.
 */
export async function getDiscoverDashboardLiveSnapshot(userId: string): Promise<DiscoverDashboardLiveSnapshot> {
  const [searches, expansions, activeSearchCount, activeExpansionCount] = await Promise.all([
    prisma.prospectSearch.findMany({
      where: { userId },
      take: 6,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        requestedCompany: true,
        status: true,
        totalProcessed: true,
        requestedTitles: true,
        requestedLocations: true,
        updatedAt: true,
        company: { select: { _count: { select: { positions: true } } } }
      }
    }),
    prisma.discoverSearchExpansion.findMany({
      where: { userId, status: "READY", addedCount: { gt: 0 } },
      take: 4,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        addedCount: true,
        searchId: true,
        updatedAt: true,
        search: { select: { requestedCompany: true } }
      }
    }),
    prisma.prospectSearch.count({
      where: {
        userId,
        status: { in: ["RESOLVING_COMPANY", "SEARCHING_PEOPLE", "CLASSIFYING_POSITIONS", "INFERRING_EMAIL_PATTERN"] }
      }
    }),
    prisma.discoverSearchExpansion.count({
      where: { userId, status: { in: ["PENDING", "PROCESSING"] } }
    })
  ]);

  return {
    active: activeSearchCount > 0 || activeExpansionCount > 0,
    items: buildActivityItems({
      recentRuns: [],
      recentImports: [],
      recentTemplates: [],
      recentProspectSearches: searches.map((row) => ({
        id: row.id,
        company: row.requestedCompany,
        status: row.status,
        peopleCount: row.totalProcessed,
        roleGroupCount: row.company?._count.positions ?? 0,
        titles: stringList(row.requestedTitles),
        locations: stringList(row.requestedLocations),
        updatedAt: row.updatedAt
      })),
      recentDiscoverExpansions: expansions.map((row) => ({
        id: row.id,
        company: row.search.requestedCompany,
        searchId: row.searchId,
        addedCount: row.addedCount,
        updatedAt: row.updatedAt
      }))
    })
  };
}
