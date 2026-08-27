-- CreateEnum
CREATE TYPE "ProductUpdateBroadcastStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProductUpdateBroadcastRecipientStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'RETRY', 'PERMANENT_FAILURE');

-- CreateTable
CREATE TABLE "ProductUpdateBroadcast" (
    "id" TEXT NOT NULL,
    "status" "ProductUpdateBroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "intro" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "scheduledSendAt" TIMESTAMP(3),
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

    CONSTRAINT "ProductUpdateBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductUpdateBroadcastRecipient" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailSnapshot" TEXT NOT NULL,
    "status" "ProductUpdateBroadcastRecipientStatus" NOT NULL DEFAULT 'PENDING',
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

    CONSTRAINT "ProductUpdateBroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductUpdateBroadcast_status_scheduledSendAt_idx" ON "ProductUpdateBroadcast"("status", "scheduledSendAt");

-- CreateIndex
CREATE INDEX "ProductUpdateBroadcast_createdAt_idx" ON "ProductUpdateBroadcast"("createdAt");

-- CreateIndex
CREATE INDEX "ProductUpdateBroadcast_createdByUserId_idx" ON "ProductUpdateBroadcast"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductUpdateBroadcastRecipient_broadcastId_userId_key" ON "ProductUpdateBroadcastRecipient"("broadcastId", "userId");

-- CreateIndex
CREATE INDEX "ProductUpdateBroadcastRecipient_broadcastId_status_nextAttemptAt_idx" ON "ProductUpdateBroadcastRecipient"("broadcastId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ProductUpdateBroadcastRecipient_status_leaseExpiresAt_idx" ON "ProductUpdateBroadcastRecipient"("status", "leaseExpiresAt");

-- AddForeignKey
ALTER TABLE "ProductUpdateBroadcast" ADD CONSTRAINT "ProductUpdateBroadcast_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUpdateBroadcastRecipient" ADD CONSTRAINT "ProductUpdateBroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "ProductUpdateBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUpdateBroadcastRecipient" ADD CONSTRAINT "ProductUpdateBroadcastRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
