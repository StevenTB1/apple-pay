# Backend setup and GraphQL contract

The backend lives in `apps/api`, separate from the local review app. Its initial migration is prepared for review only. Supabase connectivity, database behavior, owner sign-in, and real phone captures have not been verified yet.

## Private configuration

Copy `apps/api/.env.example` to `apps/api/.env.local`. Use `.env.local` for local secrets and Vercel environment settings for the future hosted API. Both real env files and generated credential files are ignored by Git. No Infisical integration is needed for this milestone.

- `DATABASE_URL`: runtime PostgreSQL connection, using the transaction pooler on port 6543 for the hosted API.
- `DIRECT_URL`: direct PostgreSQL or session-pooler connection on port 5432 for Prisma migrations. The session pooler is useful when direct IPv6 connectivity is unavailable.
- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`: verify owner access tokens with Supabase Auth. Use the publishable key, without a service-role secret.
- `OWNER_USER_ID`: the exact UUID of the allowed email/password Supabase Auth account.
- `SHORTCUT_SOURCE_ID`: stable identifier for the configured phone installation.
- `SHORTCUT_TOKEN_SHA256`: hex SHA-256 digest of its upload secret.

Use the project's Connect dialog and preserve its TLS settings. Runtime Prisma uses the `tracker` schema and a small connection pool. The database role must own the migration's tables or bypass RLS. Keep `tracker` outside the exposed Data API schemas. [Supabase's Prisma guide](https://supabase.com/docs/guides/database/prisma) describes the connection choices.

During local development, both database variables can use the same direct `postgres://` or `postgresql://` connection string. The HTTPS project address belongs in `SUPABASE_URL`. Configure TLS in the database connection string, for example with `sslmode=require` for Supabase; use `&sslmode=require` when a query string already exists. Before serverless deployment, change only `DATABASE_URL` to the transaction-pooler connection and keep `DIRECT_URL` for migrations.

`npm run shortcut:token` generates a random upload secret and source ID in `apps/api/.shortcut-credentials.json`, with private file permissions. It prints the file location, without printing its contents. It refuses to replace an existing file. Configure the file's `sourceId` and `tokenHash` in the backend and put `token` in the phone Shortcut. The source ID is a label, not phone attestation. To rotate a credential, keep the source ID for pending captures, replace the hash and the phone's secret together, and keep old files private until no longer needed.

No credentials are required for Prisma generation, schema validation, production compilation, or unauthenticated service status. Protected operations require configured credentials and a migrated database.

## Migration review

Review `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations/20261013000000_initial_tracker/migration.sql`. The SQL includes constraints and a trigger Prisma's schema cannot express; retain those in future migrations. It creates a custom `tracker` schema, enables RLS without client policies, and prevents updates to original capture identity and input. Editable fields are merchant, amount, currency, purchase time, and exclusion state.

The migration has not been applied. After review and environment configuration, `npm run db:migrate` uses `DIRECT_URL` to apply checked-in migrations. Do not substitute reset, schema push, or automatic startup migrations. Dev/build/typecheck only generate the client.

## Authentication and access

All operations use `/api/graphql`. POST requests must contain `Content-Type: application/json` and at most 32 KiB of JSON.

| Credential | Header | Permitted operations |
| --- | --- | --- |
| None | No Authorization header | `status` only |
| Phone secret | `Authorization: Bearer <phone-token>` | `recordCapture` and public status |
| Owner access token | `Authorization: Bearer <supabase-access-token>` | Owner queries, manual entries, corrections, and public status |

Owner tokens are verified using `supabase.auth.getUser(token)` and restricted to `OWNER_USER_ID`. Tokens for unrelated Supabase users fail. The client never supplies an owner ID. The phone credential cannot list or edit purchases; the owner token cannot call capture ingestion. Schema introspection reveals the API shape, without access to personal records.

Expected errors have codes `BAD_USER_INPUT`, `UNAUTHENTICATED`, `FORBIDDEN`, `CONFLICT`, or `NOT_FOUND`. Unexpected failures return a generic `INTERNAL_SERVER_ERROR`, including in development. Any GraphQL `errors` array means an upload failed, even when HTTP status is 200.

## Capture JSON

Send this JSON body using the phone secret header. Replace the source ID with the configured value and generate the event ID once, before saving the pending file.

```json
{
  "query": "mutation Capture($input: CaptureInput!) { recordCapture(input: $input) { transactionId eventId duplicate } }",
  "variables": {
    "input": {
      "sourceId": "replace-with-configured-source-id",
      "eventId": "replace-with-one-stable-event-uuid",
      "capturedAt": "2026-10-13T16:30:00-04:00",
      "merchant": "Coffee shop",
      "cardLabel": "Personal card",
      "amount": "12.30",
      "currency": "CAD",
      "rawAmount": "$12.30"
    }
  }
}
```

Amounts are nonnegative decimal **strings**, without a currency symbol, exponent, or thousands separator. CAD permits two effective decimal places; other or unknown currencies permit four. Strings may have up to sixteen integer digits. Unknown amount or currency must be omitted or `null`; automatic captures never default to CAD. Preserve ambiguous original amount text in `rawAmount`. Do not treat a missing amount as zero.

Timestamps must have an explicit timezone, valid calendar date, and at most millisecond precision. The API stores canonical UTC instants. Merchant, card label, and original amount text have bounded lengths. Source IDs use 3–100 ASCII letters/digits/underscores/hyphens; event IDs use 16–128. UUIDs meet both rules. Unsupported fields fail validation.

A successful result looks like:

```json
{
  "data": {
    "recordCapture": {
      "transactionId": "saved-purchase-uuid",
      "eventId": "the-event-id-from-your-pending-file",
      "duplicate": false
    }
  }
}
```

Save one JSON file per capture under On My iPhone **before** uploading. Delete only that file after a successful HTTP response with no GraphQL errors and an acknowledgement matching its event ID. Leave it pending after failed requests, malformed responses, or mismatched acknowledgements. A retry replays the saved input unchanged; `duplicate: true` is a successful acknowledgement.

Canonical equivalence normalizes timestamps, decimal notation, currency case, whitespace, and missing optional fields. Different original capture content under the same owner/source/event identity returns `CONFLICT`. Replay never rewrites corrected spending fields. Separate event IDs describing the same real purchase still require manual review.

Full phone automation assembly and locked-phone/offline behavior remain the later Shortcut milestone.

## Owner queries and corrections

Use the owner's Supabase access token for these operations. Amounts are returned as exact decimal strings; `totalCad` has two decimal places.

```graphql
query Month($month: String!) {
  transactions(month: $month, limit: 100) {
    id source merchant cardLabel amount currency occurredAt excluded
    capturedAt receivedAt updatedAt
  }
  spendingSummary(month: $month) {
    totalCad includedCount needsReviewCount excludedCount
  }
}
```

`month` uses `YYYY-MM`, with America/Toronto boundaries including daylight saving time. Lists default to 50 records, are limited to 100 per call, and sort newest purchase time first. Totals/counts cover the entire selected month. Complete, included CAD records contribute to `totalCad`; unknown amounts/currencies and foreign-currency records contribute to `needsReviewCount`. Excluded records contribute only to `excludedCount`. There is no FX conversion.

```graphql
mutation Add($input: ManualInput!) {
  createManualTransaction(input: $input) { id source amount currency }
}
# variables: {"input":{"merchant":"Cash lunch","amount":"8.25","occurredAt":"2026-10-13T12:00:00-04:00"}}

mutation Correct($id: ID!, $input: CorrectionInput!) {
  updateTransaction(id: $id, input: $input) {
    id merchant amount currency occurredAt excluded
  }
}
# variables: {"id":"saved-purchase-uuid","input":{"amount":"9.95","currency":"CAD"}}
```

Manual entries require an amount and purchase instant, default to CAD, and currently accept CAD only. Corrections may clear amount/currency to `null`, adjust the merchant or purchase time, or set `excluded` to true/false. An empty correction fails. Only explicitly supplied fields change; a row lock keeps concurrent edits consistent. Original capture, card label, owner/source/event identity, and receipt time stay immutable. Exclusion/restoration leaves the original capture intact.

## Static verification

Static checks: `npm run prisma:validate`, `npm run lint`, `npm run typecheck`, and `npm run build`. These neither connect to nor change a database.

The user selected static-only review for this stage. No unit or integration suites or test commands are maintained. Live Supabase connectivity, owner-token verification, and phone-to-dashboard behavior remain unverified and will need a working app and separately authorized runtime verification. The migration remains unapplied pending review.
