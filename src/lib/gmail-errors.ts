import type { FailureCode } from "@/lib/failures";

const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 600;

type GoogleApiErrorItem = {
  message?: unknown;
  reason?: unknown;
  domain?: unknown;
};

type GoogleApiErrorDetail = {
  "@type"?: unknown;
  reason?: unknown;
  domain?: unknown;
  metadata?: unknown;
};

export type GoogleApiErrorBody = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  errors?: GoogleApiErrorItem[];
  details?: GoogleApiErrorDetail[];
};

export type GmailSendFailureDiagnostic = {
  provider: "gmail";
  timestamp: string;
  httpStatus: number | null;
  code: string | null;
  status: string | null;
  reason: string | null;
  message: string | null;
  retryAfterSeconds: number | null;
};

export type GmailSendFailureMetadata = {
  provider: "gmail";
  failureCategory: FailureCode;
  providerErrorCode: string | null;
  providerErrorReason: string | null;
  providerErrorStatus: string | null;
  providerHttpStatus: number | null;
  providerErrorMessage: string | null;
  providerRetryAfterSeconds: number | null;
  lastInternalError: GmailSendFailureDiagnostic & {
    failureCode: FailureCode;
    retryable: boolean;
  };
};

export class GmailSendError extends Error {
  diagnostic: GmailSendFailureDiagnostic;

  constructor(message: string, diagnostic: GmailSendFailureDiagnostic) {
    super(message);
    this.name = "GmailSendError";
    this.diagnostic = diagnostic;
  }
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? sanitizeDiagnosticText(value) : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstString(values: unknown[]) {
  for (const value of values) {
    const text = readString(value);
    if (text) {
      return text;
    }
  }

  return null;
}

export function sanitizeDiagnosticText(value: unknown) {
  let raw: string | undefined;
  try {
    raw = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    raw = String(value);
  }
  let text = raw ?? "";

  text = text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /(access_token|refresh_token|id_token|client_secret|authorization)(["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
      "$1$2[redacted]"
    )
    .replace(/[A-Za-z0-9_-]{80,}/g, "[redacted-token]")
    .trim();

  if (text.length <= MAX_DIAGNOSTIC_MESSAGE_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH - 3)}...`;
}

export function parseRetryAfterSeconds(value: string | null) {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds);
  }

  const retryAt = new Date(value);
  if (!Number.isNaN(retryAt.getTime())) {
    return Math.max(0, Math.ceil((retryAt.getTime() - Date.now()) / 1000));
  }

  return null;
}

export function buildGmailApiFailureDiagnostic(
  apiError: GoogleApiErrorBody | undefined,
  options: {
    httpStatus: number;
    retryAfter?: string | null;
    fallbackMessage?: string;
    now?: Date;
  }
): GmailSendFailureDiagnostic {
  const errors = Array.isArray(apiError?.errors) ? apiError.errors : [];
  const details = Array.isArray(apiError?.details) ? apiError.details : [];
  const code = readNumber(apiError?.code) ?? options.httpStatus;

  return {
    provider: "gmail",
    timestamp: (options.now ?? new Date()).toISOString(),
    httpStatus: options.httpStatus,
    code: String(code),
    status: firstString([apiError?.status, details[0]?.["@type"]]),
    reason: firstString([
      errors[0]?.reason,
      details[0]?.reason,
      errors.find((entry) => typeof entry.reason === "string")?.reason,
      details.find((entry) => typeof entry.reason === "string")?.reason
    ]),
    message: firstString([apiError?.message, errors[0]?.message, options.fallbackMessage]),
    retryAfterSeconds: parseRetryAfterSeconds(options.retryAfter ?? null)
  };
}

export function getGmailSendFailureDiagnostic(error: unknown): GmailSendFailureDiagnostic | null {
  if (error instanceof GmailSendError) {
    return error.diagnostic;
  }

  if (!error || typeof error !== "object") {
    return null;
  }

  const diagnostic = (error as { diagnostic?: unknown }).diagnostic;
  if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) {
    return null;
  }

  const record = diagnostic as Partial<GmailSendFailureDiagnostic>;
  if (record.provider !== "gmail") {
    return null;
  }

  return {
    provider: "gmail",
    timestamp: typeof record.timestamp === "string" ? record.timestamp : new Date().toISOString(),
    httpStatus: typeof record.httpStatus === "number" ? record.httpStatus : null,
    code: typeof record.code === "string" ? record.code : null,
    status: typeof record.status === "string" ? record.status : null,
    reason: typeof record.reason === "string" ? record.reason : null,
    message: typeof record.message === "string" ? record.message : null,
    retryAfterSeconds: typeof record.retryAfterSeconds === "number" ? record.retryAfterSeconds : null
  };
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return sanitizeDiagnosticText(error);
}

export function buildGmailSendFailureDiagnostic(error: unknown, now = new Date()): GmailSendFailureDiagnostic {
  const diagnostic = getGmailSendFailureDiagnostic(error);
  if (diagnostic) {
    return diagnostic;
  }

  return {
    provider: "gmail",
    timestamp: now.toISOString(),
    httpStatus: null,
    code: null,
    status: null,
    reason: null,
    message: sanitizeDiagnosticText(getErrorMessage(error)),
    retryAfterSeconds: null
  };
}

export function buildGmailSendFailureMetadata(
  error: unknown,
  classification: {
    failureCode: FailureCode;
    retryable: boolean;
  },
  now = new Date()
): GmailSendFailureMetadata {
  const diagnostic = buildGmailSendFailureDiagnostic(error, now);

  return {
    provider: "gmail",
    failureCategory: classification.failureCode,
    providerErrorCode: diagnostic.code,
    providerErrorReason: diagnostic.reason,
    providerErrorStatus: diagnostic.status,
    providerHttpStatus: diagnostic.httpStatus,
    providerErrorMessage: diagnostic.message,
    providerRetryAfterSeconds: diagnostic.retryAfterSeconds,
    lastInternalError: {
      ...diagnostic,
      failureCode: classification.failureCode,
      retryable: classification.retryable
    }
  };
}

export function getGmailErrorInspectionText(error: unknown) {
  const diagnostic = getGmailSendFailureDiagnostic(error);
  const parts = [
    getErrorMessage(error),
    diagnostic?.httpStatus,
    diagnostic?.code,
    diagnostic?.status,
    diagnostic?.reason,
    diagnostic?.message
  ];

  return parts
    .filter((part): part is string | number => typeof part === "string" || typeof part === "number")
    .map((part) => String(part).toLowerCase())
    .join(" ");
}

export function isGmailDailyLimitLikeError(error: unknown) {
  const normalized = getGmailErrorInspectionText(error);
  return (
    normalized.includes("daily user sending limit exceeded") ||
    normalized.includes("dailylimitexceeded") ||
    normalized.includes("daily limit exceeded") ||
    normalized.includes("mail sending limit exceeded") ||
    normalized.includes("550-5.4.5") ||
    normalized.includes("550 5.4.5")
  );
}

export function isGmailRateLimitLikeError(error: unknown) {
  const diagnostic = getGmailSendFailureDiagnostic(error);
  const normalized = getGmailErrorInspectionText(error);

  if (diagnostic?.httpStatus === 429) {
    return true;
  }

  return (
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("user-rate limit exceeded") ||
    normalized.includes("userratelimitexceeded") ||
    normalized.includes("ratelimitexceeded") ||
    normalized.includes("quota exceeded") ||
    normalized.includes("quotaexceeded") ||
    normalized.includes("too many concurrent requests for user") ||
    normalized.includes("exceeded rate limits") ||
    normalized.includes("resource has been exhausted") ||
    normalized.includes("resource_exhausted") ||
    normalized.includes("too many requests") ||
    isGmailDailyLimitLikeError(error)
  );
}

export function isGmailTemporaryLikeError(error: unknown) {
  const diagnostic = getGmailSendFailureDiagnostic(error);
  const normalized = getGmailErrorInspectionText(error);

  if (diagnostic?.httpStatus && diagnostic.httpStatus >= 500 && diagnostic.httpStatus <= 504) {
    return true;
  }

  return (
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("temporar") ||
    normalized.includes("unavailable") ||
    normalized.includes("try again later") ||
    normalized.includes("backend error") ||
    normalized.includes("backenderror") ||
    normalized.includes("internal error") ||
    normalized.includes("internalerror") ||
    normalized.includes("econnreset") ||
    normalized.includes("etimedout") ||
    normalized.includes("socket hang up") ||
    normalized.includes("fetch failed") ||
    // 500/502/503/504 expressed only in free-text error strings (the structured
    // httpStatus path above covers GmailSendError diagnostics).
    /\b50[0234]\b/.test(normalized)
  );
}

export function getGmailRetryAfterDate(error: unknown, fallbackMs: number, now = new Date()) {
  const diagnostic = getGmailSendFailureDiagnostic(error);
  const retryAfterMs =
    typeof diagnostic?.retryAfterSeconds === "number" ? diagnostic.retryAfterSeconds * 1000 : fallbackMs;

  return new Date(now.getTime() + retryAfterMs);
}
