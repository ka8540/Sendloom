import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Firecrawl durable rollout migration", () => {
  const sql = readFileSync("prisma/migrations/20260929010000_discover_firecrawl_provider_chain/migration.sql", "utf8");
  it("adds non-null query continuation with safe zero/false defaults", () => {
    expect(sql).toContain('ADD COLUMN "firecrawlNextQueryIndex" INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('ADD COLUMN "firecrawlQueriesFetched" INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('ADD COLUMN "firecrawlExhausted" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).not.toMatch(/DROP|DiscoverSearchCache|tavilyNextQueryIndex|brightNextPage|apifyNextPage/);
  });
  it("marks every existing batch version 1 and defaults only future batches to version 2", () => {
    expect(sql).toContain('ADD COLUMN "providerChainVersion" INTEGER NOT NULL DEFAULT 1');
    expect(sql).toContain('ALTER COLUMN "providerChainVersion" SET DEFAULT 2');
  });
});
