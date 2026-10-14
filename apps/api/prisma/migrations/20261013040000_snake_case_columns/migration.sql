-- Rename every column, and the enum type, to lowercase snake_case.
ALTER TYPE "CaptureSource" RENAME TO "capture_source";

ALTER TABLE "users" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "users" RENAME COLUMN "updatedAt" TO "updated_at";

ALTER TABLE "shortcut_token" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "shortcut_token" RENAME COLUMN "tokenHash" TO "token_hash";
ALTER TABLE "shortcut_token" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "shortcut_token" RENAME COLUMN "revokedAt" TO "revoked_at";

ALTER TABLE "transaction" RENAME COLUMN "ownerId" TO "owner_id";
ALTER TABLE "transaction" RENAME COLUMN "sourceId" TO "source_id";
ALTER TABLE "transaction" RENAME COLUMN "eventId" TO "event_id";
ALTER TABLE "transaction" RENAME COLUMN "captureFingerprint" TO "capture_fingerprint";
ALTER TABLE "transaction" RENAME COLUMN "originalCapture" TO "original_capture";
ALTER TABLE "transaction" RENAME COLUMN "capturedAt" TO "captured_at";
ALTER TABLE "transaction" RENAME COLUMN "receivedAt" TO "received_at";
ALTER TABLE "transaction" RENAME COLUMN "occurredAt" TO "occurred_at";
ALTER TABLE "transaction" RENAME COLUMN "cardLabel" TO "card_label";
ALTER TABLE "transaction" RENAME COLUMN "updatedAt" TO "updated_at";

ALTER INDEX "transaction_ownerId_occurredAt_id_idx" RENAME TO "transaction_owner_id_occurred_at_id_idx";
ALTER INDEX "transaction_ownerId_sourceId_eventId_key" RENAME TO "transaction_owner_id_source_id_event_id_key";
ALTER TABLE "transaction" RENAME CONSTRAINT "transaction_ownerId_fkey" TO "transaction_owner_id_fkey";
ALTER INDEX "shortcut_token_tokenHash_key" RENAME TO "shortcut_token_token_hash_key";
ALTER INDEX "shortcut_token_userId_idx" RENAME TO "shortcut_token_user_id_idx";
ALTER TABLE "shortcut_token" RENAME CONSTRAINT "shortcut_token_userId_fkey" TO "shortcut_token_user_id_fkey";

-- Function bodies are stored as text, so they must be rewritten for the new column names.
CREATE OR REPLACE FUNCTION public.protect_capture_metadata() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF ROW(NEW."id", NEW."owner_id", NEW."source", NEW."source_id", NEW."event_id",
         NEW."capture_fingerprint", NEW."original_capture", NEW."captured_at", NEW."received_at", NEW."card_label")
     IS DISTINCT FROM
     ROW(OLD."id", OLD."owner_id", OLD."source", OLD."source_id", OLD."event_id",
         OLD."capture_fingerprint", OLD."original_capture", OLD."captured_at", OLD."received_at", OLD."card_label") THEN
    RAISE EXCEPTION 'Capture metadata is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public."users" ("id", "email") VALUES (NEW.id, NEW.email)
  ON CONFLICT ("id") DO UPDATE SET "email" = EXCLUDED."email", "updated_at" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
