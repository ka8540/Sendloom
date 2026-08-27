import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  createDiscoverSearchCompletedNotification,
  createSequenceCompletedNotification,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
  syncGmailReconnectNotification
} from "@/lib/notifications";

type Row = Record<string, any>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") {
      return (expected as Row[]).some((clause) => matches(row, clause));
    }
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      if ("lt" in expected) {
        const actual = row[key] instanceof Date ? row[key].getTime() : row[key];
        const bound = expected.lt instanceof Date ? expected.lt.getTime() : expected.lt;
        return actual < bound;
      }
      return matches(row[key] ?? {}, expected);
    }
    if (expected instanceof Date) {
      return row[key] instanceof Date && row[key].getTime() === expected.getTime();
    }
    return row[key] === expected;
  });
}

function createNotificationDb() {
  let id = 0;
  const notifications: Row[] = [];
  const searches = new Map<string, Row>();
  const allocations: Row[] = [];
  const runs = new Map<string, Row>();
  const senders = new Map<string, Row>();
  const now = () => new Date(Date.UTC(2026, 7, 26, 12, 0, id));

  const createNotification = (data: Row) => {
    const dedupe = notifications.find((row) => row.userId === data.userId && row.dedupeKey === data.dedupeKey);
    if (dedupe) {
      throw Object.assign(new Error("duplicate"), { code: "P2002" });
    }
    const activeGmail = notifications.find(
      (row) =>
        row.userId === data.userId &&
        row.type === "GMAIL_RECONNECT_REQUIRED" &&
        row.entityId === data.entityId &&
        row.resolvedAt === null
    );
    if (data.type === "GMAIL_RECONNECT_REQUIRED" && data.resolvedAt == null && activeGmail) {
      throw Object.assign(new Error("active Gmail episode already exists"), { code: "P2002" });
    }
    id += 1;
    const row = {
      id: `notification_${id}`,
      href: null,
      entityType: null,
      entityId: null,
      metadata: null,
      readAt: null,
      resolvedAt: null,
      createdAt: now(),
      updatedAt: now(),
      ...data
    };
    notifications.push(row);
    return { ...row };
  };

  const appNotification = {
    upsert: async ({ where, create }: Row) => {
      const composite = where.userId_dedupeKey;
      const existing = notifications.find(
        (row) => row.userId === composite.userId && row.dedupeKey === composite.dedupeKey
      );
      return existing ? { ...existing } : createNotification(create);
    },
    create: async ({ data }: Row) => createNotification(data),
    findFirst: async ({ where, select }: Row) => {
      const found = notifications.find((row) => matches(row, where));
      if (!found) return null;
      if (!select) return { ...found };
      return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, found[key]]));
    },
    findMany: async ({ where, take }: Row) =>
      notifications
        .filter((row) => matches(row, where))
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))
        .slice(0, take)
        .map((row) => ({ ...row })),
    count: async ({ where }: Row) => notifications.filter((row) => matches(row, where)).length,
    updateMany: async ({ where, data }: Row) => {
      let count = 0;
      for (const row of notifications) {
        if (matches(row, where)) {
          Object.assign(row, data, { updatedAt: now() });
          count += 1;
        }
      }
      return { count };
    }
  };

  const db = {
    appNotification,
    prospectSearch: {
      findUnique: async ({ where }: Row) => searches.get(where.id) ?? null
    },
    prospectSearchPerson: {
      count: async ({ where }: Row) => allocations.filter((row) => matches(row, where)).length
    },
    campaignRun: {
      findUnique: async ({ where }: Row) => runs.get(where.id) ?? null
    },
    senderProfile: {
      findUnique: async ({ where }: Row) => senders.get(where.id) ?? null
    }
  } as unknown as PrismaClient;

  return {
    db,
    state: { notifications, searches, allocations, runs, senders },
    seedNotification(data: Row) {
      return createNotification(data);
    }
  };
}

describe("in-app notification creation", () => {
  it("creates one Discover completion with only the user's allocated result count", async () => {
    const fake = createNotificationDb();
    fake.state.searches.set("search_1", {
      id: "search_1",
      userId: "user_a",
      requestedCompany: "Acme",
      status: "READY",
      totalFound: 500
    });
    fake.state.allocations.push(
      { searchId: "search_1", userId: "user_a" },
      { searchId: "search_1", userId: "user_a" },
      { searchId: "search_1", userId: "user_b" }
    );

    await createDiscoverSearchCompletedNotification("search_1", fake.db);
    await createDiscoverSearchCompletedNotification("search_1", fake.db);

    expect(fake.state.notifications).toHaveLength(1);
    expect(fake.state.notifications[0]).toMatchObject({
      userId: "user_a",
      type: "DISCOVER_SEARCH_COMPLETED",
      href: "/prospects/search_1",
      metadata: { searchId: "search_1", resultCount: 2 }
    });
    expect(fake.state.notifications[0].message).toContain("2 people");
    expect(JSON.stringify(fake.state.notifications[0])).not.toContain("500");
  });

  it("does not notify a running Discover search and allows different completed searches", async () => {
    const fake = createNotificationDb();
    fake.state.searches.set("search_running", {
      id: "search_running",
      userId: "user_a",
      requestedCompany: "Running Co",
      status: "PROCESSING"
    });
    fake.state.searches.set("search_2", {
      id: "search_2",
      userId: "user_a",
      requestedCompany: "Second Co",
      status: "READY"
    });

    expect(await createDiscoverSearchCompletedNotification("search_running", fake.db)).toBeNull();
    await createDiscoverSearchCompletedNotification("search_2", fake.db);
    expect(fake.state.notifications.map((row) => row.entityId)).toEqual(["search_2"]);
  });

  it("creates one safe Sequence completion per run with concise counters", async () => {
    const fake = createNotificationDb();
    fake.state.runs.set("run_1", {
      id: "run_1",
      status: "COMPLETED",
      sentCount: 48,
      failedCount: 2,
      suppressedCount: 3,
      campaign: { id: "campaign_1", name: "Summer Outreach", userId: "user_a" }
    });
    fake.state.runs.set("run_2", {
      id: "run_2",
      status: "COMPLETED",
      sentCount: 4,
      failedCount: 0,
      suppressedCount: 0,
      campaign: { id: "campaign_1", name: "Summer Outreach", userId: "user_a" }
    });
    fake.state.runs.set("run_paused", {
      id: "run_paused",
      status: "PAUSED",
      sentCount: 1,
      failedCount: 0,
      suppressedCount: 0,
      campaign: { id: "campaign_1", name: "Summer Outreach", userId: "user_a" }
    });

    await createSequenceCompletedNotification("run_1", fake.db);
    await createSequenceCompletedNotification("run_1", fake.db);
    await createSequenceCompletedNotification("run_2", fake.db);
    expect(await createSequenceCompletedNotification("run_paused", fake.db)).toBeNull();

    expect(fake.state.notifications).toHaveLength(2);
    expect(fake.state.notifications[0]).toMatchObject({
      userId: "user_a",
      href: "/campaigns/campaign_1",
      entityId: "run_1",
      metadata: {
        campaignId: "campaign_1",
        campaignRunId: "run_1",
        sentCount: 48,
        failedCount: 2,
        suppressedCount: 3
      }
    });
    expect(fake.state.notifications[0].message).toContain("48 sent, 2 failed, 3 suppressed");
    expect(JSON.stringify(fake.state.notifications[0].metadata)).not.toContain("recipient");
  });

  it("creates one Gmail warning per actionable failure episode and resolves on ACTIVE", async () => {
    const fake = createNotificationDb();
    const sender = {
      id: "sender_1",
      userId: "user_a",
      fromEmail: "owner@example.com",
      oauthRefreshToken: "encrypted-token",
      gmailWatchStatus: "RECONNECT_REQUIRED",
      gmailWatchError: "raw provider body invalid_grant secret"
    };
    fake.state.senders.set(sender.id, sender);

    await syncGmailReconnectNotification(sender.id, fake.db);
    await syncGmailReconnectNotification(sender.id, fake.db);
    expect(fake.state.notifications).toHaveLength(1);
    expect(fake.state.notifications[0]).toMatchObject({
      userId: "user_a",
      severity: "WARNING",
      href: "/account",
      entityId: "sender_1",
      metadata: { senderProfileId: "sender_1", senderEmail: "owner@example.com" }
    });
    expect(JSON.stringify(fake.state.notifications[0])).not.toContain("invalid_grant");
    expect(JSON.stringify(fake.state.notifications[0])).not.toContain("encrypted-token");

    sender.gmailWatchStatus = "RENEWAL_FAILED";
    await syncGmailReconnectNotification(sender.id, fake.db);
    expect(fake.state.notifications).toHaveLength(1);
    expect(fake.state.notifications[0].resolvedAt).toBeNull();

    sender.gmailWatchStatus = "ACTIVE";
    await syncGmailReconnectNotification(sender.id, fake.db);
    expect(fake.state.notifications[0].resolvedAt).toBeInstanceOf(Date);

    sender.gmailWatchStatus = "PERMISSION_REQUIRED";
    await syncGmailReconnectNotification(sender.id, fake.db);
    expect(fake.state.notifications).toHaveLength(2);
    expect(fake.state.notifications[1].resolvedAt).toBeNull();
  });

  it("does not create a Gmail notification without an owning user", async () => {
    const fake = createNotificationDb();
    fake.state.senders.set("sender_orphan", {
      id: "sender_orphan",
      userId: null,
      fromEmail: "orphan@example.com",
      oauthRefreshToken: null,
      gmailWatchStatus: "RECONNECT_REQUIRED"
    });
    expect(await syncGmailReconnectNotification("sender_orphan", fake.db)).toBeNull();
    expect(fake.state.notifications).toHaveLength(0);
  });
});

describe("notification ownership and cursor reads", () => {
  it("returns only active unread rows, counts the same feed, and preserves hidden history", async () => {
    const fake = createNotificationDb();
    fake.seedNotification({
      userId: "user_a",
      type: "SEQUENCE_COMPLETED",
      severity: "SUCCESS",
      title: "Older",
      message: "Older",
      dedupeKey: "a-old",
      createdAt: new Date("2026-08-26T10:00:00.000Z")
    });
    fake.seedNotification({
      userId: "user_b",
      type: "SEQUENCE_COMPLETED",
      severity: "SUCCESS",
      title: "Private",
      message: "Private",
      dedupeKey: "b-private",
      createdAt: new Date("2026-08-26T12:00:00.000Z")
    });
    fake.seedNotification({
      userId: "user_a",
      type: "DISCOVER_SEARCH_COMPLETED",
      severity: "SUCCESS",
      title: "Newest",
      message: "Newest",
      dedupeKey: "a-new",
      createdAt: new Date("2026-08-26T11:00:00.000Z")
    });
    fake.seedNotification({
      userId: "user_a",
      type: "SEQUENCE_COMPLETED",
      severity: "SUCCESS",
      title: "Already read",
      message: "Already read",
      dedupeKey: "a-read",
      readAt: new Date("2026-08-26T12:30:00.000Z"),
      createdAt: new Date("2026-08-26T12:30:00.000Z")
    });
    fake.seedNotification({
      userId: "user_a",
      type: "GMAIL_RECONNECT_REQUIRED",
      severity: "WARNING",
      title: "Resolved",
      message: "Resolved",
      dedupeKey: "a-resolved",
      resolvedAt: new Date("2026-08-26T13:00:00.000Z"),
      createdAt: new Date("2026-08-26T13:00:00.000Z")
    });

    const first = await listNotificationsForUser("user_a", { limit: 1 }, fake.db);
    expect(first.items.map((item) => item.title)).toEqual(["Newest"]);
    expect(first.unreadCount).toBe(2);
    expect(first.nextCursor).toBeTypeOf("string");

    const second = await listNotificationsForUser("user_a", { limit: 1, cursor: first.nextCursor }, fake.db);
    expect(second.items.map((item) => item.title)).toEqual(["Older"]);
    expect(second.items.some((item) => item.title === "Private")).toBe(false);
    expect(fake.state.notifications.map((row) => row.title)).toEqual(
      expect.arrayContaining(["Already read", "Resolved"])
    );
  });

  it("scopes mark-one and mark-all mutations to the authenticated owner and keeps mark-one idempotent", async () => {
    const fake = createNotificationDb();
    const own = fake.seedNotification({
      userId: "user_a",
      type: "SEQUENCE_COMPLETED",
      severity: "SUCCESS",
      title: "Own",
      message: "Own",
      dedupeKey: "own"
    });
    const other = fake.seedNotification({
      userId: "user_b",
      type: "SEQUENCE_COMPLETED",
      severity: "SUCCESS",
      title: "Other",
      message: "Other",
      dedupeKey: "other"
    });

    expect(await markNotificationRead("user_a", other.id, fake.db)).toBe(false);
    expect(other.readAt).toBeNull();
    expect(await markNotificationRead("user_a", own.id, fake.db)).toBe(true);
    expect(await markNotificationRead("user_a", own.id, fake.db)).toBe(true);
    expect(fake.state.notifications.find((row) => row.id === own.id)?.readAt).toBeInstanceOf(Date);
    expect(fake.state.notifications).toHaveLength(2);
    expect((await listNotificationsForUser("user_a", {}, fake.db)).items).toEqual([]);

    expect(await markAllNotificationsRead("user_a", fake.db)).toBe(0);
    expect(fake.state.notifications.find((row) => row.id === other.id)?.readAt).toBeNull();
  });

  it("paginates 20+ active notifications deterministically after earlier rows are read", async () => {
    const fake = createNotificationDb();
    for (let index = 0; index < 25; index += 1) {
      fake.seedNotification({
        userId: "user_a",
        type: "DISCOVER_SEARCH_COMPLETED",
        severity: "SUCCESS",
        title: `Unread ${index}`,
        message: `Unread ${index}`,
        dedupeKey: `unread-${index}`,
        createdAt: new Date(Date.UTC(2026, 7, 26, 12, 0, index))
      });
    }

    const first = await listNotificationsForUser("user_a", { limit: 10 }, fake.db);
    expect(first.items).toHaveLength(10);
    expect(first.items.map((item) => item.title)).toEqual(
      Array.from({ length: 10 }, (_, offset) => `Unread ${24 - offset}`)
    );
    expect(first.unreadCount).toBe(25);

    for (const item of first.items.slice(0, 3)) {
      expect(await markNotificationRead("user_a", item.id, fake.db)).toBe(true);
    }

    const second = await listNotificationsForUser("user_a", { limit: 10, cursor: first.nextCursor }, fake.db);
    const third = await listNotificationsForUser("user_a", { limit: 10, cursor: second.nextCursor }, fake.db);
    const locallyVisible = [...first.items.slice(3), ...second.items, ...third.items];

    expect(second.items).toHaveLength(10);
    expect(second.unreadCount).toBe(22);
    expect(third.items).toHaveLength(5);
    expect(third.nextCursor).toBeNull();
    expect(locallyVisible).toHaveLength(22);
    expect(new Set(locallyVisible.map((item) => item.id)).size).toBe(22);
  });
});
