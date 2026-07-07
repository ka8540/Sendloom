import { describe, expect, it } from "vitest";

import {
  ACCOUNT_TYPE_LABELS,
  MIN_PASSWORD_LENGTH,
  PASSWORD_CURRENT_REQUIRED_MESSAGE,
  PASSWORD_MISMATCH_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  SENDER_ACTIVE_CAMPAIGN_STATUSES,
  SENDER_ACTIVE_RUN_STATUSES,
  SENDER_REMOVAL_HTTP_STATUS,
  SENDER_REMOVAL_MESSAGES,
  deriveAccountType,
  describeSenderRemoval,
  getSenderConnectionStatus,
  getSenderProviderLabel,
  validatePasswordChange
} from "@/lib/account";

describe("provider + connection helpers", () => {
  it("labels the google_oauth provider as Gmail and falls back for unknowns", () => {
    expect(getSenderProviderLabel("google_oauth")).toBe("Gmail");
    expect(getSenderProviderLabel("something_else")).toBe("Email");
  });

  it("maps refresh-token presence to a connection status", () => {
    expect(getSenderConnectionStatus({ oauthRefreshToken: "token" })).toBe("connected");
    expect(getSenderConnectionStatus({ oauthRefreshToken: null })).toBe("reconnect_required");
  });
});

describe("account type", () => {
  it("derives password vs google accounts from hasPassword", () => {
    expect(deriveAccountType(true)).toBe("password");
    expect(deriveAccountType(false)).toBe("google");
    expect(ACCOUNT_TYPE_LABELS.password).toBe("Password account");
    expect(ACCOUNT_TYPE_LABELS.google).toBe("Google account");
  });
});

describe("sender removal contract", () => {
  it("includes only-sender and active-sequence blocks with safe copy + statuses", () => {
    expect(SENDER_REMOVAL_MESSAGES.only_sender).toMatch(/at least one connected sender/i);
    expect(SENDER_REMOVAL_MESSAGES.active_campaigns).toMatch(/active or scheduled sequences/i);
    expect(SENDER_REMOVAL_HTTP_STATUS.only_sender).toBe(409);
    expect(SENDER_REMOVAL_HTTP_STATUS.active_campaigns).toBe(409);
    expect(SENDER_REMOVAL_HTTP_STATUS.not_found).toBe(404);
  });

  it("treats running and scheduled work as active for both campaigns and runs", () => {
    expect(SENDER_ACTIVE_CAMPAIGN_STATUSES).toContain("RUNNING");
    expect(SENDER_ACTIVE_CAMPAIGN_STATUSES).toContain("SCHEDULED");
    expect(SENDER_ACTIVE_RUN_STATUSES).toContain("QUEUED");
    expect(SENDER_ACTIVE_RUN_STATUSES).toContain("RUNNING");
  });

  it("describes removal with the sender email and reassures about history", () => {
    const copy = describeSenderRemoval("owner@gmail.com");
    expect(copy).toContain("owner@gmail.com");
    expect(copy).toMatch(/sequence history stays available/i);
  });
});

describe("validatePasswordChange", () => {
  it("requires the current password when changing an existing one", () => {
    expect(
      validatePasswordChange({ hasPassword: true, currentPassword: "", newPassword: "abcdefgh", confirmPassword: "abcdefgh" })
    ).toEqual({ ok: false, message: PASSWORD_CURRENT_REQUIRED_MESSAGE });
  });

  it("does not require a current password for a google-only account setting one", () => {
    expect(
      validatePasswordChange({ hasPassword: false, currentPassword: "", newPassword: "abcdefgh", confirmPassword: "abcdefgh" })
    ).toEqual({ ok: true });
  });

  it(`rejects passwords shorter than ${MIN_PASSWORD_LENGTH} characters`, () => {
    expect(
      validatePasswordChange({ hasPassword: true, currentPassword: "current", newPassword: "short", confirmPassword: "short" })
    ).toEqual({ ok: false, message: PASSWORD_TOO_SHORT_MESSAGE });
  });

  it("rejects a confirmation mismatch", () => {
    expect(
      validatePasswordChange({
        hasPassword: true,
        currentPassword: "current",
        newPassword: "abcdefgh",
        confirmPassword: "different"
      })
    ).toEqual({ ok: false, message: PASSWORD_MISMATCH_MESSAGE });
  });

  it("accepts a valid change", () => {
    expect(
      validatePasswordChange({
        hasPassword: true,
        currentPassword: "current",
        newPassword: "abcdefgh",
        confirmPassword: "abcdefgh"
      })
    ).toEqual({ ok: true });
  });
});
