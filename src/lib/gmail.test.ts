import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GmailEntityNotFoundError,
  buildGmailDsnCandidateQuery,
  getGmailProfileHistoryId,
  isGmailNotFoundError
} from "@/lib/gmail";

describe("Gmail DSN candidate search", () => {
  it("searches broad bounce signals across the mailbox, not only sent or unread mail", () => {
    const query = buildGmailDsnCandidateQuery({
      after: new Date("2026-07-08T18:00:00Z"),
      before: new Date("2026-07-08T21:00:00Z")
    });

    expect(query).toContain("from:mailer-daemon");
    expect(query).toContain("from:mailer-daemon@googlemail.com");
    expect(query).toContain("from:postmaster");
    expect(query).toContain('"Mail Delivery Subsystem"');
    expect(query).toContain('"Address not found"');
    expect(query).toContain('"Address rejected"');
    expect(query).toContain('"550 5.1.0"');
    expect(query).toContain('"550 #5.1.0"');
    expect(query).toContain('"550 5.1.1"');
    expect(query).toContain('"user unknown"');
    expect(query).toContain('"recipient rejected"');
    expect(query).toContain('"unable to receive mail"');
    expect(query).toContain('"Delivery Status Notification"');
    expect(query).toContain('"Undelivered Mail Returned to Sender"');
    expect(query).toContain("after:");
    expect(query).toContain("before:");
    expect(query).not.toContain("in:sent");
    expect(query).not.toContain("is:unread");
  });
});

describe("isGmailNotFoundError", () => {
  it("recognises the typed missing-entity error", () => {
    expect(isGmailNotFoundError(new GmailEntityNotFoundError())).toBe(true);
  });

  it("recognises the raw Gmail 404 signatures", () => {
    expect(isGmailNotFoundError(new Error("Requested entity was not found."))).toBe(true);
    expect(
      isGmailNotFoundError(
        new Error(JSON.stringify({ error: { code: 404, status: "NOT_FOUND", errors: [{ reason: "notFound" }] } }))
      )
    ).toBe(true);
  });

  it("does not match unrelated errors (auth, rate limit, app not-found strings)", () => {
    expect(isGmailNotFoundError(new Error("invalid_grant"))).toBe(false);
    expect(isGmailNotFoundError(new Error("Rate Limit Exceeded"))).toBe(false);
    expect(isGmailNotFoundError(new Error("This sequence could not be found."))).toBe(false);
    expect(isGmailNotFoundError(null)).toBe(false);
  });
});

describe("Gmail 404 responses become a typed, content-free error", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws GmailEntityNotFoundError (not the raw payload) on a 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" } }),
        { status: 404 }
      )
    );

    const error = await getGmailProfileHistoryId("token").catch((caught) => caught);
    expect(error).toBeInstanceOf(GmailEntityNotFoundError);
    expect(isGmailNotFoundError(error)).toBe(true);
    // The raw Gmail payload must never ride along in the error message.
    expect((error as Error).message).not.toMatch(/requested entity was not found/i);
  });
});
