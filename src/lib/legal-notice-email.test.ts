import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock, envMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  envMock: {
    RESEND_API_KEY: "re_test_key",
    DEFAULT_FROM_EMAIL: "no-reply@sendloom.net",
    DEFAULT_FROM_NAME: "Sendloom",
    APP_BASE_URL: "https://sendloom.net"
  }
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  }
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

import { renderLegalNoticeEmail, resendLegalNoticeMailer } from "@/lib/legal-notice-email";
import type { LegalPolicyId, LegalPolicyPath } from "@/lib/legal-policies";

const policy = (id: LegalPolicyId, title: string, path: LegalPolicyPath, summary = `${title} changed.`) => ({
  id,
  title,
  path,
  version: "2026-09-01",
  lastUpdated: "September 1, 2026",
  changeSummary: [summary, `${title} details were clarified.`]
});

const terms = policy("terms", "Terms of Service", "/terms", "Terms account rules changed.");
const privacy = policy("privacy", "Privacy Policy", "/privacy", "Privacy handling changed.");
const abuse = policy("abuse", "Anti-Abuse Policy", "/abuse", "Anti-Abuse rules changed.");

describe("legal notice email", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "resend-message-1" }, error: null });
  });

  it("renders one deterministic three-policy email with every summary, date, and canonical link", () => {
    const rendered = renderLegalNoticeEmail({
      policies: [abuse, terms, privacy],
      appBaseUrl: "https://sendloom.net/app"
    });

    expect(rendered.subject).toBe("We updated our policies");
    expect(rendered.policies.map((item) => item.id)).toEqual(["terms", "privacy", "abuse"]);
    expect(rendered.reviewUrls).toEqual({
      terms: "https://sendloom.net/terms",
      privacy: "https://sendloom.net/privacy",
      abuse: "https://sendloom.net/abuse"
    });
    for (const item of [terms, privacy, abuse]) {
      expect(rendered.html).toContain(item.title);
      expect(rendered.text).toContain(item.title);
      expect(rendered.html).toContain(item.lastUpdated);
      expect(rendered.text).toContain(item.lastUpdated);
      for (const summary of item.changeSummary) {
        expect(rendered.html).toContain(summary);
        expect(rendered.text).toContain(summary);
      }
      expect(rendered.html).toContain(`https://sendloom.net${item.path}`);
      expect(rendered.text).toContain(`https://sendloom.net${item.path}`);
    }
    expect(rendered.html.indexOf("Terms of Service")).toBeLessThan(rendered.html.indexOf("Privacy Policy"));
    expect(rendered.html.indexOf("Privacy Policy")).toBeLessThan(rendered.html.indexOf("Anti-Abuse Policy"));
    expect(rendered.text).toContain("You're receiving this service notice because you have a Sendloom account.");
  });

  it("renders a two-policy release as one combined email", () => {
    const rendered = renderLegalNoticeEmail({ policies: [privacy, terms], appBaseUrl: "https://sendloom.net" });
    expect(rendered.subject).toBe("We updated our policies");
    expect(rendered.policies.map((item) => item.id)).toEqual(["terms", "privacy"]);
    expect(rendered.html).not.toContain("Anti-Abuse Policy");
  });

  it.each([
    [terms, "We updated our Terms of Service"],
    [privacy, "We updated our Privacy Policy"],
    [abuse, "We updated our Anti-Abuse Policy"]
  ] as const)("preserves the single-policy subject for $0.id", (item, subject) => {
    const rendered = renderLegalNoticeEmail({ policies: [item], appBaseUrl: "https://sendloom.net" });
    expect(rendered.subject).toBe(subject);
    expect(rendered.policies).toEqual([item]);
    expect(rendered.reviewUrls[item.id]).toBe(`https://sendloom.net${item.path}`);
  });

  it("refuses empty, duplicate, or summary-less release content", () => {
    expect(() => renderLegalNoticeEmail({ policies: [], appBaseUrl: "https://sendloom.net" })).toThrow(
      /at least one policy/
    );
    expect(() => renderLegalNoticeEmail({ policies: [terms, terms], appBaseUrl: "https://sendloom.net" })).toThrow(
      /Duplicate legal policy/
    );
    expect(() =>
      renderLegalNoticeEmail({
        policies: [{ ...privacy, changeSummary: [] }],
        appBaseUrl: "https://sendloom.net"
      })
    ).toThrow(/non-empty developer-written/);
  });

  it("sends one individually addressed combined Resend message with a stable release key", async () => {
    const result = await resendLegalNoticeMailer.send({
      to: "account@example.com",
      policies: [privacy, terms, abuse],
      releaseGroup: "2026-09-01-policy-refresh",
      idempotencyKey: "legal-release-release1-user1"
    });

    expect(result).toEqual({ status: "accepted", providerMessageId: "resend-message-1" });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      from: "Sendloom <no-reply@sendloom.net>",
      to: "account@example.com",
      subject: "We updated our policies"
    });
    expect(sendMock.mock.calls[0][0]).not.toHaveProperty("cc");
    expect(sendMock.mock.calls[0][0]).not.toHaveProperty("bcc");
    expect(sendMock.mock.calls[0][1]).toEqual({ idempotencyKey: "legal-release-release1-user1" });
  });

  it("classifies provider throttling as retryable and validation failures as permanent", async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { name: "rate_limit_exceeded", message: "slow down" } });
    await expect(
      resendLegalNoticeMailer.send({
        to: "account@example.com",
        policies: [terms],
        releaseGroup: "terms-release",
        idempotencyKey: "rate-limit"
      })
    ).resolves.toEqual({ status: "retryable", errorCode: "rate_limit_exceeded", stopRun: true });

    sendMock.mockResolvedValueOnce({ data: null, error: { name: "validation_error", message: "invalid" } });
    await expect(
      resendLegalNoticeMailer.send({
        to: "invalid@example.com",
        policies: [terms],
        releaseGroup: "terms-release",
        idempotencyKey: "invalid-address"
      })
    ).resolves.toEqual({ status: "permanent", errorCode: "validation_error" });
  });
});
