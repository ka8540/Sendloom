import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Tavily continuation migration", () => {
  const sql = readFileSync(
    "prisma/migrations/20260926120000_discover_tavily_provider_chain/migration.sql",
    "utf8"
  );

  it("adds only independent non-null continuation fields with legacy-safe defaults", () => {
    expect(sql).toContain('ADD COLUMN "tavilyNextQueryIndex" INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('ADD COLUMN "tavilyQueriesFetched" INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('ADD COLUMN "tavilyExhausted" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).not.toMatch(/DROP\s+(?:COLUMN|TABLE)/i);
    expect(sql).not.toContain('"brightNextPage"');
    expect(sql).not.toContain('"apifyNextPage"');
  });
});
