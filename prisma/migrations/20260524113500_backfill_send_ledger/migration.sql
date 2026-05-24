INSERT INTO "public"."SendLedger" (
  "id",
  "userId",
  "senderProfileId",
  "campaignId",
  "campaignRunId",
  "recipientJobId",
  "kind",
  "provider",
  "messageId",
  "sentAt",
  "createdAt"
)
SELECT
  'legacy_' || r."id",
  c."userId",
  c."senderProfileId",
  c."id",
  cr."id",
  r."id",
  'INITIAL',
  'GMAIL',
  r."providerMessageId",
  r."updatedAt",
  CURRENT_TIMESTAMP
FROM "public"."RecipientJob" r
JOIN "public"."CampaignRun" cr ON cr."id" = r."campaignRunId"
JOIN "public"."Campaign" c ON c."id" = cr."campaignId"
WHERE r."status" IN ('SENT', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED')
  AND NOT EXISTS (
    SELECT 1
    FROM "public"."SendLedger" sl
    WHERE sl."recipientJobId" = r."id"
  );
