import { describe, expect, it } from "vitest";

import {
  discoverRoleGroupKey,
  normalizeRoleGroupToken,
  normalizeRoleGroupTokens,
  roleGroupKeyFor
} from "@/services/prospects/discover-role-group-key";

describe("normalizeRoleGroupToken", () => {
  it("folds casing and surrounding/duplicated whitespace to one form (#1, #2)", () => {
    expect(normalizeRoleGroupToken("Software Engineer")).toBe("software engineer");
    expect(normalizeRoleGroupToken("software engineer")).toBe("software engineer");
    expect(normalizeRoleGroupToken("  Software   Engineer  ")).toBe("software engineer");
    expect(normalizeRoleGroupToken("Software\tEngineer")).toBe("software engineer");
  });

  it("unifies equivalent dash and quote glyphs but keeps distinct roles distinct (#3)", () => {
    expect(normalizeRoleGroupToken("Full‑Stack Engineer")).toBe(normalizeRoleGroupToken("Full-Stack Engineer"));
    expect(normalizeRoleGroupToken("VP, People’s Ops")).toBe(normalizeRoleGroupToken("VP, People's Ops"));
    expect(normalizeRoleGroupToken("Data Engineer")).not.toBe(normalizeRoleGroupToken("Software Engineer"));
    expect(normalizeRoleGroupToken("Recruiter")).not.toBe(normalizeRoleGroupToken("Product Manager"));
  });

  it("returns an empty string for blank input", () => {
    expect(normalizeRoleGroupToken("   ")).toBe("");
    expect(normalizeRoleGroupToken("")).toBe("");
  });
});

describe("normalizeRoleGroupTokens", () => {
  it("drops blanks, dedupes, and sorts so ordering never matters", () => {
    expect(normalizeRoleGroupTokens(["Recruiter", "Software Engineer", "recruiter", "  "])).toEqual([
      "recruiter",
      "software engineer"
    ]);
    expect(normalizeRoleGroupTokens(["Software Engineer", "Recruiter"])).toEqual(
      normalizeRoleGroupTokens(["Recruiter", "Software Engineer"])
    );
    expect(normalizeRoleGroupTokens(null)).toEqual([]);
  });
});

describe("roleGroupKeyFor", () => {
  it("maps casing/whitespace variants of the same role+location to one key (#1, #2)", () => {
    const a = roleGroupKeyFor({ requestedTitles: ["Software Engineer"], requestedLocations: ["New York"] });
    const b = roleGroupKeyFor({ requestedTitles: ["  software   engineer "], requestedLocations: ["new york"] });
    expect(a).toBe(b);
  });

  it("keeps different roles in different groups (#3)", () => {
    expect(roleGroupKeyFor({ requestedTitles: ["Software Engineer"] })).not.toBe(
      roleGroupKeyFor({ requestedTitles: ["Data Engineer"] })
    );
  });

  it("normalizes blank/absent location consistently (#4)", () => {
    const none = roleGroupKeyFor({ requestedTitles: ["Software Engineer"] });
    expect(none).toBe(roleGroupKeyFor({ requestedTitles: ["Software Engineer"], requestedLocations: [] }));
    expect(none).toBe(roleGroupKeyFor({ requestedTitles: ["Software Engineer"], requestedLocations: ["   "] }));
    expect(none).toBe(roleGroupKeyFor({ requestedTitles: ["Software Engineer"], requestedLocations: null }));
  });

  it("keeps the same role in different locations separate (#5)", () => {
    expect(roleGroupKeyFor({ requestedTitles: ["Software Engineer"], requestedLocations: ["New York"] })).not.toBe(
      roleGroupKeyFor({ requestedTitles: ["Software Engineer"], requestedLocations: ["London"] })
    );
  });

  it("collapses an empty role set to the 'any role' sentinel", () => {
    expect(roleGroupKeyFor({ requestedTitles: [] })).toBe("*::");
  });
});

describe("discoverRoleGroupKey", () => {
  const base = { userId: "u1", companyId: "c1", requestedTitles: ["Software Engineer"], requestedLocations: [] };

  it("is null until a company is resolved (no shared identity yet)", () => {
    expect(discoverRoleGroupKey({ ...base, companyId: null })).toBeNull();
  });

  it("never merges across users, companies, roles, or locations (#3, #5, #10, #11)", () => {
    const key = discoverRoleGroupKey(base);
    expect(discoverRoleGroupKey({ ...base, userId: "u2" })).not.toBe(key);
    expect(discoverRoleGroupKey({ ...base, companyId: "c2" })).not.toBe(key);
    expect(discoverRoleGroupKey({ ...base, requestedTitles: ["Data Engineer"] })).not.toBe(key);
    expect(discoverRoleGroupKey({ ...base, requestedLocations: ["London"] })).not.toBe(key);
  });

  it("matches the same user+company+role regardless of casing/whitespace (#8)", () => {
    expect(discoverRoleGroupKey(base)).toBe(
      discoverRoleGroupKey({ ...base, requestedTitles: ["  SOFTWARE  engineer"] })
    );
  });
});
