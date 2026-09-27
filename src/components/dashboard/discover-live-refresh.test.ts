import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const ISLAND = readFileSync("src/components/dashboard/discover-live-refresh.tsx", "utf8");
const SNAPSHOT = readFileSync("src/lib/discover-dashboard-live.ts", "utf8");
const ROUTE = readFileSync("src/app/api/discover/live-dashboard/route.ts", "utf8");

describe("dashboard Discover live island", () => {
  it("updates only Recent activity and never refreshes the route", () => {
    expect(ISLAND).toContain("<ActivityFeed items={mergedItems} />");
    expect(ISLAND).toContain('fetch("/api/discover/live-dashboard"');
    expect(ISLAND).toContain("setDiscoverItems(snapshot.items)");
    expect(ISLAND).not.toContain("useRouter");
    expect(ISLAND).not.toContain("router.refresh()");
  });

  it("polls without overlap and stops when the Discover snapshot becomes idle", () => {
    expect(ISLAND).toContain("if (requestInFlight.current) return");
    expect(ISLAND).toContain("setActiveWork(snapshot.active)");
    expect(ISLAND).toContain("active: activeWork");
  });

  it("reacts to completion events with one targeted Discover sync", () => {
    expect(ISLAND).toContain("DISCOVER_COMPLETED_EVENT");
    expect(ISLAND).toContain("void syncDiscoverActivity()");
    expect(ISLAND).toContain("removeEventListener");
  });

  it("the authenticated endpoint reads only Discover activity state", () => {
    expect(ROUTE).toContain("requireApiUser()");
    expect(ROUTE).toContain("getDiscoverDashboardLiveSnapshot(auth.user.id)");
    expect(SNAPSHOT).toContain("prisma.prospectSearch.findMany");
    expect(SNAPSHOT).toContain("prisma.discoverSearchExpansion.findMany");
    expect(SNAPSHOT).not.toMatch(/prisma\.(campaign|import|template|senderProfile)/);
  });
});
