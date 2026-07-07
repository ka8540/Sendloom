import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The account dashboard is a "use client" component and the API routes run on
// the server; the suite runs in a node env (no DOM), so this coverage uses
// source assertions plus the pure logic tested in ./account.test-adjacent files.
const DASHBOARD = readFileSync("src/components/account/account-dashboard.tsx", "utf8");
const PAGE = readFileSync("src/app/(app)/account/page.tsx", "utf8");
const ACCOUNT_ROUTE = readFileSync("src/app/api/account/route.ts", "utf8");
const SENDER_ROUTE = readFileSync("src/app/api/account/senders/[id]/route.ts", "utf8");
const PASSWORD_ROUTE = readFileSync("src/app/api/account/password/route.ts", "utf8");

describe("account page (server component)", () => {
  it("guards to operators, loads the overview server-side, and renders the dashboard", () => {
    expect(PAGE).toContain("requireOperatorUser");
    expect(PAGE).toContain("getAccountOverview");
    expect(PAGE).toContain("<AccountDashboard");
  });

  it("wires the Connect Gmail CTA to the existing OAuth kickoff, returning to /account", () => {
    expect(PAGE).toContain("/api/auth/google/connect?next=");
    expect(PAGE).toContain('encodeURIComponent("/account")');
    expect(PAGE).toContain("connectGmailHref");
  });
});

describe("account dashboard — profile + senders", () => {
  it("renders profile identity: login email and account type", () => {
    expect(DASHBOARD).toContain("{profile.email}");
    expect(DASHBOARD).toContain("ACCOUNT_TYPE_LABELS[profile.accountType]");
    expect(DASHBOARD).toContain("Login email");
  });

  it("renders connected senders with name, email, provider and connection status", () => {
    expect(DASHBOARD).toContain("senders.map((sender)");
    expect(DASHBOARD).toContain("{sender.name}");
    expect(DASHBOARD).toContain("{sender.fromEmail}");
    expect(DASHBOARD).toContain("{sender.providerLabel}");
    expect(DASHBOARD).toContain('sender.status === "connected"');
    expect(DASHBOARD).toContain("Reconnect required");
  });

  it("renders an empty state with a Connect Gmail CTA when there are no senders", () => {
    expect(DASHBOARD).toContain("senders.length === 0");
    expect(DASHBOARD).toContain("No senders connected yet");
    expect(DASHBOARD).toMatch(/href=\{connectGmailHref\}/);
  });

  it("offers 'Connect another Gmail' via the existing connect path", () => {
    expect(DASHBOARD).toContain("Connect another Gmail");
    // Both CTAs reuse the same server-provided connect href (no hand-rolled URL).
    expect(DASHBOARD.match(/href=\{connectGmailHref\}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(DASHBOARD).toContain("/api/auth/google/connect?email=");
  });
});

describe("account dashboard — sender removal", () => {
  it("disables Remove when only one sender exists, with an explanation", () => {
    expect(DASHBOARD).toContain("disabled={!canRemoveSenders}");
    expect(DASHBOARD).toContain("Add another sender before removing this one.");
    // The disabled button points at the helper text for assistive tech.
    expect(DASHBOARD).toContain("aria-describedby={canRemoveSenders ? undefined : removeHelperId}");
  });

  it("names which sender each Remove button removes", () => {
    expect(DASHBOARD).toContain("aria-label={`Remove sender ${sender.fromEmail}`}");
  });

  it("opens the shared in-app confirmation dialog (never a native confirm)", () => {
    expect(DASHBOARD).toContain("<AppConfirmDialog");
    expect(DASHBOARD).toContain('title="Remove sender?"');
    expect(DASHBOARD).toContain('confirmLabel="Remove sender"');
    expect(DASHBOARD).toContain("describeSenderRemoval(pendingRemoval.fromEmail)");
    expect(DASHBOARD).not.toMatch(/\b(?:window|globalThis)\.(?:confirm|alert|prompt)\s*\(/);
  });

  it("confirming issues a scoped DELETE and refreshes the list on success", () => {
    expect(DASHBOARD).toContain("`/api/account/senders/${encodeURIComponent(target.id)}`");
    expect(DASHBOARD).toContain('method: "DELETE"');
    expect(DASHBOARD).toContain("await refresh()");
    expect(DASHBOARD).toContain("showSuccess(");
  });

  it("surfaces a safe error in-dialog when removal fails", () => {
    expect(DASHBOARD).toContain("setRemoveError(");
    expect(DASHBOARD).toContain("error={removeError}");
  });
});

describe("account dashboard — password", () => {
  it("shows a change form for password users and a set form for google accounts", () => {
    expect(DASHBOARD).toContain("hasPassword ? \"Change password\" : \"Set a password\"");
    expect(DASHBOARD).toContain('hasPassword ? "Update password" : "Set password"');
    expect(DASHBOARD).toContain("{hasPassword ? (");
  });

  it("validates before submit using the shared pure validator", () => {
    expect(DASHBOARD).toContain("validatePasswordChange({ hasPassword, currentPassword, newPassword, confirmPassword })");
    expect(DASHBOARD).toContain("/api/account/password");
  });

  it("labels every field and sets correct password autocomplete attributes", () => {
    expect(DASHBOARD).toContain("htmlFor={currentPasswordId}");
    expect(DASHBOARD).toContain("htmlFor={newPasswordId}");
    expect(DASHBOARD).toContain("htmlFor={confirmPasswordId}");
    expect(DASHBOARD).toContain('autoComplete="current-password"');
    expect(DASHBOARD).toContain('autoComplete="new-password"');
  });

  it("disables actions while submitting and announces errors politely", () => {
    expect(DASHBOARD).toContain("disabled={savingPassword}");
    expect(DASHBOARD).toContain('role="alert"');
    expect(DASHBOARD).toContain("useErrorToast");
  });
});

describe("account API routes", () => {
  it("GET /api/account is authenticated and returns the safe overview", () => {
    expect(ACCOUNT_ROUTE).toContain("requireApiUser");
    expect(ACCOUNT_ROUTE).toContain("getAccountOverview");
  });

  it("DELETE sender route authenticates, delegates to the guarded service, and maps safe statuses", () => {
    expect(SENDER_ROUTE).toContain("export async function DELETE");
    expect(SENDER_ROUTE).toContain("requireApiUser");
    expect(SENDER_ROUTE).toContain("removeUserSender(auth.user.id, id)");
    expect(SENDER_ROUTE).toContain("SENDER_REMOVAL_MESSAGES[result.reason]");
    expect(SENDER_ROUTE).toContain("SENDER_REMOVAL_HTTP_STATUS[result.reason]");
    expect(SENDER_ROUTE).toContain("recordAuditEvent");
  });

  it("password route authenticates, rate-limits, verifies, hashes, and rotates the session", () => {
    expect(PASSWORD_ROUTE).toContain("requireApiUser");
    expect(PASSWORD_ROUTE).toContain("rateLimit");
    expect(PASSWORD_ROUTE).toContain("verifyPassword");
    expect(PASSWORD_ROUTE).toContain("createPasswordHash");
    expect(PASSWORD_ROUTE).toContain("setSession(auth.user.email)");
    expect(PASSWORD_ROUTE).toContain("validatePasswordChange");
  });

  it("never serializes a password hash back to the client", () => {
    // No NextResponse.json(...) payload includes the hash (the only passwordHash
    // use is the prisma write + the verify/derive helpers).
    expect(PASSWORD_ROUTE).not.toMatch(/NextResponse\.json\([^;]*passwordHash/);
    expect(ACCOUNT_ROUTE).not.toMatch(/NextResponse\.json\([^;]*passwordHash/);
    expect(DASHBOARD).not.toContain("passwordHash");
  });
});
