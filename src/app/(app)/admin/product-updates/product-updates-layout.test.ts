import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WORKSPACE = readFileSync("src/app/(app)/admin/product-updates/product-updates-workspace.tsx", "utf8");
const NAV = readFileSync("src/components/nav.tsx", "utf8");
const SCHEMA = readFileSync("prisma/schema.prisma", "utf8");

describe("admin product update experience", () => {
  it("is an admin-only email composer with exact preview and no user-facing What's New feed", () => {
    expect(WORKSPACE).toContain("Product communications");
    expect(WORKSPACE).toContain("Announce new Sendloom features and improvements by email.");
    expect(WORKSPACE).toContain("Exact email preview");
    expect(WORKSPACE).toContain("srcDoc={preview.html}");
    expect(WORKSPACE).toContain('"/api/admin/product-update-broadcasts/preview"');
    expect(WORKSPACE).not.toContain("Total views");
    expect(WORKSPACE).not.toContain("seen count");
  });

  it("supports 1–5 feature blocks, delivery modes, recipient confirmation, and delivery history", () => {
    expect(WORKSPACE).toContain("Group 1–5 meaningful improvements");
    expect(WORKSPACE).toContain("composer.features.length < 5");
    expect(WORKSPACE).toContain("Add feature");
    expect(WORKSPACE).toContain("Send now");
    expect(WORKSPACE).toContain("Schedule");
    expect(WORKSPACE).toContain("SEND TO ALL USERS");
    for (const column of ["Update", "Scheduled", "Status", "Delivery", "Created by", "Actions"]) {
      expect(WORKSPACE).toContain(`<th>${column}</th>`);
    }
  });

  it("adds Product Updates only to the admin nav and leaves the normal nav free of What's New", () => {
    const adminItems = NAV.slice(NAV.indexOf("const items"), NAV.indexOf("]\n    : ["));
    const normalItems = NAV.slice(NAV.indexOf("]\n    : ["), NAV.indexOf("const analysisItems"));
    expect(adminItems).toContain('/admin/product-updates');
    expect(adminItems).toContain('label: "Product Updates"');
    expect(normalItems).not.toContain("Product Updates");
    expect(normalItems).not.toContain("What's New");
    expect(normalItems).not.toContain("whats-new");
  });

  it("keeps the notification bell enum limited to its three existing product events", () => {
    const appNotificationEnum = SCHEMA.slice(
      SCHEMA.indexOf("enum AppNotificationType"),
      SCHEMA.indexOf("enum AppNotificationSeverity")
    );
    expect(appNotificationEnum).toContain("DISCOVER_SEARCH_COMPLETED");
    expect(appNotificationEnum).toContain("SEQUENCE_COMPLETED");
    expect(appNotificationEnum).toContain("GMAIL_RECONNECT_REQUIRED");
    expect(appNotificationEnum).not.toContain("PRODUCT_UPDATE");
  });
});
