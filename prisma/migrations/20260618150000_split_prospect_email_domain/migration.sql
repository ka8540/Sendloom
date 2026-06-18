-- Split prospect website domain from employee email domain.
-- `officialDomain` remains for backward compatibility and continues to mirror
-- the public website domain. New email-domain fields are evidence-backed and
-- are the only fields used for generated candidate emails.

ALTER TABLE "public"."ProspectCompany"
  ADD COLUMN IF NOT EXISTS "officialWebsiteDomain" TEXT,
  ADD COLUMN IF NOT EXISTS "emailDomain" TEXT,
  ADD COLUMN IF NOT EXISTS "emailDomainConfidence" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
  ADD COLUMN IF NOT EXISTS "emailDomainEvidence" JSONB;

UPDATE "public"."ProspectCompany"
SET "officialWebsiteDomain" = "officialDomain"
WHERE "officialWebsiteDomain" IS NULL
  AND "officialDomain" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "ProspectCompany_userId_emailDomain_idx"
  ON "public"."ProspectCompany"("userId", "emailDomain");
