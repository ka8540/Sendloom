import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { findUnsafeRawSql } from "../../scripts/check-unsafe-sql";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function withTempSource(file: string, contents: string, run: (dir: string) => void) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sql-guardrail-"));
  try {
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "src", file), contents);
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("SQL injection guardrail", () => {
  it("finds no unsafe raw SQL in the application source", () => {
    // The real protection: production code must stay clean. If this fails, an
    // unsafe raw query was reintroduced.
    expect(findUnsafeRawSql(rootDir)).toEqual([]);
  });

  it("rejects $queryRawUnsafe if it is reintroduced", () => {
    withTempSource("danger.ts", "await prisma.$queryRawUnsafe('SELECT * FROM users WHERE id = ' + id);\n", (dir) => {
      const findings = findUnsafeRawSql(dir);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ kind: "prohibited-raw-method", detail: "$queryRawUnsafe" });
    });
  });

  it("rejects $executeRawUnsafe if it is reintroduced", () => {
    withTempSource("danger.ts", "await prisma.$executeRawUnsafe(sql);\n", (dir) => {
      const findings = findUnsafeRawSql(dir);
      expect(findings).toHaveLength(1);
      expect(findings[0].detail).toBe("$executeRawUnsafe");
    });
  });

  it("rejects $queryRaw used as a string call instead of a tagged template", () => {
    withTempSource("danger.ts", "await prisma.$queryRaw(buildSqlFrom(userInput));\n", (dir) => {
      const findings = findUnsafeRawSql(dir);
      expect(findings).toHaveLength(1);
      expect(findings[0].kind).toBe("non-tagged-raw-call");
    });
  });

  it("allows the safe parameterized tagged-template form", () => {
    withTempSource(
      "safe.ts",
      "await prisma.$queryRaw`SELECT 1`;\nawait prisma.$queryRaw<Array<{ x: number }>>`SELECT ${id}`;\n",
      (dir) => {
        expect(findUnsafeRawSql(dir)).toEqual([]);
      }
    );
  });
});
