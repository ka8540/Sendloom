import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationPath =
  "prisma/migrations/20260920173000_discover_durable_public_knowledge/migration.sql";

describe("durable Discover public-knowledge migration", () => {
  const sql = readFileSync(migrationPath, "utf8");

  it("creates permanent public people and exact provider provenance without people TTL columns", () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "public"."DiscoverPublicPerson"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "public"."DiscoverProviderBatch"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "public"."DiscoverProviderBatchPerson"');
    const durablePeopleDefinition = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS "public"."DiscoverPublicPerson"'),
      sql.indexOf('CREATE TABLE IF NOT EXISTS "public"."DiscoverProviderBatch"')
    );
    expect(durablePeopleDefinition).not.toMatch(/expiresAt|staleAt|fetchedAt/);
  });

  it("backfills legacy shared rows and provider-backed private history", () => {
    expect(sql).toContain('FROM "public"."DiscoverSearchCachePerson" p');
    expect(sql).toContain('JOIN "public"."ProspectSearchPerson" a ON a."searchId" = s."id"');
    expect(sql).toContain('s."resultSource" = \'PROVIDER\'');
    expect(sql).toContain('s."apifyRunId" IS NOT NULL');
    expect(sql).toContain('s."apifyDatasetId" IS NOT NULL');
  });

  it("uses official domain first while retaining LinkedIn slug evidence", () => {
    expect(sql).toContain("THEN 'domain:' || lower(regexp_replace");
    expect(sql).toContain('"companyLinkedinSlug"');
    expect(sql).toContain("linkedin\\.com/(?:company|school|showcase)");
  });

  it("does not promote arbitrary unallocated ProspectPerson rows", () => {
    const historicalPeople = sql.slice(
      sql.indexOf("-- 2) Recover provider-backed historical allocations"),
      sql.indexOf("-- Link existing searches")
    );
    expect(historicalPeople).toContain('JOIN "public"."ProspectSearchPerson"');
    expect(historicalPeople).toMatch(
      /WHERE s\."resultSource" = 'PROVIDER'[\s\S]*s\."apifyRunId" IS NOT NULL[\s\S]*s\."apifyDatasetId" IS NOT NULL/
    );
  });
});
