-- Dedicated waiting state and durable execution-slot ownership for the
-- free-user sequence concurrency limit.
ALTER TYPE "CampaignStatus" ADD VALUE 'WAITING_FOR_SLOT' BEFORE 'RUNNING';
ALTER TYPE "RunStatus" ADD VALUE 'WAITING_FOR_SLOT' BEFORE 'RUNNING';

ALTER TABLE "CampaignRun"
ADD COLUMN "waitingForSlotAt" TIMESTAMP(3),
ADD COLUMN "executionSlotClaimedAt" TIMESTAMP(3);

-- Preserve active work during rollout. Ordinary accounts keep the oldest ten
-- due/running runs; any overflow waits FIFO. The application owner is unlimited.
WITH ranked_active AS (
  SELECT
    run."id",
    run."campaignId",
    campaign."userId",
    user_record."email",
    ROW_NUMBER() OVER (
      PARTITION BY campaign."userId"
      ORDER BY COALESCE(run."scheduledFor", run."createdAt") ASC, run."createdAt" ASC, run."id" ASC
    ) AS slot_rank
  FROM "CampaignRun" run
  JOIN "Campaign" campaign ON campaign."id" = run."campaignId"
  JOIN "User" user_record ON user_record."id" = campaign."userId"
  WHERE run."status" = 'RUNNING'
     OR (run."status" = 'QUEUED' AND (run."scheduledFor" IS NULL OR run."scheduledFor" <= CURRENT_TIMESTAMP))
)
UPDATE "CampaignRun" run
SET "executionSlotClaimedAt" = CURRENT_TIMESTAMP
FROM ranked_active ranked
WHERE run."id" = ranked."id"
  AND (LOWER(BTRIM(ranked."email")) = 'kush.ahir2024@gmail.com' OR ranked.slot_rank <= 10);

-- Overflow due runs intentionally remain unclaimed here. PostgreSQL
-- cannot write a newly added enum value until this migration transaction commits.
-- The first normal campaign reconciliation atomically moves those rows to
-- WAITING_FOR_SLOT (or claims them when capacity exists).

CREATE INDEX "Campaign_userId_status_idx" ON "Campaign"("userId", "status");
CREATE INDEX "CampaignRun_status_executionSlotClaimedAt_idx" ON "CampaignRun"("status", "executionSlotClaimedAt");
CREATE INDEX "CampaignRun_status_waitingForSlotAt_id_idx" ON "CampaignRun"("status", "waitingForSlotAt", "id");
