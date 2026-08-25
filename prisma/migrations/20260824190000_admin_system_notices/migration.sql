-- Add an independent durable ledger for admin-authored operational notices.

-- CreateEnum
CREATE TYPE "SystemNoticeType" AS ENUM ('PLANNED_MAINTENANCE', 'DEGRADED_PERFORMANCE', 'SERVICE_DISRUPTION', 'RESOLVED', 'GENERAL');

-- CreateEnum
CREATE TYPE "SystemNoticeStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "SystemNoticeRecipientStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'RETRY', 'PERMANENT_FAILURE');

-- CreateTable
CREATE TABLE "SystemNotice" (
    "id" TEXT NOT NULL,
    "type" "SystemNoticeType" NOT NULL,
    "status" "SystemNoticeStatus" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "affectedArea" TEXT,
    "scheduledSendAt" TIMESTAMP(3),
    "impactStartsAt" TIMESTAMP(3),
    "impactEndsAt" TIMESTAMP(3),
    "timeZone" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "recipientCursor" TEXT,
    "recipientsMaterializedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemNoticeRecipient" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailSnapshot" TEXT NOT NULL,
    "status" "SystemNoticeRecipientStatus" NOT NULL DEFAULT 'PENDING',
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

    CONSTRAINT "SystemNoticeRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SystemNotice_status_scheduledSendAt_idx" ON "SystemNotice"("status", "scheduledSendAt");

-- CreateIndex
CREATE INDEX "SystemNotice_createdAt_idx" ON "SystemNotice"("createdAt");

-- CreateIndex
CREATE INDEX "SystemNotice_createdByUserId_idx" ON "SystemNotice"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemNoticeRecipient_noticeId_userId_key" ON "SystemNoticeRecipient"("noticeId", "userId");

-- CreateIndex
CREATE INDEX "SystemNoticeRecipient_noticeId_status_nextAttemptAt_idx" ON "SystemNoticeRecipient"("noticeId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "SystemNoticeRecipient_status_leaseExpiresAt_idx" ON "SystemNoticeRecipient"("status", "leaseExpiresAt");

-- AddForeignKey
ALTER TABLE "SystemNotice" ADD CONSTRAINT "SystemNotice_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemNoticeRecipient" ADD CONSTRAINT "SystemNoticeRecipient_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "SystemNotice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemNoticeRecipient" ADD CONSTRAINT "SystemNoticeRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
