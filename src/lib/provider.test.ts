import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    MAIL_PROVIDER: "gmail",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret"
  }
}));

vi.mock("@/lib/google", () => ({
  refreshGoogleAccessToken: vi.fn()
}));

import { refreshGoogleAccessToken } from "@/lib/google";
import { GMAIL_RECONNECT_ERROR, sendEmail } from "@/lib/provider";

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

    expect(result).toEqual({
      data: {
        id: "gmail-message-id"
      }
    });
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

  afterEach(() => {
    global.fetch = originalFetch;
  });
});
