import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaRoleSemanticStore } from "@/services/prospects/role-semantic-store";

const identity = {
  embeddingModel: "text-embedding-3-small",
  embeddingDimensions: 3,
  semanticVersion: "v1"
};

function sqlText(value: unknown): string {
  return (value as Prisma.Sql).strings.join("?");
}

describe("PrismaRoleSemanticStore SQL safety", () => {
  it("parameterizes vector search payloads so role text never enters SQL", async () => {
    const queryRaw = vi.fn(async (_query: unknown) => []);
    const store = new PrismaRoleSemanticStore({
      prospectRoleSemantic: { findMany: vi.fn() },
      $executeRaw: vi.fn(),
      $queryRaw: queryRaw
    } as never);
    await store.findSimilarMany(
      [{ queryKey: "software engineer'); DROP TABLE users; --", category: "SOFTWARE_ENGINEERING", embedding: [1, 0, 0] }],
      identity,
      20
    );

    const sql = queryRaw.mock.calls[0][0] as unknown as Prisma.Sql;
    expect(sqlText(sql)).not.toContain("software engineer");
    expect(JSON.stringify(sql.values)).toContain("software engineer");
  });

  it("parameterizes upserts and validates vectors before executing SQL", async () => {
    const executeRaw = vi.fn(async (_query: unknown) => 1);
    const store = new PrismaRoleSemanticStore({
      prospectRoleSemantic: { findMany: vi.fn() },
      $executeRaw: executeRaw,
      $queryRaw: vi.fn()
    } as never);
    const record = {
      normalizedTitle: "engineer'); DROP TABLE users; --",
      canonicalRoleKey: "other:test",
      category: "OTHER" as const,
      specialty: "UNKNOWN" as const,
      breadth: "NARROW" as const,
      classificationConfidence: "LOW" as const,
      ...identity,
      embedding: [1, 0, 0]
    };
    await store.upsertMany([record]);
    const sql = executeRaw.mock.calls[0][0] as unknown as Prisma.Sql;
    expect(sqlText(sql)).not.toContain("DROP TABLE");
    expect(sql.values).toContain(record.normalizedTitle);

    await expect(store.upsertMany([{ ...record, embedding: [1, 0] }])).rejects.toThrow(/exactly 3/);
    await expect(store.upsertMany([{ ...record, embedding: [1, Number.NaN, 0] }])).rejects.toThrow(/non-finite/);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});
