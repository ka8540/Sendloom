import { describe, expect, it } from "vitest";

import { isSafeInternalNotificationHref } from "@/lib/notification-links";
import { formatUnreadBadge, notificationNavigationHref } from "@/lib/notification-ui";

describe("notification UI helpers", () => {
  it("hides zero, shows exact counts, and caps the badge at 99+", () => {
    expect(formatUnreadBadge(0)).toBeNull();
    expect(formatUnreadBadge(7)).toBe("7");
    expect(formatUnreadBadge(99)).toBe("99");
    expect(formatUnreadBadge(100)).toBe("99+");
  });

  it("allows only the three server-owned internal destination families", () => {
    expect(isSafeInternalNotificationHref("/prospects/search_1")).toBe(true);
    expect(isSafeInternalNotificationHref("/campaigns/campaign_1")).toBe(true);
    expect(isSafeInternalNotificationHref("/account")).toBe(true);
    expect(notificationNavigationHref("https://evil.example")).toBeNull();
    expect(notificationNavigationHref("//evil.example")).toBeNull();
    expect(notificationNavigationHref("/admin/system-notices")).toBeNull();
  });
});
