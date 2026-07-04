-- Discover user-specific result allocation.
--
-- Adds ProspectSearchPerson: the explicit grant of one person to one user-owned
-- search action. This is the ownership boundary between the shared cross-user
-- Discover result cache (which may accumulate many more candidates than any one
-- user is entitled to) and what a user's search actually received. Going
-- forward the pipeline allocates at most `maxResults` people per initial search
-- and one batch per "Add 10 more" expansion; reads, exports, and grouped
-- dashboard counts derive from these rows.
--
-- The backfill grants every existing materialized person to each of that user's
-- searches for the same company (source BACKFILL). That exactly preserves the
-- pre-migration behavior, where a user's Discover results were company-scoped:
-- no legacy search loses people and no shared-cache data is touched. Clearly
-- over-granted legacy searches can be trimmed later with the scoped repair
-- script (scripts/repair-discover-allocations.ts) — never destructively here.
--
-- All statements are idempotent so the migration is safe to re-apply.

-- CreateTable: ProspectSearchPerson
CREATE TABLE IF NOT EXISTS "public"."ProspectSearchPerson" (
  "id" TEXT NOT NULL,
  "searchId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "allocationOrder" INTEGER NOT NULL DEFAULT 0,
  "allocationSource" TEXT NOT NULL DEFAULT 'CACHE',
  "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectSearchPerson_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "ProspectSearchPerson_searchId_personId_key"
  ON "public"."ProspectSearchPerson"("searchId", "personId");
CREATE INDEX IF NOT EXISTS "ProspectSearchPerson_personId_idx"
  ON "public"."ProspectSearchPerson"("personId");
CREATE INDEX IF NOT EXISTS "ProspectSearchPerson_searchId_allocationOrder_idx"
  ON "public"."ProspectSearchPerson"("searchId", "allocationOrder");
CREATE INDEX IF NOT EXISTS "ProspectSearchPerson_userId_searchId_idx"
  ON "public"."ProspectSearchPerson"("userId", "searchId");

-- Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProspectSearchPerson_searchId_fkey' AND table_name = 'ProspectSearchPerson') THEN
    ALTER TABLE "public"."ProspectSearchPerson"
      ADD CONSTRAINT "ProspectSearchPerson_searchId_fkey"
      FOREIGN KEY ("searchId") REFERENCES "public"."ProspectSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProspectSearchPerson_personId_fkey' AND table_name = 'ProspectSearchPerson') THEN
    ALTER TABLE "public"."ProspectSearchPerson"
      ADD CONSTRAINT "ProspectSearchPerson_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "public"."ProspectPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: grant each user's existing materialized company people to every one
-- of that user's searches for the same company (deterministic order by person
-- creation time). ON CONFLICT keeps the statement idempotent.
INSERT INTO "public"."ProspectSearchPerson"
  ("id", "searchId", "personId", "userId", "allocationOrder", "allocationSource", "allocatedAt")
SELECT
  md5(s."id" || ':' || p."id"),
  s."id",
  p."id",
  s."userId",
  (ROW_NUMBER() OVER (PARTITION BY s."id" ORDER BY p."createdAt", p."id")) - 1,
  'BACKFILL',
  COALESCE(s."completedAt", s."updatedAt", CURRENT_TIMESTAMP)
FROM "public"."ProspectSearch" s
JOIN "public"."ProspectPerson" p
  ON p."companyId" = s."companyId" AND p."userId" = s."userId"
WHERE s."companyId" IS NOT NULL
ON CONFLICT ("searchId", "personId") DO NOTHING;
