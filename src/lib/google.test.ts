import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    APP_BASE_URL: "https://sendloom.test",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret"
  }
}));

import {
  GMAIL_API_NOT_ENABLED_ERROR,
  GOOGLE_CONNECT_SCOPES,
  GOOGLE_GMAIL_REPLY_SCOPE,
  GOOGLE_GMAIL_SEND_SCOPE,
  GOOGLE_LOGIN_SCOPES,
  buildGoogleConnectUrl,
  buildGoogleLoginUrl,
  normalizeGoogleApiErrorMessage
} from "@/lib/google";

describe("google oauth scopes", () => {
  it("keeps Google sign-in limited to basic profile scopes", () => {
    expect(GOOGLE_LOGIN_SCOPES).toEqual(["openid", "email", "profile"]);
  });

  it("requests only the send and reply-read scopes needed by the current product", () => {
    expect(GOOGLE_CONNECT_SCOPES).toEqual([
      "openid",
      "email",
      "profile",
      GOOGLE_GMAIL_SEND_SCOPE,
      GOOGLE_GMAIL_REPLY_SCOPE
    ]);
    expect(GOOGLE_CONNECT_SCOPES).not.toContain("https://mail.google.com/");
  });

  it("builds a login url with only sign-in scopes", () => {
    const url = buildGoogleLoginUrl({
      state: "login-state",
      redirectUri: "https://sendloom.test/api/auth/google/login/callback"
    });

    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("access_type")).toBe("online");
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  it("builds a sender connect url with the minimal master-compatible Gmail scopes", () => {
    const url = buildGoogleConnectUrl({
      state: "connect-state",
      loginHint: "sender@example.com",
      redirectUri: "https://sendloom.test/api/auth/google/callback"
    });

    expect(url.searchParams.get("scope")).toBe(
      `openid email profile ${GOOGLE_GMAIL_SEND_SCOPE} ${GOOGLE_GMAIL_REPLY_SCOPE}`
    );
    expect(url.searchParams.get("scope")).not.toContain("https://mail.google.com/");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("login_hint")).toBe("sender@example.com");
  });

  it("normalizes the Google API disabled error into a setup instruction", () => {
    expect(
      normalizeGoogleApiErrorMessage(
        "Gmail API has not been used in project 158000912786 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=158000912786 then retry."
      )
    ).toBe(GMAIL_API_NOT_ENABLED_ERROR);
  });
});
