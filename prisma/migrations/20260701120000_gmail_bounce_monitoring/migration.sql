-- Gmail bounce monitoring: mailbox-watch state on SenderProfile and structured
-- delivery-failure detail on Suppression. Additive only — no data rewrites.

ALTER TABLE "SenderProfile"
  ADD COLUMN "gmailWatchHistoryId" TEXT,
  ADD COLUMN "gmailWatchExpiresAt" TIMESTAMP(3),
  ADD COLUMN "gmailWatchStatus" TEXT,
  ADD COLUMN "gmailWatchError" TEXT,
  ADD COLUMN "bounceLastSyncedAt" TIMESTAMP(3),
  ADD COLUMN "bounceBackfillCompletedAt" TIMESTAMP(3);

ALTER TABLE "Suppression"
  ADD COLUMN "enhancedStatusCode" TEXT,
  ADD COLUMN "failureCategory" TEXT,
  ADD COLUMN "firstFailedAt" TIMESTAMP(3),
  ADD COLUMN "lastFailedAt" TIMESTAMP(3),
  ADD COLUMN "failureCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sourceGmailMessageId" TEXT;
