import { describe, expect, it } from "vitest";

import {
  FAILURE_CODES,
  createFailureCheck,
  getFailureSeverity,
  getHumanReadableFailureMessage
} from "@/lib/failures";

describe("failures", () => {
  it("exposes the expected failure codes and helper metadata", () => {
    expect(FAILURE_CODES).toContain("GMAIL_TOKEN_EXPIRED");
    expect(FAILURE_CODES).toContain("INVALID_RECIPIENT_EMAIL");
    expect(getFailureSeverity("MISSING_TEMPLATE")).toBe("BLOCKER");
    expect(getHumanReadableFailureMessage("GMAIL_RATE_LIMITED")).toContain("rate limiting");
  });

  it("builds structured failure checks", () => {
    expect(createFailureCheck("REDIS_UNAVAILABLE", "QUEUE", { retryable: true })).toEqual({
      code: "REDIS_UNAVAILABLE",
      severity: "ERROR",
      source: "QUEUE",
      message: "Redis is unavailable.",
      details: undefined,
      retryable: true,
      actionLabel: undefined,
      actionHref: undefined
    });
  });
});
