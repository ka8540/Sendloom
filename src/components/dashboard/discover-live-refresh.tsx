"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActivityFeed } from "@/components/dashboard/activity-feed";
import type { ActivityItem } from "@/components/dashboard/types";
import { useDiscoverLivePolling } from "@/components/prospects/use-discover-live-polling";
import {
  DISCOVER_COMPLETED_EVENT,
  type DiscoverCompletedEventDetail
} from "@/lib/discover-notification-live";
import type { DiscoverDashboardLiveSnapshot } from "@/lib/discover-dashboard-live";

/**
 * A small client island for Recent activity. Only its Discover rows are polled;
 * the server-rendered Overview, sequences, imports, templates, and Gmail data
 * never remount because a Discover job is running.
 */
export function DiscoverLiveRefresh({
  active,
  items
}: {
  active: boolean;
  items: ActivityItem[];
}) {
  const stableItems = useMemo(() => items.filter((item) => item.kind !== "discover"), [items]);
  const [discoverItems, setDiscoverItems] = useState(() => items.filter((item) => item.kind === "discover"));
  const [activeWork, setActiveWork] = useState(active);
  const requestInFlight = useRef(false);

  const syncDiscoverActivity = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      const response = await fetch("/api/discover/live-dashboard", {
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!response.ok) return;
      const snapshot = (await response.json()) as DiscoverDashboardLiveSnapshot;
      setDiscoverItems(snapshot.items);
      setActiveWork(snapshot.active);
    } finally {
      requestInFlight.current = false;
    }
  }, []);

  useDiscoverLivePolling({ active: activeWork, refresh: syncDiscoverActivity });

  useEffect(() => {
    const onDiscoverCompleted = (_event: CustomEvent<DiscoverCompletedEventDetail>) => {
      void syncDiscoverActivity();
    };
    window.addEventListener(DISCOVER_COMPLETED_EVENT, onDiscoverCompleted as EventListener);
    return () => window.removeEventListener(DISCOVER_COMPLETED_EVENT, onDiscoverCompleted as EventListener);
  }, [syncDiscoverActivity]);

  const mergedItems = useMemo(
    () =>
      [...stableItems, ...discoverItems]
        .sort((left, right) => new Date(right.timeValue).getTime() - new Date(left.timeValue).getTime())
        .slice(0, 7),
    [discoverItems, stableItems]
  );

  return <ActivityFeed items={mergedItems} />;
}
