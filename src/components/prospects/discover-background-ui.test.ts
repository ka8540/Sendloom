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
const NOTIFICATIONS = readFileSync("src/components/notification-center.tsx", "utf8");

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
    expect(DETAIL).toContain("active: hasActiveSearch || Boolean(activeExpansion)");
  });

  it("polls the table silently so filters, tabs, and pagination survive", () => {
    expect(DETAIL).toContain(
      "loadDetail({ category: activeCategory, location: activeLocation, search: peopleQuery, silent: true })"
    );
    expect(LIST).toContain("active: hasActiveDiscoverWork");
    expect(LIST).toContain("loadSearches({ silent: true })");
    expect(LIST).not.toContain("router.refresh()");
    expect(DASHBOARD).toContain("<DiscoverLiveRefresh active={hasActiveDiscoverWork} />");
  });

  it("revalidates on focus and visibility through the existing toast system", () => {
    expect(POLLING).toContain('window.addEventListener("focus", onFocus)');
    expect(POLLING).toContain('document.addEventListener("visibilitychange", onVisibilityChange)');
    expect(POLLING).toContain('document.visibilityState === "visible"');
    expect(POLLING).toContain("loop.stop()");
    expect(POLLING).toContain('window.removeEventListener("focus", onFocus)');
    expect(NOTIFICATIONS).toContain("useErrorToast()");
    expect(NOTIFICATIONS).toContain("showSuccess(toast.message, { title: toast.title })");
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
