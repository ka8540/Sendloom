ALTER TABLE "DiscoverProviderBatch"
  ADD COLUMN "tavilyNextQueryIndex" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tavilyQueriesFetched" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tavilyExhausted" BOOLEAN NOT NULL DEFAULT false;
