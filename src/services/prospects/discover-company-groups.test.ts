import { describe, expect, it } from "vitest";

import {
  buildDiscoverCompanyGroups,
  type GroupableSearch
} from "@/services/prospects/discover-company-groups";

const USER_ID = "user_1";

function search(overrides: Partial<GroupableSearch> & { id: string }): GroupableSearch {
  return {
    companyId: "company_walmart",
    requestedCompany: "Walmart Inc.",
    requestedTitles: ["Software Engineer"],
    requestedLocations: ["United States"],
    totalProcessed: 10,
    status: "READY",
    createdAt: new Date("2026-07-04T10:00:00.000Z"),
    updatedAt: new Date("2026-07-04T10:00:00.000Z"),
    ...overrides
  };
}

describe("buildDiscoverCompanyGroups", () => {
  it("consolidates two role searches for one company into ONE entry while keeping both children (#18, #19, #20)", () => {
    const engineer = search({ id: "s_engineer", requestedTitles: ["Software Engineer"] });
    const recruiter = search({
      id: "s_recruiter",
      requestedTitles: ["Recruiter"],
      createdAt: new Date("2026-07-04T09:00:00.000Z"),
      updatedAt: new Date("2026-07-04T09:00:00.000Z")
    });

    const groups = buildDiscoverCompanyGroups(USER_ID, [recruiter, engineer]);

    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("company_walmart");
    // Both child searches survive — grouping is display-only.
    expect(groups[0].searches.map((child) => child.id)).toEqual(["s_engineer", "s_recruiter"]);
    // Both role chips appear, first-seen casing preserved, no duplicates.
    expect(groups[0].requestedRoles).toEqual(["Software Engineer", "Recruiter"]);
  });

  it("does not merge different companies, even with similar names (#24, #25, #54)", () => {
    const apple = search({ id: "s_apple", companyId: "company_apple", requestedCompany: "Apple" });
    const appleBank = search({ id: "s_apple_bank", companyId: "company_apple_bank", requestedCompany: "Apple Bank" });
    const walmart = search({ id: "s_walmart" });

    const groups = buildDiscoverCompanyGroups(USER_ID, [apple, appleBank, walmart]);

    expect(groups).toHaveLength(3);
    expect(new Set(groups.map((group) => group.id)).size).toBe(3);
  });

  it("keeps an unresolved search (no companyId) as its own single-search entry", () => {
    const unresolved = search({ id: "s_draft", companyId: null, status: "DRAFT" });
    const resolved = search({ id: "s_ready" });

    const groups = buildDiscoverCompanyGroups(USER_ID, [unresolved, resolved]);

    expect(groups).toHaveLength(2);
    const fallback = groups.find((group) => group.companyId === null);
    expect(fallback?.id).toBe("s_draft");
    expect(fallback?.searches).toHaveLength(1);
  });

  it("dedupes role labels case-insensitively and keeps distinct locations (#roles)", () => {
    const first = search({ id: "s1", requestedTitles: ["software engineer"], requestedLocations: ["United States"] });
    const second = search({
      id: "s2",
      requestedTitles: ["Software Engineer", "Recruiter"],
      requestedLocations: ["United States", "Canada"],
      createdAt: new Date("2026-07-04T11:00:00.000Z"),
      updatedAt: new Date("2026-07-04T11:00:00.000Z")
    });

    const groups = buildDiscoverCompanyGroups(USER_ID, [first, second]);

    expect(groups[0].requestedRoles.map((role) => role.toLowerCase())).toEqual(["software engineer", "recruiter"]);
    expect(groups[0].locations).toEqual(["United States", "Canada"]);
  });

  it("uses the latest updatedAt across children as the group timestamp (#27)", () => {
    const older = search({
      id: "s_old",
      createdAt: new Date("2026-07-01T10:00:00.000Z"),
      updatedAt: new Date("2026-07-02T10:00:00.000Z")
    });
    const newer = search({
      id: "s_new",
      createdAt: new Date("2026-07-03T10:00:00.000Z"),
      updatedAt: new Date("2026-07-04T10:00:00.000Z")
    });

    const groups = buildDiscoverCompanyGroups(USER_ID, [older, newer]);

    expect(groups[0].latestActivityAt.toISOString()).toBe("2026-07-04T10:00:00.000Z");
  });

  it("orders groups by latest activity, newest first (#pagination order)", () => {
    const quiet = search({
      id: "s_quiet",
      companyId: "company_quiet",
      updatedAt: new Date("2026-07-01T10:00:00.000Z"),
      createdAt: new Date("2026-07-01T10:00:00.000Z")
    });
    const busy = search({
      id: "s_busy",
      companyId: "company_busy",
      updatedAt: new Date("2026-07-04T10:00:00.000Z"),
      createdAt: new Date("2026-07-04T10:00:00.000Z")
    });

    const groups = buildDiscoverCompanyGroups(USER_ID, [quiet, busy]);

    expect(groups.map((group) => group.id)).toEqual(["company_busy", "company_quiet"]);
  });

  it("carries the owner's user id (never a client value) for count scoping", () => {
    const groups = buildDiscoverCompanyGroups(USER_ID, [search({ id: "s1" })]);
    expect(groups[0].userId).toBe(USER_ID);
  });
});
