import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, tx } = vi.hoisted(() => {
  const transaction = {
    senderProfile: {
      findFirst: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn()
    },
    campaign: { count: vi.fn() }
  };
  return {
    tx: transaction,
    prismaMock: {
      senderProfile: { findMany: vi.fn() },
      $transaction: vi.fn(async (operation: (client: typeof transaction) => unknown) => operation(transaction))
    }
  };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { getAccountOverview, removeUserSender, serializeAccountSender } from "@/services/account";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (operation) => operation(tx));
});

const baseUser = {
  email: "owner@example.com",
  passwordHash: "hashed-value",
  createdAt: new Date("2026-01-02T03:04:05.000Z"),
  lastLoginAt: new Date("2026-07-01T09:00:00.000Z"),
  lastSeenAt: new Date("2026-07-06T12:00:00.000Z")
};

function senderRow(overrides: Partial<Parameters<typeof serializeAccountSender>[0]> = {}) {
  return {
    id: "sender-1",
    name: "Owner Sender",
    fromEmail: "owner@gmail.com",
    provider: "google_oauth",
    oauthRefreshToken: "refresh-token",
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-02T00:00:00.000Z"),
    ...overrides
  };
}

describe("serializeAccountSender", () => {
  it("maps to a client-safe view with a friendly provider label and connection status", () => {
    const view = serializeAccountSender(senderRow());
    expect(view).toEqual({
      id: "sender-1",
      name: "Owner Sender",
      fromEmail: "owner@gmail.com",
      provider: "google_oauth",
      providerLabel: "Gmail",
      status: "connected",
      connectedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-02T00:00:00.000Z"
    });
  });

  it("never leaks the OAuth refresh token onto the view", () => {
    const view = serializeAccountSender(senderRow({ oauthRefreshToken: "super-secret" }));
    expect(JSON.stringify(view)).not.toContain("super-secret");
    expect("oauthRefreshToken" in view).toBe(false);
  });

  it("reports reconnect_required when the refresh token is missing", () => {
    expect(serializeAccountSender(senderRow({ oauthRefreshToken: null })).status).toBe("reconnect_required");
  });
});

describe("getAccountOverview", () => {
  it("builds a payload with hasPassword derived and no password hash present", async () => {
    prismaMock.senderProfile.findMany.mockResolvedValue([senderRow()]);

    const overview = await getAccountOverview("user-1", baseUser);

    expect(overview.profile.email).toBe("owner@example.com");
    expect(overview.profile.accountType).toBe("password");
    expect(overview.profile.hasPassword).toBe(true);
    expect(overview.profile.createdAt).toBe("2026-01-02T03:04:05.000Z");
    expect(overview.senders).toHaveLength(1);
    expect(overview.canRemoveSenders).toBe(false);
    // The hash must never travel to the client, in any form.
    expect(JSON.stringify(overview)).not.toContain("hashed-value");
    expect("passwordHash" in overview.profile).toBe(false);
  });

  it("classifies a no-password account as a Google account and flags multiple senders removable", async () => {
    prismaMock.senderProfile.findMany.mockResolvedValue([senderRow(), senderRow({ id: "sender-2" })]);

    const overview = await getAccountOverview("user-1", { ...baseUser, passwordHash: null, lastLoginAt: null });

    expect(overview.profile.accountType).toBe("google");
    expect(overview.profile.hasPassword).toBe(false);
    expect(overview.profile.lastLoginAt).toBeNull();
    expect(overview.canRemoveSenders).toBe(true);
  });
});

describe("removeUserSender", () => {
  it("rejects a sender that is not found for this user (cross-user protection)", async () => {
    tx.senderProfile.findFirst.mockResolvedValue(null);

    const result = await removeUserSender("user-1", "sender-x");

    expect(result).toEqual({ ok: false, reason: "not_found" });
    // Scoped by userId so another user's sender is invisible/undeletable.
    expect(tx.senderProfile.findFirst).toHaveBeenCalledWith({
      where: { id: "sender-x", userId: "user-1" },
      select: { id: true, fromEmail: true }
    });
    expect(tx.senderProfile.delete).not.toHaveBeenCalled();
    expect(tx.senderProfile.update).not.toHaveBeenCalled();
  });

  it("refuses to remove the only connected sender", async () => {
    tx.senderProfile.findFirst.mockResolvedValue({ id: "sender-1", fromEmail: "owner@gmail.com" });
    tx.senderProfile.count.mockResolvedValue(1);

    const result = await removeUserSender("user-1", "sender-1");

    expect(result).toEqual({ ok: false, reason: "only_sender" });
    expect(tx.senderProfile.delete).not.toHaveBeenCalled();
    expect(tx.senderProfile.update).not.toHaveBeenCalled();
  });

  it("blocks removal when active or scheduled sequences use the sender", async () => {
    tx.senderProfile.findFirst.mockResolvedValue({ id: "sender-1", fromEmail: "owner@gmail.com" });
    tx.senderProfile.count.mockResolvedValue(2);
    tx.campaign.count.mockResolvedValueOnce(1); // active/scheduled campaigns

    const result = await removeUserSender("user-1", "sender-1");

    expect(result).toEqual({ ok: false, reason: "active_campaigns" });
    expect(tx.senderProfile.delete).not.toHaveBeenCalled();
    expect(tx.senderProfile.update).not.toHaveBeenCalled();
  });

  it("hard-deletes when no sequence references the sender", async () => {
    tx.senderProfile.findFirst.mockResolvedValue({ id: "sender-1", fromEmail: "owner@gmail.com" });
    tx.senderProfile.count.mockResolvedValue(2);
    tx.campaign.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0); // active, then total

    const result = await removeUserSender("user-1", "sender-1");

    expect(result).toEqual({ ok: true, mode: "deleted", fromEmail: "owner@gmail.com" });
    expect(tx.senderProfile.delete).toHaveBeenCalledWith({ where: { id: "sender-1" } });
    expect(tx.senderProfile.update).not.toHaveBeenCalled();
  });

  it("disconnects (detach + clear token) when historical sequences reference the sender", async () => {
    tx.senderProfile.findFirst.mockResolvedValue({ id: "sender-1", fromEmail: "owner@gmail.com" });
    tx.senderProfile.count.mockResolvedValue(2);
    tx.campaign.count.mockResolvedValueOnce(0).mockResolvedValueOnce(3); // no active, 3 historical

    const result = await removeUserSender("user-1", "sender-1");

    expect(result).toEqual({ ok: true, mode: "disconnected", fromEmail: "owner@gmail.com" });
    expect(tx.senderProfile.update).toHaveBeenCalledWith({
      where: { id: "sender-1" },
      data: { userId: null, oauthRefreshToken: null }
    });
    expect(tx.senderProfile.delete).not.toHaveBeenCalled();
  });
});
