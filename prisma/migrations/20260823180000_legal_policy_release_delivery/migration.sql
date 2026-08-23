-- Add a durable release-level delivery ledger while preserving the existing
-- per-policy notice and recipient tables as immutable history.

-- CreateTable
CREATE TABLE "LegalPolicyRelease" (
    "id" TEXT NOT NULL,
    "releaseGroup" TEXT NOT NULL,
    "status" "LegalPolicyNoticeStatus" NOT NULL DEFAULT 'PENDING',
    "recipientCursor" TEXT,
    "recipientsMaterializedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "LegalPolicyRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalPolicyReleaseRecipient" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailSnapshot" TEXT NOT NULL,
    "status" "LegalPolicyNoticeRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalPolicyReleaseRecipient_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "LegalPolicyNotice" ADD COLUMN "releaseId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LegalPolicyRelease_releaseGroup_key" ON "LegalPolicyRelease"("releaseGroup");

-- CreateIndex
CREATE INDEX "LegalPolicyRelease_status_createdAt_idx" ON "LegalPolicyRelease"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegalPolicyReleaseRecipient_releaseId_userId_key" ON "LegalPolicyReleaseRecipient"("releaseId", "userId");

-- CreateIndex
CREATE INDEX "LegalPolicyReleaseRecipient_releaseId_status_nextAttemptAt_idx" ON "LegalPolicyReleaseRecipient"("releaseId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "LegalPolicyReleaseRecipient_status_leaseExpiresAt_idx" ON "LegalPolicyReleaseRecipient"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "LegalPolicyNotice_releaseId_idx" ON "LegalPolicyNotice"("releaseId");

-- AddForeignKey
ALTER TABLE "LegalPolicyNotice" ADD CONSTRAINT "LegalPolicyNotice_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "LegalPolicyRelease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalPolicyReleaseRecipient" ADD CONSTRAINT "LegalPolicyReleaseRecipient_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "LegalPolicyRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalPolicyReleaseRecipient" ADD CONSTRAINT "LegalPolicyReleaseRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
