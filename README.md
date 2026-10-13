# Apple Pay spending tracker

A private personal spending tracker designed to record in-person Apple Pay purchases made with your iPhone and help you review spending from a mobile web app on home Wi-Fi.

**Current status: backend implementation prepared.** The two Next.js apps use TypeScript and npm workspaces. The API now contains Prisma storage, capture acknowledgement/replay handling, upload-only authentication, Supabase owner-token verification, monthly CAD totals, manual entries, and corrections. The initial migration is saved for review and has **not been applied**. Verification at this stage is limited to static source review and compiler/lint checks. The dashboard still shows an empty setup state; its sign-in and spending screens, phone Shortcuts, and deployment are the next milestones.

## Local development

Use Node.js 24; the repository includes an `.nvmrc` for nvm. Install dependencies once from the repository root:

```sh
nvm use
npm ci
```

Start the dashboard:

```sh
npm run dev
```

Open [the local dashboard](http://127.0.0.1:3000). In another terminal, start the API:

```sh
npm run dev:api
```

The API's [root endpoint](http://127.0.0.1:3001) returns service status. Its [GraphQL endpoint](http://127.0.0.1:3001/api/graphql) accepts the public query `{ status }`, which returns `"api"`. Status describes the service, without checking database connectivity. Starting either app and compiling the API need no credentials; purchase operations require private configuration and the reviewed migration.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dashboard on port 3000, bound to your computer's loopback interface |
| `npm run dev:api` | Headless API on port 3001, bound to loopback |
| `npm run dev:lan` | Dashboard on port 3000, accessible over home Wi-Fi |
| `npm run lint` | ESLint checks for both apps |
| `npm run typecheck` | Generate Next.js route types and check TypeScript for both apps |
| `npm run build` | Compile production builds for both apps |
| `npm start` | Serve the built dashboard locally |
| `npm run start:api` | Serve the built API locally |
| `npm run prisma:generate` | Generate the API's Prisma client without a database connection |
| `npm run prisma:validate` | Validate the Prisma schema without changing a database |
| `npm run shortcut:token` | Generate an ignored, private phone credential file |
| `npm run db:migrate` | Apply checked-in migrations using `DIRECT_URL`; run only after migration review |

For phone access, copy `apps/web/.env.example` to `apps/web/.env.local`, set `DEV_ORIGIN_HOST` to your computer's LAN hostname or IP without a protocol or port, and run `npm run dev:lan`. Open `http://<your-computer-LAN-IP>:3000` on your phone. Both devices must be on the same network. Owner sign-in is a later implementation step; this starter contains no personal records.

Each app has its own `.env.example`. Next.js loads environment files from the corresponding app directory. Real `.env.local` files are ignored by Git. Database credentials and the phone credential belong only in the API's server environment. API dev/build/typecheck commands generate the Prisma client automatically; they never apply migrations.

## Supabase and secrets

For this personal app, use `apps/api/.env.local` locally and Vercel environment settings when the API is deployed. An additional secrets service such as Infisical is deferred until multiple people or environments need shared secret management.

Copy `apps/api/.env.example` to `apps/api/.env.local` and configure these values privately:

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase PostgreSQL runtime connection; transaction pooler for the hosted API |
| `DIRECT_URL` | Direct or session-pooler connection for reviewed migrations |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Validate the signed-in owner's access token; no service-role key needed |
| `OWNER_USER_ID` | UUID of the single permitted Supabase Auth user |
| `SHORTCUT_SOURCE_ID`, `SHORTCUT_TOKEN_SHA256` | Bind the upload-only credential to the phone's configured source |

Use the connection strings from the dedicated project's Connect dialog, with TLS configured there. The runtime database role must own the migrated tracker tables or bypass RLS; an ordinary client role has no access. Create the owner's Supabase email/password account and put its Auth user UUID in `OWNER_USER_ID`. The dashboard sign-in screen will be implemented next.

For local development, `DATABASE_URL` and `DIRECT_URL` can use the same direct Postgres connection string. Both start with `postgres://` or `postgresql://`; the HTTPS project address goes in `SUPABASE_URL`.

Run `npm run shortcut:token` when you are ready to configure the phone. It writes `apps/api/.shortcut-credentials.json` with private file permissions and refuses to replace an existing file. Put its `token` on the phone, `sourceId` in `SHORTCUT_SOURCE_ID`, and `tokenHash` in `SHORTCUT_TOKEN_SHA256`. Keep the file private and out of shared Shortcut exports. Replacing or removing the configured hash revokes the old credential. Pending captures retain their source ID, so keep that ID when rotating the secret if those files still need uploading.

Review [the initial migration](apps/api/prisma/migrations/20261013000000_initial_tracker/migration.sql) before applying it. It creates only the application's `tracker` schema, exact decimal fields, capture constraints, an immutability trigger, and row-level security with no client policies. Keep this schema outside Supabase's exposed Data API schemas. **No migration has been applied by this implementation.** After review and private connection setup, `npm run db:migrate` applies the checked-in migrations; it is never part of startup or build.

See [API setup and request examples](apps/api/docs/setup.md) for the complete contract. Connection guidance comes from [Supabase's Prisma guide](https://supabase.com/docs/guides/database/prisma); owner sign-in uses [Supabase email/password authentication](https://supabase.com/docs/guides/auth/passwords).

## Repository layout

```text
apps/
  web/                        Local Next.js dashboard
    src/app/                  Layout, starter page, and CSS
  api/                        Headless Next.js backend
    src/app/route.ts          JSON service-status endpoint
    src/app/api/graphql/      GraphQL Yoga route handler
    src/lib/                  Authentication, validation, storage, and API schema
    prisma/                   Prisma schema and reviewed-before-apply migration
    docs/setup.md             Backend setup and GraphQL examples
docs/plans/                   Saved implementation plan
package.json                  Workspace commands
package-lock.json             Shared dependency lockfile
```

## What the app will do

- Capture purchases through a personal Wallet transaction automation on your iPhone.
- Save each capture on the phone before uploading it, so failed requests can be retried later.
- Send transaction data as JSON to an authenticated GraphQL backend hosted on Vercel.
- Store purchases in Supabase Postgres, with Prisma managing the application schema and migrations.
- Let you sign in to a local mobile dashboard to review purchases and CAD spending totals by month.
- Let you correct captured purchases, add missing purchases manually, and exclude erroneous records from totals.
- Keep captures with missing amounts or currencies visible for correction, while excluding them from totals until complete.

Version one is for one owner and their in-person iPhone Apple Pay taps.

## How capture and retry will work

1. You tap a selected card in Apple Wallet, triggering a personal Shortcuts automation configured on your phone.
2. The Shortcut assigns an event ID and saves the capture as a JSON file in a dedicated folder under **On My iPhone**. It records the transaction details that Wallet makes available, such as merchant and amount, plus the capture time and configured source ID.
3. The Shortcut sends a GraphQL mutation to the hosted API using its upload-only secret.
4. The backend checks the credential and source ID, saves the capture through Prisma, and acknowledges the event ID. Replaying the same event must return an acknowledgement without creating another purchase or overwriting a correction.
5. The Shortcut deletes its saved file only after receiving a successful acknowledgement for that event. Network failures, authorization failures, or GraphQL errors leave the file available for a separate, manually run retry Shortcut.

The retry Shortcut will resend the original saved event IDs and payloads. This prevents duplicate records caused by retrying an upload; identifying separate captures of the same real-world purchase still requires review.

## Spending review

The review app will run on your computer and be accessible from your iPhone over home Wi-Fi. It will provide:

- Supabase email/password sign-in for the configured owner.
- A month selector, purchase list, CAD spending total, and counts of records needing review.
- Purchase details including merchant, amount, currency, purchase time, and whether the entry came from Apple Pay or manual input.
- Add and edit forms for missing or incorrect purchases.
- Exclusion and restoration of erroneous records without deleting the original capture.

CAD is the default for manual entries. Reporting periods use **America/Toronto**. Automatic captures with missing currency remain unknown until corrected. Other-currency captures will remain visible for review and stay outside CAD totals; version one will not perform currency conversion.

## Architecture and access

| Component | Planned responsibility |
| --- | --- |
| iPhone Shortcuts | Wallet automation, local pending files, authenticated upload, and manual retry |
| Vercel backend | Headless Next.js app with GraphQL Yoga route handlers; authentication, validation, and capture acknowledgement |
| Prisma | Application database schema, migrations, and server-side queries |
| Supabase Postgres | Persistent purchase storage with exact decimal amounts |
| Supabase Auth | Owner sign-in for reviewing and editing purchases |
| Local review app | Next.js mobile dashboard served from your computer; calls the owner-authenticated GraphQL API |

The hosted backend will be reachable away from home. Only `apps/api` is intended for the Vercel backend project; `apps/web` remains local so its review pages are separate from the hosted API's source and build.

The phone's credential can submit captures and receive acknowledgements; it cannot read or edit spending records. Its source ID labels the configured installation. Authentication verifies possession of the secret, rather than proving which physical phone sent a request.

Database credentials stay on the server. The dashboard and shared examples must not contain database passwords or the phone's upload secret. The web starter uses Next.js server components with ordinary CSS. Prisma stores immutable original captures separately from editable review fields; the API requires an owner token for all spending queries and corrections. POST requests accept JSON bodies up to 32 KiB and do not return internal database or authentication details.

## Capture scope and verification

[Apple documents a Wallet card-tap trigger](https://support.apple.com/en-euro/guide/shortcuts/apd65c67538a/ios) and [JSON API requests from Shortcuts](https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios). Available transaction fields, operation while the phone is locked, and local file permissions still need verification on the actual iPhone and card.

The tracker records what the automation reports. It cannot promise that every payment is captured or that a captured amount matches the final bank charge. Missing captures, cancelled payments, and later amount adjustments can be corrected manually.

Apple Watch purchases, online Apple Pay, other bank transactions, categories, budgets, charts, and bank reconciliation are outside version one.

## Implementation plan

See [the local implementation plan](docs/plans/2026-10-13-apple-pay-tracker.md) for the agreed design, delivery steps, and acceptance checks. Next: review the migration, configure the private API environment, then build the local dashboard's sign-in and spending screens.

Static review, Prisma schema validation, ESLint, TypeScript checks, and both production builds passed. The repository has no unit or integration test suites at this stage, as requested. Database connectivity, live authentication, and phone capture behavior remain unverified; static compilation does not establish that they work.

Dependency audit reports nine high advisories through the Prisma CLI and Next.js ESLint toolchain, with no fix inside the selected dependency ranges. The six API build-trace manifests reference none of the affected `mysql2`, `deepmerge-ts`, or `braces` packages, nor the Prisma CLI/config packages or web app source. This does not make the installed development toolchain vulnerability-free; no forced downgrade or override was applied.
