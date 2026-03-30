ALTER TABLE "public"."SenderProfile"
ADD COLUMN IF NOT EXISTS "lastReplySyncAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastReplySyncError" TEXT;

ALTER TABLE "public"."CampaignRun"
ADD COLUMN IF NOT EXISTS "repliedCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "public"."RecipientJob"
ADD COLUMN IF NOT EXISTS "repliedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "replyCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "public"."InboundReply" (
  "id" TEXT NOT NULL,
  "senderProfileId" TEXT NOT NULL,
  "recipientJobId" TEXT,
  "gmailMessageId" TEXT NOT NULL,
  "gmailThreadId" TEXT,
  "fromEmail" TEXT,
  "subject" TEXT,
  "snippet" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InboundReply_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InboundReply_gmailMessageId_key" ON "public"."InboundReply"("gmailMessageId");
CREATE INDEX IF NOT EXISTS "InboundReply_senderProfileId_receivedAt_idx" ON "public"."InboundReply"("senderProfileId", "receivedAt");
CREATE INDEX IF NOT EXISTS "InboundReply_recipientJobId_receivedAt_idx" ON "public"."InboundReply"("recipientJobId", "receivedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'InboundReply_senderProfileId_fkey'
      AND table_name = 'InboundReply'
  ) THEN
    ALTER TABLE "public"."InboundReply"
    ADD CONSTRAINT "InboundReply_senderProfileId_fkey"
    FOREIGN KEY ("senderProfileId") REFERENCES "public"."SenderProfile"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'InboundReply_recipientJobId_fkey'
      AND table_name = 'InboundReply'
  ) THEN
    ALTER TABLE "public"."InboundReply"
    ADD CONSTRAINT "InboundReply_recipientJobId_fkey"
    FOREIGN KEY ("recipientJobId") REFERENCES "public"."RecipientJob"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;
