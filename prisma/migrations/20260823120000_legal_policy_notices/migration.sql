-- CreateEnum
CREATE TYPE "LegalPolicyNoticeStatus" AS ENUM ('BASELINE', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "LegalPolicyNoticeRecipientStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED_RETRYABLE', 'FAILED_PERMANENT');

-- CreateTable
CREATE TABLE "LegalPolicyNotice" (
    "id" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "policyTitle" TEXT NOT NULL,
    "policyPath" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "lastUpdated" TEXT NOT NULL,
    "changeSummary" JSONB NOT NULL,
    "status" "LegalPolicyNoticeStatus" NOT NULL DEFAULT 'PENDING',
    "recipientCursor" TEXT,
    "recipientsMaterializedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "LegalPolicyNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalPolicyNoticeRecipient" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
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

    CONSTRAINT "LegalPolicyNoticeRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LegalPolicyNotice_policy_version_key" ON "LegalPolicyNotice"("policy", "version");

-- CreateIndex
CREATE INDEX "LegalPolicyNotice_policy_createdAt_idx" ON "LegalPolicyNotice"("policy", "createdAt");

-- CreateIndex
CREATE INDEX "LegalPolicyNotice_status_createdAt_idx" ON "LegalPolicyNotice"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegalPolicyNoticeRecipient_noticeId_userId_key" ON "LegalPolicyNoticeRecipient"("noticeId", "userId");

-- CreateIndex
CREATE INDEX "LegalPolicyNoticeRecipient_noticeId_status_nextAttemptAt_idx" ON "LegalPolicyNoticeRecipient"("noticeId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "LegalPolicyNoticeRecipient_status_leaseExpiresAt_idx" ON "LegalPolicyNoticeRecipient"("status", "leaseExpiresAt");

-- AddForeignKey
ALTER TABLE "LegalPolicyNoticeRecipient" ADD CONSTRAINT "LegalPolicyNoticeRecipient_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "LegalPolicyNotice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalPolicyNoticeRecipient" ADD CONSTRAINT "LegalPolicyNoticeRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
