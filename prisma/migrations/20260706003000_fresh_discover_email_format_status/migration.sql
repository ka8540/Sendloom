ALTER TABLE "ProspectCompany"
ADD COLUMN "emailFormatDiscoveryStatus" TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED',
ADD COLUMN "emailFormatDiscoveryReason" TEXT,
ADD COLUMN "emailFormatDiscoveryAt" TIMESTAMP(3);

ALTER TABLE "DiscoverSearchCache"
ADD COLUMN "emailFormatDiscoveryStatus" TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED',
ADD COLUMN "emailFormatDiscoveryReason" TEXT,
ADD COLUMN "emailFormatDiscoveryAt" TIMESTAMP(3),
ADD COLUMN "emailFormatDiscoveryExpiresAt" TIMESTAMP(3);

CREATE INDEX "DiscoverSearchCache_emailFormatDiscoveryStatus_idx"
ON "DiscoverSearchCache"("emailFormatDiscoveryStatus");
