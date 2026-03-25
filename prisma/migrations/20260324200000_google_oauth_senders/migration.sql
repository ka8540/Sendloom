ALTER TABLE "public"."SenderProfile"
ADD COLUMN IF NOT EXISTS "userId" TEXT,
ADD COLUMN IF NOT EXISTS "oauthRefreshToken" TEXT,
ADD COLUMN IF NOT EXISTS "oauthScope" TEXT;

CREATE INDEX IF NOT EXISTS "SenderProfile_userId_idx" ON "public"."SenderProfile"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'SenderProfile_userId_fkey'
      AND table_name = 'SenderProfile'
  ) THEN
    ALTER TABLE "public"."SenderProfile"
    ADD CONSTRAINT "SenderProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "public"."User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;
