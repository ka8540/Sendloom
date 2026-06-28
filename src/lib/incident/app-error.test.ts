import { describe, expect, it } from "vitest";

import {
  appErrorCategory,
  categoryFromHttpStatus,
  deriveRecoveryActions,
  isReportableCode,
  normalizeAppError
} from "@/lib/incident/app-error";

describe("categoryFromHttpStatus", () => {
  it("maps 500–599 to safe server categories", () => {
    expect(categoryFromHttpStatus(500)).toBe("SERVER_ERROR");
    expect(categoryFromHttpStatus(502)).toBe("SERVER_ERROR");
    expect(categoryFromHttpStatus(599)).toBe("SERVER_ERROR");
    expect(categoryFromHttpStatus(503)).toBe("SERVICE_UNAVAILABLE");
  });

  it("returns null for 4xx (normal validation / auth / not-found, never incidents)", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      expect(categoryFromHttpStatus(status)).toBeNull();
    }
    expect(categoryFromHttpStatus(undefined)).toBeNull();
  });
});

describe("isReportableCode", () => {
  it("treats validation / product-rule codes as NOT reportable", () => {
    for (const code of [
      "BAD_USER_INPUT",
      "VALIDATION",
      "FORBIDDEN",
      "UNAUTHENTICATED",
      "NOT_FOUND",
      "DUPLICATE",
      "DISCOVER_DAILY_LIMIT_REACHED",
      "CANCELED"
    ]) {
      expect(isReportableCode(code)).toBe(false);
    }
  });

  it("treats unknown / unexpected codes as reportable", () => {
    expect(isReportableCode("PG_DEADLOCK_DETECTED")).toBe(true);
    expect(isReportableCode(null)).toBe(true);
    expect(isReportableCode(undefined)).toBe(true);
  });
});

describe("deriveRecoveryActions", () => {
  it("offers Reconnect Gmail + Report for Gmail auth/connection (Retry won't help yet)", () => {
    expect(deriveRecoveryActions("GMAIL_AUTHORIZATION")).toEqual(["RECONNECT_GMAIL", "REPORT"]);
    expect(deriveRecoveryActions("GMAIL_CONNECTION")).toEqual(["RECONNECT_GMAIL", "REPORT"]);
  });

  it("offers Try again + Report for retryable failures", () => {
    expect(deriveRecoveryActions("SERVER_ERROR")).toEqual(["RETRY", "REPORT"]);
    expect(deriveRecoveryActions("SEQUENCE_LAUNCH")).toEqual(["RETRY", "REPORT"]);
    expect(deriveRecoveryActions("NETWORK_OFFLINE")).toEqual(["RETRY", "REPORT"]);
  });

  it("offers Report + Go back for a terminal (non-retryable) failure, never Retry", () => {
    expect(deriveRecoveryActions("UNKNOWN", { retryable: false })).toEqual(["REPORT", "GO_BACK"]);
  });

  it("omits Report when the failure is not reportable", () => {
    expect(deriveRecoveryActions("SERVER_ERROR", { reportable: false })).toEqual(["RETRY"]);
  });
});

describe("normalizeAppError", () => {
  it("uses hardcoded safe copy and never surfaces the raw internal code as the message", () => {
    const normalized = normalizeAppError({
      category: "SERVER_ERROR",
      feature: "Sequences",
      operation: "Launch sequence",
      internalCode: "PG_DEADLOCK_DETECTED at users.sql:42",
      httpStatus: 500
    });

    expect(normalized.publicTitle).toBe("Something went wrong");
    expect(normalized.publicMessage).not.toContain("PG_DEADLOCK");
    expect(normalized.publicMessage).not.toContain("users.sql");
    // The internal code is retained for diagnostics, just never shown as copy.
    expect(normalized.internalCode).toContain("PG_DEADLOCK_DETECTED");
    expect(normalized.reportable).toBe(true);
    expect(normalized.retryable).toBe(true);
  });

  it("marks a validation-shaped code as not reportable", () => {
    const normalized = normalizeAppError({ category: "UNKNOWN", internalCode: "BAD_USER_INPUT" });
    expect(normalized.reportable).toBe(false);
  });

  it("falls back to UNKNOWN for an unrecognized category", () => {
    expect(appErrorCategory("NOT_A_REAL_CATEGORY")).toBe("UNKNOWN");
    expect(normalizeAppError({ category: "NOT_A_REAL_CATEGORY" }).category).toBe("UNKNOWN");
  });
});
