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
import { getGmailSendFailureDiagnostic } from "@/lib/gmail-errors";
import {
  GMAIL_RECONNECT_ERROR,
  GMAIL_SEND_RATE_LIMIT_USER_ERROR,
  getUserSafeGmailSendError,
  sendEmail
} from "@/lib/provider";
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
    expect(mimeMessage).toContain("To: recipient@example.com");
    expect(mimeMessage).toContain("hello.txt");

    // The RFC Message-ID is generated at send time and embedded in the MIME
    // message so later delivery-status notifications can be correlated.
    expect(result.data?.id).toBe("gmail-message-id");
    expect(result.data?.rfcMessageId).toMatch(/^<[^@]+@example\.com>$/);
    expect(mimeMessage).toContain(`Message-ID: ${result.data?.rfcMessageId}`);
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

  it("preserves structured Gmail rate-limit diagnostics without exposing them as user-facing copy", async () => {
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
            message: "User-rate limit exceeded",
            status: "PERMISSION_DENIED",
            errors: [{ reason: "userRateLimitExceeded", message: "User-rate limit exceeded" }]
          }
        }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "90"
          }
        }
      )
    );

    try {
      await sendEmail({
        from: "Sender Example <sender@example.com>",
        to: "recipient@example.com",
        subject: "Slow down",
        html: "<p>Hello</p>",
        sender: {
          fromEmail: "sender@example.com",
          oauthRefreshToken: "refresh-token"
        }
      });
      throw new Error("Expected sendEmail to fail.");
    } catch (error) {
      const diagnostic = getGmailSendFailureDiagnostic(error);
      expect(diagnostic).toMatchObject({
        provider: "gmail",
        httpStatus: 403,
        code: "403",
        status: "PERMISSION_DENIED",
        reason: "userRateLimitExceeded",
        message: "User-rate limit exceeded",
        retryAfterSeconds: 90
      });
      expect(getUserSafeGmailSendError(error, "GMAIL_RATE_LIMITED")).toBe(GMAIL_SEND_RATE_LIMIT_USER_ERROR);
    }
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });
});
