/**
 * Shared follow-up email types, constants, and validation used by the
 * server (campaign service, API routes, scheduler) and the client UI.
 */

export const FOLLOW_UP_SEND_MODES = ["same_thread", "new_email"] as const;
export type FollowUpSendMode = (typeof FOLLOW_UP_SEND_MODES)[number];

export const FOLLOW_UP_SEND_MODE_LABELS: Record<FollowUpSendMode, string> = {
  same_thread: "Same email thread",
  new_email: "New email"
};

/** Per-recipient follow-up lifecycle status (stored on RecipientJob.followUpStatus). */
export const FOLLOW_UP_STATUSES = ["PENDING", "SENT", "FAILED", "SKIPPED"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

/** Max follow-up send attempts before a recipient is marked failed. */
export const MAX_FOLLOW_UP_ATTEMPTS = 3;

export type FollowUpTemplateSnapshot = {
  subject: string;
  format?: string;
  htmlBody: string;
  variableManifest?: unknown;
};

export type FollowUpConfigInput = {
  enabled: boolean;
  templateId: string | null;
  sendMode: FollowUpSendMode | null;
  /** ISO-8601 UTC instant. */
  scheduledAt: string | null;
  timezone: string | null;
};

export function isFollowUpSendMode(value: unknown): value is FollowUpSendMode {
  return typeof value === "string" && (FOLLOW_UP_SEND_MODES as readonly string[]).includes(value);
}

export type FollowUpValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Validate a follow-up configuration. Shared by client and server so the
 * rules (template required, future send time, valid mode) stay identical.
 */
export function validateFollowUpConfig(
  input: {
    enabled: boolean;
    templateId?: string | null;
    sendMode?: string | null;
    scheduledAt?: string | null;
  },
  now: Date = new Date()
): FollowUpValidationResult {
  if (!input.enabled) {
    return { ok: true };
  }

  if (!input.templateId) {
    return { ok: false, error: "Choose a follow-up template." };
  }

  if (!isFollowUpSendMode(input.sendMode ?? "")) {
    return { ok: false, error: "Choose a follow-up delivery mode." };
  }

  if (!input.scheduledAt) {
    return { ok: false, error: "Choose when the follow-up should send." };
  }

  const scheduledAt = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { ok: false, error: "Choose a valid follow-up send time." };
  }

  if (scheduledAt.getTime() <= now.getTime()) {
    return { ok: false, error: "Choose a future time for the follow-up." };
  }

  return { ok: true };
}

/** Strip a leading "Re:" so same-thread replies don't stack "Re: Re:". */
export function toReplySubject(subject: string) {
  const trimmed = subject.trim();
  const withoutRe = trimmed.replace(/^(re:\s*)+/i, "").trim();
  return `Re: ${withoutRe || trimmed}`;
}
