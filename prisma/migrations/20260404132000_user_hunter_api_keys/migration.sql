ALTER TABLE "User"
ADD COLUMN "hunterApiKeyEncrypted" TEXT,
ADD COLUMN "hunterApiKeyLast4" TEXT,
ADD COLUMN "hunterApiKeyUpdatedAt" TIMESTAMP(3);
