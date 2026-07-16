import { describe, expect, it } from "vitest";

import {
  COMPANY_ROLE_SEARCH_MESSAGES,
  resolveCompanyRoleSearchAction,
  validateCompanyRoleSearchInput,
  type CompanyRoleSearchCandidate
} from "@/services/prospects/discover-company-role-search";

function candidate(overrides: Partial<CompanyRoleSearchCandidate> & { id: string }): CompanyRoleSearchCandidate {
  return {
    status: "READY",
    requestedTitles: ["Software Engineer"],
    requestedLocations: ["United States"],
    ...overrides
  };
}

describe("Search this company — input validation", () => {
  it("rejects an empty or whitespace-only job title with product copy (#11)", () => {
    for (const jobTitle of ["", "   ", null, undefined]) {
      const result = validateCompanyRoleSearchInput({ jobTitle, location: "United States" });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toBe("EMPTY_ROLE");
      expect(!result.ok && result.message).toBe(COMPANY_ROLE_SEARCH_MESSAGES.emptyRole);
    }
  });

  it("bounds role and location length", () => {
    const longText = "x".repeat(201);
    const role = validateCompanyRoleSearchInput({ jobTitle: longText });
    expect(!role.ok && role.error).toBe("ROLE_TOO_LONG");
    const location = validateCompanyRoleSearchInput({ jobTitle: "Recruiter", location: longText });
    expect(!location.ok && location.error).toBe("LOCATION_TOO_LONG");
  });

  it("trims inputs and folds a blank location to null (the 'any location' group)", () => {
    const result = validateCompanyRoleSearchInput({ jobTitle: "  Recruiter ", location: "   " });
    expect(result).toEqual({ ok: true, jobTitle: "Recruiter", location: null });
  });
});

describe("Search this company — duplicate resolution (canonical role+location)", () => {
  const ready = candidate({ id: "s_ready" });

  it("blocks an exact same role + same location as a duplicate pointing at Add 10 more (#1)", () => {
    const action = resolveCompanyRoleSearchAction({
      jobTitle: "Software Engineer",
      location: "United States",
      existingSearches: [ready]
    });
    expect(action).toEqual({
      kind: "duplicate",
      reason: "ready",
      searchId: "s_ready",
      message: COMPANY_ROLE_SEARCH_MESSAGES.duplicateReady
    });
  });

  it("casing differences are still duplicates (#1-casing)", () => {
    const action = resolveCompanyRoleSearchAction({
      jobTitle: "software engineer",
      location: "UNITED STATES",
      existingSearches: [ready]
    });
    expect(action.kind).toBe("duplicate");
  });

  it("extra internal/surrounding whitespace is still a duplicate (#2)", () => {
    const action = resolveCompanyRoleSearchAction({
      jobTitle: "  Software   Engineer ",
      location: " United  States ",
      existingSearches: [ready]
    });
    expect(action.kind).toBe("duplicate");
  });

  it("blank location vs blank location is a duplicate (#3)", () => {
    const bare = candidate({ id: "s_bare", requestedLocations: [] });
    const action = resolveCompanyRoleSearchAction({
      jobTitle: "Software Engineer",
      location: null,
      existingSearches: [bare]
    });
    expect(action.kind).toBe("duplicate");
  });

  it("blank location never merges with a real location in either direction (#3-safety)", () => {
    expect(
      resolveCompanyRoleSearchAction({
        jobTitle: "Software Engineer",
        location: null,
        existingSearches: [ready]
      }).kind
    ).toBe("create");
    const bare = candidate({ id: "s_bare", requestedLocations: [] });
    expect(
      resolveCompanyRoleSearchAction({
        jobTitle: "Software Engineer",
        location: "United States",
        existingSearches: [bare]
      }).kind
    ).toBe("create");
  });

  it("same role + different location is allowed (#4)", () => {
    const action = resolveCompanyRoleSearchAction({
      jobTitle: "Software Engineer",
      location: "Canada",
      existingSearches: [ready]
    });
    expect(action).toEqual({ kind: "create" });
  });

  it("different role + same location is allowed (#5)", () => {
    const action = resolveCompanyRoleSearchAction({
      jobTitle: "Recruiter",
      location: "United States",
      existingSearches: [ready]
    });
    expect(action).toEqual({ kind: "create" });
  });

  it("never folds distinct roles together (Software Engineer vs Data Engineer)", () => {
    const action = resolveCompanyRoleSearchAction({
      jobTitle: "Data Engineer",
      location: "United States",
      existingSearches: [ready]
    });
    expect(action).toEqual({ kind: "create" });
  });

  it("a still-running identical search blocks with the running message (#8)", () => {
    for (const status of ["RESOLVING_COMPANY", "SEARCHING_PEOPLE", "CLASSIFYING_POSITIONS", "INFERRING_EMAIL_PATTERN"]) {
      const action = resolveCompanyRoleSearchAction({
        jobTitle: "Software Engineer",
        location: "United States",
        existingSearches: [candidate({ id: "s_running", status })]
      });
      expect(action.kind === "duplicate" && action.reason).toBe("running");
      expect(action.kind === "duplicate" && action.message).toBe(COMPANY_ROLE_SEARCH_MESSAGES.duplicateRunning);
    }
  });

  it("an identical DRAFT is reused instead of creating a second row", () => {
    const action = resolveCompanyRoleSearchAction({
      jobTitle: "Software Engineer",
      location: "United States",
      existingSearches: [candidate({ id: "s_draft", status: "DRAFT" })]
    });
    expect(action).toEqual({ kind: "reuse-draft", searchId: "s_draft" });
  });

  it("an identical NO_RESULTS search is reused — 'Search this company again' re-runs it", () => {
    const action = resolveCompanyRoleSearchAction({
      jobTitle: "Software Engineer",
      location: "United States",
      existingSearches: [candidate({ id: "s_no_results", status: "NO_RESULTS" })]
    });
    expect(action).toEqual({ kind: "reuse-draft", searchId: "s_no_results" });
  });

  it("an identical FAILED search points at the existing retry flow (#9)", () => {
    const action = resolveCompanyRoleSearchAction({
      jobTitle: "Software Engineer",
      location: "United States",
      existingSearches: [candidate({ id: "s_failed", status: "FAILED" })]
    });
    expect(action.kind === "duplicate" && action.reason).toBe("failed");
    expect(action.kind === "duplicate" && action.message).toBe(COMPANY_ROLE_SEARCH_MESSAGES.duplicateFailed);
  });

  it("a CANCELED sibling never blocks a new search", () => {
    const action = resolveCompanyRoleSearchAction({
      jobTitle: "Software Engineer",
      location: "United States",
      existingSearches: [candidate({ id: "s_canceled", status: "CANCELED" })]
    });
    expect(action).toEqual({ kind: "create" });
  });

  it("READY wins the duplicate message when READY and FAILED siblings coexist", () => {
    const action = resolveCompanyRoleSearchAction({
      jobTitle: "Software Engineer",
      location: "United States",
      existingSearches: [candidate({ id: "s_failed", status: "FAILED" }), ready]
    });
    expect(action.kind === "duplicate" && action.reason).toBe("ready");
  });

  it("tolerates malformed stored titles/locations without crashing", () => {
    const legacy: CompanyRoleSearchCandidate = {
      id: "s_legacy",
      status: "READY",
      requestedTitles: null,
      requestedLocations: { not: "an array" }
    };
    const action = resolveCompanyRoleSearchAction({
      jobTitle: "Software Engineer",
      location: "United States",
      existingSearches: [legacy]
    });
    expect(action).toEqual({ kind: "create" });
  });
});
