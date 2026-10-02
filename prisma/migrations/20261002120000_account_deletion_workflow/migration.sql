ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE TYPE "AccountDeletionStatus" AS ENUM ('PENDING_REVIEW', 'PROCESSING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED');

CREATE TABLE "AccountDeletionRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "activeUserId" TEXT,
  "status" "AccountDeletionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedByAdminId" TEXT,
  "reviewNote" TEXT,
  "processingStartedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "requestEmailSentAt" TIMESTAMP(3),
  "completionEmailSentAt" TIMESTAMP(3),
  CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountDeletionRequest_activeUserId_key" ON "AccountDeletionRequest"("activeUserId");
CREATE INDEX "AccountDeletionRequest_status_requestedAt_idx" ON "AccountDeletionRequest"("status", "requestedAt");
CREATE INDEX "AccountDeletionRequest_userId_requestedAt_idx" ON "AccountDeletionRequest"("userId", "requestedAt");
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AccountDeletionObject" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "AccountDeletionObject_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountDeletionObject_requestId_bucket_key_key" ON "AccountDeletionObject"("requestId", "bucket", "key");
CREATE INDEX "AccountDeletionObject_requestId_deletedAt_idx" ON "AccountDeletionObject"("requestId", "deletedAt");
ALTER TABLE "AccountDeletionObject" ADD CONSTRAINT "AccountDeletionObject_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AccountDeletionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
