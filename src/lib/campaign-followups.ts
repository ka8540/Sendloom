import type { FollowUpSendMode } from "@prisma/client";

export const FOLLOW_UP_MIN_DELAY_DAYS = 1;
export const FOLLOW_UP_MAX_DELAY_DAYS = 60;
export const FOLLOW_UP_SEND_MODES = ["SAME_THREAD", "NEW_EMAIL"] as const;
export const FOLLOW_UP_PROCESSABLE_RUN_STATUSES = ["QUEUED", "RUNNING", "COMPLETED"] as const;

export type NormalizedFollowUpConfig =
  | {
      enabled: false;
      templateId: null;
      delayDays: null;
      sendMode: null;
    }
  | {
      enabled: true;
      templateId: string;
      delayDays: number;
      sendMode: FollowUpSendMode;
    };

export type FollowUpConfigInput = {
  enabled?: boolean;
  templateId?: string | null;
  delayDays?: number | null;
  sendMode?: string | null;
};

export type FollowUpValidationResult =
  | {
      ok: true;
      config: NormalizedFollowUpConfig;
    }
  | {
      ok: false;
      error: string;
    };

export const disabledFollowUpConfig: NormalizedFollowUpConfig = {
  enabled: false,
  templateId: null,
  delayDays: null,
  sendMode: null
};

export function normalizeFollowUpSendMode(value?: string | null): FollowUpSendMode | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().replace(/-/g, "_").toUpperCase();
  return FOLLOW_UP_SEND_MODES.includes(normalized as FollowUpSendMode) ? (normalized as FollowUpSendMode) : null;
}

export function validateFollowUpConfig(
  input: FollowUpConfigInput,
  options: {
    followUpTemplateSubject?: string | null;
    validateTemplateSubject?: boolean;
  } = {}
): FollowUpValidationResult {
  if (!input.enabled) {
    return {
      ok: true,
      config: disabledFollowUpConfig
    };
  }

  const templateId = input.templateId?.trim();
  if (!templateId) {
    return {
      ok: false,
      error: "Select a follow-up template."
    };
  }

  const delayDays = input.delayDays;
  if (!Number.isInteger(delayDays) || delayDays == null || delayDays < FOLLOW_UP_MIN_DELAY_DAYS) {
    return {
      ok: false,
      error: "Enter a delay of at least 1 day."
    };
  }

  if (delayDays > FOLLOW_UP_MAX_DELAY_DAYS) {
    return {
      ok: false,
      error: `Enter a delay of ${FOLLOW_UP_MAX_DELAY_DAYS} days or less.`
    };
  }

  const sendMode = normalizeFollowUpSendMode(input.sendMode);
  if (!sendMode) {
    return {
      ok: false,
      error: "Choose how the follow-up should be sent."
    };
  }

  if (options.validateTemplateSubject && sendMode === "NEW_EMAIL" && !options.followUpTemplateSubject?.trim()) {
    return {
      ok: false,
      error: "New email follow-ups require a subject."
    };
  }

  return {
    ok: true,
    config: {
      enabled: true,
      templateId,
      delayDays,
      sendMode
    }
  };
}

export function addFollowUpDelay(sentAt: Date, delayDays: number) {
  return new Date(sentAt.getTime() + delayDays * 24 * 60 * 60_000);
}

export function canProcessFollowUpsForRunStatus(status: string) {
  return FOLLOW_UP_PROCESSABLE_RUN_STATUSES.includes(status as (typeof FOLLOW_UP_PROCESSABLE_RUN_STATUSES)[number]);
}

export function getFollowUpSendSubject(args: {
  sendMode: FollowUpSendMode;
  originalSubject: string;
  renderedFollowUpSubject: string;
}) {
  if (args.sendMode === "NEW_EMAIL") {
    return args.renderedFollowUpSubject.trim();
  }

  const originalSubject = args.originalSubject.trim();
  if (!originalSubject) {
    return "";
  }

  return /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;
}

export function mergeReferencesHeader(currentReferences?: string | null, messageIdHeader?: string | null) {
  const references = [currentReferences, messageIdHeader]
    .flatMap((value) => (value ? value.split(/\s+/) : []))
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set(references)).join(" ") || null;
}
