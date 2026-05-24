CREATE TABLE IF NOT EXISTS "public"."SendLedger" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "senderProfileId" TEXT,
  "campaignId" TEXT,
  "campaignRunId" TEXT,
  "recipientJobId" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'INITIAL',
  "provider" TEXT NOT NULL DEFAULT 'GMAIL',
  "messageId" TEXT,
  "threadId" TEXT,
  "sentAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SendLedger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SendLedger_senderProfileId_sentAt_idx"
ON "public"."SendLedger"("senderProfileId", "sentAt");

CREATE INDEX IF NOT EXISTS "SendLedger_userId_sentAt_idx"
ON "public"."SendLedger"("userId", "sentAt");

CREATE INDEX IF NOT EXISTS "SendLedger_recipientJobId_idx"
ON "public"."SendLedger"("recipientJobId");
