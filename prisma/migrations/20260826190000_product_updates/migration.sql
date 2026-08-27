-- Add admin-authored Product Updates (user-facing "What's New") with a
-- per-user seen ledger. Additive only: no email delivery, no recipient
-- ledger, and no changes to SystemNotice or AppNotification tables.
-- Hand-written because the local shadow database cannot replay the legacy
-- pgvector migration; verified equivalent to `prisma migrate dev` output.

-- CreateEnum
CREATE TYPE "ProductUpdateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductUpdateIcon" AS ENUM ('SPARKLES', 'BELL', 'USER', 'SEARCH', 'SEND', 'MAIL', 'SHIELD', 'SETTINGS');

-- CreateTable
CREATE TABLE "ProductUpdate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" "ProductUpdateIcon" NOT NULL,
    "status" "ProductUpdateStatus" NOT NULL DEFAULT 'DRAFT',
    "ctaLabel" TEXT,
    "ctaHref" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ProductUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductUpdateView" (
    "id" TEXT NOT NULL,
    "productUpdateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductUpdateView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductUpdate_slug_key" ON "ProductUpdate"("slug");

-- CreateIndex
CREATE INDEX "ProductUpdate_status_publishedAt_idx" ON "ProductUpdate"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "ProductUpdate_createdAt_idx" ON "ProductUpdate"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductUpdateView_productUpdateId_userId_key" ON "ProductUpdateView"("productUpdateId", "userId");

-- CreateIndex
CREATE INDEX "ProductUpdateView_userId_seenAt_idx" ON "ProductUpdateView"("userId", "seenAt");

-- AddForeignKey
ALTER TABLE "ProductUpdate" ADD CONSTRAINT "ProductUpdate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUpdateView" ADD CONSTRAINT "ProductUpdateView_productUpdateId_fkey" FOREIGN KEY ("productUpdateId") REFERENCES "ProductUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUpdateView" ADD CONSTRAINT "ProductUpdateView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
