-- AI web-search email-format discovery.
-- Adds an optional reason summary (from the GPT web search) and a discovery
-- timestamp used to cache high-confidence results and avoid re-paying for the
-- AI web search within the freshness window. Both columns are additive and
-- nullable so the migration is safe to re-run.

ALTER TABLE "public"."ProspectCompany"
  ADD COLUMN IF NOT EXISTS "emailFormatReason" TEXT,
  ADD COLUMN IF NOT EXISTS "emailFormatDiscoveredAt" TIMESTAMP(3);
