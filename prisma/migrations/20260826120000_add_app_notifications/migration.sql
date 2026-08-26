-- Add account-scoped in-app product notifications. This is independent from
-- the existing admin-authored SystemNotice delivery tables.

-- CreateEnum
CREATE TYPE "AppNotificationType" AS ENUM ('DISCOVER_SEARCH_COMPLETED', 'SEQUENCE_COMPLETED', 'GMAIL_RECONNECT_REQUIRED');

-- CreateEnum
CREATE TYPE "AppNotificationSeverity" AS ENUM ('SUCCESS', 'INFO', 'WARNING');

-- CreateTable
CREATE TABLE "AppNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AppNotificationType" NOT NULL,
    "severity" "AppNotificationSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "href" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppNotification_userId_dedupeKey_key" ON "AppNotification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "AppNotification_userId_createdAt_idx" ON "AppNotification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AppNotification_userId_readAt_createdAt_idx" ON "AppNotification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "AppNotification_userId_type_entityId_idx" ON "AppNotification"("userId", "type", "entityId");

-- One unresolved Gmail warning per sender and owner. Once resolvedAt is set,
-- a later failure episode can create a new row while concurrent health checks
-- still collapse to one active warning.
CREATE UNIQUE INDEX "AppNotification_active_gmail_episode_key"
ON "AppNotification"("userId", "type", "entityId")
WHERE "type" = 'GMAIL_RECONNECT_REQUIRED' AND "resolvedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "AppNotification" ADD CONSTRAINT "AppNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
