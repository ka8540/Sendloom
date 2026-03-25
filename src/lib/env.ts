import { loadEnvConfig } from "@next/env";
import { z } from "zod";

const globalForEnv = globalThis as typeof globalThis & { __sendloomEnvLoaded?: boolean };

if (!globalForEnv.__sendloomEnvLoaded) {
  loadEnvConfig(process.cwd());
  globalForEnv.__sendloomEnvLoaded = true;
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(12),
  MAIL_PROVIDER: z.enum(["gmail", "resend"]).default("gmail"),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  APP_BASE_URL: z.string().url(),
  OBJECT_STORAGE_MODE: z.enum(["local"]).default("local"),
  LOCAL_UPLOAD_DIR: z.string().default("./uploads"),
  DEFAULT_FROM_EMAIL: z.string().email().optional(),
  DEFAULT_FROM_NAME: z.string().min(1).optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional()
});

export type AppEnv = z.infer<typeof envSchema>;

function readRawEnv() {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    SESSION_SECRET: process.env.SESSION_SECRET,
    MAIL_PROVIDER: process.env.MAIL_PROVIDER,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    APP_BASE_URL: process.env.APP_BASE_URL,
    OBJECT_STORAGE_MODE: process.env.OBJECT_STORAGE_MODE,
    LOCAL_UPLOAD_DIR: process.env.LOCAL_UPLOAD_DIR,
    DEFAULT_FROM_EMAIL: process.env.DEFAULT_FROM_EMAIL,
    DEFAULT_FROM_NAME: process.env.DEFAULT_FROM_NAME,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD
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
