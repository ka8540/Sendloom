-- Follow-up email scheduling

-- Campaign: follow-up configuration
ALTER TABLE "Campaign" ADD COLUMN "followUpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Campaign" ADD COLUMN "followUpTemplateId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "followUpSendMode" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "followUpScheduledAt" TIMESTAMP(3);
ALTER TABLE "Campaign" ADD COLUMN "followUpTimezone" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "followUpTemplateSnapshot" JSONB;

-- RecipientJob: Gmail threading metadata + follow-up tracking
ALTER TABLE "RecipientJob" ADD COLUMN "gmailThreadId" TEXT;
ALTER TABLE "RecipientJob" ADD COLUMN "initialMessageIdHeader" TEXT;
ALTER TABLE "RecipientJob" ADD COLUMN "followUpStatus" TEXT;
ALTER TABLE "RecipientJob" ADD COLUMN "followUpSentAt" TIMESTAMP(3);
ALTER TABLE "RecipientJob" ADD COLUMN "followUpError" TEXT;
ALTER TABLE "RecipientJob" ADD COLUMN "followUpAttemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RecipientJob" ADD COLUMN "followUpMessageId" TEXT;
ALTER TABLE "RecipientJob" ADD COLUMN "followUpNextRetryAt" TIMESTAMP(3);

-- Index for the follow-up scheduler
CREATE INDEX "RecipientJob_campaignRunId_followUpStatus_idx" ON "RecipientJob"("campaignRunId", "followUpStatus");
