// The project discovers Vitest files under src/, while the executable under
// test intentionally remains in scripts/.
import { describe, expect, it, vi } from "vitest";

import {
  databaseFingerprint,
  formatZeroResultRepairStats,
  parseZeroResultRepairOptions,
  runZeroResultRepair,
  type ZeroResultRepairPrisma,
  type ZeroResultRepairRow
} from "../../../scripts/repair-discover-zero-result-role-searches";

function fakeRepairPrisma(initial: ZeroResultRepairRow[], failingIds: string[] = []) {
  const rows = initial.map((row) => ({ ...row }));
  const failures = new Set(failingIds);
  const findMany = vi.fn<ZeroResultRepairPrisma["prospectSearch"]["findMany"]>(async (args) =>
    rows
      .filter((row) => args.where.status.in.includes(row.status))
      .filter((row) => !args.where.id || row.id > args.where.id.gt)
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, args.take)
      .map((row) => ({ ...row }))
  );
  const updateMany = vi.fn<ZeroResultRepairPrisma["prospectSearch"]["updateMany"]>(async (args) => {
    if (failures.has(args.where.id)) {
      throw new Error("simulated write failure containing private row data");
    }
    const row = rows.find(
      (candidate) =>
        candidate.id === args.where.id &&
        candidate.status === args.where.status &&
        candidate.totalProcessed <= args.where.totalProcessed.lte
    );
    if (!row) {
      return { count: 0 };
    }
    row.status = args.data.status;
    return { count: 1 };
  });
  const prisma: ZeroResultRepairPrisma = { prospectSearch: { findMany, updateMany } };
  return { prisma, rows, findMany, updateMany };
}

describe("repair Discover READY+0 searches", () => {
  it("is dry-run by default and reports candidates without writing", async () => {
    const fake = fakeRepairPrisma([
      { id: "a", status: "READY", totalProcessed: 0 },
      { id: "b", status: "NO_RESULTS", totalProcessed: 0 },
      { id: "c", status: "READY", totalProcessed: 7 }
    ]);

    const stats = await runZeroResultRepair(fake.prisma, { apply: false });

    expect(stats).toEqual({
      rowsScanned: 3,
      readyZeroCandidates: 1,
      changedToNoResults: 0,
      noResultsAlreadyCorrect: 1,
      readyWithPeopleSkipped: 1,
      failures: 0
    });
    expect(fake.updateMany).not.toHaveBeenCalled();
    expect(fake.rows[0].status).toBe("READY");
  });

  it("apply changes only safe READY+0 rows and a second dry-run is idempotent", async () => {
    const fake = fakeRepairPrisma([
      { id: "a", status: "READY", totalProcessed: 0 },
      { id: "b", status: "READY", totalProcessed: -1 },
      { id: "c", status: "NO_RESULTS", totalProcessed: 0 },
      { id: "d", status: "READY", totalProcessed: 8 },
      { id: "e", status: "FAILED", totalProcessed: 0 }
    ]);

    const applied = await runZeroResultRepair(fake.prisma, { apply: true });
    expect(applied.changedToNoResults).toBe(2);
    expect(applied.failures).toBe(0);
    expect(fake.rows.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "a", status: "NO_RESULTS" },
      { id: "b", status: "NO_RESULTS" },
      { id: "c", status: "NO_RESULTS" },
      { id: "d", status: "READY" },
      { id: "e", status: "FAILED" }
    ]);

    const after = await runZeroResultRepair(fake.prisma, { apply: false });
    expect(after.readyZeroCandidates).toBe(0);
    expect(after.changedToNoResults).toBe(0);
    expect(after.failures).toBe(0);
  });

  it("continues after a row-level failure and never includes row data in the report", async () => {
    const fake = fakeRepairPrisma(
      [
        { id: "private-person-a", status: "READY", totalProcessed: 0 },
        { id: "private-person-b", status: "READY", totalProcessed: 0 }
      ],
      ["private-person-a"]
    );

    const stats = await runZeroResultRepair(fake.prisma, { apply: true });
    const report = formatZeroResultRepairStats(stats);

    expect(stats.changedToNoResults).toBe(1);
    expect(stats.failures).toBe(1);
    expect(report).not.toContain("private-person");
    expect(report).not.toContain("simulated write failure");
  });

  it("uses bounded keyset batches", async () => {
    const fake = fakeRepairPrisma(
      Array.from({ length: 205 }, (_, index) => ({
        id: `row-${String(index).padStart(3, "0")}`,
        status: "READY",
        totalProcessed: 1
      }))
    );

    const stats = await runZeroResultRepair(fake.prisma, { apply: false });

    expect(stats.rowsScanned).toBe(205);
    expect(stats.readyWithPeopleSkipped).toBe(205);
    expect(fake.findMany).toHaveBeenCalledTimes(3);
    expect(fake.findMany.mock.calls[0][0].take).toBe(200);
    expect(fake.findMany.mock.calls[1][0].where.id?.gt).toBe("row-199");
  });
});

describe("repair script safety gates", () => {
  it("accepts explicit modes, defaults to dry-run, and rejects conflicting/unknown flags", () => {
    expect(parseZeroResultRepairOptions([])).toEqual({ apply: false });
    expect(parseZeroResultRepairOptions(["--dry-run"])).toEqual({ apply: false });
    expect(parseZeroResultRepairOptions(["--apply"])).toEqual({ apply: true });
    expect(() => parseZeroResultRepairOptions(["--dry-run", "--apply"])).toThrow(/either/i);
    expect(() => parseZeroResultRepairOptions(["--force"])).toThrow(/unsupported/i);
  });

  it("fails closed without a valid DB URL and fingerprints without credentials or query secrets", () => {
    expect(() => databaseFingerprint(undefined)).toThrow(/required/i);
    expect(() => databaseFingerprint("not-a-url")).toThrow(/valid PostgreSQL/i);

    const fingerprint = databaseFingerprint(
      "postgresql://private-user:private-password@db.example.test:5433/sendloom?sslmode=require&token=secret"
    );
    expect(fingerprint).toBe("target host=db.example.test port=5433 database=sendloom");
    for (const secret of ["private-user", "private-password", "token", "secret", "sslmode"]) {
      expect(fingerprint).not.toContain(secret);
    }
  });
});
