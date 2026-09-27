"use client";

import { useEffect, useRef } from "react";

export const DISCOVER_ACTIVE_POLL_INTERVAL_MS = 3_000;

export type DiscoverPollLoop = {
  /** Revalidate now (window focus / visibilitychange). Never overlaps. */
  trigger: () => void;
  /** Cancel the pending timer and ignore every later callback. */
  stop: () => void;
};

/**
 * One non-overlapping revalidation loop over durable Discover state.
 *
 * A recursive timeout re-arms only after the previous refresh settles and only
 * while `isActive()` reports real server-side work, so an idle page schedules
 * nothing and a slow request is never stacked on top of itself. DOM-free so the
 * cadence is testable with fake timers.
 */
export function createDiscoverPollLoop(args: {
  isActive: () => boolean;
  refresh: () => Promise<void> | void;
  intervalMs?: number;
}): DiscoverPollLoop {
  const intervalMs = args.intervalMs ?? DISCOVER_ACTIVE_POLL_INTERVAL_MS;
  let stopped = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const arm = () => {
    clear();
    if (stopped || !args.isActive()) return;
    timer = setTimeout(() => {
      // Work can finish between arming and firing (a sibling tab, a focus
      // refresh). Never spend a request on an idle page.
      if (stopped || !args.isActive()) return;
      void run();
    }, intervalMs);
  };

  async function run() {
    if (stopped || inFlight) return;
    clear();
    inFlight = true;
    try {
      await args.refresh();
    } finally {
      inFlight = false;
      arm();
    }
  }

  arm();

  return {
    trigger: () => void run(),
    stop: () => {
      stopped = true;
      clear();
    }
  };
}

/**
 * Poll only while durable Discover work is active. Focus/visibility always
 * revalidate once, which lets an already-open second tab discover work another
 * tab started and a returning user see finished results without F5.
 */
export function useDiscoverLivePolling(args: {
  active: boolean;
  refresh: () => Promise<void> | void;
  intervalMs?: number;
}) {
  const latest = useRef(args);
  latest.current = args;

  useEffect(() => {
    const loop = createDiscoverPollLoop({
      isActive: () => latest.current.active,
      refresh: () => latest.current.refresh(),
      intervalMs: args.intervalMs
    });
    const onFocus = () => loop.trigger();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") loop.trigger();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      loop.stop();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [args.active, args.intervalMs]);
}
