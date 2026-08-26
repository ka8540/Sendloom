import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const CENTER = readFileSync("src/components/notification-center.tsx", "utf8");
const CSS = readFileSync("src/components/notification-center.module.css", "utf8");
const LAYOUT = readFileSync("src/app/(app)/layout.tsx", "utf8");
const NAV = readFileSync("src/components/nav.tsx", "utf8");

describe("authenticated notification center", () => {
  it("places the bell on the right of the existing toolbar without adding a sidebar product item", () => {
    const toolbar = LAYOUT.match(/<div className="content-toolbar">[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(toolbar.indexOf("<BackButton")).toBeLessThan(toolbar.indexOf("<NotificationCenter"));
    expect(CSS).toMatch(/\.root\s*\{[\s\S]*margin-left:\s*auto/);
    expect(NAV).not.toContain('label: "Notifications"');
  });

  it("has an accessible keyboard-operable bell and popover", () => {
    expect(CENTER).toContain('aria-label="Notifications"');
    expect(CENTER).toContain('aria-haspopup="dialog"');
    expect(CENTER).toContain('aria-expanded={open}');
    expect(CENTER).toContain('event.key === "Escape"');
    expect(CENTER).toContain('role="dialog"');
    expect(CENTER).toContain('aria-label={`Unread notification: ${item.title}`}');
  });

  it("does not mark notifications read merely by opening the popover", () => {
    const openEffect = CENTER.match(/useEffect\(\(\) => \{\n    if \(!open\)[\s\S]*?\n  \}, \[fetchNotifications, open\]\);/)?.[0] ?? "";
    expect(openEffect).toContain("fetchNotifications");
    expect(openEffect).not.toContain("read-all");
    expect(openEffect).not.toContain("markOneRead");
  });

  it("removes one item only after a successful read while preserving navigation", () => {
    const markOne = CENTER.match(/const markOneRead = useCallback\([\s\S]*?\n  \);/)?.[0] ?? "";
    expect(markOne).toContain('/api/notifications/${encodeURIComponent(item.id)}/read');
    expect(markOne.indexOf("if (!response.ok)")).toBeLessThan(
      markOne.indexOf("current.filter((entry) => entry.id !== item.id)")
    );
    expect(markOne).toContain("setUnreadCount((current) => Math.max(0, current - 1))");
    expect(markOne).toContain("setOpen(false)");
    expect(markOne).toContain("router.push(destination as Route)");
  });

  it("clears the active inbox and cursor only after mark-all succeeds", () => {
    const markAll = CENTER.match(/const markAllRead = useCallback\([\s\S]*?\n  }, \[\]\);/)?.[0] ?? "";
    expect(markAll).toContain('fetch("/api/notifications/read-all"');
    expect(markAll.indexOf("if (!response.ok)")).toBeLessThan(markAll.indexOf("setItems([])"));
    expect(markAll).toContain("setUnreadCount(0)");
    expect(markAll).toContain("setNextCursor(null)");
  });

  it("preserves focus refresh and polling with ten-item cursor pages", () => {
    expect(CENTER).toContain("NOTIFICATION_POLL_INTERVAL_MS = 45_000");
    expect(CENTER).toContain("NOTIFICATION_PAGE_SIZE = 10");
    expect(CENTER).toContain("limit: String(NOTIFICATION_PAGE_SIZE)");
    expect(CENTER).toContain('window.addEventListener("focus"');
    expect(CENTER).toContain("fetchNotifications(nextCursor)");
    expect(CENTER).toContain('"Load more"');
  });

  it("renders only active unread rows and the caught-up empty state", () => {
    expect(CENTER).toContain("You&apos;re all caught up");
    expect(CENTER).toContain("New updates about Discover searches");
    expect(CENTER).toContain("styles.unreadRow");
    expect(CENTER).toContain('item.severity === "WARNING"');
    expect(CENTER).not.toContain("styles.resolved");
  });

  it("bounds the popover and scrolls only the list body across themes and mobile viewports", () => {
    expect(CSS).toContain("var(--warning-soft)");
    expect(CSS).toContain("var(--accent-soft)");
    expect(CSS).toMatch(/width:\s*min\(25rem, calc\(100vw - 2rem\)\)/);
    expect(CSS).toMatch(/max-height:\s*min\(36rem, calc\(100dvh - 7rem\)\)/);
    expect(CSS).toMatch(/\.header\s*\{[\s\S]*?flex:\s*0 0 auto/);
    expect(CSS).toMatch(/\.list\s*\{[\s\S]*?flex:\s*1 1 auto[\s\S]*?min-height:\s*0[\s\S]*?overflow-y:\s*auto/);
    expect(CSS).toMatch(/\.footer\s*\{[\s\S]*?flex:\s*0 0 auto/);
    expect(CSS).toContain("scrollbar-gutter: stable");
    expect(CSS).toContain("@media (max-width: 640px)");
    expect(CSS).toContain("max-height: calc(100dvh - 5.5rem)");
  });
});
