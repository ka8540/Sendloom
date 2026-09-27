import { describe, expect, it } from "vitest";

import {
  discoverCompletionToast,
  isDiscoverRefreshRoute,
  selectNewNotifications
} from "@/lib/discover-notification-live";
import type { AppNotificationItem } from "@/lib/notifications";

function notification(overrides: Partial<AppNotificationItem> = {}): AppNotificationItem {
  return {
    id: "notification_1",
    type: "DISCOVER_SEARCH_COMPLETED",
    severity: "SUCCESS",
    title: "Discover search completed",
    message: "Fallback",
    href: "/prospects/search_1",
    entityType: "ProspectSearch",
    entityId: "search_1",
    metadata: { company: "AT&T", resultCount: 10 },
    readAt: null,
    resolvedAt: null,
    createdAt: "2026-09-27T01:00:01.000Z",
    ...overrides
  };
}

describe("Discover live notification presentation", () => {
  it("uses the requested normal and expansion success copy", () => {
    expect(discoverCompletionToast(notification())).toEqual({
      title: "Discover results ready",
      message: "AT&T is ready with 10 people."
    });
    expect(discoverCompletionToast(notification({
      id: "expansion",
      metadata: { kind: "DISCOVER_EXPANSION_COMPLETED", company: "AT&T", addedCount: 1 }
    }))).toEqual({
      title: "More people are ready",
      message: "1 new person was added to your AT&T search."
    });
  });

  it("never emits expansion success copy for zero added people", () => {
    expect(discoverCompletionToast(notification({
      metadata: { kind: "DISCOVER_EXPANSION_COMPLETED", company: "AT&T", addedCount: 0 }
    }))).toBeNull();
  });

  it("baselines the session's first page and emits each later id at most once", () => {
    const observed = new Set(["old"]);
    const old = notification({ id: "old", createdAt: "2026-09-27T00:59:59.000Z" });
    const next = notification({ id: "next", createdAt: "2026-09-27T01:00:01.000Z" });
    expect(selectNewNotifications([next, old], observed).map((item) => item.id)).toEqual(["next"]);
    observed.add("next");
    expect(selectNewNotifications([next, old], observed)).toEqual([]);
    // A server clock behind the client's still surfaces the arrival.
    const skewed = notification({ id: "skewed", createdAt: "2020-01-01T00:00:00.000Z" });
    expect(selectNewNotifications([skewed], observed).map((item) => item.id)).toEqual(["skewed"]);
  });

  it("refreshes only Discover and dashboard routes", () => {
    expect(isDiscoverRefreshRoute("/prospects")).toBe(true);
    expect(isDiscoverRefreshRoute("/prospects/search_1")).toBe(true);
    expect(isDiscoverRefreshRoute("/workspace")).toBe(true);
    expect(isDiscoverRefreshRoute("/campaigns")).toBe(false);
  });
});
