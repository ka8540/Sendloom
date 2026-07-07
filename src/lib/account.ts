import type { CampaignStatus, RunStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Pure account helpers, view types, and shared copy.
//
// This module is deliberately free of any database / server-only imports so it
// can be shared by server services, API routes, the client dashboard, and the
// node test suite. Secrets (password hashes, OAuth refresh tokens) never appear
// in any type defined here.
// ---------------------------------------------------------------------------

// The raw `provider` key stored on a SenderProfile is an internal detail; the
// UI shows a friendly, human name instead.
const PROVIDER_LABELS: Record<string, string> = {
  google_oauth: "Gmail"
};

export function getSenderProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? "Email";
}

export type SenderConnectionStatus = "connected" | "reconnect_required";

// A sender can send only while it holds a Google refresh token. A missing token
// (revoked/expired) means the account owner must reconnect before sending.
export function getSenderConnectionStatus(sender: { oauthRefreshToken: string | null }): SenderConnectionStatus {
  return sender.oauthRefreshToken ? "connected" : "reconnect_required";
}

// Campaign / run statuses that count a sender as being "in active use". Removal
// is blocked while any of these reference the sender so we never orphan running
// or scheduled work.
export const SENDER_ACTIVE_CAMPAIGN_STATUSES = [
  "SCHEDULED",
  "WAITING_FOR_SLOT",
  "RUNNING",
  "PAUSED"
] as const satisfies ReadonlyArray<CampaignStatus>;

export const SENDER_ACTIVE_RUN_STATUSES = [
  "QUEUED",
  "WAITING_FOR_SLOT",
  "RUNNING",
  "PAUSED"
] as const satisfies ReadonlyArray<RunStatus>;

export type AccountType = "password" | "google";

// Login capability is derived from a single stored fact: whether the account
// has a password hash. Google-only accounts have none; email/password accounts
// do. We never claim a linked-Google state we cannot prove from stored fields.
export function deriveAccountType(hasPassword: boolean): AccountType {
  return hasPassword ? "password" : "google";
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  password: "Password account",
  google: "Google account"
};

// --- Client-safe view types (serialized into the account payload) -----------

export type AccountSenderView = {
  id: string;
  name: string;
  fromEmail: string;
  provider: string;
  providerLabel: string;
  status: SenderConnectionStatus;
  connectedAt: string;
  updatedAt: string;
};

export type AccountProfileView = {
  email: string;
  /** User has no stored name field today — surfaced as null, never invented. */
  name: string | null;
  accountType: AccountType;
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
};

export type AccountOverview = {
  profile: AccountProfileView;
  senders: AccountSenderView[];
  /** True only when more than one sender is connected — the removal gate. */
  canRemoveSenders: boolean;
};

// --- Sender removal outcome contract (shared server + client copy) ----------

export type SenderRemovalReason = "not_found" | "only_sender" | "active_campaigns";

export const SENDER_REMOVAL_MESSAGES: Record<SenderRemovalReason, string> = {
  not_found: "We couldn't find that connected sender.",
  only_sender:
    "You need at least one connected sender. Connect another Gmail account before removing this one.",
  active_campaigns:
    "This sender is used by active or scheduled sequences. Pause or update those sequences before removing it."
};

export const SENDER_REMOVAL_HTTP_STATUS: Record<SenderRemovalReason, number> = {
  not_found: 404,
  only_sender: 409,
  active_campaigns: 409
};

/** Confirmation-dialog body copy for removing a specific sender. */
export function describeSenderRemoval(fromEmail: string): string {
  return `This removes Gmail sending access for ${fromEmail}. Existing sequence history stays available.`;
}

// --- Password rules (mirror signup's z.string().min(8)) ---------------------

export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_UPDATE_SUCCESS_MESSAGE = "Password updated.";
export const PASSWORD_UPDATE_ERROR_MESSAGE =
  "We couldn't update your password. Check your current password and try again.";
export const PASSWORD_MISMATCH_MESSAGE = "New password and confirmation do not match.";
export const PASSWORD_TOO_SHORT_MESSAGE = `Use at least ${MIN_PASSWORD_LENGTH} characters for your new password.`;
export const PASSWORD_CURRENT_REQUIRED_MESSAGE = "Enter your current password.";

export type PasswordValidationResult = { ok: true } | { ok: false; message: string };

// Pure validation shared by the API route and its tests. `hasPassword` decides
// whether this is a change (current password required) or an initial set for a
// Google-only account.
export function validatePasswordChange(input: {
  hasPassword: boolean;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): PasswordValidationResult {
  if (input.hasPassword && input.currentPassword.length === 0) {
    return { ok: false, message: PASSWORD_CURRENT_REQUIRED_MESSAGE };
  }

  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: PASSWORD_TOO_SHORT_MESSAGE };
  }

  if (input.newPassword !== input.confirmPassword) {
    return { ok: false, message: PASSWORD_MISMATCH_MESSAGE };
  }

  return { ok: true };
}
