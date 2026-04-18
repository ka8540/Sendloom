import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    APP_BASE_URL: "https://sendloom.test",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret"
  }
}));

import {
  GOOGLE_CONNECT_SCOPES,
  GOOGLE_GMAIL_SEND_SCOPE,
  GOOGLE_LOGIN_SCOPES,
  buildGoogleConnectUrl,
  buildGoogleLoginUrl
} from "@/lib/google";

describe("google oauth scopes", () => {
  it("keeps Google sign-in limited to basic profile scopes", () => {
    expect(GOOGLE_LOGIN_SCOPES).toEqual(["openid", "email", "profile"]);
  });

  it("requests gmail.send for sender connections instead of full mailbox access", () => {
    expect(GOOGLE_CONNECT_SCOPES).toEqual(["openid", "email", "profile", GOOGLE_GMAIL_SEND_SCOPE]);
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

  it("builds a sender connect url with gmail.send and no full mailbox scope", () => {
    const url = buildGoogleConnectUrl({
      state: "connect-state",
      loginHint: "sender@example.com",
      redirectUri: "https://sendloom.test/api/auth/google/callback"
    });

    expect(url.searchParams.get("scope")).toBe(`openid email profile ${GOOGLE_GMAIL_SEND_SCOPE}`);
    expect(url.searchParams.get("scope")).not.toContain("https://mail.google.com/");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("login_hint")).toBe("sender@example.com");
  });
});
