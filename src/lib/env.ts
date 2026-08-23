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
    // Read only by the narrow auth-OTP runtime helper. It stays optional here
    // so unrelated pages and local builds do not fail just because OTP email
    // is not configured; OTP endpoints themselves validate it and fail closed.
    AUTH_OTP_SECRET: z.string().optional(),
    TRACKING_SECRET: z.string().min(12).optional(),
    MAIL_PROVIDER: z.enum(["gmail", "resend"]).default("gmail"),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    HUNTER_KEY_ENCRYPTION_SECRET: z.string().min(12).optional(),
    // --- Incident reporting (server-only) ---
    // Keys the anonymous reporter pseudonym (HMAC) and encrypts the reversible
    // internal reporter reference (AES-256-GCM). Both are server-only and must
    // never be prefixed with NEXT_PUBLIC_. In production both are required (see
    // superRefine below); in dev they fall back to SESSION_SECRET so local
    // bootstrapping stays painless, mirroring HUNTER_KEY_ENCRYPTION_SECRET.
    REPORT_PSEUDONYM_SECRET: z.string().min(16).optional(),
    REPORT_IDENTITY_ENCRYPTION_KEY: z.string().min(32).optional(),
    CRON_SECRET: z.string().min(1).optional(),
    // Legal-policy account notices are fail-closed. Delivery additionally
    // requires NODE_ENV=production and VERCEL_ENV=production at runtime.
    LEGAL_NOTICE_PROCESSING_ENABLED: booleanFlag(false),
    LEGAL_NOTICE_BATCH_SIZE: z.coerce.number().int().positive().max(50).default(25),
    LEGAL_NOTICE_MAX_PER_RUN: z.coerce.number().int().positive().max(500).default(50),
    // --- Gmail bounce monitoring (mailbox watch + Pub/Sub push) ---
    // Topic the Gmail watch publishes to (projects/<id>/topics/<name>). The
    // webhook accepts a push request when EITHER the shared verification token
    // matches (?token=...) OR the Pub/Sub OIDC bearer token validates against
    // the configured audience/service account. With none configured the
    // endpoint fails closed.
    GMAIL_PUBSUB_TOPIC: z.string().min(1).optional(),
    GMAIL_PUBSUB_VERIFICATION_TOKEN: z.string().min(16).optional(),
    GMAIL_PUBSUB_AUDIENCE: z.string().min(1).optional(),
    GMAIL_PUBSUB_SERVICE_ACCOUNT: z.string().email().optional(),
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
    // Ambiguous-person identity resolution runs at most once per person whose
    // name is too incomplete to build an address from, and never for a clean
    // name. This hard cap keeps a bad provider page from fanning out into
    // per-person AI usage; 0 disables the fallback entirely.
    PROSPECT_AI_MAX_IDENTITY_CALLS_PER_SEARCH: z.coerce.number().int().nonnegative().default(5),
    PROSPECT_IDENTITY_RESOLUTION_ENABLED: booleanFlag(true),
    PROSPECT_AI_MAX_UNIQUE_TITLES: z.coerce.number().int().positive().default(100),
    PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS: booleanFlag(false),
    // --- AI web-search email-format discovery (OpenAI Responses + web_search) ---
    // Primary email-format discovery now uses GPT-5.5 with the OpenAI Responses
    // API built-in web_search tool. "none" disables it (manual/source-URL only).
    PROSPECT_EMAIL_DISCOVERY_PROVIDER: z.preprocess(
      (value) => (value === "" || value === undefined ? "openai_web_search" : String(value).trim().toLowerCase()),
      z.enum(["none", "openai_web_search"]).default("openai_web_search")
    ),
    // Master switch for the web search call. When false, web search never runs
    // even if a provider/key is present; manual override + source URL still work.
    PROSPECT_EMAIL_FORMAT_WEB_SEARCH_ENABLED: booleanFlag(true),
    // How many web results the model is asked to consider per company.
    PROSPECT_EMAIL_FORMAT_MAX_WEB_RESULTS: z.coerce.number().int().positive().max(20).default(5),
    // Cost controls — AI web-search discovery calls per user.
    PROSPECT_EMAIL_FORMAT_AI_DAILY_LIMIT: z.coerce.number().int().nonnegative().default(20),
    PROSPECT_EMAIL_FORMAT_AI_HOURLY_LIMIT: z.coerce.number().int().nonnegative().default(5),
    // --- Discover (prospect) daily usage limits ---
    // Fixed people per processed Discover search (users cannot choose this).
    DISCOVER_RESULTS_PER_SEARCH: z.coerce.number().int().positive().max(50).default(10),
    // Processed Discover searches allowed per user per daily window.
    DISCOVER_DAILY_SEARCH_LIMIT: z.coerce.number().int().positive().max(100).default(4),
    // Server-only allowlist (comma-separated, case-insensitive) of accounts
    // exempt from the daily Discover quota. Never prefix with NEXT_PUBLIC_ and
    // never expose to the client.
    DISCOVER_QUOTA_EXEMPT_EMAILS: z.string().optional(),
    // --- Discover "Add 10 more" expansion ---
    // New people materialized per expansion. The enforced product value is 10;
    // the override exists for operations only.
    DISCOVER_EXPANSION_BATCH_SIZE: z.coerce.number().int().positive().max(50).default(10),
    // Safety cap on provider continuation pages fetched in a single expansion so
    // a sparse query can never trigger an unbounded/expensive provider loop.
    DISCOVER_EXPANSION_MAX_PROVIDER_PAGES: z.coerce.number().int().positive().max(20).default(5),
    // --- Shared Discover result cache ---
    // How long a shared provider-result dataset stays fresh before Apify is
    // called again. Absent/blank/invalid/<=0 falls back to 30.
    DISCOVER_SHARED_CACHE_TTL_DAYS: z.preprocess((value) => {
      const parsed = typeof value === "string" ? Number(value) : value;
      return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
    }, z.number().int().positive().default(30)),
    // Bumping the cache schema version invalidates every existing entry (it is
    // part of the fingerprint). Absent/blank falls back to "v1".
    DISCOVER_SHARED_CACHE_VERSION: z.preprocess(
      (value) => (value === undefined || value === "" ? "v1" : String(value).trim()),
      z.string().min(1)
    ),
    // --- Discover semantic role intelligence (pgvector) ---
    // Off by default for a no-behavior-change deployment. The embedding
    // dimensions are intentionally pinned to the migration's vector(1536)
    // column; changing them requires a new additive schema/version rollout.
    DISCOVER_ROLE_VECTOR_ENABLED: booleanFlag(false),
    DISCOVER_ROLE_EMBEDDING_MODEL: z.preprocess(
      (value) => (value === undefined || value === "" ? "text-embedding-3-small" : String(value).trim()),
      z.string().min(1)
    ),
    DISCOVER_ROLE_EMBEDDING_DIMENSIONS: z.coerce
      .number()
      .int()
      .positive()
      .refine((value) => value === 1536, "Must match the pgvector vector(1536) column.")
      .default(1536),
    DISCOVER_ROLE_SEMANTIC_VERSION: z.preprocess(
      (value) => (value === undefined || value === "" ? "v1" : String(value).trim()),
      z.string().min(1)
    ),
    DISCOVER_ROLE_MAX_APIFY_TITLES: z.coerce.number().int().positive().max(8).default(5),
    // Discover currently accepts at most five exact requested roles, so the
    // total cap cannot be configured below five without dropping user intent.
    DISCOVER_ROLE_MAX_APIFY_TITLES_TOTAL: z.coerce.number().int().min(5).max(20).default(8)
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

    if (value.DISCOVER_ROLE_MAX_APIFY_TITLES > value.DISCOVER_ROLE_MAX_APIFY_TITLES_TOTAL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DISCOVER_ROLE_MAX_APIFY_TITLES"],
        message: "Cannot exceed DISCOVER_ROLE_MAX_APIFY_TITLES_TOTAL."
      });
    }

    if (process.env.NODE_ENV === "production") {
      const requiredInProduction = [
        ["CRON_SECRET", value.CRON_SECRET],
        ["TRACKING_SECRET", value.TRACKING_SECRET],
        ["HUNTER_KEY_ENCRYPTION_SECRET", value.HUNTER_KEY_ENCRYPTION_SECRET],
        ["REPORT_PSEUDONYM_SECRET", value.REPORT_PSEUDONYM_SECRET],
        ["REPORT_IDENTITY_ENCRYPTION_KEY", value.REPORT_IDENTITY_ENCRYPTION_KEY]
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
    AUTH_OTP_SECRET: process.env.AUTH_OTP_SECRET,
    TRACKING_SECRET: process.env.TRACKING_SECRET,
    MAIL_PROVIDER: process.env.MAIL_PROVIDER,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    HUNTER_KEY_ENCRYPTION_SECRET: process.env.HUNTER_KEY_ENCRYPTION_SECRET,
    REPORT_PSEUDONYM_SECRET: process.env.REPORT_PSEUDONYM_SECRET,
    REPORT_IDENTITY_ENCRYPTION_KEY: process.env.REPORT_IDENTITY_ENCRYPTION_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    LEGAL_NOTICE_PROCESSING_ENABLED: process.env.LEGAL_NOTICE_PROCESSING_ENABLED,
    LEGAL_NOTICE_BATCH_SIZE: process.env.LEGAL_NOTICE_BATCH_SIZE,
    LEGAL_NOTICE_MAX_PER_RUN: process.env.LEGAL_NOTICE_MAX_PER_RUN,
    GMAIL_PUBSUB_TOPIC: process.env.GMAIL_PUBSUB_TOPIC,
    GMAIL_PUBSUB_VERIFICATION_TOKEN: process.env.GMAIL_PUBSUB_VERIFICATION_TOKEN,
    GMAIL_PUBSUB_AUDIENCE: process.env.GMAIL_PUBSUB_AUDIENCE,
    GMAIL_PUBSUB_SERVICE_ACCOUNT: process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT,
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
    PROSPECT_AI_MAX_IDENTITY_CALLS_PER_SEARCH: process.env.PROSPECT_AI_MAX_IDENTITY_CALLS_PER_SEARCH,
    PROSPECT_IDENTITY_RESOLUTION_ENABLED: process.env.PROSPECT_IDENTITY_RESOLUTION_ENABLED,
    PROSPECT_AI_MAX_UNIQUE_TITLES: process.env.PROSPECT_AI_MAX_UNIQUE_TITLES,
    PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS: process.env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS,
    PROSPECT_EMAIL_DISCOVERY_PROVIDER: process.env.PROSPECT_EMAIL_DISCOVERY_PROVIDER,
    PROSPECT_EMAIL_FORMAT_WEB_SEARCH_ENABLED: process.env.PROSPECT_EMAIL_FORMAT_WEB_SEARCH_ENABLED,
    PROSPECT_EMAIL_FORMAT_MAX_WEB_RESULTS: process.env.PROSPECT_EMAIL_FORMAT_MAX_WEB_RESULTS,
    PROSPECT_EMAIL_FORMAT_AI_DAILY_LIMIT: process.env.PROSPECT_EMAIL_FORMAT_AI_DAILY_LIMIT,
    PROSPECT_EMAIL_FORMAT_AI_HOURLY_LIMIT: process.env.PROSPECT_EMAIL_FORMAT_AI_HOURLY_LIMIT,
    DISCOVER_RESULTS_PER_SEARCH: process.env.DISCOVER_RESULTS_PER_SEARCH,
    DISCOVER_DAILY_SEARCH_LIMIT: process.env.DISCOVER_DAILY_SEARCH_LIMIT,
    DISCOVER_QUOTA_EXEMPT_EMAILS: process.env.DISCOVER_QUOTA_EXEMPT_EMAILS,
    DISCOVER_EXPANSION_BATCH_SIZE: process.env.DISCOVER_EXPANSION_BATCH_SIZE,
    DISCOVER_EXPANSION_MAX_PROVIDER_PAGES: process.env.DISCOVER_EXPANSION_MAX_PROVIDER_PAGES,
    DISCOVER_SHARED_CACHE_TTL_DAYS: process.env.DISCOVER_SHARED_CACHE_TTL_DAYS,
    DISCOVER_SHARED_CACHE_VERSION: process.env.DISCOVER_SHARED_CACHE_VERSION,
    DISCOVER_ROLE_VECTOR_ENABLED: process.env.DISCOVER_ROLE_VECTOR_ENABLED,
    DISCOVER_ROLE_EMBEDDING_MODEL: process.env.DISCOVER_ROLE_EMBEDDING_MODEL,
    DISCOVER_ROLE_EMBEDDING_DIMENSIONS: process.env.DISCOVER_ROLE_EMBEDDING_DIMENSIONS,
    DISCOVER_ROLE_SEMANTIC_VERSION: process.env.DISCOVER_ROLE_SEMANTIC_VERSION,
    DISCOVER_ROLE_MAX_APIFY_TITLES: process.env.DISCOVER_ROLE_MAX_APIFY_TITLES,
    DISCOVER_ROLE_MAX_APIFY_TITLES_TOTAL: process.env.DISCOVER_ROLE_MAX_APIFY_TITLES_TOTAL
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
