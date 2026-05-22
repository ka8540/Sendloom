-- Normalize follow-up send mode storage after early preview deployments.

ALTER TABLE "Campaign" ALTER COLUMN "followUpSendMode" DROP DEFAULT;
ALTER TABLE "Campaign" ALTER COLUMN "followUpSendMode" DROP NOT NULL;
ALTER TABLE "Campaign"
  ALTER COLUMN "followUpSendMode" TYPE TEXT
  USING "followUpSendMode"::TEXT;

UPDATE "Campaign"
SET "followUpSendMode" = CASE "followUpSendMode"
  WHEN 'SAME_THREAD' THEN 'same_thread'
  WHEN 'NEW_EMAIL' THEN 'new_email'
  WHEN 'NEW_THREAD' THEN 'new_email'
  WHEN 'same_thread' THEN 'same_thread'
  WHEN 'new_email' THEN 'new_email'
  ELSE NULL
END
WHERE "followUpSendMode" IS NOT NULL;

DO $$
DECLARE
  enum_type_id oid;
BEGIN
  SELECT oid INTO enum_type_id
  FROM pg_type
  WHERE typname = 'FollowUpSendMode'
  LIMIT 1;

  IF enum_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM pg_attribute attribute
    JOIN pg_class relation ON relation.oid = attribute.attrelid
    WHERE attribute.atttypid = enum_type_id
      AND NOT attribute.attisdropped
      AND relation.relkind IN ('r', 'p')
  ) THEN
    DROP TYPE "FollowUpSendMode";
  END IF;
END $$;
