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

import { renderProductUpdateEmail, resendProductUpdateMailer } from "@/lib/product-update-email";

function feature(index: number) {
  return {
    title: `Feature ${index}`,
    description: `Description ${index}`,
    ctaLabel: `Open feature ${index}`,
    ctaHref: index % 2 ? "/workspace" : "/account"
  };
}

const broadcast = {
  id: "broadcast-1",
  subject: "New in Sendloom: Notifications & Profile Photos",
  headline: "Two new ways to make Sendloom better",
  intro: "We've shipped a couple of improvements.",
  features: [feature(1), feature(2)],
  scheduledSendAt: null,
  timeZone: "America/Phoenix"
};

describe("product update email", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "resend-message-1" }, error: null });
  });

  it.each([1, 2, 5])("renders every field for %s feature blocks with complete text fallback", (count) => {
    const features = Array.from({ length: count }, (_, index) => feature(index + 1));
    const rendered = renderProductUpdateEmail({
      broadcast: { ...broadcast, features },
      appBaseUrl: "https://sendloom.net"
    });
    expect(rendered.subject).toBe(broadcast.subject);
    expect(rendered.html).toContain('src="https://sendloom.net/icon-192.png"');
    expect(rendered.html).toContain('<span style="color:#15221f;">Send</span><span style="color:#23a774;">loom</span>');
    expect(rendered.html).toContain("New in Sendloom");
    expect(rendered.text).toContain("NEW IN SENDLOOM");
    expect(rendered.text).toContain(broadcast.headline);
    expect(rendered.text).toContain(broadcast.intro);
    for (const item of features) {
      expect(rendered.html).toContain(item.title);
      expect(rendered.text).toContain(item.title);
      expect(rendered.text).toContain(item.description);
      expect(rendered.text).toContain(`https://sendloom.net${item.ctaHref}`);
    }
    expect(rendered.text).toContain("You're receiving this product update because you have a Sendloom account.");
    expect(rendered.html).not.toContain("service notice");
    expect(rendered.html).not.toContain("maintenance");
  });

  it("escapes every admin-authored HTML field and CTA label", () => {
    const rendered = renderProductUpdateEmail({
      broadcast: {
        ...broadcast,
        headline: '<img src=x onerror="alert(1)">',
        intro: "Hello <script>alert('x')</script> & goodbye",
        features: [{
          title: "Feature <b>one</b>",
          description: "Description <svg onload=alert(1)>",
          ctaLabel: "Open <script>",
          ctaHref: "/workspace"
        }]
      },
      appBaseUrl: "https://sendloom.net"
    });
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("<img src=x");
    expect(rendered.html).not.toContain("<b>one</b>");
    expect(rendered.html).toContain("&lt;script&gt;alert(&#039;x&#039;)&lt;/script&gt; &amp; goodbye");
    expect(rendered.text).toContain("Hello <script>alert('x')</script> & goodbye");
  });

  it("sends one individually addressed message with product-update tags and stable caller key", async () => {
    await expect(resendProductUpdateMailer.send({
      to: "account@example.com",
      broadcast,
      idempotencyKey: "product-update-broadcast-1-recipient-1"
    })).resolves.toEqual({ status: "accepted", providerMessageId: "resend-message-1" });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      from: "Sendloom <no-reply@sendloom.net>",
      to: "account@example.com",
      subject: broadcast.subject,
      tags: [
        { name: "category", value: "product-update" },
        { name: "broadcast_id", value: "broadcast-1" }
      ]
    });
    expect(sendMock.mock.calls[0][0]).not.toHaveProperty("bcc");
    expect(sendMock.mock.calls[0][1]).toEqual({ idempotencyKey: "product-update-broadcast-1-recipient-1" });
  });

  it("stops on provider-wide errors and isolates invalid recipients", async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { name: "rate_limit_exceeded" } });
    await expect(resendProductUpdateMailer.send({ to: "one@example.com", broadcast, idempotencyKey: "retry" }))
      .resolves.toEqual({ status: "retryable", errorCode: "rate_limit_exceeded", stopRun: true });
    sendMock.mockResolvedValueOnce({ data: null, error: { name: "validation_error" } });
    await expect(resendProductUpdateMailer.send({ to: "bad@example.com", broadcast, idempotencyKey: "bad" }))
      .resolves.toEqual({ status: "permanent", errorCode: "validation_error" });
  });
});
