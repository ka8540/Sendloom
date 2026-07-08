import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const calls = {
    check: [] as Row[],
    audit: [] as Row[]
  };
  const impl = {
    auth: (async () => ({ user: { id: "user-1", email: "user@example.com" } })) as () => Promise<Row>,
    rateLimit: (async () => ({ allowed: true })) as () => Promise<Row>,
    check: (async () => ({
      status: "ok",
      summary: {
        checkedMessages: 12,
        bouncesFound: 3,
        invalidRecipientsUpdated: 3,
        suppressionsRecorded: 3,
        skippedAlreadyKnown: 0,
        gmailSyncSkipped: null
      }
    })) as (args: Row) => Promise<Row>
  };
  return { calls, impl };
});

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: () => h.impl.auth()
}));
vi.mock("@/lib/audit", () => ({
  recordAuditEvent: async (args: Record<string, unknown>) => {
    h.calls.audit.push(args);
  }
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => h.impl.rateLimit(),
  createRateLimitResponse: (retryAfterSeconds?: number) =>
    new Response(JSON.stringify({ error: "rate limited", retryAfterSeconds }), { status: 429 })
}));
vi.mock("@/services/sequence-bounce-check", () => ({
  checkSequenceBounces: (args: Record<string, unknown>) => {
    h.calls.check.push(args);
    return h.impl.check(args);
  }
}));

import { POST } from "@/app/api/campaigns/[id]/sync-bounces/route";

async function post(id = "campaign-1"): Promise<Response> {
  const response = await POST(
    new Request("https://app.example.test/api/campaigns/campaign-1/sync-bounces", { method: "POST" }),
    { params: Promise.resolve({ id }) }
  );
  // The auth helper's union type makes `auth.response` optional to the
  // compiler; at runtime every branch returns a Response.
  if (!response) throw new Error("route returned no response");
  return response;
}

beforeEach(() => {
  h.calls.check.length = 0;
  h.calls.audit.length = 0;
  h.impl.auth = async () => ({ user: { id: "user-1", email: "user@example.com" } });
  h.impl.rateLimit = async () => ({ allowed: true });
  h.impl.check = async () => ({
    status: "ok",
    summary: {
      checkedMessages: 12,
      bouncesFound: 3,
      invalidRecipientsUpdated: 3,
      suppressionsRecorded: 3,
      skippedAlreadyKnown: 0,
      gmailSyncSkipped: null
    }
  });
});

describe("POST /api/campaigns/[id]/sync-bounces", () => {
  it("requires authentication", async () => {
    h.impl.auth = async () => ({ response: new Response(JSON.stringify({ error: "no" }), { status: 401 }) });
    const response = await post();
    expect(response.status).toBe(401);
    expect(h.calls.check).toHaveLength(0);
  });

  it("requires sequence ownership (unowned sequences are not found)", async () => {
    h.impl.check = async () => ({ status: "not_found" });
    const response = await post();
    expect(response.status).toBe(404);
    // The ownership filter travels with the call.
    expect(h.calls.check[0]).toMatchObject({ campaignId: "campaign-1", userId: "user-1" });
  });

  it("returns a safe reconnect error for a disconnected sender", async () => {
    h.impl.check = async () => ({ status: "sender_disconnected" });
    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Reconnect Gmail to check bounces.",
      code: "SENDER_DISCONNECTED"
    });
  });

  it("returns the counts-only summary and records an audit event on success", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checkedMessages: 12,
      bouncesFound: 3,
      invalidRecipientsUpdated: 3,
      suppressionsRecorded: 3,
      skippedAlreadyKnown: 0,
      gmailSyncSkipped: null
    });
    expect(h.calls.audit[0]).toMatchObject({
      action: "sequence.bounce_check",
      target: { type: "sequence", id: "campaign-1" }
    });
  });

  it("rate limits repeated manual checks", async () => {
    h.impl.rateLimit = async () => ({ allowed: false, retryAfterSeconds: 30 });
    const response = await post();
    expect(response.status).toBe(429);
    expect(h.calls.check).toHaveLength(0);
  });
});

describe("bounce check never sends email (source contract)", () => {
  const sources = [
    readFileSync("src/app/api/campaigns/[id]/sync-bounces/route.ts", "utf8"),
    readFileSync("src/services/sequence-bounce-check.ts", "utf8")
  ];

  it("neither the route nor the service references any send path", () => {
    for (const source of sources) {
      expect(source).not.toMatch(/sendEmail|sendGmail|messages\/send|processRecipientJob|launch/i);
    }
  });

  it("the response is counts only — no Gmail message content fields exist", () => {
    for (const source of sources) {
      expect(source).not.toMatch(/payload\.headers|body\.data|snippet|raw:/);
    }
  });
});
