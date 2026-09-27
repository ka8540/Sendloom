-- Bright Data and Apify have independent continuation state. Provider source
-- belongs to the membership row because one exact intent may contain both.
ALTER TABLE "public"."DiscoverProviderBatch"
  ADD COLUMN IF NOT EXISTS "brightNextPage" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "brightPagesFetched" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "brightExhausted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "apifyNextPage" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "apifyPagesFetched" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "apifyExhausted" BOOLEAN NOT NULL DEFAULT false;

UPDATE "public"."DiscoverProviderBatch"
SET
  "apifyNextPage" = "providerNextPage",
  "apifyPagesFetched" = "providerPagesFetched",
  "apifyExhausted" = "providerExhausted"
WHERE "provider" = 'APIFY';

ALTER TABLE "public"."DiscoverProviderBatchPerson"
  ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'APIFY';

CREATE INDEX IF NOT EXISTS "DiscoverProviderBatchPerson_batchId_provider_providerSortIndex_idx"
  ON "public"."DiscoverProviderBatchPerson"("batchId", "provider", "providerSortIndex");
