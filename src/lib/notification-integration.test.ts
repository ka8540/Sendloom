import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const SEARCH_SERVICE = readFileSync("src/services/prospects/prospect-search-service.ts", "utf8");
const PROSPECT_SERVICES = readFileSync("src/services/prospects/prospect-services.ts", "utf8");
const CAMPAIGNS = readFileSync("src/services/campaigns.ts", "utf8");
const BOUNCES = readFileSync("src/services/bounces.ts", "utf8");
const SENDERS = readFileSync("src/services/senders.ts", "utf8");
const MIGRATION = readFileSync(
  "prisma/migrations/20260826120000_add_app_notifications/migration.sql",
  "utf8"
);

describe("authoritative notification transition hooks", () => {
  it("notifies Discover only from backend READY handling and wires the durable helper in production", () => {
    expect(SEARCH_SERVICE).toContain('if (newStatus === "READY")');
    expect(SEARCH_SERVICE).toContain('runNotificationSideEffect("discover-search-completed"');
    expect(PROSPECT_SERVICES).toContain("createDiscoverSearchCompletedNotification(searchId, prisma)");
    expect(SEARCH_SERVICE).not.toContain("DISCOVER_SEARCH_COMPLETED");
  });

  it("notifies after the locked CampaignRun completion transition", () => {
    const finalize = CAMPAIGNS.match(/async function finalizeRunIfComplete[\s\S]*?return true;/)?.[0] ?? "";
    expect(finalize.indexOf('status: "COMPLETED"')).toBeLessThan(
      finalize.indexOf("createSequenceCompletedNotification(runId, prisma)")
    );
    expect(finalize).toContain('runNotificationSideEffect("sequence-completed"');
  });

  it("syncs Gmail warnings at centralized actionable/healthy states and successful reauthorization", () => {
    expect(BOUNCES).toContain('if (data.gmailWatchStatus)');
    expect(BOUNCES).toContain("syncGmailReconnectNotification(senderId, prisma)");
    expect(SENDERS).toContain("syncGmailReconnectNotification(sender.id, prisma)");
    expect(SENDERS).toContain("resolveGmailReconnectNotification(sender.id, prisma)");
  });

  it("uses one additive table and a partial uniqueness guard for active Gmail episodes", () => {
    expect(MIGRATION).toContain('CREATE TABLE "AppNotification"');
    expect(MIGRATION).toContain('CREATE UNIQUE INDEX "AppNotification_active_gmail_episode_key"');
    expect(MIGRATION).toContain('WHERE "type" = \'GMAIL_RECONNECT_REQUIRED\' AND "resolvedAt" IS NULL');
    expect(MIGRATION).not.toContain("SystemNoticeRecipient");
    expect(MIGRATION).not.toMatch(/DROP|DELETE FROM|TRUNCATE/i);
  });
});
