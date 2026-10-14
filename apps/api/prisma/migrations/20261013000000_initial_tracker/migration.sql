-- CreateEnum
CREATE TYPE "CaptureSource" AS ENUM ('APPLE_PAY', 'MANUAL');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ownerId" UUID NOT NULL,
    "source" "CaptureSource" NOT NULL,
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
CREATE INDEX "Transaction_ownerId_occurredAt_id_idx" ON "Transaction"("ownerId", "occurredAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_ownerId_sourceId_eventId_key" ON "Transaction"("ownerId", "sourceId", "eventId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma cannot reference auth.users; deleting an Auth user removes their profile and purchases.
ALTER TABLE "User" ADD CONSTRAINT "User_id_auth_fkey" FOREIGN KEY ("id") REFERENCES auth.users("id") ON DELETE CASCADE;

-- Prisma cannot express these cross-field constraints; keep them in this migration.
ALTER TABLE "Transaction"
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
CREATE FUNCTION public.protect_capture_metadata() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
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
BEFORE UPDATE ON "Transaction"
FOR EACH ROW EXECUTE FUNCTION public.protect_capture_metadata();

-- Mirror each Auth user into public."User" with the same UUID.
CREATE FUNCTION public.sync_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public."User" ("id", "email") VALUES (NEW.id, NEW.email)
  ON CONFLICT ("id") DO UPDATE SET "email" = EXCLUDED."email", "updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "on_auth_user_created"
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_auth_user();

CREATE TRIGGER "on_auth_user_email_updated"
AFTER UPDATE OF email ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_auth_user();

INSERT INTO "User" ("id", "email") SELECT id, email FROM auth.users ON CONFLICT ("id") DO NOTHING;

-- Prisma connects as the table owner and bypasses RLS; Data API users see only their own rows.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Transaction" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own profile" ON "User"
FOR SELECT TO authenticated USING ("id" = (SELECT auth.uid()));

CREATE POLICY "Users read their own transactions" ON "Transaction"
FOR SELECT TO authenticated USING ("ownerId" = (SELECT auth.uid()));
