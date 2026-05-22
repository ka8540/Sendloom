-- Follow-up email scheduling

-- Campaign: follow-up configuration
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "followUpEnabled" BOOLEAN DEFAULT false;
UPDATE "Campaign" SET "followUpEnabled" = false WHERE "followUpEnabled" IS NULL;
ALTER TABLE "Campaign" ALTER COLUMN "followUpEnabled" SET DEFAULT false;
ALTER TABLE "Campaign" ALTER COLUMN "followUpEnabled" SET NOT NULL;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "followUpTemplateId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "followUpSendMode" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "followUpScheduledAt" TIMESTAMP(3);
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "followUpTimezone" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "followUpTemplateSnapshot" JSONB;

-- RecipientJob: Gmail threading metadata + follow-up tracking
ALTER TABLE "RecipientJob" ADD COLUMN IF NOT EXISTS "gmailThreadId" TEXT;
ALTER TABLE "RecipientJob" ADD COLUMN IF NOT EXISTS "initialMessageIdHeader" TEXT;
ALTER TABLE "RecipientJob" ADD COLUMN IF NOT EXISTS "followUpStatus" TEXT;
ALTER TABLE "RecipientJob" ADD COLUMN IF NOT EXISTS "followUpSentAt" TIMESTAMP(3);
ALTER TABLE "RecipientJob" ADD COLUMN IF NOT EXISTS "followUpError" TEXT;
ALTER TABLE "RecipientJob" ADD COLUMN IF NOT EXISTS "followUpAttemptCount" INTEGER DEFAULT 0;
UPDATE "RecipientJob" SET "followUpAttemptCount" = 0 WHERE "followUpAttemptCount" IS NULL;
ALTER TABLE "RecipientJob" ALTER COLUMN "followUpAttemptCount" SET DEFAULT 0;
ALTER TABLE "RecipientJob" ALTER COLUMN "followUpAttemptCount" SET NOT NULL;
ALTER TABLE "RecipientJob" ADD COLUMN IF NOT EXISTS "followUpMessageId" TEXT;
ALTER TABLE "RecipientJob" ADD COLUMN IF NOT EXISTS "followUpNextRetryAt" TIMESTAMP(3);

-- Index for the follow-up scheduler
CREATE INDEX IF NOT EXISTS "RecipientJob_campaignRunId_followUpStatus_idx" ON "RecipientJob"("campaignRunId", "followUpStatus");
