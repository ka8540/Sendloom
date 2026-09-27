import type { AppNotificationItem } from "@/lib/notifications";

export type DiscoverCompletionToast = { title: string; message: string };

/**
 * Notifications this browser has not seen yet. The first page of a session
 * seeds `observedIds` and toasts nothing, so a reload never replays the inbox;
 * anything arriving later is genuinely new. Ids — not createdAt — are the
 * baseline, so client/server clock skew can never swallow a completion.
 */
export function selectNewNotifications(
  items: AppNotificationItem[],
  observedIds: ReadonlySet<string>
): AppNotificationItem[] {
  return items.filter((item) => !observedIds.has(item.id));
}

export function discoverCompletionToast(item: AppNotificationItem): DiscoverCompletionToast | null {
  if (item.type !== "DISCOVER_SEARCH_COMPLETED") return null;
  const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
    ? item.metadata as Record<string, unknown>
    : {};
  const company = typeof metadata.company === "string" && metadata.company.trim()
    ? metadata.company.trim()
    : null;

  if (metadata.kind === "DISCOVER_EXPANSION_COMPLETED") {
    const addedCount = typeof metadata.addedCount === "number" ? metadata.addedCount : 0;
    if (addedCount <= 0) return null;
    return {
      title: "More people are ready",
      message: company
        ? `${addedCount} new ${addedCount === 1 ? "person was" : "people were"} added to your ${company} search.`
        : item.message
    };
  }

  const resultCount = typeof metadata.resultCount === "number" ? metadata.resultCount : null;
  return {
    title: "Discover results ready",
    message: company && resultCount !== null
      ? `${company} is ready with ${resultCount} ${resultCount === 1 ? "person" : "people"}.`
      : item.message
  };
}

export function isDiscoverRefreshRoute(pathname: string): boolean {
  return pathname === "/workspace" || pathname === "/" || pathname === "/prospects" || pathname.startsWith("/prospects/");
}
