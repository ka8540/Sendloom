import { describe, expect, it } from "vitest";

import { getCanonicalCompanyKey } from "@/services/prospects/canonical-company";
import {
  resolveCompanyEmailFormatUpdate,
  type CompanyEmailFormatRecord
} from "@/services/prospects/company-email-format";

function format(overrides: Partial<CompanyEmailFormatRecord> = {}): CompanyEmailFormatRecord {
  return {
    emailDomain: "walmart.com",
    emailDomainConfidence: "HIGH",
    emailDomainEvidence: [],
    emailPattern: "first.last",
    patternConfidence: "HIGH",
    patternEvidence: [],
    emailFormatReason: "Evidence-backed format",
    emailFormatAuthority: "AI",
    emailFormatDiscoveredAt: new Date("2026-07-04T00:00:00.000Z"),
    ...overrides
  };
}

describe("canonical company identity", () => {
  it("maps Walmart display-name aliases to one domain key", () => {
    expect(getCanonicalCompanyKey({ name: "Walmart", officialDomain: "www.Walmart.com" })).toBe(
      "domain:walmart.com"
    );
    expect(getCanonicalCompanyKey({ name: "Walmart Inc.", officialWebsiteDomain: "walmart.com" })).toBe(
      "domain:walmart.com"
    );
  });

  it("does not combine similar names on different domains", () => {
    expect(getCanonicalCompanyKey({ name: "Acme", officialDomain: "acme.com" })).not.toBe(
      getCanonicalCompanyKey({ name: "Acme", officialDomain: "acme.co.uk" })
    );
  });
});

describe("canonical company email-format precedence", () => {
  it("does not let an unavailable role-search snapshot erase a valid format", () => {
    const current = format();
    const unavailable = format({
      emailDomain: null,
      emailDomainConfidence: "UNAVAILABLE",
      emailPattern: null,
      patternConfidence: "UNAVAILABLE"
    });
    expect(resolveCompanyEmailFormatUpdate(current, unavailable, "SHARED_CACHE")).toBe(current);
  });

  it("does not let a lower-confidence cache snapshot overwrite the company", () => {
    const current = format();
    const lower = format({ emailDomainConfidence: "MEDIUM", patternConfidence: "MEDIUM" });
    expect(resolveCompanyEmailFormatUpdate(current, lower, "SHARED_CACHE")).toBe(current);
  });

  it("gives manual correction highest priority and preserves it from AI failure", () => {
    const manual = format({
      emailDomainEvidence: [{ sourceType: "manual_override" }],
      patternEvidence: [{ sourceType: "manual_override" }],
      emailFormatReason: "Manual correction",
      emailFormatAuthority: "MANUAL"
    });
    const ai = format({ emailDomain: "careers.walmart.com", emailFormatReason: "AI refresh" });
    expect(resolveCompanyEmailFormatUpdate(manual, ai, "AI")).toBe(manual);
    expect(resolveCompanyEmailFormatUpdate(ai, manual, "MANUAL")).toBe(manual);
  });

  it("lets AI replace a cache seed but not a trusted source correction", () => {
    const cacheSeed = format({ emailPattern: "flast", emailFormatAuthority: "SHARED_CACHE" });
    const ai = format({ emailFormatAuthority: "AI" });
    const source = format({ emailPattern: "first_last", emailFormatAuthority: "SOURCE" });

    expect(resolveCompanyEmailFormatUpdate(cacheSeed, ai, "AI")).toBe(ai);
    expect(resolveCompanyEmailFormatUpdate(source, ai, "AI")).toBe(source);
  });
});
