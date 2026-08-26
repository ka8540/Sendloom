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
const PASSWORD_VERIFY_ROUTE = readFileSync("src/app/api/account/password/verify/route.ts", "utf8");
const PASSWORD_RESEND_ROUTE = readFileSync("src/app/api/account/password/resend/route.ts", "utf8");
const PHOTO_ROUTE = readFileSync("src/app/api/account/profile-photo/route.ts", "utf8");
const PHOTO_IMAGE_ROUTE = readFileSync("src/app/api/account/profile-photo/image/route.ts", "utf8");

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
  it("renders the identity card: avatar initial, email, integrated account type", () => {
    expect(DASHBOARD).toContain("accountInitial(profile)");
    expect(DASHBOARD).toContain("{profile.name ?? profile.email}");
    expect(DASHBOARD).toContain("ACCOUNT_TYPE_LABELS[profile.accountType]");
    expect(DASHBOARD).toContain("Member since");
    expect(DASHBOARD).toContain("Last sign-in");
  });

  it("does not render a 'Signed in' badge or other decorative status chips", () => {
    expect(DASHBOARD).not.toContain("Signed in");
    expect(DASHBOARD).not.toContain("signedInBadge");
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
  it("hides the Remove action when only one sender exists, with helper text below the list", () => {
    // No disabled pill in the row — the action only renders when removal is allowed.
    expect(DASHBOARD).toContain("{canRemoveSenders ? (");
    expect(DASHBOARD).not.toContain("disabled={!canRemoveSenders}");
    expect(DASHBOARD).toContain("{!canRemoveSenders ? (");
    expect(DASHBOARD).toContain("Connect another Gmail account before removing this sender.");
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
    expect(DASHBOARD).toContain('hasPassword ? "Password" : "Set a password"');
    expect(DASHBOARD).toContain('hasPassword ? "Update password" : "Set password"');
    expect(DASHBOARD).toContain("{hasPassword ? (");
  });

  it("validates before submit using the shared pure validator", () => {
    expect(DASHBOARD).toContain("validatePasswordChange({ hasPassword, currentPassword, newPassword, confirmPassword })");
    expect(DASHBOARD).toContain("/api/account/password");
  });

  it("transitions to an inline OTP step and clears plaintext password state", () => {
    expect(DASHBOARD).toContain("<OtpVerificationForm");
    expect(DASHBOARD).toContain('verifyEndpoint="/api/account/password/verify"');
    expect(DASHBOARD).toContain('resendEndpoint="/api/account/password/resend"');
    expect(DASHBOARD).toContain('submitLabel="Verify & update password"');
    expect(DASHBOARD).toContain('setCurrentPassword("")');
    expect(DASHBOARD).toContain('setNewPassword("")');
    expect(DASHBOARD).toContain('setConfirmPassword("")');
    expect(DASHBOARD).toContain('cancelLabel="Cancel"');
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

  it("password start authenticates, rate-limits, verifies the current password, and creates only a challenge", () => {
    expect(PASSWORD_ROUTE).toContain("requireApiUser");
    expect(PASSWORD_ROUTE).toContain("rateLimit");
    expect(PASSWORD_ROUTE).toContain("verifyPassword");
    expect(PASSWORD_ROUTE).toContain("createPasswordHash");
    expect(PASSWORD_ROUTE).toContain("createAuthOtpChallenge");
    expect(PASSWORD_ROUTE).not.toContain("prisma.user.update");
    expect(PASSWORD_ROUTE).not.toContain("setSession(");
    expect(PASSWORD_ROUTE).toContain("validatePasswordChange");
  });

  it("commits the stored hash and rotates the session only in the authenticated verify route", () => {
    expect(PASSWORD_VERIFY_ROUTE).toContain("requireApiUser");
    expect(PASSWORD_VERIFY_ROUTE).toContain('purpose: "PASSWORD_CHANGE"');
    expect(PASSWORD_VERIFY_ROUTE).toContain("userId: auth.user.id");
    expect(PASSWORD_VERIFY_ROUTE).toContain("verifyAndConsumeAuthOtpChallenge");
    expect(PASSWORD_VERIFY_ROUTE).toContain("prisma.user.update");
    expect(PASSWORD_VERIFY_ROUTE).toContain("setSession(auth.user.email)");
    expect(PASSWORD_RESEND_ROUTE).toContain("rotateAuthOtpChallenge");
  });

  it("never serializes a password hash back to the client", () => {
    // No NextResponse.json(...) payload includes the hash (the only passwordHash
    // use is the prisma write + the verify/derive helpers).
    expect(PASSWORD_ROUTE).not.toMatch(/NextResponse\.json\([^;]*passwordHash/);
    expect(PASSWORD_VERIFY_ROUTE).not.toMatch(/NextResponse\.json\([^;]*passwordHash/);
    expect(ACCOUNT_ROUTE).not.toMatch(/NextResponse\.json\([^;]*passwordHash/);
    expect(DASHBOARD).not.toContain("passwordHash");
  });
});

describe("account dashboard — profile photo", () => {
  it("renders the uploaded photo with alt text and falls back to the account initial", () => {
    expect(DASHBOARD).toContain("profile.profilePhotoUrl && !photoFailed");
    expect(DASHBOARD).toContain('alt="Profile photo"');
    expect(DASHBOARD).toContain("accountInitial(profile)");
    // A failed image load returns to the initial — never a broken-image icon.
    expect(DASHBOARD).toContain("onError={() => setPhotoFailed(true)}");
  });

  it("offers a hidden file input gated to jpeg/png/webp behind a keyboard-accessible button", () => {
    expect(DASHBOARD).toContain('type="file"');
    expect(DASHBOARD).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(DASHBOARD).toContain("photoInputRef.current?.click()");
    expect(DASHBOARD).toContain('aria-label="Choose a profile photo"');
  });

  it("shows Upload/Change + Remove controls and an uploading state", () => {
    expect(DASHBOARD).toContain('"Uploading…"');
    expect(DASHBOARD).toContain('"Change photo"');
    expect(DASHBOARD).toContain('"Upload photo"');
    expect(DASHBOARD).toMatch(/className=\{styles\.photoRemoveButton\}[\s\S]*?>\s*Remove\s*<\/button>/);
  });

  it("uploads via multipart POST to the profile-photo route and refreshes the nav on success", () => {
    expect(DASHBOARD).toContain('formData.append("photo", file)');
    expect(DASHBOARD).toContain('fetch("/api/account/profile-photo", { method: "POST", body: formData })');
    expect(DASHBOARD).toContain("router.refresh()");
    expect(DASHBOARD).toContain("useRouter");
  });

  it("validates type and size client-side as a convenience before upload", () => {
    expect(DASHBOARD).toContain('["image/jpeg", "image/png", "image/webp"].includes(file.type)');
    expect(DASHBOARD).toContain("file.size > PROFILE_PHOTO_MAX_BYTES");
  });

  it("confirms removal in the shared dialog and clears the avatar on success", () => {
    expect(DASHBOARD).toContain('title="Remove profile photo?"');
    expect(DASHBOARD).toContain('confirmLabel="Remove photo"');
    expect(DASHBOARD).toContain('fetch("/api/account/profile-photo", { method: "DELETE" })');
    expect(DASHBOARD).toContain("applyProfilePhotoUrl(null)");
  });
});

describe("profile photo API routes", () => {
  it("upload/delete authenticate with the existing API helper and rate-limit per user", () => {
    expect(PHOTO_ROUTE).toContain("requireApiUser");
    expect(PHOTO_ROUTE.match(/rateLimit/g)?.length).toBeGreaterThanOrEqual(2);
    expect(PHOTO_ROUTE).toContain("account:profile-photo:user:");
  });

  it("stores photos in the existing attachments bucket only — no new bucket", () => {
    expect(PHOTO_ROUTE).toContain('bucket: "attachments"');
    expect(PHOTO_ROUTE).not.toMatch(/profile.?images? bucket|avatars? bucket/i);
    expect(PHOTO_ROUTE).not.toContain("CLOUDFLARE_R2_PROFILE");
    expect(PHOTO_ROUTE).not.toContain("AVATAR_BUCKET");
  });

  it("scopes the object key to the session user and sniffs the real bytes", () => {
    expect(PHOTO_ROUTE).toContain("buildProfilePhotoKey(auth.user.id,");
    expect(PHOTO_ROUTE).toContain("detectProfilePhotoType(buffer)");
    expect(PHOTO_ROUTE).toContain("PROFILE_PHOTO_MAX_BYTES");
    expect(PHOTO_ROUTE).not.toContain('formData?.get("userId")');
    expect(PHOTO_ROUTE).not.toContain("file.name");
  });

  it("deletes the old object only after the DB points at the new photo", () => {
    const uploadIndex = PHOTO_ROUTE.indexOf("await uploadObject(");
    const updateIndex = PHOTO_ROUTE.indexOf("await prisma.user.update(");
    const oldDeleteIndex = PHOTO_ROUTE.indexOf('await deleteObject("attachments", previousKey)');
    expect(uploadIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(uploadIndex);
    expect(oldDeleteIndex).toBeGreaterThan(updateIndex);
  });

  it("removes the orphaned new object when the DB update fails", () => {
    expect(PHOTO_ROUTE).toContain('await deleteObject("attachments", newKey).catch(() => undefined)');
  });

  it("serves only the session user's own photo with safe headers", () => {
    expect(PHOTO_IMAGE_ROUTE).toContain("requireApiUser");
    expect(PHOTO_IMAGE_ROUTE).toContain("auth.user.profilePhotoKey");
    expect(PHOTO_IMAGE_ROUTE).toContain('getObjectBuffer("attachments", key)');
    expect(PHOTO_IMAGE_ROUTE).toContain('"X-Content-Type-Options": "nosniff"');
    expect(PHOTO_IMAGE_ROUTE).toContain('"private, max-age=3600"');
    // No request parameter at all — arbitrary keys/userIds can never be read.
    expect(PHOTO_IMAGE_ROUTE).toContain("export async function GET()");
  });
});
