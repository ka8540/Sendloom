import { SystemNoticeType } from "@prisma/client";
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

import { renderSystemNoticeEmail, resendSystemNoticeMailer } from "@/lib/system-notice-email";

const notice = {
  id: "notice-1",
  type: SystemNoticeType.PLANNED_MAINTENANCE,
  subject: "Scheduled maintenance: Sendloom",
  title: "Scheduled maintenance",
  message: "We will be performing maintenance.\nNo action is required.",
  affectedArea: "Sequences and campaign processing",
  scheduledSendAt: new Date("2026-08-27T05:00:00Z"),
  impactStartsAt: new Date("2026-08-28T05:00:00Z"),
  impactEndsAt: new Date("2026-08-28T06:00:00Z"),
  timeZone: "America/Phoenix"
};

describe("system notice email", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "resend-message-1" }, error: null });
  });

  it("renders Sendloom branding, operational content, timezone, and the account-service footer", () => {
    const rendered = renderSystemNoticeEmail({ notice, appBaseUrl: "https://sendloom.net" });

    expect(rendered.subject).toBe(notice.subject);
    expect(rendered.html).toContain('src="https://sendloom.net/icon-192.png"');
    expect(rendered.html).toContain('<span style="color:#15221f;">Send</span><span style="color:#23a774;">loom</span>');
    expect(rendered.html).toContain("Planned maintenance");
    expect(rendered.html).toContain("Scheduled maintenance");
    expect(rendered.html).toContain("Sequences and campaign processing");
    expect(rendered.html).toContain("America/Phoenix");
    expect(rendered.text).toContain("10:00 PM MST – 11:00 PM MST");
    expect(rendered.text).toContain("What to expect");
    expect(rendered.text).toContain("You're receiving this service notice because you have a Sendloom account.");
    expect(rendered.html).not.toContain("unsubscribe");
  });

  it("escapes every admin-authored HTML field while retaining readable plain text", () => {
    const rendered = renderSystemNoticeEmail({
      notice: {
        ...notice,
        title: '<img src=x onerror="alert(1)">',
        message: "Hello <script>alert('x')</script> & goodbye",
        affectedArea: "API <b>workers</b>"
      },
      appBaseUrl: "https://sendloom.net"
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("<img src=x");
    expect(rendered.html).not.toContain("<b>workers</b>");
    expect(rendered.html).toContain("&lt;script&gt;alert(&#039;x&#039;)&lt;/script&gt; &amp; goodbye");
    expect(rendered.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(rendered.text).toContain("Hello <script>alert('x')</script> & goodbye");
  });

  it("sends one individually addressed Resend message with the caller's stable idempotency key", async () => {
    await expect(
      resendSystemNoticeMailer.send({
        to: "account@example.com",
        notice,
        idempotencyKey: "system-notice-notice-1-recipient-1"
      })
    ).resolves.toEqual({ status: "accepted", providerMessageId: "resend-message-1" });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      from: "Sendloom <no-reply@sendloom.net>",
      to: "account@example.com",
      subject: notice.subject
    });
    expect(sendMock.mock.calls[0][0]).not.toHaveProperty("bcc");
    expect(sendMock.mock.calls[0][1]).toEqual({ idempotencyKey: "system-notice-notice-1-recipient-1" });
  });

  it("stops a run for provider-wide errors but isolates an invalid recipient", async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { name: "rate_limit_exceeded" } });
    await expect(
      resendSystemNoticeMailer.send({ to: "one@example.com", notice, idempotencyKey: "retry" })
    ).resolves.toEqual({ status: "retryable", errorCode: "rate_limit_exceeded", stopRun: true });

    sendMock.mockResolvedValueOnce({ data: null, error: { name: "validation_error" } });
    await expect(
      resendSystemNoticeMailer.send({ to: "bad@example.com", notice, idempotencyKey: "bad" })
    ).resolves.toEqual({ status: "permanent", errorCode: "validation_error" });
  });
});
