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

const policy = (id: LegalPolicyId, title: string, path: LegalPolicyPath) => ({
  id,
  title,
  path,
  version: "2026-09-01",
  lastUpdated: "September 1, 2026",
  changeSummary: ["Added more detail about account security.", "Clarified how service providers process data."]
});

describe("legal notice email", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "resend-message-1" }, error: null });
  });

  it.each([
    ["terms", "Terms of Service", "/terms", "We updated our Terms of Service"],
    ["privacy", "Privacy Policy", "/privacy", "We updated our Privacy Policy"],
    ["abuse", "Anti-Abuse Policy", "/abuse", "We updated our Anti-Abuse Policy"]
  ] as const)("renders the correct %s subject, summary, date, and canonical link", (id, title, path, subject) => {
    const rendered = renderLegalNoticeEmail({ policy: policy(id, title, path), appBaseUrl: "https://sendloom.net/app" });
    expect(rendered.subject).toBe(subject);
    expect(rendered.reviewUrl).toBe(`https://sendloom.net${path}`);
    expect(rendered.html).toContain("Added more detail about account security.");
    expect(rendered.html).toContain("September 1, 2026");
    expect(rendered.html).toContain(`https://sendloom.net${path}`);
    expect(rendered.text).toContain("Clarified how service providers process data.");
    expect(rendered.text).toContain("You're receiving this service notice because you have a Sendloom account.");
  });

  it("refuses to render a notice without a developer-written summary", () => {
    expect(() =>
      renderLegalNoticeEmail({
        policy: { ...policy("privacy", "Privacy Policy", "/privacy"), changeSummary: [] },
        appBaseUrl: "https://sendloom.net"
      })
    ).toThrow(/non-empty developer-written/);
  });

  it("sends one individually addressed Resend message with a stable idempotency key", async () => {
    const result = await resendLegalNoticeMailer.send({
      to: "account@example.com",
      policy: policy("privacy", "Privacy Policy", "/privacy"),
      idempotencyKey: "legal-notice-n1-r1"
    });

    expect(result).toEqual({ status: "accepted", providerMessageId: "resend-message-1" });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      from: "Sendloom <no-reply@sendloom.net>",
      to: "account@example.com",
      subject: "We updated our Privacy Policy"
    });
    expect(sendMock.mock.calls[0][0]).not.toHaveProperty("cc");
    expect(sendMock.mock.calls[0][0]).not.toHaveProperty("bcc");
    expect(sendMock.mock.calls[0][1]).toEqual({ idempotencyKey: "legal-notice-n1-r1" });
  });

  it("classifies provider throttling as retryable and validation failures as permanent", async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { name: "rate_limit_exceeded", message: "slow down" } });
    await expect(
      resendLegalNoticeMailer.send({
        to: "account@example.com",
        policy: policy("terms", "Terms of Service", "/terms"),
        idempotencyKey: "rate-limit"
      })
    ).resolves.toEqual({ status: "retryable", errorCode: "rate_limit_exceeded", stopRun: true });

    sendMock.mockResolvedValueOnce({ data: null, error: { name: "validation_error", message: "invalid" } });
    await expect(
      resendLegalNoticeMailer.send({
        to: "invalid@example.com",
        policy: policy("terms", "Terms of Service", "/terms"),
        idempotencyKey: "invalid-address"
      })
    ).resolves.toEqual({ status: "permanent", errorCode: "validation_error" });

    sendMock.mockResolvedValueOnce({ data: null, error: { name: "invalid_from_address", message: "sender" } });
    await expect(
      resendLegalNoticeMailer.send({
        to: "account@example.com",
        policy: policy("terms", "Terms of Service", "/terms"),
        idempotencyKey: "sender-config"
      })
    ).resolves.toEqual({ status: "retryable", errorCode: "invalid_from_address", stopRun: true });
  });
});
