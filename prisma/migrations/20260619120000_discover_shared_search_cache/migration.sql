-- Shared 30-day Discover search-result cache.
-- Adds an internal, cross-user provider-result cache (no requester identity) so
-- identical canonical Discover searches reuse normalized public results instead
-- of calling Apify again, plus internal result-provenance columns on the
-- user-owned ProspectSearch. All statements are idempotent so the migration is
-- safe to re-apply against a partially-migrated database.

-- ProspectSearch: internal result provenance (additive, nullable).
ALTER TABLE "public"."ProspectSearch"
  ADD COLUMN IF NOT EXISTS "resultSource" TEXT,
  ADD COLUMN IF NOT EXISTS "sharedCacheId" TEXT,
  ADD COLUMN IF NOT EXISTS "cacheFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "cacheFetchedAt" TIMESTAMP(3);

-- CreateTable: DiscoverSearchCache
CREATE TABLE IF NOT EXISTS "public"."DiscoverSearchCache" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "cacheVersion" TEXT NOT NULL,
  "companyKey" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
  "companyDomain" TEXT,
  "companyLinkedinUrl" TEXT,
  "normalizedRoles" JSONB NOT NULL,
  "normalizedLocations" JSONB NOT NULL,
  "resultLimit" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REFRESHING',
  "fetchedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "refreshStartedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "resultCount" INTEGER NOT NULL DEFAULT 0,
  "emailDomain" TEXT,
  "emailDomainConfidence" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
  "emailDomainEvidence" JSONB,
  "emailPattern" TEXT,
  "patternConfidence" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
  "patternEvidence" JSONB,
  "emailFormatReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscoverSearchCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DiscoverSearchCachePerson
CREATE TABLE IF NOT EXISTS "public"."DiscoverSearchCachePerson" (
  "id" TEXT NOT NULL,
  "cacheId" TEXT NOT NULL,
  "sourceProfileId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "currentTitle" TEXT,
  "normalizedTitle" TEXT,
  "positionCategory" TEXT,
  "location" TEXT,
  "country" TEXT,
  "state" TEXT,
  "city" TEXT,
  "linkedinUrl" TEXT NOT NULL,
  "inferredEmail" TEXT,
  "emailStatus" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
  "emailConfidence" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
  "emailPattern" TEXT,
  "emailSource" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscoverSearchCachePerson_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "DiscoverSearchCache_fingerprint_key"
  ON "public"."DiscoverSearchCache"("fingerprint");
CREATE INDEX IF NOT EXISTS "DiscoverSearchCache_companyKey_idx"
  ON "public"."DiscoverSearchCache"("companyKey");
CREATE INDEX IF NOT EXISTS "DiscoverSearchCache_expiresAt_idx"
  ON "public"."DiscoverSearchCache"("expiresAt");
CREATE INDEX IF NOT EXISTS "DiscoverSearchCache_status_idx"
  ON "public"."DiscoverSearchCache"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "DiscoverSearchCachePerson_cacheId_sourceProfileId_key"
  ON "public"."DiscoverSearchCachePerson"("cacheId", "sourceProfileId");
CREATE INDEX IF NOT EXISTS "DiscoverSearchCachePerson_cacheId_positionCategory_idx"
  ON "public"."DiscoverSearchCachePerson"("cacheId", "positionCategory");

-- Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'DiscoverSearchCachePerson_cacheId_fkey' AND table_name = 'DiscoverSearchCachePerson') THEN
    ALTER TABLE "public"."DiscoverSearchCachePerson"
      ADD CONSTRAINT "DiscoverSearchCachePerson_cacheId_fkey"
      FOREIGN KEY ("cacheId") REFERENCES "public"."DiscoverSearchCache"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
