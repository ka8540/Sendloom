import { describe, expect, it } from "vitest";

import {
  GMAIL_CONNECT_CANCELED_ERROR,
  GMAIL_CONNECT_USER_ERROR,
  GOOGLE_LOGIN_ACCOUNT_INELIGIBLE_ERROR,
  GOOGLE_LOGIN_CANCELED_ERROR,
  GOOGLE_LOGIN_UNVERIFIED_EMAIL_ERROR,
  GOOGLE_LOGIN_USER_ERROR,
  getGmailConnectUserError,
  getGoogleLoginUserError
} from "@/lib/user-facing-errors";

describe("user-facing auth errors", () => {
  it("uses a generic login error for backend and provider failures", () => {
    expect(getGoogleLoginUserError()).toBe(GOOGLE_LOGIN_USER_ERROR);
    expect(getGoogleLoginUserError("server_error")).toBe(GOOGLE_LOGIN_USER_ERROR);
    expect(getGoogleLoginUserError("state_mismatch")).toBe(GOOGLE_LOGIN_USER_ERROR);
  });

  it("uses a friendlier canceled login error when the user closes consent", () => {
    expect(getGoogleLoginUserError("access_denied")).toBe(GOOGLE_LOGIN_CANCELED_ERROR);
  });

  it("surfaces the unverified-email reason from the Google login callback", () => {
    expect(getGoogleLoginUserError("email_unverified")).toBe(GOOGLE_LOGIN_UNVERIFIED_EMAIL_ERROR);
  });

  it("surfaces the account-ineligible reason from the Google login callback", () => {
    expect(getGoogleLoginUserError("account_ineligible")).toBe(GOOGLE_LOGIN_ACCOUNT_INELIGIBLE_ERROR);
  });

  it("uses a generic Gmail connection error for backend and provider failures", () => {
    expect(getGmailConnectUserError()).toBe(GMAIL_CONNECT_USER_ERROR);
    expect(getGmailConnectUserError("server_error")).toBe(GMAIL_CONNECT_USER_ERROR);
    expect(getGmailConnectUserError("state_mismatch")).toBe(GMAIL_CONNECT_USER_ERROR);
  });

  it("uses a friendlier canceled connection error when the user closes consent", () => {
    expect(getGmailConnectUserError("access_denied")).toBe(GMAIL_CONNECT_CANCELED_ERROR);
  });
});
