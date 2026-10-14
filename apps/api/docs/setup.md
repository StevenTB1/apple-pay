# API contract

The API has two endpoints. Everything the dashboard does goes through GraphQL; the capture endpoint exists so the iPhone Shortcut can post a transaction without building a query.

| Endpoint | Caller | Body |
| --- | --- | --- |
| `POST /api/graphql` | Dashboard | GraphQL request (`application/json`, at most 32 KB) |
| `POST /api/graphql/capture` | iPhone Shortcut | Anything: a file, text or JSON (at most 32 KB) |

## Structure

- `server/schemas.graphql` is the single source of truth. Every query and mutation carries exactly one auth directive; an undecorated one is blocked.
- `server/resolvers.ts` registers the `*_QUERIES` / `*_MUTATIONS` exported by `server/services/*`.
- `server/context.ts` builds `{ supabase, token }` per request. `supabase` uses the service-role key, so each service filters by `token.user_id`.
- Operations are camelCase verbs; fields and arguments are snake_case and match the database columns.

## Credentials

| Credential | Header | Role | May call |
| --- | --- | --- | --- |
| None | — | — | `status` |
| Supabase access token | `Authorization: Bearer <access-token>` | `user` | `@authenticated` operations |
| Phone token | `Authorization: Bearer ap_<64 hex>` | `shortcut` | `recordCapture` and the capture endpoint |

Access tokens are verified with `supabase.auth.getUser`. Phone tokens are looked up by SHA-256 in `shortcut_token`; a revoked or unknown token is treated as no credential. The client never supplies a user ID.

## Operations

| Operation | Directive | Notes |
| --- | --- | --- |
| `status: String!` | `@public` | Always `"api"` |
| `getTransactions(month, limit = 50, offset = 0): Transactions` | `@authenticated` | `{ count, data }`, newest first; `limit` 1–100 |
| `getSpendingSummary(month): SpendingSummary` | `@authenticated` | Totals and counts for the whole month |
| `createManualTransaction(input): Transaction` | `@authenticated` | CAD only; `amount` and `occurred_at` required |
| `updateTransaction(transaction_id, input): Transaction` | `@authenticated` | Only supplied fields change |
| `createShortcutToken: ShortcutCredential` | `@authenticated` | Returns the raw token once and revokes the previous one |
| `recordCapture(input: JSON): CaptureAck` | `@shortcut` | Same service as the capture endpoint |

`month` is `YYYY-MM` in America/Toronto. Amounts are exact decimal strings, never floats. Timestamps need an explicit timezone.

```graphql
query Month($month: String!) {
  getTransactions(month: $month, limit: 100) {
    count
    data { id source merchant card_label amount currency occurred_at excluded }
  }
  getSpendingSummary(month: $month) { total_cad included_count needs_review_count excluded_count }
}

mutation Add($input: ManualTransactionInput!) {
  createManualTransaction(input: $input) { id amount currency }
}
# variables: {"input":{"merchant":"Cash lunch","amount":"8.25","occurred_at":"2026-10-13T12:00:00-04:00"}}

mutation Correct($id: ID!, $input: TransactionCorrectionInput!) {
  updateTransaction(transaction_id: $id, input: $input) { id merchant amount currency excluded }
}
# variables: {"id":"<transaction uuid>","input":{"excluded":true}}
```

In a summary, complete CAD purchases that are not excluded make up `total_cad`. Purchases with an unknown amount or currency, or a non-CAD currency, count under `needs_review_count`.

## Capture

`POST /api/graphql/capture` with a phone token. The whole body is the capture input:

- **An object** contributes any of `merchant`, `amount` (or `raw_amount`), `card` (or `card_label`), `currency`, `event_id`, `captured_at`. Unknown keys are ignored.
- **Anything else** is treated as raw text: the first money-looking part becomes the amount and the rest is stored as the merchant.

The server fills in what is missing: `event_id` is generated, `captured_at` is the arrival time, the amount is parsed from the text (`$12.30`, `CA$1,234.50`, `12,30 $`), and the currency is inferred (`US$`, `€`, `£`, a three-letter code, or CAD for a bare `$`). Unreadable values are saved as unknown, not rejected, and the exact input is stored in `original_capture.received`.

```sh
curl -X POST https://apple-pay-api.vercel.app/api/graphql/capture \
  -H "Authorization: Bearer ap_…" -H "Content-Type: application/json" \
  -d '{"merchant":"Coffee shop","amount":"$4.50","card":"Visa"}'
# {"transaction_id":"…","event_id":"…","duplicate":false}
```

A capture that sends its own `event_id` is idempotent: replaying the same content returns `duplicate: true`, and different content under the same ID returns a conflict. Without an `event_id`, every request creates a new purchase.

## Errors and limits

GraphQL errors carry `extensions.code`: `BAD_USER_INPUT`, `UNAUTHENTICATED`, `FORBIDDEN`, `CONFLICT` or `NOT_FOUND`. Anything unexpected is logged on the server and returned as a generic `INTERNAL_SERVER_ERROR`. The capture endpoint uses HTTP status codes (400, 401, 403, 409, 500) with `{ "error": "…" }`.

Rate limits are per IP address, in `server/integrations/rateLimit.ts`: 120 requests a minute on `/api/graphql` and 30 a minute on the capture endpoint. Over the limit returns HTTP 429 before any database work. The limiter fails open if Upstash is unreachable or unconfigured.

Schema introspection is disabled in production.
