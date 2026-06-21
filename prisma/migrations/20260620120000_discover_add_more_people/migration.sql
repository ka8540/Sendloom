-- Discover "Add 10 more people" expansion support.
-- Adds (1) provider-continuation state + deterministic ordering to the shared
-- result cache so an expansion can resume the provider after previously fetched
-- pages instead of restarting at page 1, and (2) a durable DiscoverSearchExpansion
-- idempotency/audit record so double clicks, retries, and concurrent requests
-- cannot double-charge quota or add duplicate batches. All statements are
-- idempotent so the migration is safe to re-apply against a partial database.

-- DiscoverSearchCache: provider continuation state (additive, defaulted).
ALTER TABLE "public"."DiscoverSearchCache"
  ADD COLUMN IF NOT EXISTS "providerNextPage" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "providerPagesFetched" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "providerExhausted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "lastProviderFetchAt" TIMESTAMP(3);

-- DiscoverSearchCachePerson: deterministic provider order within an entry.
ALTER TABLE "public"."DiscoverSearchCachePerson"
  ADD COLUMN IF NOT EXISTS "sortIndex" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "DiscoverSearchCachePerson_cacheId_sortIndex_idx"
  ON "public"."DiscoverSearchCachePerson"("cacheId", "sortIndex");

-- CreateTable: DiscoverSearchExpansion
CREATE TABLE IF NOT EXISTS "public"."DiscoverSearchExpansion" (
  "id" TEXT NOT NULL,
  "searchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestedCount" INTEGER NOT NULL DEFAULT 10,
  "addedCount" INTEGER NOT NULL DEFAULT 0,
  "cacheCount" INTEGER NOT NULL DEFAULT 0,
  "providerCount" INTEGER NOT NULL DEFAULT 0,
  "totalPeopleCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "quotaReserved" BOOLEAN NOT NULL DEFAULT false,
  "exhausted" BOOLEAN NOT NULL DEFAULT false,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "DiscoverSearchExpansion_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "DiscoverSearchExpansion_searchId_idempotencyKey_key"
  ON "public"."DiscoverSearchExpansion"("searchId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "DiscoverSearchExpansion_searchId_status_idx"
  ON "public"."DiscoverSearchExpansion"("searchId", "status");
CREATE INDEX IF NOT EXISTS "DiscoverSearchExpansion_searchId_createdAt_idx"
  ON "public"."DiscoverSearchExpansion"("searchId", "createdAt");

-- Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'DiscoverSearchExpansion_searchId_fkey' AND table_name = 'DiscoverSearchExpansion') THEN
    ALTER TABLE "public"."DiscoverSearchExpansion"
      ADD CONSTRAINT "DiscoverSearchExpansion_searchId_fkey"
      FOREIGN KEY ("searchId") REFERENCES "public"."ProspectSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
