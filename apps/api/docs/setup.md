# Backend setup and GraphQL contract

The backend lives in `apps/api`, separate from the local review app. Its initial migration is prepared for review only. Supabase connectivity, database behavior, owner sign-in, and real phone captures have not been verified yet.

## Private configuration

Copy `apps/api/.env.example` to `apps/api/.env.local`. Use `.env.local` for local secrets and Vercel environment settings for the future hosted API. Both real env files and generated credential files are ignored by Git. No Infisical integration is needed for this milestone.

- `DIRECT_URL`: session-pooler PostgreSQL connection on port 5432, used only by `npm run db:migrate`. The running API does not use a PostgreSQL connection string.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: the API talks to the database only through supabase-js with the service-role key, and verifies sign-in tokens with `auth.getUser`. The key bypasses RLS, so every service filters by the signed-in user.

The API follows the same layout as the lindyventures API: `server/schemas.graphql` is the single source of truth with one auth directive per operation (`@public`, `@authenticated`, `@shortcut`; anything undecorated is forbidden), `server/resolvers.ts` registers `*_QUERIES` / `*_MUTATIONS` exported by `server/services/*`, `server/context.ts` builds `{ supabase, token }` per request, and `src/pages/api/graphql.ts` serves it with Apollo Server. Operations are camelCase verbs (`getTransactions`, `recordCapture`); fields and arguments are snake_case and match the database columns. Prisma is kept only as the migration tool.


Phone credentials live in the `shortcut_token` table, one active token per user. A signed-in user creates one with the dashboard's **Create phone token** button (`createShortcutToken` mutation); the raw `ap_…` secret is shown once and only its SHA-256 is stored. Creating a new token revokes the previous one. The token decides which user owns each capture.

Schema validation and production compilation need no credentials. Every request, including `status`, needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## Migration review

Review `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations/20261013000000_initial_tracker/migration.sql`. The SQL includes constraints and a trigger Prisma's schema cannot express; retain those in future migrations. It creates `users` (mirrored from `auth.users` by trigger, same UUID) and `transaction` in `public`, enables RLS so Data API users can only read their own rows, and prevents updates to original capture identity and input. Editable fields are merchant, amount, currency, purchase time, and exclusion state.

Migrations are applied to the Supabase project. `npm run db:migrate` uses `DIRECT_URL` to apply new checked-in migrations. Do not substitute reset, schema push, or automatic startup migrations. Dev/build/typecheck only generate the client.

## Phone access over Tailscale

The API and dashboard stay bound to `127.0.0.1`. Tailscale gives the iPhone a private, encrypted HTTPS route to this Mac, from home Wi-Fi or cellular, without publishing a public endpoint.

1. Install Tailscale on the Mac and the iPhone and sign in to the same tailnet. In the admin console, enable **MagicDNS** and **HTTPS certificates** (DNS page).
2. Find the Mac's name: `tailscale status` lists it as `<mac>.<tailnet>.ts.net`.
3. Expose both apps to the tailnet only (not Funnel):
   ```bash
   tailscale serve --bg 3000
   tailscale serve --bg --https=8443 3001
   ```
   The dashboard is then `https://<mac>.<tailnet>.ts.net` and the capture API is `https://<mac>.<tailnet>.ts.net:8443/api/graphql`.
4. Set `DEV_ORIGIN_HOST=<mac>.<tailnet>.ts.net` in `apps/web/.env.local`, then run `npm run dev:api` and `npm run dev` from the repository root.
5. On the iPhone, with Tailscale connected, open the dashboard URL and sign in.

`tailscale serve status` shows the mappings; `tailscale serve reset` removes them. Uploads only work while the Mac is awake with both apps running; otherwise captures stay pending on the phone for the retry Shortcut.

## Authentication and access

All operations use `/api/graphql`. POST requests must contain `Content-Type: application/json` and at most 32 KiB of JSON.

| Credential | Header | Permitted operations |
| --- | --- | --- |
| None | No Authorization header | `status` only |
| Phone secret | `Authorization: Bearer <phone-token>` | `record_capture` and public status |
| Owner access token | `Authorization: Bearer <supabase-access-token>` | Owner queries, manual entries, corrections, and public status |

Owner tokens are verified using `supabase.auth.getUser(token)` ; each signed-in user reads and edits only their own purchases. The client never supplies an owner ID. The phone credential cannot list or edit purchases; the owner token cannot call capture ingestion. Schema introspection reveals the API shape, without access to personal records.

Expected errors have codes `BAD_USER_INPUT`, `UNAUTHENTICATED`, `FORBIDDEN`, `CONFLICT`, or `NOT_FOUND`. Unexpected failures return a generic `INTERNAL_SERVER_ERROR`, including in development. Any GraphQL `errors` array means an upload failed, even when HTTP status is 200.

## Capture JSON

Send this JSON body using the phone secret header. Generate the event ID once, before saving the pending file. `source_id` is optional and defaults to the token's own ID.

```json
{
  "query": "mutation Capture($input: CaptureInput!) { recordCapture(input: $input) { transaction_id event_id duplicate } }",
  "variables": {
    "input": {
      "event_id": "replace-with-one-stable-event-uuid",
      "captured_at": "2026-10-13T16:30:00-04:00",
      "merchant": "Coffee shop",
      "card_label": "Personal card",
      "amount": "12.30",
      "currency": "CAD",
      "raw_amount": "$12.30"
    }
  }
}
```

Amounts are nonnegative decimal **strings**, without a currency symbol, exponent, or thousands separator. CAD permits two effective decimal places; other or unknown currencies permit four. Strings may have up to sixteen integer digits. Unknown amount or currency must be omitted or `null`; automatic captures never default to CAD. Preserve ambiguous original amount text in `raw_amount`. Do not treat a missing amount as zero.

Timestamps must have an explicit timezone, valid calendar date, and at most millisecond precision. The API stores canonical UTC instants. Merchant, card label, and original amount text have bounded lengths. Source IDs use 3–100 ASCII letters/digits/underscores/hyphens; event IDs use 16–128. UUIDs meet both rules. Unsupported fields fail validation.

A successful result looks like:

```json
{
  "data": {
    "recordCapture": {
      "transaction_id": "saved-purchase-uuid",
      "event_id": "the-event-id-from-your-pending-file",
      "duplicate": false
    }
  }
}
```

Save one JSON file per capture under On My iPhone **before** uploading. Delete only that file after a successful HTTP response with no GraphQL errors and an acknowledgement matching its event ID. Leave it pending after failed requests, malformed responses, or mismatched acknowledgements. A retry replays the saved input unchanged; `duplicate: true` is a successful acknowledgement.

Canonical equivalence normalizes timestamps, decimal notation, currency case, whitespace, and missing optional fields. Different original capture content under the same owner/source/event identity returns `CONFLICT`. Replay never rewrites corrected spending fields. Separate event IDs describing the same real purchase still require manual review.

Full phone automation assembly and locked-phone/offline behavior remain the later Shortcut milestone.

## Owner queries and corrections

Use the owner's Supabase access token for these operations. Amounts are returned as exact decimal strings; `total_cad` has two decimal places.

```graphql
query Month($month: String!) {
  getTransactions(month: $month, limit: 100) { count data {
    id source merchant card_label amount currency occurred_at excluded
    captured_at received_at updated_at
  } }
  getSpendingSummary(month: $month) {
    total_cad included_count needs_review_count excluded_count
  }
}
```

`month` uses `YYYY-MM`, with America/Toronto boundaries including daylight saving time. Lists default to 50 records, are limited to 100 per call, and sort newest purchase time first. Totals/counts cover the entire selected month. Complete, included CAD records contribute to `total_cad`; unknown amounts/currencies and foreign-currency records contribute to `needs_review_count`. Excluded records contribute only to `excluded_count`. There is no FX conversion.

```graphql
mutation Add($input: ManualTransactionInput!) {
  createManualTransaction(input: $input) { id source amount currency }
}
# variables: {"input":{"merchant":"Cash lunch","amount":"8.25","occurred_at":"2026-10-13T12:00:00-04:00"}}

mutation Correct($id: ID!, $input: TransactionCorrectionInput!) {
  updateTransaction(transaction_id: $id, input: $input) {
    id merchant amount currency occurred_at excluded
  }
}
# variables: {"id":"saved-purchase-uuid","input":{"amount":"9.95","currency":"CAD"}}
```

Manual entries require an amount and purchase instant, default to CAD, and currently accept CAD only. Corrections may clear amount/currency to `null`, adjust the merchant or purchase time, or set `excluded` to true/false. An empty correction fails. Only explicitly supplied fields change; a row lock keeps concurrent edits consistent. Original capture, card label, owner/source/event identity, and receipt time stay immutable. Exclusion/restoration leaves the original capture intact.

## Static verification

Static checks: `npm run prisma:validate`, `npm run lint`, `npm run typecheck`, and `npm run build`. These neither connect to nor change a database.

The user selected static-only review for this stage. No unit or integration suites or test commands are maintained. Live Supabase connectivity, owner-token verification, and phone-to-dashboard behavior remain unverified and will need a working app and separately authorized runtime verification. The migration remains unapplied pending review.
