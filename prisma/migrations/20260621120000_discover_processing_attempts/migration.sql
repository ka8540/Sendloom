-- Discover processing-attempt instrumentation.
-- Adds durable, internal-only attempt bookkeeping to ProspectSearch so a
-- user-triggered Retry is a distinct processing attempt (attemptCount increments,
-- lastAttemptId rotates) while a network replay of the same client idempotency
-- key reuses the current attempt and never double-counts. These columns are never
-- exposed via GraphQL — they back safe server-side diagnostics only. All
-- statements are additive + idempotent so the migration is safe to re-apply.

ALTER TABLE "public"."ProspectSearch"
  ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastAttemptId" TEXT,
  ADD COLUMN IF NOT EXISTS "lastAttemptStartedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastAttemptCompletedAt" TIMESTAMP(3);
