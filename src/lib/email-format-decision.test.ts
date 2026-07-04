import { describe, expect, it } from "vitest";

import {
  buildEmailFormatCacheKey,
  parseEmailFormatDecisionMetadata,
  serializeEmailFormatDecisionMetadata,
  type EmailFormatDecisionMetadata
} from "@/lib/email-format-decision";

describe("email-format decision metadata", () => {
  it("round-trips structured metadata without a narrative", () => {
    const metadata: EmailFormatDecisionMetadata = {
      version: "structured-v2",
      decisionCode: "SOURCE_MAJORITY",
      supportingSourceCount: 3,
      conflictingSourceCount: 1,
      cacheKey: "structured-v2|walmart inc|walmart.com|walmart.com"
    };

    expect(parseEmailFormatDecisionMetadata(serializeEmailFormatDecisionMetadata(metadata))).toEqual(metadata);
  });

  it("keeps historical prose compatible but unused", () => {
    expect(parseEmailFormatDecisionMetadata("Multiple public sources indicate first.last.")).toBeNull();
  });

  it("keys cache identity by company, website, email domain, and discovery version", () => {
    expect(
      buildEmailFormatCacheKey({ companyName: " Walmart Inc. ", websiteDomain: "www.walmart.com", emailDomain: "walmart.com" })
    ).toBe("structured-v2|walmart inc|walmart.com|walmart.com");
  });
});
