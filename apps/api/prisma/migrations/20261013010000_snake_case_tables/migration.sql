-- Rename tables to lowercase snake_case; "user" is a reserved word, so the profile table is "users".
ALTER TABLE "User" RENAME TO "users";
ALTER TABLE "Transaction" RENAME TO "transaction";

ALTER TABLE "users" RENAME CONSTRAINT "User_pkey" TO "users_pkey";
ALTER TABLE "users" RENAME CONSTRAINT "User_id_auth_fkey" TO "users_id_auth_fkey";
ALTER TABLE "transaction" RENAME CONSTRAINT "Transaction_pkey" TO "transaction_pkey";
ALTER TABLE "transaction" RENAME CONSTRAINT "Transaction_ownerId_fkey" TO "transaction_ownerId_fkey";
ALTER TABLE "transaction" RENAME CONSTRAINT "Transaction_nonnegative_amount" TO "transaction_nonnegative_amount";
ALTER TABLE "transaction" RENAME CONSTRAINT "Transaction_currency_code" TO "transaction_currency_code";
ALTER TABLE "transaction" RENAME CONSTRAINT "Transaction_cad_precision" TO "transaction_cad_precision";
ALTER TABLE "transaction" RENAME CONSTRAINT "Transaction_capture_metadata" TO "transaction_capture_metadata";
ALTER INDEX "Transaction_ownerId_occurredAt_id_idx" RENAME TO "transaction_ownerId_occurredAt_id_idx";
ALTER INDEX "Transaction_ownerId_sourceId_eventId_key" RENAME TO "transaction_ownerId_sourceId_eventId_key";
ALTER TRIGGER "Transaction_protect_capture_metadata" ON "transaction" RENAME TO "transaction_protect_capture_metadata";

CREATE OR REPLACE FUNCTION public.sync_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public."users" ("id", "email") VALUES (NEW.id, NEW.email)
  ON CONFLICT ("id") DO UPDATE SET "email" = EXCLUDED."email", "updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- Only Prisma (the table owner) needs migration history; hide it from the Data API.
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "_prisma_migrations" FROM anon, authenticated;
