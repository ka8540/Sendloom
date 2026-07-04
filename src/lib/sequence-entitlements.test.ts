import { describe, expect, it } from "vitest";

import { isApplicationOwner } from "@/lib/account-entitlements";
import {
  FREE_SEQUENCE_CONCURRENT_LIMIT,
  FREE_SEQUENCE_STORAGE_LIMIT,
  getSequenceEntitlements,
  isSequenceLimitExempt
} from "@/lib/sequence-entitlements";

describe("sequence entitlements", () => {
  it("limits ordinary users to 10 concurrent and 50 stored sequences", () => {
    expect(getSequenceEntitlements({ email: "person@example.com" })).toEqual({
      maxConcurrentSequences: FREE_SEQUENCE_CONCURRENT_LIMIT,
      maxStoredSequences: FREE_SEQUENCE_STORAGE_LIMIT
    });
  });

  it("gives the application owner unlimited sequence access", () => {
    expect(getSequenceEntitlements({ email: "kush.ahir2024@gmail.com" })).toEqual({
      maxConcurrentSequences: null,
      maxStoredSequences: null
    });
    expect(isSequenceLimitExempt({ email: "kush.ahir2024@gmail.com" })).toBe(true);
  });

  it("normalizes owner email casing and whitespace", () => {
    expect(isApplicationOwner({ email: "  KUSH.AHIR2024@GMAIL.COM " })).toBe(true);
  });

  it("does not grant an exemption without the trusted user email", () => {
    expect(isSequenceLimitExempt({})).toBe(false);
    expect(isSequenceLimitExempt({ email: "attacker@example.com" })).toBe(false);
  });
});
