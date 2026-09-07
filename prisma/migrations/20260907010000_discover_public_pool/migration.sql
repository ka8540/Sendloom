ALTER TABLE "DiscoverSearchCache" ADD COLUMN "publicExpansion" JSONB;
ALTER TABLE "DiscoverSearchCachePerson" ADD COLUMN "locationSource" TEXT;
ALTER TABLE "ProspectPerson" ADD COLUMN "locationSource" TEXT;
