import { describe, expect, it } from "vitest";

import {
  DISCOVER_PUBLIC_ERROR_CATEGORIES,
  discoverPublicErrorCategory,
  mapDiscoverPublicError
} from "@/lib/discover-public-error";

// Internal codes that must NEVER appear in any user-facing field.
const INTERNAL_CODES = [
  "COMPANY_UNRESOLVED",
  "APIFY_RUN_FAILED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_ERROR",
  "CACHE_REFRESH_FAILED",
  "REDIS_LOCK_FAILED",
  "GRAPHQL_ERROR",
  "INTERNAL_SERVER_ERROR"
];

describe("discover public error mapper", () => {
  it("maps COMPANY_UNRESOLVED to the safe COMPANY_NOT_FOUND product error (#error-1)", () => {
    const mapped = mapDiscoverPublicError("COMPANY_UNRESOLVED");
    expect(mapped.category).toBe("COMPANY_NOT_FOUND");
    expect(mapped.title).toBe("We couldn't identify this company");
    expect(mapped.retryable).toBe(true);
    // Never leaks the internal code or LinkedIn/domain instructions.
    expect(mapped.message).not.toContain("COMPANY_UNRESOLVED");
    expect(mapped.message).not.toMatch(/linkedin|domain/i);
  });

  it("never returns a raw internal code as the category or in the copy (#error-1)", () => {
    for (const code of INTERNAL_CODES) {
      const mapped = mapDiscoverPublicError(code);
      expect(DISCOVER_PUBLIC_ERROR_CATEGORIES).toContain(mapped.category);
      expect(mapped.category).not.toBe(code);
      expect(`${mapped.title} ${mapped.message}`).not.toContain(code);
    }
  });

  it("maps unknown / null / empty codes to a generic safe message (#error-6)", () => {
    for (const value of [null, undefined, "", "  ", "SOMETHING_WE_NEVER_DEFINED"]) {
      const mapped = mapDiscoverPublicError(value);
      expect(mapped.category).toBe("UNKNOWN");
      expect(mapped.title).toBe("Search unavailable");
    }
  });

  it("maps transient provider failures to a retryable try-again message (#error-2)", () => {
    for (const code of ["PROVIDER_TIMEOUT", "PROVIDER_ERROR", "APIFY_RUN_FAILED", "CACHE_REFRESH_FAILED"]) {
      const mapped = mapDiscoverPublicError(code);
      expect(mapped.category).toBe("TRY_AGAIN_LATER");
      expect(mapped.retryable).toBe(true);
    }
  });

  it("maps ownership / not-found codes to a non-revealing unavailable state (#error-9)", () => {
    const mapped = mapDiscoverPublicError("NOT_FOUND");
    expect(mapped.category).toBe("NOT_AVAILABLE");
    expect(mapped.message).toBe("This Discover search is no longer available.");
    expect(mapped.retryable).toBe(false);
  });

  it("is idempotent — a public category re-maps to itself", () => {
    for (const category of DISCOVER_PUBLIC_ERROR_CATEGORIES) {
      expect(discoverPublicErrorCategory(category)).toBe(category);
    }
  });
});
