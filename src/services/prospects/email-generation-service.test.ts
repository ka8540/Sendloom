import { describe, expect, it } from "vitest";

import { generateEmail, resolveCandidateEmail } from "@/services/prospects/email-generation-service";

describe("generateEmail (deterministic)", () => {
  it("produces the same address every time for a given pattern", () => {
    const args = { firstName: "Jane", lastName: "Doe", domain: "apple.com", pattern: "flast" };
    expect(generateEmail(args)).toBe("jdoe@apple.com");
    expect(generateEmail(args)).toBe("jdoe@apple.com");
  });

  it("supports the documented patterns", () => {
    const base = { firstName: "Jane", lastName: "Doe", domain: "apple.com" };
    expect(generateEmail({ ...base, pattern: "first.last" })).toBe("jane.doe@apple.com");
    expect(generateEmail({ ...base, pattern: "first_last" })).toBe("jane_doe@apple.com");
    expect(generateEmail({ ...base, pattern: "firstlast" })).toBe("janedoe@apple.com");
    expect(generateEmail({ ...base, pattern: "first" })).toBe("jane@apple.com");
    expect(generateEmail({ ...base, pattern: "f.last" })).toBe("j.doe@apple.com");
  });

  it("normalizes unicode and punctuation in names", () => {
    expect(generateEmail({ firstName: "José", lastName: "García", domain: "apple.com", pattern: "flast" })).toBe(
      "jgarcia@apple.com"
    );
    expect(generateEmail({ firstName: "Mary-Jane", lastName: "O'Brien", domain: "apple.com", pattern: "first.last" })).toBe(
      "maryjane.obrien@apple.com"
    );
  });

  it("returns null when a required name component is missing", () => {
    expect(generateEmail({ firstName: "Jane", lastName: "", domain: "apple.com", pattern: "flast" })).toBeNull();
    expect(generateEmail({ firstName: "", lastName: "Doe", domain: "apple.com", pattern: "first.last" })).toBeNull();
  });

  it("rejects personal email domains", () => {
    expect(generateEmail({ firstName: "Jane", lastName: "Doe", domain: "gmail.com", pattern: "flast" })).toBeNull();
  });

  it("rejects unknown patterns", () => {
    expect(generateEmail({ firstName: "Jane", lastName: "Doe", domain: "apple.com", pattern: "totally-made-up" })).toBeNull();
  });
});

describe("resolveCandidateEmail", () => {
  it("labels inferred emails by confidence and never marks them VERIFIED", () => {
    const high = resolveCandidateEmail({
      firstName: "Jane",
      lastName: "Doe",
      domain: "apple.com",
      pattern: "flast",
      patternConfidence: "HIGH",
      allowLowConfidence: false
    });
    expect(high.email).toBe("jdoe@apple.com");
    expect(high.status).toBe("INFERRED_HIGH");
    expect(high.status).not.toBe("VERIFIED");
  });

  it("withholds emails for LOW confidence unless explicitly allowed", () => {
    const blocked = resolveCandidateEmail({
      firstName: "Jane",
      lastName: "Doe",
      domain: "apple.com",
      pattern: "flast",
      patternConfidence: "LOW",
      allowLowConfidence: false
    });
    expect(blocked.email).toBeNull();
    expect(blocked.status).toBe("UNAVAILABLE");

    const allowed = resolveCandidateEmail({
      firstName: "Jane",
      lastName: "Doe",
      domain: "apple.com",
      pattern: "flast",
      patternConfidence: "LOW",
      allowLowConfidence: true
    });
    expect(allowed.email).toBe("jdoe@apple.com");
    expect(allowed.status).toBe("INFERRED_LOW");
  });

  it("returns UNAVAILABLE when there is no pattern or domain", () => {
    expect(
      resolveCandidateEmail({
        firstName: "Jane",
        lastName: "Doe",
        domain: null,
        pattern: "flast",
        patternConfidence: "HIGH",
        allowLowConfidence: false
      }).email
    ).toBeNull();
  });
});
