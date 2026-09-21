-- Durable Discover public knowledge + provider provenance.
--
-- Redis is the only cache after this migration. These tables contain permanent
-- sanitized public facts and exact provider-intent provenance; none has a TTL.
-- The migration is additive/idempotent for safe rollout. Legacy cache tables
-- remain temporarily for rollback only and runtime code no longer reads/writes
-- them after the corresponding application deployment.

CREATE TABLE IF NOT EXISTS "public"."DiscoverPublicPerson" (
  "id" TEXT NOT NULL,
  "companyCanonicalKey" TEXT NOT NULL,
  "companyDomain" TEXT,
  "companyLinkedinSlug" TEXT,
  "sourceProfileId" TEXT NOT NULL,
  "linkedinUrl" TEXT NOT NULL,
  "normalizedLinkedinUrl" TEXT,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "sourceName" TEXT,
  "nameNormalization" TEXT,
  "currentTitle" TEXT,
  "normalizedTitle" TEXT,
  "positionCategory" TEXT,
  "location" TEXT,
  "country" TEXT,
  "state" TEXT,
  "city" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscoverPublicPerson_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."DiscoverProviderBatch" (
  "id" TEXT NOT NULL,
  "intentHash" TEXT NOT NULL,
  "companyCanonicalKey" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
  "companyDomain" TEXT,
  "companyLinkedinSlug" TEXT,
  "normalizedRoles" JSONB NOT NULL,
  "normalizedLocations" JSONB NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'APIFY',
  "providerRunId" TEXT,
  "providerDatasetId" TEXT,
  "providerNextPage" INTEGER NOT NULL DEFAULT 1,
  "providerPagesFetched" INTEGER NOT NULL DEFAULT 0,
  "providerExhausted" BOOLEAN NOT NULL DEFAULT false,
  "lastProviderFetchAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscoverProviderBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."DiscoverProviderBatchPerson" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "publicPersonId" TEXT NOT NULL,
  "providerSortIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscoverProviderBatchPerson_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DiscoverPublicPerson_companyCanonicalKey_sourceProfileId_key"
  ON "public"."DiscoverPublicPerson"("companyCanonicalKey", "sourceProfileId");
CREATE UNIQUE INDEX IF NOT EXISTS "DiscoverPublicPerson_companyCanonicalKey_normalizedLinkedinUrl_key"
  ON "public"."DiscoverPublicPerson"("companyCanonicalKey", "normalizedLinkedinUrl");
CREATE INDEX IF NOT EXISTS "DiscoverPublicPerson_companyCanonicalKey_positionCategory_idx"
  ON "public"."DiscoverPublicPerson"("companyCanonicalKey", "positionCategory");
CREATE INDEX IF NOT EXISTS "DiscoverPublicPerson_companyCanonicalKey_normalizedTitle_idx"
  ON "public"."DiscoverPublicPerson"("companyCanonicalKey", "normalizedTitle");
CREATE INDEX IF NOT EXISTS "DiscoverPublicPerson_companyDomain_idx"
  ON "public"."DiscoverPublicPerson"("companyDomain");
CREATE INDEX IF NOT EXISTS "DiscoverPublicPerson_companyLinkedinSlug_idx"
  ON "public"."DiscoverPublicPerson"("companyLinkedinSlug");
CREATE INDEX IF NOT EXISTS "DiscoverPublicPerson_country_state_city_idx"
  ON "public"."DiscoverPublicPerson"("country", "state", "city");

CREATE UNIQUE INDEX IF NOT EXISTS "DiscoverProviderBatch_intentHash_key"
  ON "public"."DiscoverProviderBatch"("intentHash");
CREATE INDEX IF NOT EXISTS "DiscoverProviderBatch_companyCanonicalKey_createdAt_idx"
  ON "public"."DiscoverProviderBatch"("companyCanonicalKey", "createdAt");
CREATE INDEX IF NOT EXISTS "DiscoverProviderBatch_companyDomain_idx"
  ON "public"."DiscoverProviderBatch"("companyDomain");
CREATE INDEX IF NOT EXISTS "DiscoverProviderBatch_companyLinkedinSlug_idx"
  ON "public"."DiscoverProviderBatch"("companyLinkedinSlug");
CREATE INDEX IF NOT EXISTS "DiscoverProviderBatch_providerRunId_idx"
  ON "public"."DiscoverProviderBatch"("providerRunId");
CREATE INDEX IF NOT EXISTS "DiscoverProviderBatch_providerDatasetId_idx"
  ON "public"."DiscoverProviderBatch"("providerDatasetId");

CREATE UNIQUE INDEX IF NOT EXISTS "DiscoverProviderBatchPerson_batchId_publicPersonId_key"
  ON "public"."DiscoverProviderBatchPerson"("batchId", "publicPersonId");
CREATE INDEX IF NOT EXISTS "DiscoverProviderBatchPerson_batchId_providerSortIndex_idx"
  ON "public"."DiscoverProviderBatchPerson"("batchId", "providerSortIndex");
CREATE INDEX IF NOT EXISTS "DiscoverProviderBatchPerson_publicPersonId_idx"
  ON "public"."DiscoverProviderBatchPerson"("publicPersonId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'DiscoverProviderBatchPerson_batchId_fkey') THEN
    ALTER TABLE "public"."DiscoverProviderBatchPerson"
      ADD CONSTRAINT "DiscoverProviderBatchPerson_batchId_fkey"
      FOREIGN KEY ("batchId") REFERENCES "public"."DiscoverProviderBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'DiscoverProviderBatchPerson_publicPersonId_fkey') THEN
    ALTER TABLE "public"."DiscoverProviderBatchPerson"
      ADD CONSTRAINT "DiscoverProviderBatchPerson_publicPersonId_fkey"
      FOREIGN KEY ("publicPersonId") REFERENCES "public"."DiscoverPublicPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "public"."ProspectSearch"
  ADD COLUMN IF NOT EXISTS "publicProviderBatchId" TEXT,
  ADD COLUMN IF NOT EXISTS "publicIntentHash" TEXT;

CREATE INDEX IF NOT EXISTS "ProspectSearch_publicProviderBatchId_idx"
  ON "public"."ProspectSearch"("publicProviderBatchId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProspectSearch_publicProviderBatchId_fkey') THEN
    ALTER TABLE "public"."ProspectSearch"
      ADD CONSTRAINT "ProspectSearch_publicProviderBatchId_fkey"
      FOREIGN KEY ("publicProviderBatchId") REFERENCES "public"."DiscoverProviderBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 1) Promote every legacy shared cache intent into durable provider provenance.
INSERT INTO "public"."DiscoverProviderBatch" (
  "id", "intentHash", "companyCanonicalKey", "companyName", "companyDomain",
  "companyLinkedinSlug", "normalizedRoles", "normalizedLocations", "provider",
  "providerNextPage", "providerPagesFetched", "providerExhausted",
  "lastProviderFetchAt", "createdAt", "updatedAt"
)
SELECT
  md5('legacy-cache-batch:' || c."id"),
  c."fingerprint",
  CASE
    WHEN NULLIF(lower(regexp_replace(trim(COALESCE(c."companyDomain", '')), '^www\.', '', 'i')), '') IS NOT NULL
      THEN 'domain:' || lower(regexp_replace(trim(c."companyDomain"), '^www\.', '', 'i'))
    ELSE c."companyKey"
  END,
  c."companyName",
  NULLIF(lower(regexp_replace(trim(COALESCE(c."companyDomain", '')), '^www\.', '', 'i')), ''),
  CASE WHEN c."companyLinkedinUrl" ILIKE '%linkedin.com/%'
    THEN lower(substring(c."companyLinkedinUrl" from '(?i)linkedin\.com/(?:company|school|showcase)/([^/?#]+)'))
    ELSE NULL END,
  c."normalizedRoles",
  c."normalizedLocations",
  'APIFY',
  COALESCE(c."providerNextPage", 1),
  COALESCE(c."providerPagesFetched", 0),
  COALESCE(c."providerExhausted", false),
  c."lastProviderFetchAt",
  c."createdAt",
  c."updatedAt"
FROM "public"."DiscoverSearchCache" c
ON CONFLICT ("intentHash") DO NOTHING;

INSERT INTO "public"."DiscoverPublicPerson" (
  "id", "companyCanonicalKey", "companyDomain", "companyLinkedinSlug",
  "sourceProfileId", "linkedinUrl", "normalizedLinkedinUrl", "firstName",
  "lastName", "fullName", "sourceName", "nameNormalization", "currentTitle",
  "normalizedTitle", "positionCategory", "location", "country", "state", "city",
  "firstSeenAt", "lastSeenAt", "createdAt", "updatedAt"
)
SELECT
  md5('legacy-cache-person:' || c."id" || ':' || p."sourceProfileId"),
  b."companyCanonicalKey",
  b."companyDomain",
  b."companyLinkedinSlug",
  p."sourceProfileId",
  p."linkedinUrl",
  NULLIF(lower(regexp_replace(regexp_replace(trim(p."linkedinUrl"), '[?#].*$', ''), '/$', '')), ''),
  p."firstName", p."lastName", p."fullName", p."sourceName", p."nameNormalization",
  p."currentTitle", p."normalizedTitle", p."positionCategory", p."location",
  p."country", p."state", p."city", p."createdAt", p."updatedAt",
  p."createdAt", p."updatedAt"
FROM "public"."DiscoverSearchCachePerson" p
JOIN "public"."DiscoverSearchCache" c ON c."id" = p."cacheId"
JOIN "public"."DiscoverProviderBatch" b ON b."intentHash" = c."fingerprint"
ON CONFLICT DO NOTHING;

INSERT INTO "public"."DiscoverProviderBatchPerson"
  ("id", "batchId", "publicPersonId", "providerSortIndex", "createdAt")
SELECT
  md5('legacy-cache-link:' || b."id" || ':' || pp."id"),
  b."id",
  pp."id",
  p."sortIndex",
  p."createdAt"
FROM "public"."DiscoverSearchCachePerson" p
JOIN "public"."DiscoverSearchCache" c ON c."id" = p."cacheId"
JOIN "public"."DiscoverProviderBatch" b ON b."intentHash" = c."fingerprint"
JOIN "public"."DiscoverPublicPerson" pp
  ON pp."companyCanonicalKey" = b."companyCanonicalKey"
 AND (pp."sourceProfileId" = p."sourceProfileId"
   OR pp."normalizedLinkedinUrl" = NULLIF(lower(regexp_replace(regexp_replace(trim(p."linkedinUrl"), '[?#].*$', ''), '/$', '')), ''))
ON CONFLICT ("batchId", "publicPersonId") DO NOTHING;

-- 2) Recover provider-backed historical allocations that may never have been
-- copied into the legacy shared tables. The provenance predicate deliberately
-- excludes arbitrary/manual contacts.
INSERT INTO "public"."DiscoverProviderBatch" (
  "id", "intentHash", "companyCanonicalKey", "companyName", "companyDomain",
  "companyLinkedinSlug", "normalizedRoles", "normalizedLocations", "provider",
  "providerRunId", "providerDatasetId", "providerNextPage", "providerPagesFetched",
  "providerExhausted", "lastProviderFetchAt", "createdAt", "updatedAt"
)
SELECT
  md5('historical-provider-batch:' || s."id"),
  md5('historical-provider-intent:' || s."id"),
  CASE
    WHEN NULLIF(lower(regexp_replace(trim(COALESCE(pc."officialWebsiteDomain", pc."officialDomain", '')), '^www\.', '', 'i')), '') IS NOT NULL
      THEN 'domain:' || lower(regexp_replace(trim(COALESCE(pc."officialWebsiteDomain", pc."officialDomain")), '^www\.', '', 'i'))
    ELSE pc."canonicalKey"
  END,
  COALESCE(pc."officialName", pc."name"),
  COALESCE(pc."officialWebsiteDomain", pc."officialDomain"),
  CASE WHEN pc."linkedinUrl" ILIKE '%linkedin.com/%'
    THEN lower(substring(pc."linkedinUrl" from '(?i)linkedin\.com/(?:company|school|showcase)/([^/?#]+)'))
    ELSE NULL END,
  s."requestedTitles",
  COALESCE(s."requestedLocations", '[]'::jsonb),
  'APIFY',
  s."apifyRunId",
  s."apifyDatasetId",
  1,
  CASE WHEN s."apifyRunId" IS NOT NULL OR s."apifyDatasetId" IS NOT NULL THEN 1 ELSE 0 END,
  false,
  s."completedAt",
  s."createdAt",
  s."updatedAt"
FROM "public"."ProspectSearch" s
JOIN "public"."ProspectCompany" pc ON pc."id" = s."companyId"
WHERE s."resultSource" = 'PROVIDER'
   OR s."apifyRunId" IS NOT NULL
   OR s."apifyDatasetId" IS NOT NULL
ON CONFLICT ("intentHash") DO NOTHING;

INSERT INTO "public"."DiscoverPublicPerson" (
  "id", "companyCanonicalKey", "companyDomain", "companyLinkedinSlug",
  "sourceProfileId", "linkedinUrl", "normalizedLinkedinUrl", "firstName",
  "lastName", "fullName", "sourceName", "nameNormalization", "currentTitle",
  "normalizedTitle", "positionCategory", "location", "country", "state", "city",
  "firstSeenAt", "lastSeenAt", "createdAt", "updatedAt"
)
SELECT DISTINCT ON (
  CASE WHEN COALESCE(pc."officialWebsiteDomain", pc."officialDomain") IS NOT NULL
    THEN 'domain:' || lower(regexp_replace(trim(COALESCE(pc."officialWebsiteDomain", pc."officialDomain")), '^www\.', '', 'i'))
    ELSE pc."canonicalKey" END,
  p."sourceProfileId"
)
  md5('historical-public-person:' ||
    CASE WHEN COALESCE(pc."officialWebsiteDomain", pc."officialDomain") IS NOT NULL
      THEN 'domain:' || lower(regexp_replace(trim(COALESCE(pc."officialWebsiteDomain", pc."officialDomain")), '^www\.', '', 'i'))
      ELSE pc."canonicalKey" END || ':' || p."sourceProfileId"),
  CASE WHEN COALESCE(pc."officialWebsiteDomain", pc."officialDomain") IS NOT NULL
    THEN 'domain:' || lower(regexp_replace(trim(COALESCE(pc."officialWebsiteDomain", pc."officialDomain")), '^www\.', '', 'i'))
    ELSE pc."canonicalKey" END,
  COALESCE(pc."officialWebsiteDomain", pc."officialDomain"),
  CASE WHEN pc."linkedinUrl" ILIKE '%linkedin.com/%'
    THEN lower(substring(pc."linkedinUrl" from '(?i)linkedin\.com/(?:company|school|showcase)/([^/?#]+)'))
    ELSE NULL END,
  p."sourceProfileId",
  p."linkedinUrl",
  NULLIF(lower(regexp_replace(regexp_replace(trim(p."linkedinUrl"), '[?#].*$', ''), '/$', '')), ''),
  p."firstName", p."lastName", p."fullName", p."sourceName", p."nameNormalization",
  p."currentTitle", p."normalizedTitle", pos."category", p."location", p."country",
  p."state", p."city", p."createdAt", p."updatedAt", p."createdAt", p."updatedAt"
FROM "public"."ProspectSearch" s
JOIN "public"."ProspectCompany" pc ON pc."id" = s."companyId"
JOIN "public"."ProspectSearchPerson" a ON a."searchId" = s."id"
JOIN "public"."ProspectPerson" p ON p."id" = a."personId" AND p."userId" = s."userId"
JOIN "public"."ProspectCompanyPosition" pos ON pos."id" = p."positionId"
WHERE s."resultSource" = 'PROVIDER'
   OR s."apifyRunId" IS NOT NULL
   OR s."apifyDatasetId" IS NOT NULL
ORDER BY
  CASE WHEN COALESCE(pc."officialWebsiteDomain", pc."officialDomain") IS NOT NULL
    THEN 'domain:' || lower(regexp_replace(trim(COALESCE(pc."officialWebsiteDomain", pc."officialDomain")), '^www\.', '', 'i'))
    ELSE pc."canonicalKey" END,
  p."sourceProfileId", p."updatedAt" DESC
ON CONFLICT DO NOTHING;

INSERT INTO "public"."DiscoverProviderBatchPerson"
  ("id", "batchId", "publicPersonId", "providerSortIndex", "createdAt")
SELECT
  md5('historical-provider-link:' || b."id" || ':' || pp."id"),
  b."id",
  pp."id",
  a."allocationOrder",
  a."allocatedAt"
FROM "public"."ProspectSearch" s
JOIN "public"."ProspectCompany" pc ON pc."id" = s."companyId"
JOIN "public"."DiscoverProviderBatch" b ON b."intentHash" = md5('historical-provider-intent:' || s."id")
JOIN "public"."ProspectSearchPerson" a ON a."searchId" = s."id"
JOIN "public"."ProspectPerson" p ON p."id" = a."personId" AND p."userId" = s."userId"
JOIN "public"."DiscoverPublicPerson" pp
  ON pp."companyCanonicalKey" = b."companyCanonicalKey" AND pp."sourceProfileId" = p."sourceProfileId"
WHERE s."resultSource" = 'PROVIDER'
   OR s."apifyRunId" IS NOT NULL
   OR s."apifyDatasetId" IS NOT NULL
ON CONFLICT ("batchId", "publicPersonId") DO NOTHING;

-- Link existing searches to their promoted provenance where possible.
UPDATE "public"."ProspectSearch" s
SET "publicProviderBatchId" = b."id",
    "publicIntentHash" = b."intentHash"
FROM "public"."DiscoverProviderBatch" b
WHERE b."intentHash" = s."cacheFingerprint"
  AND s."publicProviderBatchId" IS NULL;

UPDATE "public"."ProspectSearch" s
SET "publicProviderBatchId" = b."id",
    "publicIntentHash" = b."intentHash"
FROM "public"."DiscoverProviderBatch" b
WHERE b."intentHash" = md5('historical-provider-intent:' || s."id")
  AND s."publicProviderBatchId" IS NULL;

COMMENT ON TABLE "public"."DiscoverSearchCache" IS
  'DEPRECATED rollout fallback. Runtime source of truth is DiscoverPublicPerson/DiscoverProviderBatch; Redis is the only cache.';
COMMENT ON TABLE "public"."DiscoverSearchCachePerson" IS
  'DEPRECATED rollout fallback. Runtime no longer reads or writes this table.';
