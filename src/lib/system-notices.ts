import { SystemNoticeType } from "@prisma/client";
import { z } from "zod";

export const SYSTEM_NOTICE_TYPE_LABELS: Record<SystemNoticeType, string> = {
  PLANNED_MAINTENANCE: "Planned maintenance",
  DEGRADED_PERFORMANCE: "Degraded performance",
  SERVICE_DISRUPTION: "Service disruption",
  RESOLVED: "Resolved",
  GENERAL: "Service notice"
};

export const SYSTEM_NOTICE_SUBJECT_SUGGESTIONS: Record<SystemNoticeType, string> = {
  PLANNED_MAINTENANCE: "Scheduled maintenance: Sendloom",
  DEGRADED_PERFORMANCE: "Service update: Sendloom performance",
  SERVICE_DISRUPTION: "Service disruption affecting Sendloom",
  RESOLVED: "Resolved: Sendloom service has recovered",
  GENERAL: "Sendloom service notice"
};

export function normalizeIanaTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 100 || /^[+-]\d/.test(candidate)) return null;

  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: candidate }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

const optionalInstant = z
  .union([z.string().datetime({ offset: true }), z.null()])
  .optional()
  .transform((value) => (value ? new Date(value) : null));

const optionalPlainText = (max: number) =>
  z
    .union([z.string().max(max), z.null()])
    .optional()
    .transform((value) => value?.trim() || null);

export const systemNoticeInputSchema = z
  .object({
    type: z.nativeEnum(SystemNoticeType),
    subject: z.string().trim().min(1, "Subject is required.").max(160),
    title: z.string().trim().min(1, "Title is required.").max(140),
    message: z.string().trim().min(1, "Message is required.").max(5000),
    affectedArea: optionalPlainText(160),
    scheduledSendAt: optionalInstant,
    impactStartsAt: optionalInstant,
    impactEndsAt: optionalInstant,
    timeZone: z
      .string()
      .trim()
      .min(1, "Timezone is required.")
      .max(100)
      .transform((value, context) => {
        const normalized = normalizeIanaTimeZone(value);
        if (!normalized) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: "Select a valid IANA timezone." });
          return z.NEVER;
        }
        return normalized;
      })
  })
  .strict()
  .superRefine((value, context) => {
    if (value.impactStartsAt && value.impactEndsAt && value.impactEndsAt <= value.impactStartsAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["impactEndsAt"],
        message: "Impact end must be after impact start."
      });
    }
  });

export const scheduleSystemNoticeSchema = z
  .object({
    scheduledSendAt: z.string().datetime({ offset: true }).transform((value) => new Date(value)),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .transform((value, context) => {
        const normalized = normalizeIanaTimeZone(value);
        if (!normalized) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: "Select a valid IANA timezone." });
          return z.NEVER;
        }
        return normalized;
      })
  })
  .strict();

export type SystemNoticeInput = z.infer<typeof systemNoticeInputSchema>;

export function ensureFutureScheduledInstant(value: Date, now = new Date()) {
  if (!Number.isFinite(value.getTime()) || value <= now) {
    throw new SystemNoticeValidationError("Scheduled send time must be in the future.");
  }
  return value;
}

export class SystemNoticeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SystemNoticeValidationError";
  }
}

export class SystemNoticeActionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SystemNoticeActionError";
  }
}
