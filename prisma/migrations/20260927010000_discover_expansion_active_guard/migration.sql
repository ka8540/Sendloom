-- Exactly one PENDING/PROCESSING Add More expansion may own a search at once.
-- Terminal rows clear activeSearchId; PostgreSQL permits multiple NULL values
-- in this unique index, preserving the full expansion history.
ALTER TABLE "public"."DiscoverSearchExpansion"
  ADD COLUMN IF NOT EXISTS "activeSearchId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "DiscoverSearchExpansion_activeSearchId_key"
  ON "public"."DiscoverSearchExpansion"("activeSearchId");
