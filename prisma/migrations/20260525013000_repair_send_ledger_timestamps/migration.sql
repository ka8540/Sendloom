WITH confirmed_send_times AS (
  SELECT
    sl."id",
    COALESCE(
      CASE
        WHEN r."metadata"->>'resolvedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
          THEN (r."metadata"->>'resolvedAt')::timestamp
      END,
      CASE
        WHEN r."metadata"->>'sentAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
          THEN (r."metadata"->>'sentAt')::timestamp
      END,
      CASE
        WHEN r."metadata"->>'lastAttemptAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
          THEN (r."metadata"->>'lastAttemptAt')::timestamp
      END
    ) AS "confirmedSentAt"
  FROM "public"."SendLedger" sl
  JOIN "public"."RecipientJob" r ON r."id" = sl."recipientJobId"
  WHERE sl."id" LIKE 'legacy_%'
)
UPDATE "public"."SendLedger" sl
SET "sentAt" = confirmed_send_times."confirmedSentAt"
FROM confirmed_send_times
WHERE sl."id" = confirmed_send_times."id"
  AND confirmed_send_times."confirmedSentAt" IS NOT NULL
  AND sl."sentAt" <> confirmed_send_times."confirmedSentAt";
