-- CreateEnum
CREATE TYPE "FollowUpSendMode" AS ENUM ('SAME_THREAD', 'NEW_EMAIL');

-- CreateEnum
CREATE TYPE "FollowUpJobStatus" AS ENUM ('NONE', 'SCHEDULED', 'PROCESSING', 'SENT', 'SKIPPED', 'FAILED', 'RETRYING');

-- AlterTable
ALTER TABLE "Campaign"
ADD COLUMN "followUpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "followUpTemplateId" TEXT,
ADD COLUMN "followUpDelayDays" INTEGER,
ADD COLUMN "followUpSendMode" "FollowUpSendMode",
ADD COLUMN "followUpTemplateSnapshot" JSONB;

-- AlterTable
ALTER TABLE "RecipientJob"
ADD COLUMN "firstEmailSentAt" TIMESTAMP(3),
ADD COLUMN "providerThreadId" TEXT,
ADD COLUMN "messageIdHeader" TEXT,
ADD COLUMN "referencesHeader" TEXT,
ADD COLUMN "followUpStatus" "FollowUpJobStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN "followUpScheduledAt" TIMESTAMP(3),
ADD COLUMN "followUpSentAt" TIMESTAMP(3),
ADD COLUMN "followUpRetryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "followUpNextRetryAt" TIMESTAMP(3),
ADD COLUMN "followUpLastError" TEXT,
ADD COLUMN "followUpSkippedReason" TEXT,
ADD COLUMN "followUpProviderMessageId" TEXT,
ADD COLUMN "followUpProviderThreadId" TEXT,
ADD COLUMN "followUpMessageIdHeader" TEXT,
ADD COLUMN "followUpReferencesHeader" TEXT;

-- CreateIndex
CREATE INDEX "Campaign_followUpTemplateId_idx" ON "Campaign"("followUpTemplateId");

-- CreateIndex
CREATE INDEX "RecipientJob_campaignRunId_followUpStatus_followUpScheduledAt_idx" ON "RecipientJob"("campaignRunId", "followUpStatus", "followUpScheduledAt");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_followUpTemplateId_fkey" FOREIGN KEY ("followUpTemplateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
