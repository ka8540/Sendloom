-- Existing batches retain their pre-Firecrawl continuation. New batches start with Firecrawl.
ALTER TABLE "DiscoverProviderBatch"
  ADD COLUMN "providerChainVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "firecrawlNextQueryIndex" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "firecrawlQueriesFetched" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "firecrawlExhausted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DiscoverProviderBatch" ALTER COLUMN "providerChainVersion" SET DEFAULT 2;
