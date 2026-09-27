import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDiscoverPollLoop,
  DISCOVER_ACTIVE_POLL_INTERVAL_MS
} from "@/components/prospects/use-discover-live-polling";
import type { ProspectSearchStatus } from "@/components/prospects/prospect-graphql";
import { isActiveDiscoverExpansion, isActivelyProcessing } from "@/components/prospects/prospect-view";

const DETAIL = readFileSync("src/components/prospects/prospect-detail-view.tsx", "utf8");
const LIST = readFileSync("src/components/prospects/prospects-list-view.tsx", "utf8");
const POLLING = readFileSync("src/components/prospects/use-discover-live-polling.ts", "utf8");
const DASHBOARD = readFileSync("src/components/dashboard/overview-command-center.tsx", "utf8");
const DASHBOARD_LIVE = readFileSync("src/components/dashboard/discover-live-refresh.tsx", "utf8");
const NOTIFICATIONS = readFileSync("src/components/notification-center.tsx", "utf8");
const GRAPHQL = readFileSync("src/components/prospects/prospect-graphql.ts", "utf8");

/** Resolves pending microtasks so an awaited refresh settles under fake timers. */
async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await Promise.resolve();
  }
}

describe("Discover durable background UI wiring", () => {
  it("derives Add More loading and disabled state from the latest server expansion", () => {
    expect(DETAIL).toContain("search?.latestExpansion");
    expect(DETAIL).toContain("(entry) => isActiveDiscoverExpansion(entry.status)");
    expect(DETAIL).toContain("const addingMore = expanding || Boolean(activeExpansion)");
    expect(DETAIL).toContain("addMoreDisabledReason(quota, addingMore)");
    expect(DETAIL).toContain("addingMore ? ADD_MORE_LOADING_LABEL");
    // The click flag is immediate feedback only; the durable row decides.
    expect(DETAIL).toContain("active: activeLiveTargets.length > 0");
  });

  it("polls lightweight state while preserving rendered tables and local controls", () => {
    expect(GRAPHQL).toContain("query DiscoverSearchLiveState($id: ID!)");
    expect(GRAPHQL.slice(GRAPHQL.indexOf("query DiscoverSearchLiveState"), GRAPHQL.indexOf("export const COMPANY_DETAIL_QUERY")))
      .not.toMatch(/company\s*\{|people\s*\(|email|position/i);
    expect(DETAIL).toContain("DISCOVER_SEARCH_LIVE_STATE_QUERY");
    expect(DETAIL).toContain("refresh: syncDiscoverLiveState");
    expect(DETAIL).not.toContain("refresh: async () => {\n      await Promise.all([\n        loadDetail");
    expect(DETAIL).toContain("const pageIndex = peoplePageIndex");
    expect(DETAIL).toContain("peopleAfterCursors.current[pageIndex]");
    expect(LIST).toContain("refresh: syncActiveSearches");
    expect(LIST).toContain("mergeDiscoverLiveStatesIntoGroups");
    expect(LIST).not.toContain("router.refresh()");
    expect(DASHBOARD).toContain("<DiscoverLiveRefresh active={hasActiveDiscoverWork} items={activityItems} />");
    expect(DASHBOARD_LIVE).toContain('fetch("/api/discover/live-dashboard"');
    expect(DASHBOARD_LIVE).not.toContain("router.refresh()");
  });

  it("does not reload company or people on an active Add More polling tick", () => {
    const sync = DETAIL.slice(
      DETAIL.indexOf("const syncDiscoverLiveState"),
      DETAIL.indexOf("useDiscoverLivePolling({", DETAIL.indexOf("const syncDiscoverLiveState"))
    );
    expect(sync).toContain("DISCOVER_SEARCH_LIVE_STATE_QUERY");
    expect(sync).not.toContain("loadCompany(");
    expect(sync).not.toContain("loadPeople(");
    expect(sync).not.toContain("loadDetail(");
    expect(sync).not.toContain("resetPeopleState(");
  });

  it("runs the targeted completion reload once per terminal transition", () => {
    expect(DETAIL).toContain("completedLiveRefreshes.current.has(key)");
    expect(DETAIL).toContain("completedLiveRefreshes.current.add(key)");
    expect(DETAIL).toContain("if (refreshCompleted) await refreshCompletedData()");
    expect(DETAIL).toContain("const pageIndex = peoplePageIndex");
    expect(DETAIL).toContain("const after = peopleAfterCursors.current[pageIndex] ?? null");
  });

  it("commits the process mutation's durable status before clearing click feedback", () => {
    const processHandler = DETAIL.slice(DETAIL.indexOf("const handleProcess"), DETAIL.indexOf("const handleCancel"));
    expect(processHandler).toContain("isActivelyProcessing(search.status)");
    expect(processHandler.indexOf("setSearch((current)")).toBeLessThan(processHandler.lastIndexOf("setProcessing(false)"));
    expect(processHandler).not.toContain("await loadDetail({ category: activeCategory });\n  },");
  });

  it("updates active Search History rows in place without touching list controls", () => {
    const sync = LIST.slice(LIST.indexOf("const syncActiveSearches"), LIST.indexOf("useDiscoverLivePolling({"));
    expect(sync).toContain("mergeDiscoverLiveStatesIntoGroups");
    expect(sync).not.toContain("setHistoryQuery");
    expect(sync).not.toContain("setHistoryPageIndex");
    expect(sync).not.toContain("setSearchesLoading(true)");
  });

  it("revalidates on focus and visibility through the existing toast system", () => {
    expect(POLLING).toContain('window.addEventListener("focus", onFocus)');
    expect(POLLING).toContain('document.addEventListener("visibilitychange", onVisibilityChange)');
    expect(POLLING).toContain('document.visibilityState === "visible"');
    expect(POLLING).toContain("loop.stop()");
    expect(POLLING).toContain('window.removeEventListener("focus", onFocus)');
    expect(NOTIFICATIONS).toContain("useErrorToast()");
    expect(NOTIFICATIONS).toContain("showSuccess(toast.message, { title: toast.title })");
    expect(NOTIFICATIONS).toContain("dispatchDiscoverCompletedEvent(item)");
    expect(NOTIFICATIONS).not.toContain("router.refresh()");
    // Toasting never marks the bell read.
    expect(NOTIFICATIONS).toContain("/read`");
    expect(NOTIFICATIONS).not.toContain("showSuccess(toast.message, { title: toast.title });\n            void markOneRead");
  });
});

describe("active-work predicates decide when polling runs", () => {
  it("treats only real in-flight search statuses as active", () => {
    const active: ProspectSearchStatus[] = [
      "RESOLVING_COMPANY",
      "SEARCHING_PEOPLE",
      "CLASSIFYING_POSITIONS",
      "INFERRING_EMAIL_PATTERN"
    ];
    for (const status of active) {
      expect(isActivelyProcessing(status)).toBe(true);
    }
    for (const status of ["READY", "NO_RESULTS", "FAILED", "CANCELED", "DRAFT"] as ProspectSearchStatus[]) {
      expect(isActivelyProcessing(status)).toBe(false);
    }
  });

  it("treats only PENDING/PROCESSING expansions as active", () => {
    expect(isActiveDiscoverExpansion("PENDING")).toBe(true);
    expect(isActiveDiscoverExpansion("PROCESSING")).toBe(true);
    expect(isActiveDiscoverExpansion("READY")).toBe(false);
    expect(isActiveDiscoverExpansion("FAILED")).toBe(false);
    expect(isActiveDiscoverExpansion(null)).toBe(false);
    expect(isActiveDiscoverExpansion(undefined)).toBe(false);
  });
});

describe("createDiscoverPollLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules nothing while no work is active", async () => {
    const refresh = vi.fn();
    const loop = createDiscoverPollLoop({ isActive: () => false, refresh });
    await vi.advanceTimersByTimeAsync(DISCOVER_ACTIVE_POLL_INTERVAL_MS * 5);
    expect(refresh).not.toHaveBeenCalled();
    loop.stop();
  });

  it("polls every interval while work is active", async () => {
    const refresh = vi.fn();
    const loop = createDiscoverPollLoop({ isActive: () => true, refresh });
    await vi.advanceTimersByTimeAsync(DISCOVER_ACTIVE_POLL_INTERVAL_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(3);
    loop.stop();
  });

  it("stops as soon as the server reports terminal work", async () => {
    let active = true;
    const refresh = vi.fn();
    const loop = createDiscoverPollLoop({ isActive: () => active, refresh });
    await vi.advanceTimersByTimeAsync(DISCOVER_ACTIVE_POLL_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    active = false; // READY / NO_RESULTS / FAILED / CANCELED
    await vi.advanceTimersByTimeAsync(DISCOVER_ACTIVE_POLL_INTERVAL_MS * 4);
    expect(refresh).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it("never overlaps a slow refresh and does not double-schedule after a trigger", async () => {
    const pending: Array<() => void> = [];
    let started = 0;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          started += 1;
          pending.push(resolve);
        })
    );
    const loop = createDiscoverPollLoop({ isActive: () => true, refresh });

    await vi.advanceTimersByTimeAsync(DISCOVER_ACTIVE_POLL_INTERVAL_MS);
    expect(started).toBe(1);

    // Focus while the request is still in flight: swallowed, not stacked.
    loop.trigger();
    loop.trigger();
    await vi.advanceTimersByTimeAsync(DISCOVER_ACTIVE_POLL_INTERVAL_MS * 3);
    expect(started).toBe(1);

    pending.shift()?.();
    await flush();
    // Re-armed exactly once by the settled refresh — the two swallowed triggers
    // added no timers. The next attempt blocks on the new unresolved refresh.
    await vi.advanceTimersByTimeAsync(DISCOVER_ACTIVE_POLL_INTERVAL_MS * 3);
    expect(started).toBe(2);
    pending.shift()?.();
    loop.stop();
  });

  it("revalidates immediately on trigger", async () => {
    const refresh = vi.fn();
    const loop = createDiscoverPollLoop({ isActive: () => true, refresh });
    loop.trigger();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it("honours a custom interval and stops forever after stop()", async () => {
    const refresh = vi.fn();
    const loop = createDiscoverPollLoop({ isActive: () => true, refresh, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    loop.stop();
    loop.trigger();
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
