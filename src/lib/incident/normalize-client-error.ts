// Pure client-side mapping of a failed fetch / HTTP response into a
// NormalizedAppError. No DOM mutation, no network — just classification — so it is
// unit-testable and reuses the shared app-error copy (a backend message can never
// become the user-facing text). 4xx responses return null: those are normal
// validation / auth / not-found outcomes the caller handles with its own message.

import {
  type AppErrorCategory,
  type NormalizedAppError,
  categoryFromHttpStatus,
  normalizeAppError
} from "@/lib/incident/app-error";

export type ClientErrorContext = {
  feature?: string;
  operation?: string;
  /** Category to use when a thrown error isn't offline/timeout/network. */
  fallbackCategory?: AppErrorCategory;
};

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isTimeoutLike(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  const name = (error as { name?: string } | null)?.name ?? "";
  const message = String((error as { message?: string } | null)?.message ?? "").toLowerCase();
  return name === "TimeoutError" || message.includes("timeout") || message.includes("timed out");
}

function readBodyField(body: unknown, ...keys: string[]): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  for (const key of keys) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

/**
 * Classify a thrown fetch error (the request never produced a response): offline,
 * a timeout/abort, or a generic network failure. Always returns an incident — a
 * thrown transport error is never a normal validation outcome.
 */
export function normalizeThrownError(error: unknown, context: ClientErrorContext = {}): NormalizedAppError {
  const base = { feature: context.feature, operation: context.operation };
  if (isOffline()) {
    return normalizeAppError({ ...base, category: "NETWORK_OFFLINE" });
  }
  if (isTimeoutLike(error)) {
    return normalizeAppError({ ...base, category: "REQUEST_TIMEOUT" });
  }
  return normalizeAppError({ ...base, category: context.fallbackCategory ?? "NETWORK_REQUEST_FAILED" });
}

/**
 * Classify a non-ok HTTP Response. Returns null for 4xx (handled as normal
 * validation/auth/not-found by the caller); 5xx + 503 become incidents. An
 * optional parsed body supplies a safe correlation id + internal code.
 */
export function normalizeResponseError(
  response: { status: number; headers?: { get(name: string): string | null } },
  context: ClientErrorContext = {},
  body?: unknown
): NormalizedAppError | null {
  const category = categoryFromHttpStatus(response.status);
  if (!category) {
    return null;
  }
  const correlationId =
    readBodyField(body, "requestId", "correlationId") ?? response.headers?.get("x-request-id") ?? undefined;
  const internalCode = readBodyField(body, "errorCode", "code");
  return normalizeAppError({
    feature: context.feature,
    operation: context.operation,
    category,
    httpStatus: response.status,
    correlationId,
    internalCode
  });
}

/** The plain object the report/event endpoints accept for this error. */
export function toReportContext(error: NormalizedAppError, extra: Record<string, unknown> = {}) {
  return {
    category: error.category,
    feature: error.feature,
    operation: error.operation,
    internalCode: error.internalCode,
    httpStatus: error.httpStatus,
    correlationId: error.correlationId,
    retryable: error.retryable,
    route: typeof window !== "undefined" ? window.location.pathname : undefined,
    onlineStatus: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    ...extra
  };
}
