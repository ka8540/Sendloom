// Contracts for the pure Discover suggestion ranking + conservative typo
// correction, plus the comma-token helpers. No I/O — every branch is exercised
// directly (node-only vitest).

import { describe, expect, it } from "vitest";

import {
  activeToken,
  activeTokenRange,
  levenshtein,
  rankSuggestions,
  replaceActiveToken,
  type SuggestionEntry
} from "@/services/prospects/discover-suggestions";

function roleEntry(value: string, count?: number): SuggestionEntry {
  return { value, count };
}

const KNOWN_ROLES: SuggestionEntry[] = [
  roleEntry("Software Engineer", 5),
  roleEntry("Data Engineer", 3),
  roleEntry("Recruiter", 4),
  roleEntry("Recruiting Manager", 1),
  roleEntry("Product Manager", 2)
];

const KNOWN_LOCATIONS: SuggestionEntry[] = [
  roleEntry("United States", 6),
  roleEntry("United Kingdom", 2),
  roleEntry("India", 3),
  roleEntry("Indiana", 1),
  roleEntry("New York", 4)
];

describe("rankSuggestions — ordering (#1, #2, #3, #4)", () => {
  it("ranks an exact match first (#1)", () => {
    const { matches } = rankSuggestions(KNOWN_ROLES, "Recruiter");
    expect(matches[0]?.value).toBe("Recruiter");
    // "Recruiting Manager" is only a substring/word match, so it sits lower.
    expect(matches[0]?.value).not.toBe("Recruiting Manager");
  });

  it("ranks a prefix match before a fuzzy correction (#2)", () => {
    // "recr" prefixes "Recruiter" and "Recruiting Manager" → both are matches,
    // and because there IS a direct match, no correction is produced.
    const { matches, correction } = rankSuggestions(KNOWN_ROLES, "recr");
    expect(matches.map((match) => match.value)).toContain("Recruiter");
    expect(matches.map((match) => match.value)).toContain("Recruiting Manager");
    expect(correction).toBeNull();
  });

  it("is case-insensitive (#3)", () => {
    const upper = rankSuggestions(KNOWN_ROLES, "SOFTWARE ENGINEER").matches[0]?.value;
    const lower = rankSuggestions(KNOWN_ROLES, "software engineer").matches[0]?.value;
    expect(upper).toBe("Software Engineer");
    expect(lower).toBe("Software Engineer");
  });

  it("normalizes extra spaces (#4)", () => {
    const { matches } = rankSuggestions(KNOWN_ROLES, "  software   engineer ");
    expect(matches[0]?.value).toBe("Software Engineer");
  });

  it("orders equal-rank matches by usage count then alphabetically", () => {
    const entries = [roleEntry("Sales Associate", 1), roleEntry("Sales Manager", 9)];
    const { matches } = rankSuggestions(entries, "sales");
    expect(matches.map((match) => match.value)).toEqual(["Sales Manager", "Sales Associate"]);
  });
});

describe("rankSuggestions — typo correction (#5, #6)", () => {
  it("suggests 'Software Engineer' for 'softwere engineer' (#5)", () => {
    const { matches, correction } = rankSuggestions(KNOWN_ROLES, "softwere engineer");
    expect(matches).toHaveLength(0);
    expect(correction?.value).toBe("Software Engineer");
    expect(correction?.kind).toBe("correction");
  });

  it("suggests 'Software Engineer' for a longer 'softwere engineering' typo", () => {
    const { correction } = rankSuggestions(KNOWN_ROLES, "softwere engineering");
    expect(correction?.value).toBe("Software Engineer");
  });

  it("corrects common role typos to the nearest known role", () => {
    expect(rankSuggestions(KNOWN_ROLES, "software enginer").correction?.value).toBe("Software Engineer");
    expect(rankSuggestions(KNOWN_ROLES, "recuiter").correction?.value).toBe("Recruiter");
    expect(rankSuggestions(KNOWN_ROLES, "recruter").correction?.value).toBe("Recruiter");
    expect(rankSuggestions(KNOWN_ROLES, "data engneer").correction?.value).toBe("Data Engineer");
  });

  it("suggests 'United States' for 'untied states' (#6)", () => {
    const { matches, correction } = rankSuggestions(KNOWN_LOCATIONS, "untied states");
    expect(matches).toHaveLength(0);
    expect(correction?.value).toBe("United States");
  });

  it("suggests 'New York' for 'new yrok'", () => {
    expect(rankSuggestions(KNOWN_LOCATIONS, "new yrok").correction?.value).toBe("New York");
  });
});

describe("rankSuggestions — conservative, never over-corrects (#7)", () => {
  it("does not correct an unrelated short word (#7)", () => {
    const { matches, correction } = rankSuggestions(KNOWN_ROLES, "xyz");
    expect(matches).toHaveLength(0);
    expect(correction).toBeNull();
  });

  it("never corrects one distinct role into another", () => {
    // "Software Engineer" typed with only "Data Engineer"-family roles known must
    // NOT be "corrected" to Data Engineer — they are distinct roles.
    const onlyDataRoles = [roleEntry("Data Engineer"), roleEntry("Data Analyst")];
    expect(rankSuggestions(onlyDataRoles, "software engineer").correction).toBeNull();
  });

  it("does not merge India and Indiana or United States and United Kingdom", () => {
    // "india" is a prefix of "Indiana", so it surfaces as a MATCH (India first),
    // never as a correction that silently swaps the two.
    const { matches, correction } = rankSuggestions(KNOWN_LOCATIONS, "india");
    expect(matches[0]?.value).toBe("India");
    expect(matches.map((match) => match.value)).toContain("Indiana");
    expect(correction).toBeNull();

    // "united" prefixes both countries — both are matches, neither is a wrong
    // correction of the other.
    const united = rankSuggestions(KNOWN_LOCATIONS, "united");
    expect(united.matches.map((match) => match.value)).toEqual(
      expect.arrayContaining(["United States", "United Kingdom"])
    );
    expect(united.correction).toBeNull();
  });

  it("does not correct very short queries", () => {
    // "eng" would be within edit distance of nothing meaningful; and short
    // queries are never corrected regardless.
    expect(rankSuggestions(KNOWN_ROLES, "rec").correction).toBeNull();
  });
});

describe("rankSuggestions — company matching by name and domain (#10, #11)", () => {
  const companies: SuggestionEntry[] = [
    {
      value: "Stripe",
      detail: "stripe.com",
      companyId: "c_stripe",
      canonicalKey: "domain:stripe.com",
      matchKeys: ["Stripe", "stripe.com"],
      correctionKeys: ["Stripe"]
    },
    {
      value: "Snowflake Inc.",
      detail: "snowflake.com",
      companyId: "c_snow",
      canonicalKey: "domain:snowflake.com",
      matchKeys: ["Snowflake Inc.", "Snowflake", "snowflake.com"],
      correctionKeys: ["Snowflake Inc.", "Snowflake"]
    }
  ];

  it("matches a company by name prefix and preserves dedupe hints", () => {
    const { matches } = rankSuggestions(companies, "str");
    expect(matches[0]?.value).toBe("Stripe");
    expect(matches[0]?.companyId).toBe("c_stripe");
    expect(matches[0]?.canonicalKey).toBe("domain:stripe.com");
    expect(matches[0]?.detail).toBe("stripe.com");
  });

  it("matches a company by its domain (#11)", () => {
    const { matches } = rankSuggestions(companies, "snowflake.com");
    expect(matches[0]?.value).toBe("Snowflake Inc.");
  });

  it("enforces the result limit (#15)", () => {
    const many = Array.from({ length: 20 }, (_, index) => roleEntry(`Engineer ${index}`));
    expect(rankSuggestions(many, "engineer", { limit: 8 }).matches).toHaveLength(8);
  });

  it("returns nothing for an empty query (#16)", () => {
    expect(rankSuggestions(companies, "")).toEqual({ matches: [], correction: null });
    expect(rankSuggestions(companies, "   ")).toEqual({ matches: [], correction: null });
  });
});

describe("levenshtein", () => {
  it("computes small edit distances and honors the bound", () => {
    expect(levenshtein("recruiter", "recruiter")).toBe(0);
    expect(levenshtein("recruter", "recruiter")).toBe(1);
    expect(levenshtein("untied", "united")).toBe(2);
    // Bailing early once the bound is exceeded returns max + 1, not the true cost.
    expect(levenshtein("abcdef", "zzzzzz", 2)).toBe(3);
  });
});

describe("comma-token helpers (#7 comma tokens, #20)", () => {
  it("finds the active token range around the caret", () => {
    const value = "Software Engineer, Recr";
    // caret at the end sits in the second token.
    expect(activeToken(value, value.length)).toBe("Recr");
    // caret inside the first token.
    expect(activeToken(value, 5)).toBe("Software Engineer");
  });

  it("replaces ONLY the active token, keeping the others and spacing", () => {
    const value = "Software Engineer, Recr";
    const { value: next } = replaceActiveToken(value, value.length, "Recruiter");
    expect(next).toBe("Software Engineer, Recruiter");
  });

  it("replaces the first token without touching later ones", () => {
    const value = "Softwere Engineer, Recruiter";
    const { value: next, caret } = replaceActiveToken(value, 4, "Software Engineer");
    expect(next).toBe("Software Engineer, Recruiter");
    expect(caret).toBe("Software Engineer".length);
  });

  it("treats a single-token field as one whole replacement", () => {
    const value = "Untied States";
    const { value: next } = replaceActiveToken(value, value.length, "United States");
    expect(next).toBe("United States");
  });

  it("reports a caret at the boundary against the preceding token", () => {
    const range = activeTokenRange("a, b", 1);
    expect("a, b".slice(range.start, range.end)).toBe("a");
  });
});
