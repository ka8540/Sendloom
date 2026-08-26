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
    expect(CENTER).toContain('aria-label={`${unread ? "Unread notification: " : ""}${item.title}`}');
  });

  it("does not mark notifications read merely by opening the popover", () => {
    const openEffect = CENTER.match(/useEffect\(\(\) => \{\n    if \(!open\)[\s\S]*?\n  \}, \[fetchNotifications, open\]\);/)?.[0] ?? "";
    expect(openEffect).toContain("fetchNotifications");
    expect(openEffect).not.toContain("read-all");
    expect(openEffect).not.toContain("markOneRead");
  });

  it("supports click-to-read, mark-all, focus refresh, polling, and cursor loading", () => {
    expect(CENTER).toContain("NOTIFICATION_POLL_INTERVAL_MS = 45_000");
    expect(CENTER).toContain('window.addEventListener("focus"');
    expect(CENTER).toContain('/api/notifications/${encodeURIComponent(item.id)}/read');
    expect(CENTER).toContain('fetch("/api/notifications/read-all"');
    expect(CENTER).toContain("fetchNotifications(nextCursor)");
    expect(CENTER).toContain("router.push(destination as Route)");
  });

  it("renders empty, unread, warning, resolved, loading, and responsive states with theme tokens", () => {
    expect(CENTER).toContain("No notifications yet");
    expect(CENTER).toContain("styles.unreadRow");
    expect(CENTER).toContain('item.severity === "WARNING"');
    expect(CENTER).toContain("styles.resolved");
    expect(CSS).toContain("var(--warning-soft)");
    expect(CSS).toContain("var(--accent-soft)");
    expect(CSS).toMatch(/width:\s*min\(25rem, calc\(100vw - 2rem\)\)/);
    expect(CSS).toContain("@media (max-width: 640px)");
  });
});
