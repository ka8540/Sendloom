import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath = "prisma/migrations/20260820130000_discover_role_semantics/migration.sql";

describe("Discover role semantic migration", () => {
  it("is additive and creates one title-level vector(1536) table", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "public"\."ProspectRoleSemantic"/i);
    expect(sql).toMatch(/"embedding" vector\(1536\) NOT NULL/i);
    expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
    expect(sql).not.toMatch(/ALTER TABLE\s+"public"\."(ProspectPerson|DiscoverSearchCachePerson)"/i);
  });

  it("keeps vectors off per-person models", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const personModel = schema.match(/model ProspectPerson \{[\s\S]*?\n\}/)?.[0] ?? "";
    const cachePersonModel = schema.match(/model DiscoverSearchCachePerson \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(personModel).not.toContain("Unsupported(\"vector\")");
    expect(cachePersonModel).not.toContain("Unsupported(\"vector\")");
  });
});
