-- CreateTable
CREATE TABLE "shortcut_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "shortcut_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shortcut_token_tokenHash_key" ON "shortcut_token"("tokenHash");

-- CreateIndex
CREATE INDEX "shortcut_token_userId_idx" ON "shortcut_token"("userId");

-- AddForeignKey
ALTER TABLE "shortcut_token" ADD CONSTRAINT "shortcut_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Only the API (table owner) reads credentials; no Data API access at all.
ALTER TABLE "shortcut_token" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "shortcut_token" FROM anon, authenticated;
