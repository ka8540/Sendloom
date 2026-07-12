// Contracts for the Discover role-label normalization planner (repair script
// core). Pure — no DB.

import { describe, expect, it } from "vitest";

import { planDiscoverRoleLabelNormalization } from "@/services/prospects/normalize-discover-role-labels";

const row = (id: string, requestedTitles: string[], userId = "user_A") => ({ id, userId, requestedTitles });

describe("planDiscoverRoleLabelNormalization (#21, #22, #23, #24)", () => {
  it("reports bad casing/typo rows without mutating input (#21, #22)", () => {
    const rows = [row("s1", ["SOftware Enigneer"]), row("s2", ["recuiter"])];
    const { changes, summary } = planDiscoverRoleLabelNormalization(rows);
    expect(summary.rowsScanned).toBe(2);
    expect(summary.rowsChanged).toBe(2);
    expect(changes).toEqual([
      { id: "s1", userId: "user_A", before: ["SOftware Enigneer"], after: ["Software Engineer"] },
      { id: "s2", userId: "user_A", before: ["recuiter"], after: ["Recruiter"] }
    ]);
    // Input rows are untouched.
    expect(rows[0].requestedTitles).toEqual(["SOftware Enigneer"]);
  });

  it("normalizes high-confidence corrections toward the canonical dictionary (#22)", () => {
    const { changes } = planDiscoverRoleLabelNormalization([row("s1", ["data engneer", "software enginer"])]);
    expect(changes[0]?.after).toEqual(["Data Engineer", "Software Engineer"]);
  });

  it("is idempotent — a second pass over normalized labels changes nothing (#23)", () => {
    const first = planDiscoverRoleLabelNormalization([row("s1", ["SOftware Engineer"])]);
    const normalized = first.changes[0]?.after ?? [];
    expect(normalized).toEqual(["Software Engineer"]);
    const second = planDiscoverRoleLabelNormalization([row("s1", normalized)]);
    expect(second.summary.rowsChanged).toBe(0);
  });

  it("does not rewrite unrelated / already-clean roles (#24)", () => {
    const rows = [row("s1", ["Software Engineer"]), row("s2", ["Quantum Mechanic"]), row("s3", ["Data Engineer"])];
    const { summary } = planDiscoverRoleLabelNormalization(rows);
    expect(summary.rowsChanged).toBe(0);
  });

  it("scopes changes per row and preserves userId", () => {
    const { changes } = planDiscoverRoleLabelNormalization([row("s1", ["SOftware Engineer"], "user_B")]);
    expect(changes[0]?.userId).toBe("user_B");
  });
});
