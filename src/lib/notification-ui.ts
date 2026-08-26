import { isSafeInternalNotificationHref } from "@/lib/notification-links";

export function formatUnreadBadge(unreadCount: number): string | null {
  if (unreadCount <= 0) {
    return null;
  }
  return unreadCount >= 100 ? "99+" : String(unreadCount);
}

export function notificationNavigationHref(href: string | null): string | null {
  return href && isSafeInternalNotificationHref(href) ? href : null;
}
