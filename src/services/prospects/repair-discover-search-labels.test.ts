import { describe, expect, it, vi } from "vitest";

import {
  discoverLabelDatabaseFingerprint,
  formatDiscoverLabelRepairStats,
  parseDiscoverLabelRepairOptions,
  runDiscoverLabelRepair,
  type DiscoverLabelRepairPrisma,
  type DiscoverLabelRepairRow
} from "../../../scripts/repair-discover-search-labels";

function row(id: string, overrides: Partial<DiscoverLabelRepairRow> = {}): DiscoverLabelRepairRow {
  return {
    id,
    status: "READY",
    requestedTitles: ["Software Engineer"],
    requestedLocations: ["United States"],
    totalProcessed: 1,
    attemptCount: 1,
    updatedAt: new Date("2026-08-19T12:00:00Z"),
    ...overrides
  };
}

function fakeRepairPrisma(initial: DiscoverLabelRepairRow[], failingIds: string[] = []) {
  const rows = initial.map((item) => ({
    ...item,
    requestedTitles: Array.isArray(item.requestedTitles) ? [...item.requestedTitles] : item.requestedTitles,
    requestedLocations: Array.isArray(item.requestedLocations) ? [...item.requestedLocations] : item.requestedLocations
  }));
  const failures = new Set(failingIds);
  const findMany = vi.fn<DiscoverLabelRepairPrisma["prospectSearch"]["findMany"]>(async (args) =>
    rows
      .filter((item) => !args.where.id || item.id > args.where.id.gt)
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, args.take)
      .map((item) => ({ ...item }))
  );
  const updateMany = vi.fn<DiscoverLabelRepairPrisma["prospectSearch"]["updateMany"]>(async (args) => {
    if (failures.has(args.where.id)) {
      throw new Error("private database failure with raw labels");
    }
    const target = rows.find(
      (item) => item.id === args.where.id && item.updatedAt.getTime() === args.where.updatedAt.getTime()
    );
    if (!target) {
      return { count: 0 };
    }
    if (args.data.requestedTitles) {
      target.requestedTitles = [...args.data.requestedTitles];
    }
    if (args.data.requestedLocations) {
      target.requestedLocations = [...args.data.requestedLocations];
    }
    target.updatedAt = new Date(target.updatedAt.getTime() + 1);
    return { count: 1 };
  });
  const prisma: DiscoverLabelRepairPrisma = { prospectSearch: { findMany, updateMany } };
  return { prisma, rows, findMany, updateMany };
}

describe("repair Discover search labels", () => {
  it("defaults to dry-run, reports safe corrections, and performs zero writes", async () => {
    const fake = fakeRepairPrisma([
      row("01", {
        requestedTitles: ["SOFTWARE ENGINEER", "Softwre Engineer"],
        requestedLocations: ["united states", "Un"]
      })
    ]);

    const stats = await runDiscoverLabelRepair(fake.prisma, { apply: false });

    expect(stats).toEqual({
      rowsScanned: 1,
      titleLabelsScanned: 2,
      locationLabelsScanned: 2,
      canonicalCorrections: 3,
      invalidOrIncompleteFound: 0,
      ambiguousFound: 1,
      historicalValuesQuarantined: 1,
      rowsChanged: 0,
      failures: 0
    });
    expect(fake.updateMany).not.toHaveBeenCalled();
    expect(fake.rows[0].requestedLocations).toEqual(["united states", "Un"]);
  });

  it("applies only deterministic corrections, preserves ambiguous history, and is idempotent", async () => {
    const fake = fakeRepairPrisma([
      row("01", {
        requestedTitles: ["Softwre Engineer"],
        requestedLocations: ["united states", "Un"]
      }),
      row("02", { requestedTitles: ["Recruiter"], requestedLocations: ["Canada"] })
    ]);

    const applied = await runDiscoverLabelRepair(fake.prisma, { apply: true });
    expect(applied.rowsChanged).toBe(1);
    expect(applied.canonicalCorrections).toBe(2);
    expect(fake.rows[0].requestedTitles).toEqual(["Software Engineer"]);
    expect(fake.rows[0].requestedLocations).toEqual(["United States", "Un"]);

    const after = await runDiscoverLabelRepair(fake.prisma, { apply: false });
    expect(after.canonicalCorrections).toBe(0);
    expect(after.rowsChanged).toBe(0);
    expect(after.failures).toBe(0);
    expect(after.ambiguousFound).toBe(1);
  });

  it("continues after write failures without exposing ids, labels, or driver errors", async () => {
    const fake = fakeRepairPrisma(
      [
        row("private-a", { requestedTitles: ["Softwre Engineer"] }),
        row("private-b", { requestedTitles: ["Recrutier"] })
      ],
      ["private-a"]
    );

    const stats = await runDiscoverLabelRepair(fake.prisma, { apply: true });
    const report = formatDiscoverLabelRepairStats(stats);

    expect(stats.rowsChanged).toBe(1);
    expect(stats.failures).toBe(1);
    expect(report).not.toContain("private");
    expect(report).not.toContain("Softwre");
    expect(report).not.toContain("database failure");
  });

  it("uses bounded keyset batches", async () => {
    const fake = fakeRepairPrisma(Array.from({ length: 205 }, (_, index) => row(String(index).padStart(3, "0"))));

    const stats = await runDiscoverLabelRepair(fake.prisma, { apply: false });

    expect(stats.rowsScanned).toBe(205);
    expect(fake.findMany).toHaveBeenCalledTimes(3);
    expect(fake.findMany.mock.calls[0][0].take).toBe(200);
    expect(fake.findMany.mock.calls[1][0].where.id?.gt).toBe("199");
  });
});

describe("repair Discover search label script safety", () => {
  it("accepts explicit modes and rejects conflicting or unknown flags", () => {
    expect(parseDiscoverLabelRepairOptions([])).toEqual({ apply: false });
    expect(parseDiscoverLabelRepairOptions(["--dry-run"])).toEqual({ apply: false });
    expect(parseDiscoverLabelRepairOptions(["--apply"])).toEqual({ apply: true });
    expect(() => parseDiscoverLabelRepairOptions(["--dry-run", "--apply"])).toThrow(/either/i);
    expect(() => parseDiscoverLabelRepairOptions(["--force"])).toThrow(/unsupported/i);
  });

  it("prints only a sanitized database fingerprint", () => {
    expect(() => discoverLabelDatabaseFingerprint(undefined)).toThrow(/required/i);
    expect(() => discoverLabelDatabaseFingerprint("not-a-url")).toThrow(/valid PostgreSQL/i);
    const fingerprint = discoverLabelDatabaseFingerprint(
      "postgresql://private-user:private-password@db.example.test:5433/sendloom?sslmode=require&token=secret"
    );
    expect(fingerprint).toBe("target host=db.example.test port=5433 database=sendloom");
    for (const secret of ["private-user", "private-password", "token", "secret", "sslmode"]) {
      expect(fingerprint).not.toContain(secret);
    }
  });
});
