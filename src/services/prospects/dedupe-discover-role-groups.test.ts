import { describe, expect, it } from "vitest";

import {
  planRoleGroupDedupe,
  type DedupeSearchInput
} from "@/services/prospects/dedupe-discover-role-groups";

function search(overrides: Partial<DedupeSearchInput> & { id: string }): DedupeSearchInput {
  return {
    userId: "u1",
    companyId: "c1",
    requestedTitles: ["Software Engineer"],
    requestedLocations: [],
    status: "READY",
    createdAt: new Date("2026-07-04T10:00:00.000Z"),
    allocationPersonIds: [],
    hasExpansions: false,
    ...overrides
  };
}

describe("planRoleGroupDedupe", () => {
  it("reports nothing when every role group is unique (#18 no-op)", () => {
    const plan = planRoleGroupDedupe([
      search({ id: "s1", requestedTitles: ["Software Engineer"] }),
      search({ id: "s2", requestedTitles: ["Recruiter"] })
    ]);
    expect(plan.groups).toHaveLength(0);
    expect(plan.summary).toEqual({
      duplicateGroups: 0,
      searchesRemoved: 0,
      peopleMoved: 0,
      duplicatePeopleSkipped: 0
    });
  });

  it("keeps the oldest search and folds duplicates into it (#19, #20)", () => {
    const plan = planRoleGroupDedupe([
      search({ id: "old", createdAt: new Date("2026-07-01T00:00:00.000Z"), allocationPersonIds: ["p1", "p2"] }),
      search({ id: "new", createdAt: new Date("2026-07-05T00:00:00.000Z"), allocationPersonIds: ["p3"] })
    ]);
    expect(plan.groups).toHaveLength(1);
    const group = plan.groups[0];
    expect(group.canonicalId).toBe("old");
    expect(group.duplicates).toHaveLength(1);
    expect(group.duplicates[0].searchId).toBe("new");
    expect(group.duplicates[0].reparentPersonIds).toEqual(["p3"]);
    expect(group.canonicalTotalProcessed).toBe(3);
    expect(plan.summary.peopleMoved).toBe(1);
  });

  it("never duplicates a person the canonical already holds (#21)", () => {
    const plan = planRoleGroupDedupe([
      search({ id: "old", createdAt: new Date("2026-07-01T00:00:00.000Z"), allocationPersonIds: ["p1", "p2"] }),
      search({ id: "new", createdAt: new Date("2026-07-05T00:00:00.000Z"), allocationPersonIds: ["p2", "p3"] })
    ]);
    const group = plan.groups[0];
    expect(group.duplicates[0].reparentPersonIds).toEqual(["p3"]);
    expect(group.duplicates[0].dropPersonIds).toEqual(["p2"]);
    expect(group.canonicalTotalProcessed).toBe(3);
    expect(plan.summary.peopleMoved).toBe(1);
    expect(plan.summary.duplicatePeopleSkipped).toBe(1);
  });

  it("is idempotent — after the merge only the canonical remains, so re-planning is a no-op (#22)", () => {
    const merged = planRoleGroupDedupe([
      search({ id: "old", allocationPersonIds: ["p1", "p2", "p3"] })
    ]);
    expect(merged.groups).toHaveLength(0);
  });

  it("collapses casing/whitespace variants of the same role (#8)", () => {
    const plan = planRoleGroupDedupe([
      search({ id: "a", requestedTitles: ["Software Engineer"] }),
      search({ id: "b", requestedTitles: ["  software   ENGINEER"], createdAt: new Date("2026-07-05T00:00:00.000Z") })
    ]);
    expect(plan.groups).toHaveLength(1);
    expect(plan.summary.searchesRemoved).toBe(1);
  });

  it("never merges different roles, users, companies, or locations (#23, #24)", () => {
    const plan = planRoleGroupDedupe([
      search({ id: "role_a", requestedTitles: ["Software Engineer"] }),
      search({ id: "role_b", requestedTitles: ["Data Engineer"] }),
      search({ id: "user_b", userId: "u2" }),
      search({ id: "company_b", companyId: "c2" }),
      search({ id: "loc_b", requestedLocations: ["London"] })
    ]);
    expect(plan.groups).toHaveLength(0);
  });

  it("ignores unresolved (no company) and non-READY searches", () => {
    const plan = planRoleGroupDedupe([
      search({ id: "ready", createdAt: new Date("2026-07-01T00:00:00.000Z") }),
      search({ id: "draft", status: "DRAFT", createdAt: new Date("2026-07-02T00:00:00.000Z") }),
      search({ id: "no_company", companyId: null, createdAt: new Date("2026-07-03T00:00:00.000Z") })
    ]);
    expect(plan.groups).toHaveLength(0);
  });

  it("merges three duplicates and dedupes people that repeat across them", () => {
    const plan = planRoleGroupDedupe([
      search({ id: "s1", createdAt: new Date("2026-07-01T00:00:00.000Z"), allocationPersonIds: ["p1"] }),
      search({ id: "s2", createdAt: new Date("2026-07-02T00:00:00.000Z"), allocationPersonIds: ["p1", "p2"] }),
      search({ id: "s3", createdAt: new Date("2026-07-03T00:00:00.000Z"), allocationPersonIds: ["p2", "p3"] })
    ]);
    const group = plan.groups[0];
    expect(group.canonicalId).toBe("s1");
    expect(group.duplicates).toHaveLength(2);
    expect(group.canonicalTotalProcessed).toBe(3);
    expect(plan.summary.peopleMoved).toBe(2); // p2 (from s2) and p3 (from s3)
    expect(plan.summary.duplicatePeopleSkipped).toBe(2); // p1 (s2) and p2 (s3) already present
    expect(plan.summary.searchesRemoved).toBe(2);
  });
});
