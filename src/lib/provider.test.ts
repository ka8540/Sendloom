import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    MAIL_PROVIDER: "gmail",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret"
  }
}));

vi.mock("@/lib/google", () => ({
  GMAIL_API_NOT_ENABLED_ERROR:
    "Gmail API is disabled for this Google Cloud project. Enable gmail.googleapis.com for the project tied to GOOGLE_CLIENT_ID, wait a few minutes, and try again.",
  normalizeGoogleApiErrorMessage: vi.fn((message: string) =>
    message.includes("Gmail API has not been used in project")
      ? "Gmail API is disabled for this Google Cloud project. Enable gmail.googleapis.com for the project tied to GOOGLE_CLIENT_ID, wait a few minutes, and try again."
      : message
  ),
  refreshGoogleAccessToken: vi.fn()
}));

import { refreshGoogleAccessToken } from "@/lib/google";
import { GMAIL_RECONNECT_ERROR, sendEmail } from "@/lib/provider";
import { GMAIL_API_NOT_ENABLED_ERROR } from "@/lib/google";

const refreshGoogleAccessTokenMock = vi.mocked(refreshGoogleAccessToken);

describe("gmail provider", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("sends mail through the Gmail API with a base64url-encoded raw message", async () => {
    refreshGoogleAccessTokenMock.mockResolvedValue({
      access_token: "access-token",
      expires_in: 3600,
      token_type: "Bearer"
    });

    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: "gmail-message-id" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    const result = await sendEmail({
      from: "Sender Example <sender@example.com>",
      to: "recipient@example.com",
      subject: "Scope migration test",
      html: "<p>Hello from Sendloom</p>",
      messageIdHeader: "<sendloom-test@example.com>",
      attachments: [
        {
          fileName: "hello.txt",
          contentBase64: Buffer.from("hello world").toString("base64"),
          contentType: "text/plain"
        }
      ],
      sender: {
        fromEmail: "sender@example.com",
        oauthRefreshToken: "refresh-token"
      }
    });

    expect(refreshGoogleAccessTokenMock).toHaveBeenCalledWith("refresh-token");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, request] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(request?.method).toBe("POST");
    expect(request?.headers).toMatchObject({
      Authorization: "Bearer access-token",
      "Content-Type": "application/json"
    });

    const payload = JSON.parse(String(request?.body)) as { raw: string };
    expect(payload.raw).toMatch(/^[A-Za-z0-9_-]+$/);

    const mimeMessage = Buffer.from(payload.raw, "base64url").toString("utf8");
    expect(mimeMessage).toContain("Subject: Scope migration test");
    expect(mimeMessage).toContain("Message-ID: <sendloom-test@example.com>");
    expect(mimeMessage).toContain("To: recipient@example.com");
    expect(mimeMessage).toContain("hello.txt");

    expect(result.data.id).toBe("gmail-message-id");
    expect(result.data.messageIdHeader).toBe("<sendloom-test@example.com>");
    expect(result.data.threadId).toBeUndefined();
  });

  it("sends Gmail replies with thread id and reply headers", async () => {
    refreshGoogleAccessTokenMock.mockResolvedValue({
      access_token: "access-token",
      expires_in: 3600,
      token_type: "Bearer"
    });

    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: "gmail-reply-id", threadId: "gmail-thread-id" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    const result = await sendEmail({
      from: "Sender Example <sender@example.com>",
      to: "recipient@example.com",
      subject: "Re: Original outreach",
      html: "<p>Following up</p>",
      gmailThreadId: "gmail-thread-id",
      inReplyTo: "<original@example.com>",
      references: "<original@example.com>",
      sender: {
        fromEmail: "sender@example.com",
        oauthRefreshToken: "refresh-token"
      }
    });

    const [, request] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    const payload = JSON.parse(String(request?.body)) as { raw: string; threadId?: string };
    const mimeMessage = Buffer.from(payload.raw, "base64url").toString("utf8");

    expect(payload.threadId).toBe("gmail-thread-id");
    expect(mimeMessage).toContain("Subject: Re: Original outreach");
    expect(mimeMessage).toContain("In-Reply-To: <original@example.com>");
    expect(mimeMessage).toContain("References: <original@example.com>");
    expect(result.data.threadId).toBe("gmail-thread-id");
  });

  it("surfaces reconnect guidance when the refresh token is no longer valid", async () => {
    refreshGoogleAccessTokenMock.mockRejectedValue(new Error("invalid_grant"));

    await expect(
      sendEmail({
        from: "Sender Example <sender@example.com>",
        to: "recipient@example.com",
        subject: "Reconnect me",
        html: "<p>Hello</p>",
        sender: {
          fromEmail: "sender@example.com",
          oauthRefreshToken: "expired-refresh-token"
        }
      })
    ).rejects.toThrow(GMAIL_RECONNECT_ERROR);
  });

  it("surfaces reconnect guidance when Gmail rejects the token scopes", async () => {
    refreshGoogleAccessTokenMock.mockResolvedValue({
      access_token: "access-token",
      expires_in: 3600,
      token_type: "Bearer"
    });

    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 403,
            message: "Request had insufficient authentication scopes.",
            status: "PERMISSION_DENIED"
          }
        }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    await expect(
      sendEmail({
        from: "Sender Example <sender@example.com>",
        to: "recipient@example.com",
        subject: "Reconnect me",
        html: "<p>Hello</p>",
        sender: {
          fromEmail: "sender@example.com",
          oauthRefreshToken: "refresh-token"
        }
      })
    ).rejects.toThrow(GMAIL_RECONNECT_ERROR);
  });

  it("surfaces a clear setup error when the Gmail API is disabled in Google Cloud", async () => {
    refreshGoogleAccessTokenMock.mockResolvedValue({
      access_token: "access-token",
      expires_in: 3600,
      token_type: "Bearer"
    });

    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 403,
            message:
              "Gmail API has not been used in project 158000912786 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=158000912786 then retry.",
            status: "PERMISSION_DENIED"
          }
        }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    await expect(
      sendEmail({
        from: "Sender Example <sender@example.com>",
        to: "recipient@example.com",
        subject: "Enable the API",
        html: "<p>Hello</p>",
        sender: {
          fromEmail: "sender@example.com",
          oauthRefreshToken: "refresh-token"
        }
      })
    ).rejects.toThrow(GMAIL_API_NOT_ENABLED_ERROR);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });
});
