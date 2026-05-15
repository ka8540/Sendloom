import { prisma } from "@/lib/db";
import { getRedis } from "@/lib/redis";
import { checkStorageHealth } from "@/lib/storage";

type RuntimeCheck = {
  status: "ok" | "down";
  message: string;
};

type ConfigCheck = {
  status: "configured" | "missing";
  message: string;
};

const HEALTH_CHECK_TIMEOUT_MS = 1_500;

export type SystemHealthReport = {
  status: "ok" | "degraded" | "down";
  timestamp: string;
  checks: {
    database: RuntimeCheck;
    redis: RuntimeCheck;
    storage: RuntimeCheck;
    appBaseUrl: ConfigCheck;
    sessionSecret: ConfigCheck;
    googleOAuth: ConfigCheck;
    mailProvider: ConfigCheck;
    cron: ConfigCheck;
  };
};

async function withTimeout<T>(operation: Promise<T>, timeoutMessage: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), HEALTH_CHECK_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function getDatabaseHealth(): Promise<RuntimeCheck> {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, "Database health check timed out.");
    return {
      status: "ok",
      message: "Database reachable."
    };
  } catch {
    return {
      status: "down",
      message: "Database unavailable."
    };
  }
}

async function getRedisHealth(): Promise<RuntimeCheck> {
  if (!process.env.REDIS_URL) {
    return {
      status: "down",
      message: "Redis is not configured."
    };
  }

  try {
    await withTimeout(getRedis().ping(), "Redis health check timed out.");
    return {
      status: "ok",
      message: "Redis reachable."
    };
  } catch {
    return {
      status: "down",
      message: "Redis unavailable."
    };
  }
}

function configured(value: string | undefined, successMessage: string, missingMessage: string): ConfigCheck {
  return value?.trim()
    ? {
        status: "configured",
        message: successMessage
      }
    : {
        status: "missing",
        message: missingMessage
      };
}

export async function getSystemHealth(): Promise<SystemHealthReport> {
  const [database, redis, storage] = await Promise.all([
    getDatabaseHealth(),
    getRedisHealth(),
    checkStorageHealth()
  ]);
  const appBaseUrl = configured(process.env.APP_BASE_URL, "APP_BASE_URL configured.", "APP_BASE_URL missing.");
  const sessionSecret = configured(process.env.SESSION_SECRET, "SESSION_SECRET configured.", "SESSION_SECRET missing.");
  const googleOAuth =
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()
      ? {
          status: "configured" as const,
          message: "Google OAuth configured."
        }
      : {
          status: "missing" as const,
          message: "Google OAuth credentials missing."
        };
  const mailProvider = configured(process.env.MAIL_PROVIDER ?? "gmail", "Mail provider configured.", "Mail provider missing.");
  const cron = configured(process.env.CRON_SECRET, "Cron secret configured.", "Cron secret missing.");
  const runtimeDown = [database, redis, storage].some((check) => check.status === "down");
  const configMissing = [appBaseUrl, sessionSecret, googleOAuth, mailProvider, cron].some(
    (check) => check.status === "missing"
  );

  return {
    status: runtimeDown ? "down" : configMissing ? "degraded" : "ok",
    timestamp: new Date().toISOString(),
    checks: {
      database,
      redis,
      storage,
      appBaseUrl,
      sessionSecret,
      googleOAuth,
      mailProvider,
      cron
    }
  };
}
