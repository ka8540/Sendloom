import { describe, expect, it } from "vitest";

import {
  identityNeedsResolution,
  identityToEmailTokens,
  isIdentityUsableForEmail,
  normalizeNameForEmail,
  parsePersonName
} from "@/services/prospects/prospect-person-name";

const parse = (fullName: string) => parsePersonName({ fullName });

describe("parsePersonName — clean names", () => {
  it("parses an ordinary two-part name", () => {
    const identity = parse("Jared Cho");
    expect(identity.firstName).toBe("Jared");
    expect(identity.lastName).toBe("Cho");
    expect(identity.fullName).toBe("Jared Cho");
    expect(identity.status).toBe("COMPLETE");
    expect(identity.alternateFirstNames).toEqual([]);
  });

  it("keeps hyphenated and apostrophe names usable", () => {
    const hyphenated = parse("Jean-Pierre Smith-Jones");
    expect(hyphenated.firstName).toBe("Jean-Pierre");
    expect(hyphenated.lastName).toBe("Smith-Jones");
    expect(isIdentityUsableForEmail(hyphenated)).toBe(true);

    const apostrophe = parse("Patrick O'Brien");
    expect(apostrophe.firstName).toBe("Patrick");
    expect(apostrophe.lastName).toBe("O'Brien");
    expect(isIdentityUsableForEmail(apostrophe)).toBe(true);
  });

  it("preserves accented characters in the canonical identity", () => {
    const identity = parse("José García");
    expect(identity.firstName).toBe("José");
    expect(identity.lastName).toBe("García");
    expect(identity.status).toBe("COMPLETE");
  });
});

describe("parsePersonName — credentials", () => {
  it.each([
    ["Jared Cho MBA"],
    ["Jared Cho M.B.A."],
    ["Jared Cho, MBA"],
    ["Jared Cho, Ph.D."],
    ["Jared Cho PhD"],
    ["Jared Cho, MBA, PMP"],
    ["Jared Cho Esq."],
    ["Jared Cho, J.D."],
    ["Jared Cho CPA"]
  ])("strips trailing credentials from %s", (raw) => {
    const identity = parse(raw);
    expect(identity.firstName).toBe("Jared");
    expect(identity.lastName).toBe("Cho");
    expect(identity.fullName).toBe("Jared Cho");
    expect(identity.status).toBe("COMPLETE");
  });

  it("never strips a legitimate surname that spells a degree abbreviation", () => {
    const li = parse("Li Ma");
    expect(li.firstName).toBe("Li");
    expect(li.lastName).toBe("Ma");
    expect(li.status).toBe("COMPLETE");

    // The same guard protects other real surnames in the collision set.
    expect(parse("Jane Do").lastName).toBe("Do");
    expect(parse("Amy Ba").lastName).toBe("Ba");
    expect(parse("Chen Ms").lastName).toBe("Ms");
  });

  it("treats a credential that can never be a surname as decoration", () => {
    const identity = parse("Jared MBA");
    expect(identity.firstName).toBe("Jared");
    expect(identity.lastName).toBeNull();
    expect(identity.status).toBe("INCOMPLETE");
  });

  it("strips a leading honorific", () => {
    const identity = parse("Dr. Jared Cho");
    expect(identity.firstName).toBe("Jared");
    expect(identity.lastName).toBe("Cho");
  });

  it("strips generational suffixes without eating the surname", () => {
    expect(parse("Jane Doe Jr.").lastName).toBe("Doe");
    expect(parse("Jane Doe III").lastName).toBe("Doe");
  });
});

describe("parsePersonName — emoji and symbols", () => {
  it.each([["🚀 Jared Cho"], ["Jared Cho 🎯"], ["Jared 🚀 Cho"], ["Jared Cho ✅ MBA"], ["Jared 👨🏽‍💻 Cho"]])(
    "discards decorations in %s",
    (raw) => {
      const identity = parse(raw);
      expect(identity.firstName).toBe("Jared");
      expect(identity.lastName).toBe("Cho");
      expect(identity.fullName).toBe("Jared Cho");
      expect(identity.status).toBe("COMPLETE");
    }
  );

  it("never lets a decoration reach an email local part", () => {
    expect(normalizeNameForEmail("🚀Jared", "Cho🎯")).toEqual({
      first: "jared",
      last: "cho",
      firstInitial: "j"
    });
  });
});

describe("parsePersonName — middle names and initials", () => {
  it.each([["Jared M. Cho"], ["Jared M Cho"], ["Jared Michael Cho"]])(
    "keeps the middle component out of the family name for %s",
    (raw) => {
      const identity = parse(raw);
      expect(identity.firstName).toBe("Jared");
      expect(identity.lastName).toBe("Cho");
      expect(identity.status).toBe("COMPLETE");
    }
  );
});

describe("parsePersonName — multi-part family names", () => {
  it.each([
    ["María de la Cruz", "María", "de la Cruz"],
    ["Ana del Río", "Ana", "del Río"],
    ["Jan van der Meer", "Jan", "van der Meer"],
    ["Ludwig von Braun", "Ludwig", "von Braun"]
  ])("preserves particles in %s", (raw, first, last) => {
    const identity = parse(raw);
    expect(identity.firstName).toBe(first);
    expect(identity.lastName).toBe(last);
    expect(identity.status).toBe("COMPLETE");
  });
});

describe("parsePersonName — parenthetical names", () => {
  it("treats a parenthetical given name as an alternate, never a name part", () => {
    const identity = parse("Jared (Yiming) Cho");
    expect(identity.firstName).toBe("Jared");
    expect(identity.lastName).toBe("Cho");
    expect(identity.alternateFirstNames).toEqual(["Yiming"]);
    expect(identity.fullName).toBe("Jared (Yiming) Cho");
    expect(identity.status).toBe("COMPLETE");
  });

  it("never fuses the alternate into a name component", () => {
    const tokens = identityToEmailTokens(parse("Jared (Yiming) Cho"));
    expect(tokens.first).toBe("jared");
    expect(tokens.last).toBe("cho");
    expect(tokens.first).not.toContain("yiming");
    expect(tokens.last).not.toContain("yiming");
  });

  it.each([["Jared (he/him) Cho"], ["Jared (MBA) Cho"], ["Jared (She/Her) Cho"], ["Jared (Retired) Cho"]])(
    "does not treat non-name parentheticals in %s as alternates",
    (raw) => {
      const identity = parse(raw);
      expect(identity.firstName).toBe("Jared");
      expect(identity.lastName).toBe("Cho");
      expect(identity.alternateFirstNames).toEqual([]);
    }
  );
});

describe("parsePersonName — incomplete identities", () => {
  it.each([["Jared C."], ["Jared C"], ["Jared C. MBA"], ["Jared C. 🎯"]])(
    "reports %s as ambiguous with no family name",
    (raw) => {
      const identity = parse(raw);
      expect(identity.firstName).toBe("Jared");
      expect(identity.lastName).toBeNull();
      expect(identity.status).toBe("AMBIGUOUS");
      expect(identityNeedsResolution(identity)).toBe(true);
    }
  );

  it("preserves the readable display form of an unresolved identity", () => {
    expect(parse("Jared C.").fullName).toBe("Jared C.");
  });

  it("reports a lone given name as incomplete", () => {
    const identity = parse("Jared");
    expect(identity.firstName).toBe("Jared");
    expect(identity.lastName).toBeNull();
    expect(identity.status).toBe("INCOMPLETE");
    expect(identityNeedsResolution(identity)).toBe(true);
  });

  it.each([["J. Cho"], ["J Cho"]])("reports an initial-only given name in %s as ambiguous", (raw) => {
    const identity = parse(raw);
    expect(identity.firstName).toBeNull();
    expect(identity.firstInitial).toBe("j");
    expect(identity.lastName).toBe("Cho");
    expect(identity.status).toBe("AMBIGUOUS");
  });

  it("reports an empty or decoration-only name as unusable", () => {
    expect(parse("").status).toBe("UNUSABLE");
    expect(parse("🚀🎯").status).toBe("UNUSABLE");
  });
});

describe("parsePersonName — structured provider fields", () => {
  it("repairs a polluted provider last name", () => {
    const identity = parsePersonName({
      firstName: "Jared",
      lastName: "Cho M.B.A.",
      fullName: "Jared Cho M.B.A."
    });
    expect(identity.firstName).toBe("Jared");
    expect(identity.lastName).toBe("Cho");
  });

  it("rejects an initial-only provider last name", () => {
    const identity = parsePersonName({ firstName: "Jared", lastName: "C.", fullName: "Jared C." });
    expect(identity.lastName).toBeNull();
    expect(identity.status).toBe("AMBIGUOUS");
  });

  it("strips a parenthetical from a provider last name", () => {
    const identity = parsePersonName({
      firstName: "Jared",
      lastName: "(Yiming) Cho",
      fullName: "Jared (Yiming) Cho"
    });
    expect(identity.lastName).toBe("Cho");
    expect(identity.alternateFirstNames).toEqual(["Yiming"]);
  });

  it("drops a leading middle initial left in a provider last name", () => {
    const identity = parsePersonName({
      firstName: "Jared",
      lastName: "M. Cho",
      fullName: "Jared M. Cho"
    });
    expect(identity.lastName).toBe("Cho");
  });

  it("does not glue a middle name onto the family name", () => {
    const identity = parsePersonName({
      firstName: "Jared",
      lastName: "Michael Cho",
      fullName: "Jared Michael Cho"
    });
    expect(identity.lastName).toBe("Cho");
  });

  it("keeps a particle-carrying provider family name whole", () => {
    const identity = parsePersonName({
      firstName: "Jan",
      lastName: "van der Meer",
      fullName: "Jan van der Meer"
    });
    expect(identity.lastName).toBe("van der Meer");
  });

  it("falls back to the display name when structured fields are missing", () => {
    const identity = parsePersonName({ fullName: "Jared Cho" });
    expect(identity.firstName).toBe("Jared");
    expect(identity.lastName).toBe("Cho");
  });
});

describe("normalizeNameForEmail", () => {
  it("folds diacritics, apostrophes, and hyphens", () => {
    expect(normalizeNameForEmail("José", "García")).toEqual({
      first: "jose",
      last: "garcia",
      firstInitial: "j"
    });
    expect(normalizeNameForEmail("O'Brien", "Smith-Jones")).toEqual({
      first: "obrien",
      last: "smithjones",
      firstInitial: "o"
    });
    expect(normalizeNameForEmail("Jane", "Doe Jr.")).toEqual({
      first: "jane",
      last: "doe",
      firstInitial: "j"
    });
  });

  it("returns null tokens for missing components", () => {
    expect(normalizeNameForEmail("", "Doe").first).toBeNull();
    expect(normalizeNameForEmail("Jane", "").last).toBeNull();
  });

  it("withholds a surname token when only an initial is known", () => {
    const tokens = normalizeNameForEmail("Jared", "C.");
    expect(tokens.first).toBe("jared");
    expect(tokens.last).toBeNull();
  });

  it("exposes a given-name initial even when the full given name is unknown", () => {
    const tokens = normalizeNameForEmail("J.", "Cho");
    expect(tokens.first).toBeNull();
    expect(tokens.firstInitial).toBe("j");
    expect(tokens.last).toBe("cho");
  });
});
