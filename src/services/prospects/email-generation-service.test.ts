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

  it.each([
    ["first", "jane@apple.com"],
    ["last", "doe@apple.com"],
    ["firstlast", "janedoe@apple.com"],
    ["first.last", "jane.doe@apple.com"],
    ["first_last", "jane_doe@apple.com"],
    ["flast", "jdoe@apple.com"],
    ["f.last", "j.doe@apple.com"],
    ["f_last", "j_doe@apple.com"],
    ["firstl", "janed@apple.com"],
    ["first.l", "jane.d@apple.com"],
    ["lastf", "doej@apple.com"],
    ["last.first", "doe.jane@apple.com"]
  ])("supports canonical pattern %s", (pattern, expected) => {
    expect(generateEmail({ firstName: "Jane", lastName: "Doe", domain: "apple.com", pattern })).toBe(expected);
  });

  it("generates recruiter addresses from the same company pattern", () => {
    expect(
      generateEmail({ firstName: "Christy", lastName: "Stouffer", domain: "walmart.com", pattern: "first.last" })
    ).toBe("christy.stouffer@walmart.com");
    expect(
      generateEmail({ firstName: "Abel", lastName: "Garcia", domain: "walmart.com", pattern: "first.last" })
    ).toBe("abel.garcia@walmart.com");
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

// Regression suite for the malformed-identity bugs: a display name must never
// be able to produce a syntactically valid but semantically wrong address.
describe("generateEmail — malformed identities", () => {
  const apple = { domain: "apple.com", pattern: "first.last" };

  it.each([
    ["Jared", "Cho M.B.A."],
    ["Jared", "Cho MBA"],
    ["Jared", "Cho, Ph.D."],
    ["Jared", "M. Cho"],
    ["Jared", "Michael Cho"],
    ["Jared", "(Yiming) Cho"],
    ["🚀 Jared", "Cho 🎯"]
  ])("withholds unvalidated source components %s / %s", (firstName, lastName) => {
    expect(generateEmail({ ...apple, firstName, lastName })).toBeNull();
  });

  it("never lets a credential become part of the local part", () => {
    const email = generateEmail({ ...apple, firstName: "Jared", lastName: "Cho M.B.A." });
    expect(email).toBeNull();

  });

  it("never fuses a parenthetical alternate into the local part", () => {
    const email = generateEmail({ ...apple, firstName: "Jared", lastName: "(Yiming) Cho" });
    expect(email).toBeNull();

  });

  it("withholds every surname-dependent address for an initial-only surname", () => {
    for (const pattern of ["first.last", "firstlast", "first_last", "flast", "f.last", "f_last", "lastf", "last.first", "last", "firstl", "first.l"]) {
      expect(generateEmail({ firstName: "Jared", lastName: "C.", domain: "apple.com", pattern })).toBeNull();
    }
  });

  it("withholds even first-only patterns until the ambiguous identity is validated", () => {
    expect(generateEmail({ firstName: "Jared", lastName: "C.", domain: "apple.com", pattern: "first" })).toBeNull();
  });

  it("withholds addresses needing a full given name when only an initial is known", () => {
    expect(generateEmail({ firstName: "J.", lastName: "Cho", domain: "apple.com", pattern: "first.last" })).toBeNull();
    expect(generateEmail({ firstName: "J.", lastName: "Cho", domain: "apple.com", pattern: "f.last" })).toBeNull();
  });

  it("does not mistake a real surname for a degree abbreviation", () => {
    expect(generateEmail({ firstName: "Li", lastName: "Ma", domain: "apple.com", pattern: "first.last" })).toBe(
      "li.ma@apple.com"
    );
  });

  it("reports UNAVAILABLE for an unresolvable identity", () => {
    const candidate = resolveCandidateEmail({
      firstName: "Jared",
      lastName: "C.",
      domain: "apple.com",
      pattern: "first.last",
      patternConfidence: "HIGH",
      allowLowConfidence: false
    });
    expect(candidate.email).toBeNull();
    expect(candidate.status).toBe("UNAVAILABLE");
  });
});
