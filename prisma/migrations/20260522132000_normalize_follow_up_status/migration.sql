-- Normalize follow-up status storage after early preview deployments.

ALTER TABLE "RecipientJob" ALTER COLUMN "followUpStatus" DROP DEFAULT;
ALTER TABLE "RecipientJob" ALTER COLUMN "followUpStatus" DROP NOT NULL;
ALTER TABLE "RecipientJob"
  ALTER COLUMN "followUpStatus" TYPE TEXT
  USING "followUpStatus"::TEXT;

UPDATE "RecipientJob"
SET "followUpStatus" = CASE "followUpStatus"
  WHEN 'PENDING' THEN 'PENDING'
  WHEN 'SENT' THEN 'SENT'
  WHEN 'FAILED' THEN 'FAILED'
  WHEN 'SKIPPED' THEN 'SKIPPED'
  WHEN 'pending' THEN 'PENDING'
  WHEN 'sent' THEN 'SENT'
  WHEN 'failed' THEN 'FAILED'
  WHEN 'skipped' THEN 'SKIPPED'
  ELSE NULL
END
WHERE "followUpStatus" IS NOT NULL;

DO $$
DECLARE
  enum_type_id oid;
BEGIN
  SELECT oid INTO enum_type_id
  FROM pg_type
  WHERE typname = 'FollowUpStatus'
  LIMIT 1;

  IF enum_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM pg_attribute attribute
    JOIN pg_class relation ON relation.oid = attribute.attrelid
    WHERE attribute.atttypid = enum_type_id
      AND NOT attribute.attisdropped
      AND relation.relkind IN ('r', 'p')
  ) THEN
    DROP TYPE "FollowUpStatus";
  END IF;
END $$;
