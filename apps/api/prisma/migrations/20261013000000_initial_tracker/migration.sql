-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "tracker";

-- CreateEnum
CREATE TYPE "tracker"."CaptureSource" AS ENUM ('APPLE_PAY', 'MANUAL');

-- CreateTable
CREATE TABLE "tracker"."Transaction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ownerId" UUID NOT NULL,
    "source" "tracker"."CaptureSource" NOT NULL,
    "sourceId" VARCHAR(100),
    "eventId" VARCHAR(128),
    "captureFingerprint" CHAR(64),
    "originalCapture" JSONB,
    "capturedAt" TIMESTAMPTZ(3),
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "merchant" VARCHAR(200),
    "cardLabel" VARCHAR(100),
    "amount" DECIMAL(20,4),
    "currency" VARCHAR(3),
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transaction_ownerId_occurredAt_id_idx" ON "tracker"."Transaction"("ownerId", "occurredAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_ownerId_sourceId_eventId_key" ON "tracker"."Transaction"("ownerId", "sourceId", "eventId");

-- Prisma cannot express these cross-field constraints; keep them in this migration.
ALTER TABLE "tracker"."Transaction"
  ADD CONSTRAINT "Transaction_nonnegative_amount" CHECK ("amount" IS NULL OR "amount" >= 0),
  ADD CONSTRAINT "Transaction_currency_code" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Transaction_cad_precision" CHECK (
    "currency" IS DISTINCT FROM 'CAD' OR "amount" IS NULL OR "amount" = trunc("amount", 2)
  ),
  ADD CONSTRAINT "Transaction_capture_metadata" CHECK (
    ("source" = 'APPLE_PAY'
      AND "sourceId" IS NOT NULL AND "sourceId" ~ '^[A-Za-z0-9_-]{3,100}$'
      AND "eventId" IS NOT NULL AND "eventId" ~ '^[A-Za-z0-9_-]{16,128}$'
      AND "captureFingerprint" IS NOT NULL AND "captureFingerprint" ~ '^[a-f0-9]{64}$'
      AND "originalCapture" IS NOT NULL AND jsonb_typeof("originalCapture") = 'object'
      AND "capturedAt" IS NOT NULL)
    OR ("source" = 'MANUAL'
      AND "sourceId" IS NULL AND "eventId" IS NULL AND "captureFingerprint" IS NULL
      AND "originalCapture" IS NULL AND "capturedAt" IS NULL)
  );

-- Original capture and owner identity remain unchanged when review fields are corrected.
CREATE FUNCTION "tracker"."protect_capture_metadata"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."id", NEW."ownerId", NEW."source", NEW."sourceId", NEW."eventId",
         NEW."captureFingerprint", NEW."originalCapture", NEW."capturedAt", NEW."receivedAt", NEW."cardLabel")
     IS DISTINCT FROM
     ROW(OLD."id", OLD."ownerId", OLD."source", OLD."sourceId", OLD."eventId",
         OLD."captureFingerprint", OLD."originalCapture", OLD."capturedAt", OLD."receivedAt", OLD."cardLabel") THEN
    RAISE EXCEPTION 'Capture metadata is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Transaction_protect_capture_metadata"
BEFORE UPDATE ON "tracker"."Transaction"
FOR EACH ROW EXECUTE FUNCTION "tracker"."protect_capture_metadata"();

-- Server Prisma uses the migration/table owner. Client roles receive no row policies.
-- Keep tracker outside Supabase's exposed Data API schemas.
REVOKE ALL ON SCHEMA "tracker" FROM PUBLIC;
REVOKE ALL ON TABLE "tracker"."Transaction" FROM PUBLIC;
ALTER TABLE "tracker"."Transaction" ENABLE ROW LEVEL SECURITY;
