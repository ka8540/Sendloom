-- Canonical company identity for Discover email-format ownership.
--
-- Before adding the unique key, consolidate only rows that belong to the same
-- user and the same normalized resolved domain. Search and person records are
-- repointed first; no people or searches are deleted. Same-name companies on
-- different domains remain separate.

BEGIN;

ALTER TABLE "public"."ProspectCompany"
  ADD COLUMN IF NOT EXISTS "canonicalKey" TEXT;

ALTER TABLE "public"."ProspectCompany"
  ADD COLUMN IF NOT EXISTS "emailFormatAuthority" TEXT NOT NULL DEFAULT 'UNRESOLVED';

UPDATE "public"."ProspectCompany"
SET "emailFormatAuthority" = CASE
  WHEN COALESCE("emailDomainEvidence"::text, '') LIKE '%manual_override%'
    OR COALESCE("emailFormatReason", '') ILIKE '%manual%'
    THEN 'MANUAL'
  WHEN "emailDomain" IS NOT NULL AND "emailPattern" IS NOT NULL THEN 'AI'
  ELSE 'UNRESOLVED'
END;

CREATE TEMP TABLE "_ProspectCanonicalCompanyMap" ON COMMIT DROP AS
WITH keyed AS (
  SELECT
    c."id",
    c."userId",
    CASE
      WHEN COALESCE(c."officialWebsiteDomain", c."officialDomain", c."emailDomain") IS NOT NULL
        THEN 'domain:' || regexp_replace(lower(trim(COALESCE(c."officialWebsiteDomain", c."officialDomain", c."emailDomain"))), '^www\.', '')
      ELSE 'name:' || c."normalizedName"
    END AS "baseKey",
    row_number() OVER (
      PARTITION BY
        c."userId",
        CASE
          WHEN COALESCE(c."officialWebsiteDomain", c."officialDomain", c."emailDomain") IS NOT NULL
            THEN 'domain:' || regexp_replace(lower(trim(COALESCE(c."officialWebsiteDomain", c."officialDomain", c."emailDomain"))), '^www\.', '')
          ELSE 'name:' || c."normalizedName"
        END
      ORDER BY
        CASE WHEN COALESCE(c."emailDomainEvidence"::text, '') LIKE '%manual_override%' OR COALESCE(c."emailFormatReason", '') ILIKE '%manual%' THEN 1 ELSE 0 END DESC,
        CASE WHEN c."emailDomain" IS NOT NULL AND c."emailPattern" IS NOT NULL THEN 1 ELSE 0 END DESC,
        CASE c."patternConfidence" WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END DESC,
        CASE c."emailDomainConfidence" WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END DESC,
        c."updatedAt" DESC,
        c."id" ASC
    ) AS "rank"
  FROM "public"."ProspectCompany" c
), winners AS (
  SELECT "userId", "baseKey", "id" AS "canonicalId"
  FROM keyed
  WHERE "rank" = 1
)
SELECT keyed."id" AS "oldId", winners."canonicalId", keyed."baseKey"
FROM keyed
JOIN winners
  ON winners."userId" = keyed."userId"
 AND winners."baseKey" = keyed."baseKey";

-- Pick one position per canonical company/category, preferring a position that
-- already belongs to the winning company row.
CREATE TEMP TABLE "_ProspectCanonicalPositionMap" ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    p."id" AS "oldPositionId",
    cm."canonicalId",
    p."category",
    first_value(p."id") OVER (
      PARTITION BY cm."canonicalId", p."category"
      ORDER BY CASE WHEN p."companyId" = cm."canonicalId" THEN 0 ELSE 1 END, p."createdAt", p."id"
    ) AS "canonicalPositionId"
  FROM "public"."ProspectCompanyPosition" p
  JOIN "_ProspectCanonicalCompanyMap" cm ON cm."oldId" = p."companyId"
)
SELECT DISTINCT "oldPositionId", "canonicalId", "category", "canonicalPositionId"
FROM ranked;

UPDATE "public"."ProspectPerson" person
SET
  "companyId" = pm."canonicalId",
  "positionId" = pm."canonicalPositionId"
FROM "_ProspectCanonicalPositionMap" pm
WHERE person."positionId" = pm."oldPositionId";

UPDATE "public"."ProspectSearch" search
SET "companyId" = cm."canonicalId"
FROM "_ProspectCanonicalCompanyMap" cm
WHERE search."companyId" = cm."oldId"
  AND cm."oldId" <> cm."canonicalId";

DELETE FROM "public"."ProspectCompanyPosition" position
USING "_ProspectCanonicalPositionMap" pm
WHERE position."id" = pm."oldPositionId"
  AND pm."oldPositionId" <> pm."canonicalPositionId";

UPDATE "public"."ProspectCompanyPosition" position
SET "companyId" = pm."canonicalId"
FROM "_ProspectCanonicalPositionMap" pm
WHERE position."id" = pm."canonicalPositionId"
  AND position."companyId" <> pm."canonicalId";

DELETE FROM "public"."ProspectCompany" company
USING "_ProspectCanonicalCompanyMap" cm
WHERE company."id" = cm."oldId"
  AND cm."oldId" <> cm."canonicalId";

UPDATE "public"."ProspectCompany" company
SET "canonicalKey" = cm."baseKey"
FROM "_ProspectCanonicalCompanyMap" cm
WHERE company."id" = cm."canonicalId";

ALTER TABLE "public"."ProspectCompany"
  ALTER COLUMN "canonicalKey" SET NOT NULL;

DROP INDEX IF EXISTS "public"."ProspectCompany_userId_normalizedName_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ProspectCompany_userId_canonicalKey_key"
  ON "public"."ProspectCompany"("userId", "canonicalKey");

CREATE INDEX IF NOT EXISTS "ProspectCompany_userId_normalizedName_idx"
  ON "public"."ProspectCompany"("userId", "normalizedName");

COMMIT;
