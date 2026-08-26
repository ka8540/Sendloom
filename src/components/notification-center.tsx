"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  Bell,
  CheckCheck,
  LoaderCircle,
  MailWarning,
  SendHorizontal,
  UserRoundSearch
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AppNotificationItem, AppNotificationPage } from "@/lib/notifications";
import { formatUnreadBadge, notificationNavigationHref } from "@/lib/notification-ui";

import styles from "./notification-center.module.css";

const NOTIFICATION_POLL_INTERVAL_MS = 45_000;

function notificationTime(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? "Recently" : formatDistanceToNow(date, { addSuffix: true });
}

function NotificationTypeIcon({ item }: { item: AppNotificationItem }) {
  if (item.type === "DISCOVER_SEARCH_COMPLETED") {
    return <UserRoundSearch aria-hidden="true" />;
  }
  if (item.type === "SEQUENCE_COMPLETED") {
    return <SendHorizontal aria-hidden="true" />;
  }
  return <MailWarning aria-hidden="true" />;
}

function mergeNotificationPages(current: AppNotificationItem[], incoming: AppNotificationItem[]) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}

export function NotificationCenter() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [activeNotificationId, setActiveNotificationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async (cursor: string | null = null) => {
    const append = Boolean(cursor);
    append ? setLoadingMore(true) : setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "15" });
      if (cursor) {
        params.set("cursor", cursor);
      }
      const response = await fetch(`/api/notifications?${params.toString()}`, {
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!response.ok) {
        throw new Error("Notifications could not be loaded.");
      }
      const page = (await response.json()) as AppNotificationPage;
      setItems((current) => (append ? mergeNotificationPages(current, page.items) : page.items));
      setUnreadCount(page.unreadCount);
      setNextCursor(page.nextCursor);
    } catch {
      setError("Notifications could not be loaded. Try again.");
    } finally {
      append ? setLoadingMore(false) : setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchNotifications();
    const interval = window.setInterval(() => void fetchNotifications(), NOTIFICATION_POLL_INTERVAL_MS);
    const refreshOnFocus = () => void fetchNotifications();
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [fetchNotifications]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void fetchNotifications();
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        bellRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [fetchNotifications, open]);

  const markOneRead = useCallback(
    async (item: AppNotificationItem) => {
      setActiveNotificationId(item.id);
      setError(null);
      try {
        const response = await fetch(`/api/notifications/${encodeURIComponent(item.id)}/read`, {
          method: "POST",
          credentials: "same-origin"
        });
        if (!response.ok) {
          throw new Error("Notification could not be marked as read.");
        }
        const readAt = item.readAt ?? new Date().toISOString();
        setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, readAt } : entry)));
        if (!item.readAt) {
          setUnreadCount((current) => Math.max(0, current - 1));
        }
        setOpen(false);
        const destination = notificationNavigationHref(item.href);
        if (destination) {
          router.push(destination as Route);
        }
      } catch {
        setError("That notification could not be opened. Try again.");
      } finally {
        setActiveNotificationId(null);
      }
    },
    [router]
  );

  const markAllRead = useCallback(async () => {
    setMarkingAll(true);
    setError(null);
    try {
      const response = await fetch("/api/notifications/read-all", {
        method: "POST",
        credentials: "same-origin"
      });
      if (!response.ok) {
        throw new Error("Notifications could not be marked as read.");
      }
      const readAt = new Date().toISOString();
      setItems((current) => current.map((item) => (item.readAt ? item : { ...item, readAt })));
      setUnreadCount(0);
    } catch {
      setError("Notifications could not be marked as read. Try again.");
    } finally {
      setMarkingAll(false);
    }
  }, []);

  const badge = formatUnreadBadge(unreadCount);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={bellRef}
        type="button"
        className={styles.bellButton}
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Notifications"
        onClick={() => setOpen((current) => !current)}
      >
        <Bell aria-hidden="true" />
        {badge ? (
          <span className={styles.badge} aria-label={`${unreadCount} unread notifications`}>
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <section className={styles.popover} role="dialog" aria-label="Notifications">
          <header className={styles.header}>
            <div>
              <h2>Notifications</h2>
              {unreadCount > 0 ? <p>{unreadCount} unread</p> : null}
            </div>
            <button
              type="button"
              className={styles.markAllButton}
              disabled={unreadCount === 0 || markingAll}
              onClick={() => void markAllRead()}
            >
              {markingAll ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : <CheckCheck aria-hidden="true" />}
              Mark all as read
            </button>
          </header>

          {error ? (
            <div className={styles.error} role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => void fetchNotifications()}>
                Retry
              </button>
            </div>
          ) : null}

          <div className={styles.list} aria-live="polite">
            {loading && items.length === 0 ? (
              <div className={styles.loadingState} role="status">
                <LoaderCircle className={styles.spinner} aria-hidden="true" />
                Loading notifications…
              </div>
            ) : items.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon} aria-hidden="true">
                  <Bell />
                </span>
                <strong>No notifications yet</strong>
                <p>Updates about Discover searches, sequences, and account connections will appear here.</p>
              </div>
            ) : (
              items.map((item) => {
                const unread = !item.readAt;
                const active = activeNotificationId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`${styles.row}${unread ? ` ${styles.unreadRow}` : ""}${
                      item.severity === "WARNING" ? ` ${styles.warningRow}` : ""
                    }`}
                    aria-label={`${unread ? "Unread notification: " : ""}${item.title}`}
                    disabled={active}
                    onClick={() => void markOneRead(item)}
                  >
                    <span className={styles.typeIcon} aria-hidden="true">
                      {active ? <LoaderCircle className={styles.spinner} /> : <NotificationTypeIcon item={item} />}
                    </span>
                    <span className={styles.rowContent}>
                      <span className={styles.rowHeading}>
                        <strong>{item.title}</strong>
                        <time dateTime={item.createdAt}>{notificationTime(item.createdAt)}</time>
                      </span>
                      <span className={styles.message}>{item.message}</span>
                      {item.resolvedAt ? <span className={styles.resolved}>Resolved</span> : null}
                    </span>
                    {unread ? (
                      <span className={styles.unreadDot} aria-hidden="true" />
                    ) : null}
                    {unread ? <span className={styles.srOnly}>Unread</span> : null}
                  </button>
                );
              })
            )}
          </div>

          {nextCursor ? (
            <footer className={styles.footer}>
              <button type="button" disabled={loadingMore} onClick={() => void fetchNotifications(nextCursor)}>
                {loadingMore ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : null}
                {loadingMore ? "Loading…" : "View more"}
              </button>
            </footer>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
