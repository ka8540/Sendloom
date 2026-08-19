import { describe, expect, it } from "vitest";

import {
  buildTrustedDiscoverLabelPool,
  sanitizeDiscoverSuggestionLabel,
  validateDiscoverSearchLabel,
  validateDiscoverSearchLabels
} from "@/services/prospects/discover-search-label-validation";

describe("Discover role/location input-integrity boundary", () => {
  it.each([
    ["SOFTWARE ENGINEER", "Software Engineer"],
    ["Softwre Engineer", "Software Engineer"],
    ["Recrutier", "Recruiter"],
    ["Human Resouce", "Human Resource"]
  ])("safely canonicalizes the role %s", (value, expected) => {
    const result = validateDiscoverSearchLabel({ type: "ROLE", value });
    expect(result.status).toBe("CORRECTED");
    expect("value" in result && result.value).toBe(expected);
  });

  it("never allows the malformed SOFtenginner label through unchanged", () => {
    const result = validateDiscoverSearchLabel({ type: "ROLE", value: "SOFtenginner" });
    expect(result).toEqual({
      status: "CORRECTED",
      original: "SOFtenginner",
      value: "Software Engineer"
    });
  });

  it("blocks incomplete/ambiguous location prefixes and returns real choices", () => {
    for (const value of ["Un", "United"]) {
      const result = validateDiscoverSearchLabel({ type: "LOCATION", value });
      expect(result.status).toBe("AMBIGUOUS");
      expect("suggestions" in result ? result.suggestions : []).toEqual(
        expect.arrayContaining(["United States", "United Kingdom"])
      );
    }
  });

  it("accepts exact values and safely completes a one-character unique prefix", () => {
    expect(validateDiscoverSearchLabel({ type: "LOCATION", value: "United States" })).toEqual({
      status: "VALID",
      value: "United States"
    });
    expect(validateDiscoverSearchLabel({ type: "LOCATION", value: "united states" })).toEqual({
      status: "CORRECTED",
      original: "united states",
      value: "United States"
    });
    expect(validateDiscoverSearchLabel({ type: "LOCATION", value: "Toront" })).toEqual({
      status: "CORRECTED",
      original: "Toront",
      value: "Toronto"
    });
  });

  it("accepts trusted short professional acronyms without accepting arbitrary fragments", () => {
    expect(validateDiscoverSearchLabel({ type: "ROLE", value: "HR" })).toEqual({ status: "VALID", value: "HR" });
    expect(validateDiscoverSearchLabel({ type: "ROLE", value: "IT" })).toEqual({ status: "VALID", value: "IT" });
    expect(validateDiscoverSearchLabel({ type: "LOCATION", value: "zz" }).status).toBe("INVALID");
  });

  it.each(["", "   ", "@@@", "----"])('rejects malformed value "%s"', (value) => {
    expect(validateDiscoverSearchLabel({ type: "ROLE", value }).status).toBe("INVALID");
    expect(validateDiscoverSearchLabel({ type: "LOCATION", value }).status).toBe("INVALID");
  });

  it("preserves supported professional/location punctuation and distinct place names", () => {
    expect(validateDiscoverSearchLabel({ type: "ROLE", value: "VP, R&D" }).status).toBe("VALID");
    expect(["VALID", "CORRECTED"]).toContain(
      validateDiscoverSearchLabel({ type: "LOCATION", value: "St. John's" }).status
    );
    expect(validateDiscoverSearchLabel({ type: "LOCATION", value: "Indiana" })).toEqual({
      status: "VALID",
      value: "Indiana"
    });
  });

  it("rejects the entire list when any token is ambiguous and otherwise persists only canonical values", () => {
    expect(validateDiscoverSearchLabels({ type: "LOCATION", values: ["Canada", "Un"] })).toMatchObject({
      ok: false,
      index: 1,
      status: "AMBIGUOUS"
    });
    expect(
      validateDiscoverSearchLabels({ type: "ROLE", values: ["Softwre Engineer", "recrutier"] })
    ).toEqual({ ok: true, values: ["Software Engineer", "Recruiter"] });
  });
});

describe("historical suggestion trust", () => {
  it("quarantines incomplete history and canonicalizes safe stored values", () => {
    expect(sanitizeDiscoverSuggestionLabel("LOCATION", "Un")).toBeNull();
    expect(sanitizeDiscoverSuggestionLabel("ROLE", "SOFTWARE ENGINEER")).toBe("Software Engineer");
    expect(sanitizeDiscoverSuggestionLabel("ROLE", "Softwre Engineer")).toBe("Software Engineer");
  });

  it("never admits an ambiguous historical value into a trusted pool", () => {
    const pool = buildTrustedDiscoverLabelPool("LOCATION", ["Un", "Phoenix"]);
    expect(pool).not.toContain("Un");
    expect(pool).toContain("Phoenix");
  });
});
