-- CreateTable
CREATE TABLE "AttachmentAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT '',
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttachmentAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttachmentAsset_userId_sha256_sizeBytes_contentType_key" ON "AttachmentAsset"("userId", "sha256", "sizeBytes", "contentType");

-- CreateIndex
CREATE INDEX "AttachmentAsset_userId_createdAt_idx" ON "AttachmentAsset"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AttachmentAsset" ADD CONSTRAINT "AttachmentAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
