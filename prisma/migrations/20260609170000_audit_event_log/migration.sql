-- Extend AuditLog into an admin-grade audit event table. All new columns are
-- nullable or defaulted so existing rows stay valid.
ALTER TABLE "public"."AuditLog"
  ADD COLUMN IF NOT EXISTS "actorUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "actorName" TEXT,
  ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS "severity" TEXT NOT NULL DEFAULT 'INFO',
  ADD COLUMN IF NOT EXISTS "targetName" TEXT,
  ADD COLUMN IF NOT EXISTS "message" TEXT,
  ADD COLUMN IF NOT EXISTS "ipAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "userAgent" TEXT;

ALTER TABLE "public"."AuditLog" ALTER COLUMN "entityType" DROP NOT NULL;
ALTER TABLE "public"."AuditLog" ALTER COLUMN "entityId" DROP NOT NULL;

-- Attribute existing rows to user ids where the actor email still matches a
-- user, and categorize known legacy action prefixes. This only annotates
-- events that were genuinely recorded — it does not fabricate history.
UPDATE "public"."AuditLog" AS a
SET "actorUserId" = u."id"
FROM "public"."User" AS u
WHERE a."actorUserId" IS NULL AND u."email" = a."actorEmail";

UPDATE "public"."AuditLog" SET "category" = 'ADMIN' WHERE "category" = 'SYSTEM' AND "action" LIKE 'admin.%';
UPDATE "public"."AuditLog" SET "category" = 'SEQUENCE' WHERE "category" = 'SYSTEM' AND "action" LIKE 'campaign.%';

CREATE INDEX IF NOT EXISTS "AuditLog_actorUserId_createdAt_idx"
ON "public"."AuditLog"("actorUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_actorEmail_createdAt_idx"
ON "public"."AuditLog"("actorEmail", "createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_category_createdAt_idx"
ON "public"."AuditLog"("category", "createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_severity_createdAt_idx"
ON "public"."AuditLog"("severity", "createdAt");
