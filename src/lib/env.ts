import { loadEnvConfig } from "@next/env";
import { z } from "zod";

const globalForEnv = globalThis as typeof globalThis & { __sendloomEnvLoaded?: boolean };

if (!globalForEnv.__sendloomEnvLoaded) {
  loadEnvConfig(process.cwd());
  globalForEnv.__sendloomEnvLoaded = true;
}

// Coerce a string env flag into a boolean. Only the literal string "true"
// (case-insensitive) enables a flag; anything else (including unset) is false.
const booleanFlag = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined ? defaultValue : value.trim().toLowerCase() === "true"));

const prospectAiReasoningEffort = z.preprocess((value) => {
  if (value === undefined || value === "") {
    return "low";
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "minimal" ? "low" : normalized;
}, z.enum(["none", "low", "medium", "high", "xhigh"]).default("low"));

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    SESSION_SECRET: z.string().min(12),
    TRACKING_SECRET: z.string().min(12).optional(),
    MAIL_PROVIDER: z.enum(["gmail", "resend"]).default("gmail"),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    HUNTER_KEY_ENCRYPTION_SECRET: z.string().min(12).optional(),
    CRON_SECRET: z.string().min(1).optional(),
    RESEND_API_KEY: z.string().optional(),
    RESEND_WEBHOOK_SECRET: z.string().optional(),
    APP_BASE_URL: z.string().url(),
    OBJECT_STORAGE_MODE: z.enum(["local", "r2"]).default("local"),
    LOCAL_UPLOAD_DIR: z.string().default("./uploads"),
    CLOUDFLARE_R2_ACCOUNT_ID: z.string().min(1).optional(),
    CLOUDFLARE_R2_IMPORTS_BUCKET: z.string().min(1).optional(),
    CLOUDFLARE_R2_ATTACHMENTS_BUCKET: z.string().min(1).optional(),
    CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    CLOUDFLARE_R2_PUBLIC_BASE_URL: z.string().url().optional(),
    DEFAULT_FROM_EMAIL: z.string().email().optional(),
    DEFAULT_FROM_NAME: z.string().min(1).optional(),
    ADMIN_EMAIL: z.string().email().optional(),
    ADMIN_PASSWORD: z.string().min(8).optional(),
    GMAIL_DAILY_SEND_SAFETY_LIMIT: z.coerce.number().int().positive().default(450),
    // Per-sender send pacing: max Gmail sends per minute per connected sender.
    // Gmail throttles sustained API sends well below its documented per-second
    // quota, so we pace hard. 120/min then 30/min still tripped rate limits on
    // large sequences; 3/min keeps a single mailbox far under the limit. This is
    // separate from GMAIL_DAILY_SEND_SAFETY_LIMIT (the rolling 24h cap) — both
    // are enforced. Parallel sequences for the same sender share this window.
    GMAIL_SENDS_PER_MINUTE: z.coerce.number().int().positive().max(600).default(3),
    // Maximum simultaneous Gmail sends the worker runs at once. Combined with the
    // per-sender pacing above this prevents a burst of concurrent sends from one
    // mailbox, which is what Gmail's anti-abuse rate limiter punishes hardest.
    GMAIL_SENDER_CONCURRENCY: z.coerce.number().int().positive().max(50).default(2),
    // --- Prospect graph backend (local-first prototype) ---
    APIFY_API_TOKEN: z.string().min(1).optional(),
    APIFY_PROSPECT_ACTOR_ID: z.string().min(1).default("harvestapi/linkedin-profile-search"),
    WEB_SEARCH_PROVIDER: z.preprocess(
      (value) => (value === "" || value === undefined ? "none" : String(value).trim().toLowerCase()),
      z.enum(["none", "serper", "brave"]).default("none")
    ),
    SERPER_API_KEY: z.string().min(1).optional(),
    BRAVE_SEARCH_API_KEY: z.string().min(1).optional(),
    PROSPECT_GRAPH_ENABLED: booleanFlag(false),
    GRAPHQL_GRAPHIQL_ENABLED: booleanFlag(false),
    LOCAL_PROSPECT_MAX_RESULTS: z.coerce.number().int().positive().max(200).default(25),
    PROSPECT_AI_ENABLED: booleanFlag(true),
    // Empty string (a blank `PROSPECT_AI_MODEL=` line) is treated as unset so the
    // default model is used.
    PROSPECT_AI_MODEL: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional()),
    // GPT-5.5 rejects the legacy "minimal" effort value. If an old deployment
    // still sets it, coerce to "low" so prospect AI stays available.
    PROSPECT_AI_REASONING_EFFORT: prospectAiReasoningEffort,
    PROSPECT_AI_MAX_COMPANY_CALLS_PER_SEARCH: z.coerce.number().int().nonnegative().default(2),
    PROSPECT_AI_MAX_ROLE_CALLS_PER_SEARCH: z.coerce.number().int().nonnegative().default(1),
    PROSPECT_AI_MAX_PATTERN_CALLS_PER_SEARCH: z.coerce.number().int().nonnegative().default(1),
    PROSPECT_AI_MAX_UNIQUE_TITLES: z.coerce.number().int().positive().default(100),
    PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS: booleanFlag(false)
  })
  .superRefine((value, ctx) => {
    if (value.OBJECT_STORAGE_MODE === "r2") {
      const requiredR2Keys = [
        "CLOUDFLARE_R2_ACCOUNT_ID",
        "CLOUDFLARE_R2_IMPORTS_BUCKET",
        "CLOUDFLARE_R2_ATTACHMENTS_BUCKET",
        "CLOUDFLARE_R2_ACCESS_KEY_ID",
        "CLOUDFLARE_R2_SECRET_ACCESS_KEY"
      ] as const;

      for (const key of requiredR2Keys) {
        if (!value[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when OBJECT_STORAGE_MODE is "r2".`
          });
        }
      }
    }

    if (process.env.NODE_ENV === "production") {
      const requiredInProduction = [
        ["CRON_SECRET", value.CRON_SECRET],
        ["TRACKING_SECRET", value.TRACKING_SECRET],
        ["HUNTER_KEY_ENCRYPTION_SECRET", value.HUNTER_KEY_ENCRYPTION_SECRET]
      ] as const;

      for (const [key, val] of requiredInProduction) {
        if (!val) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required in production.`
          });
        }
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

function readRawEnv() {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    SESSION_SECRET: process.env.SESSION_SECRET,
    TRACKING_SECRET: process.env.TRACKING_SECRET,
    MAIL_PROVIDER: process.env.MAIL_PROVIDER,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    HUNTER_KEY_ENCRYPTION_SECRET: process.env.HUNTER_KEY_ENCRYPTION_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    APP_BASE_URL: process.env.APP_BASE_URL,
    OBJECT_STORAGE_MODE: process.env.OBJECT_STORAGE_MODE,
    LOCAL_UPLOAD_DIR: process.env.LOCAL_UPLOAD_DIR,
    CLOUDFLARE_R2_ACCOUNT_ID: process.env.CLOUDFLARE_R2_ACCOUNT_ID,
    CLOUDFLARE_R2_IMPORTS_BUCKET: process.env.CLOUDFLARE_R2_IMPORTS_BUCKET,
    CLOUDFLARE_R2_ATTACHMENTS_BUCKET: process.env.CLOUDFLARE_R2_ATTACHMENTS_BUCKET,
    CLOUDFLARE_R2_ACCESS_KEY_ID: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    CLOUDFLARE_R2_PUBLIC_BASE_URL: process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL,
    DEFAULT_FROM_EMAIL: process.env.DEFAULT_FROM_EMAIL,
    DEFAULT_FROM_NAME: process.env.DEFAULT_FROM_NAME,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    GMAIL_DAILY_SEND_SAFETY_LIMIT: process.env.GMAIL_DAILY_SEND_SAFETY_LIMIT,
    GMAIL_SENDS_PER_MINUTE: process.env.GMAIL_SENDS_PER_MINUTE,
    GMAIL_SENDER_CONCURRENCY: process.env.GMAIL_SENDER_CONCURRENCY,
    APIFY_API_TOKEN: process.env.APIFY_API_TOKEN,
    APIFY_PROSPECT_ACTOR_ID: process.env.APIFY_PROSPECT_ACTOR_ID,
    WEB_SEARCH_PROVIDER: process.env.WEB_SEARCH_PROVIDER,
    SERPER_API_KEY: process.env.SERPER_API_KEY,
    BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY,
    PROSPECT_GRAPH_ENABLED: process.env.PROSPECT_GRAPH_ENABLED,
    GRAPHQL_GRAPHIQL_ENABLED: process.env.GRAPHQL_GRAPHIQL_ENABLED,
    LOCAL_PROSPECT_MAX_RESULTS: process.env.LOCAL_PROSPECT_MAX_RESULTS,
    PROSPECT_AI_ENABLED: process.env.PROSPECT_AI_ENABLED,
    PROSPECT_AI_MODEL: process.env.PROSPECT_AI_MODEL,
    PROSPECT_AI_REASONING_EFFORT: process.env.PROSPECT_AI_REASONING_EFFORT,
    PROSPECT_AI_MAX_COMPANY_CALLS_PER_SEARCH: process.env.PROSPECT_AI_MAX_COMPANY_CALLS_PER_SEARCH,
    PROSPECT_AI_MAX_ROLE_CALLS_PER_SEARCH: process.env.PROSPECT_AI_MAX_ROLE_CALLS_PER_SEARCH,
    PROSPECT_AI_MAX_PATTERN_CALLS_PER_SEARCH: process.env.PROSPECT_AI_MAX_PATTERN_CALLS_PER_SEARCH,
    PROSPECT_AI_MAX_UNIQUE_TITLES: process.env.PROSPECT_AI_MAX_UNIQUE_TITLES,
    PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS: process.env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS
  };
}

let cachedEnv: AppEnv | null = null;

export function getEnv() {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(readRawEnv());
  }

  return cachedEnv;
}

export function getEnvStatus() {
  const parsed = envSchema.safeParse(readRawEnv());
  if (parsed.success) {
    return {
      ok: true as const,
      missing: [] as string[]
    };
  }

  const missing = parsed.error.issues.map((issue) => issue.path.join("."));
  return {
    ok: false as const,
    missing
  };
}

export const env = new Proxy({} as AppEnv, {
  get(_, prop) {
    return getEnv()[prop as keyof AppEnv];
  }
});
