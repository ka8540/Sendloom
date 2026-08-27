import { z } from "zod";

import { normalizeIanaTimeZone } from "@/lib/system-notices";

export const PRODUCT_UPDATE_CONFIRMATION_PHRASE = "SEND TO ALL USERS";
export const PRODUCT_UPDATE_MAX_FEATURES = 5;

const AUTHENTICATED_CTA_ROOTS = new Set([
  "account",
  "analysis",
  "campaigns",
  "finder",
  "imports",
  "prospects",
  "sequences",
  "suppressions",
  "templates",
  "workspace"
]);

export type ProductUpdateFeature = {
  title: string;
  description: string;
  ctaLabel: string | null;
  ctaHref: string | null;
};

export function normalizeProductUpdateCtaHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    candidate.includes("%") ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return null;
  }

  try {
    const parsed = new URL(candidate, "https://sendloom.invalid");
    const root = parsed.pathname.split("/").filter(Boolean)[0];
    if (parsed.origin !== "https://sendloom.invalid" || !root || !AUTHENTICATED_CTA_ROOTS.has(root)) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

const optionalCtaText = (max: number) =>
  z
    .union([z.string().max(max), z.null()])
    .optional()
    .transform((value) => value?.trim() || null);

export const productUpdateFeatureSchema = z
  .object({
    title: z.string().trim().min(1, "Feature title is required.").max(120),
    description: z.string().trim().min(1, "Feature description is required.").max(1200),
    ctaLabel: optionalCtaText(50),
    ctaHref: optionalCtaText(500).transform((value, context) => {
      if (!value) return null;
      const normalized = normalizeProductUpdateCtaHref(value);
      if (!normalized) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "CTA destination must be a safe authenticated Sendloom path."
        });
        return z.NEVER;
      }
      return normalized;
    })
  })
  .strict()
  .superRefine((feature, context) => {
    if (Boolean(feature.ctaLabel) !== Boolean(feature.ctaHref)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [feature.ctaLabel ? "ctaHref" : "ctaLabel"],
        message: "CTA label and destination must be provided together."
      });
    }
  });

const optionalInstant = z
  .union([z.string().datetime({ offset: true }), z.null()])
  .optional()
  .transform((value) => (value ? new Date(value) : null));

const timeZoneSchema = z
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
  });

export const productUpdateBroadcastInputSchema = z
  .object({
    subject: z
      .string()
      .trim()
      .min(1, "Email subject is required.")
      .max(160)
      .refine((value) => !/[\r\n]/.test(value), "Email subject cannot contain line breaks."),
    headline: z.string().trim().min(1, "Email headline is required.").max(140),
    intro: z.string().trim().min(1, "Intro message is required.").max(1500),
    features: z
      .array(productUpdateFeatureSchema)
      .min(1, "Add at least one feature.")
      .max(PRODUCT_UPDATE_MAX_FEATURES, `Add no more than ${PRODUCT_UPDATE_MAX_FEATURES} features.`),
    scheduledSendAt: optionalInstant,
    timeZone: timeZoneSchema
  })
  .strict();

export const scheduleProductUpdateBroadcastSchema = z
  .object({
    scheduledSendAt: z.string().datetime({ offset: true }).transform((value) => new Date(value)),
    timeZone: timeZoneSchema
  })
  .strict();

export const sendNowProductUpdateBroadcastSchema = z
  .object({
    confirmation: z.literal(PRODUCT_UPDATE_CONFIRMATION_PHRASE)
  })
  .strict();

export type ProductUpdateBroadcastInput = z.infer<typeof productUpdateBroadcastInputSchema>;

export function ensureFutureProductUpdateInstant(value: Date, now = new Date()) {
  if (!Number.isFinite(value.getTime()) || value <= now) {
    throw new ProductUpdateValidationError("Scheduled send time must be in the future.");
  }
  return value;
}

export function parseStoredProductUpdateFeatures(value: unknown): ProductUpdateFeature[] {
  const parsed = z.array(productUpdateFeatureSchema).min(1).max(PRODUCT_UPDATE_MAX_FEATURES).safeParse(value);
  if (!parsed.success) {
    throw new ProductUpdateValidationError("Stored product update features are invalid.");
  }
  return parsed.data;
}

export class ProductUpdateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductUpdateValidationError";
  }
}

export class ProductUpdateActionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ProductUpdateActionError";
  }
}
