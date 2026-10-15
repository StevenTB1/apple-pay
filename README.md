# Apple Pay spending tracker

Records Apple Pay purchases from an iPhone Shortcut and shows monthly CAD spending in a web dashboard.

## How it works

1. A Wallet automation on the iPhone runs after a payment with a selected card.
2. The Shortcut POSTs the transaction, as-is, to `/api/graphql/capture` with an upload-only token.
3. The API works out the merchant, amount and currency, and stores the purchase in Supabase. The original input is kept with the row.
4. You sign in to the dashboard with a Supabase email/password account to review, correct, exclude or add purchases.

Each user sees only their own purchases. A phone token can add captures but never read anything.

## Repository layout

```text
apps/
  web/                         Next.js dashboard
    src/app/api/purchases/     Forwards the signed-in browser's requests to the API
  api/                         Next.js API (no pages of its own)
    src/pages/api/graphql.ts   Apollo Server endpoint
    src/pages/api/graphql/capture.ts   Free-form capture endpoint for the Shortcut
    server/schemas.graphql     GraphQL schema; one auth directive per operation
    server/resolvers.ts        Resolver registry
    server/services/           Queries and mutations, calling Supabase through supabase-js
    server/context.ts          Per-request Supabase client and decoded credential
    server/directives.ts       @public, @authenticated, @shortcut; undecorated operations are blocked
    server/integrations/       Third-party clients (Upstash rate limiting)
    prisma/                    Schema and migrations (Prisma is the migration tool only)
    docs/setup.md              API contract and request examples
```

## Local development

Use Node.js 24 (`nvm use`) and install once from the repository root with `pnpm install`.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Dashboard on http://127.0.0.1:3000 |
| `pnpm dev:api` | API on http://127.0.0.1:3001 |
| `pnpm dev:lan` | Dashboard reachable from other devices on your network |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | Static checks for both apps |
| `pnpm prisma:validate` | Validate the Prisma schema |
| `pnpm db:migrate` | Apply checked-in migrations using `DIRECT_URL` |

There are no automated tests.

## Configuration

Copy each app's `.env.example` to `.env.local`. Real env files are ignored by Git; on Vercel the same names are set per project.

**`apps/api`**

| Setting | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | The API's only database access. It bypasses RLS, so every service filters by the signed-in user. Server only. |
| `DIRECT_URL` | `postgresql://` session-pooler URL (port 5432), used only by `pnpm db:migrate` |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Rate limiting. If unset, rate limiting is off. |

**`apps/web`**

| Setting | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser sign-in. Never a secret key. |
| `GRAPHQL_API_URL` | The API's `/api/graphql` address |
| `DEV_ORIGIN_HOST` | Optional hostname allowed to reach the dev server from another device |

## Database

Supabase Postgres, `public` schema, snake_case names.

| Table | Purpose |
| --- | --- |
| `users` | One row per Supabase Auth user, same UUID, kept in sync by a trigger on `auth.users` |
| `transaction` | Purchases. Capture metadata is immutable; merchant, amount, currency, time and `excluded` are editable. |
| `shortcut_token` | SHA-256 of each phone token; one active token per user |

RLS is on for every table. Through Supabase's Data API a signed-in user can only read their own `users` row and `transaction` rows; `shortcut_token` and Prisma's migration table are not reachable at all. The API uses the service-role key and applies the per-user filter itself.

Change the schema only through a new migration in `apps/api/prisma/migrations/`, then run `pnpm db:migrate`. Migrations are never part of a build or deploy. Some SQL (constraints, triggers, RLS policies, the `spending_summary` function, the link to `auth.users`) exists only in the migration files, so use `prisma migrate deploy`, not `migrate dev`.

## Phone setup

1. Sign in to the dashboard and press **Create phone token**. Copy the `ap_…` value; it is shown once, and creating another revokes it.
2. In Shortcuts → Automation, add a **Wallet** (Transaction) automation for your cards, set to **Run Immediately**, that runs a new shortcut.
3. In that shortcut add **Get Contents of URL**:
   - URL: `https://<your-api>.vercel.app/api/graphql/capture`
   - Method: `POST`
   - Header: `Authorization` = `Bearer ap_…`
   - Request Body: **File** = **Shortcut Input**

Captures need a network connection; there is no offline queue or duplicate protection on this path.

## Deployment

Two Vercel projects, `apple-pay-api` (root directory `apps/api`) and `apple-pay-web` (root directory `apps/web`), both on Node 24.

## Known limits

- Amounts are parsed from Wallet's display text; anything unreadable is saved as "amount unknown" for manual correction. A bare `$` is read as CAD.
- Totals are CAD only, with no currency conversion. Months use America/Toronto.
- Editing a purchase does not lock the row, so two simultaneous edits can produce a validation error.
- Rate limiting fails open: if Upstash is unreachable, requests are allowed.

## License

MIT. See [LICENSE](LICENSE).
