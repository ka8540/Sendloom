-- Add user profile-photo metadata. Image bytes live in object storage (the
-- existing attachments bucket); PostgreSQL stores only the object key and the
-- display metadata needed to serve and cache-bust the photo.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "profilePhotoKey" TEXT,
ADD COLUMN "profilePhotoContentType" TEXT,
ADD COLUMN "profilePhotoUpdatedAt" TIMESTAMP(3);
