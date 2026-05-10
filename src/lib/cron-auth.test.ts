import { describe, expect, it } from "vitest";

import { isCronRequestAuthorized } from "@/lib/cron-auth";

describe("cron auth", () => {
  it("accepts bearer authorization secrets", () => {
    const headers = new Headers({
      authorization: "Bearer test-secret"
    });

    expect(isCronRequestAuthorized(headers, "test-secret")).toBe(true);
  });

  it("accepts raw authorization secrets from cron providers", () => {
    const headers = new Headers({
      authorization: "test-secret"
    });

    expect(isCronRequestAuthorized(headers, "test-secret")).toBe(true);
  });

  it("accepts x-cron-secret headers", () => {
    const headers = new Headers({
      "x-cron-secret": "test-secret"
    });

    expect(isCronRequestAuthorized(headers, "test-secret")).toBe(true);
  });

  it("rejects incorrect secrets when cron auth is configured", () => {
    const headers = new Headers({
      authorization: "wrong-secret"
    });

    expect(isCronRequestAuthorized(headers, "test-secret")).toBe(false);
  });
});
