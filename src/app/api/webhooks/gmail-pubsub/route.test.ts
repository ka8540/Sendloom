import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  pushCalls: [] as Array<{ emailAddress: string }>,
  dedupeKeys: new Set<string>(),
  env: {
    GMAIL_PUBSUB_VERIFICATION_TOKEN: "test-verification-token-16",
    GMAIL_PUBSUB_AUDIENCE: undefined as string | undefined,
    GMAIL_PUBSUB_SERVICE_ACCOUNT: undefined as string | undefined
  },
  afterCallbacks: [] as Array<() => Promise<void>>
}));

vi.mock("@/lib/env", () => ({ env: h.env }));

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    set: async (key: string, _value: string, _ex: string, _ttl: number, _nx: string) => {
      if (h.dedupeKeys.has(key)) {
        return null;
      }
      h.dedupeKeys.add(key);
      return "OK";
    }
  })
}));

vi.mock("@/services/bounces", () => ({
  handleGmailPushNotification: async (args: { emailAddress: string }) => {
    h.pushCalls.push(args);
    return { checkedMessages: 0, processedBounces: 0, unmatchedBounces: 0, recovered: false };
  }
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" }
      })
  },
  // Capture post-ack work so tests can flush it deterministically.
  after: (callback: () => Promise<void>) => {
    h.afterCallbacks.push(callback);
  }
}));

import { POST } from "@/app/api/webhooks/gmail-pubsub/route";

function pushBody(emailAddress = "kush@techsmail.com", messageId = "pubsub-1") {
  return JSON.stringify({
    message: {
      messageId,
      data: Buffer.from(JSON.stringify({ emailAddress, historyId: "12345" }), "utf8").toString("base64url")
    },
    subscription: "projects/test/subscriptions/gmail"
  });
}

function request(body: string, url = "http://localhost/api/webhooks/gmail-pubsub?token=test-verification-token-16") {
  return new Request(url, { method: "POST", body, headers: { "content-type": "application/json" } });
}

async function flushAfter() {
  for (const callback of h.afterCallbacks.splice(0)) {
    await callback();
  }
}

beforeEach(() => {
  h.pushCalls.length = 0;
  h.dedupeKeys.clear();
  h.afterCallbacks.length = 0;
});

describe("gmail pub/sub webhook", () => {
  it("rejects requests without valid authentication (never an open job trigger)", async () => {
    const missing = await POST(request(pushBody(), "http://localhost/api/webhooks/gmail-pubsub"));
    expect(missing.status).toBe(401);
    const wrong = await POST(request(pushBody(), "http://localhost/api/webhooks/gmail-pubsub?token=wrong-token-000000"));
    expect(wrong.status).toBe(401);
    await flushAfter();
    expect(h.pushCalls).toHaveLength(0);
  });

  it("acknowledges fast and processes the mailbox sync after the response", async () => {
    const response = await POST(request(pushBody()));
    expect(response.status).toBe(204);
    // Nothing heavy ran before the ack…
    expect(h.pushCalls).toHaveLength(0);
    // …the sync runs in the post-response phase.
    await flushAfter();
    expect(h.pushCalls).toEqual([{ emailAddress: "kush@techsmail.com" }]);
  });

  it("deduplicates redelivered Pub/Sub message ids", async () => {
    expect((await POST(request(pushBody("kush@techsmail.com", "dup-1")))).status).toBe(204);
    expect((await POST(request(pushBody("kush@techsmail.com", "dup-1")))).status).toBe(204);
    await flushAfter();
    expect(h.pushCalls).toHaveLength(1);
  });

  it("acks malformed payloads without processing them", async () => {
    for (const body of ["not json", JSON.stringify({}), JSON.stringify({ message: { data: "!!!", messageId: "m" } })]) {
      const response = await POST(request(body));
      expect(response.status).toBe(204);
    }
    // Oversized bodies are also acked and dropped.
    const oversized = await POST(request("x".repeat(70_000)));
    expect(oversized.status).toBe(204);
    await flushAfter();
    expect(h.pushCalls).toHaveLength(0);
  });
});
