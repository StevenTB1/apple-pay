# Apple Pay spending tracker implementation plan

Date: 2026-10-13

Status: Next.js scaffold created; storage and authenticated GraphQL implementation prepared. Initial migration saved for review only, without applying it to Supabase. The user selected static-only review at this stage; no unit or integration suites are maintained. The dashboard, phone Shortcuts, and deployment remain pending.

## Goal and agreed scope

Capture this owner's in-person iPhone Apple Pay taps through a personal Shortcuts automation, save them in the existing dedicated Supabase project, and review spending through a mobile web app served from the owner's computer on home Wi-Fi.

- Project: `/Users/admin/GitHub/apple-pay`.
- Backend: a custom authenticated GraphQL API in a headless Next.js app, prepared for Vercel.
- Database: the dedicated Supabase Postgres project the owner has already created; Prisma owns the application's schema and migrations.
- Phone: save each capture locally before attempting an upload; provide a separate manually run retry Shortcut.
- Review: transaction list, CAD totals, corrections, and manual entries.
- Incomplete captures: retain missing values and expose them for correction; exclude them from spending totals until complete.
- Defaults: CAD for manual entries and America/Toronto for reporting periods. Do not infer an automatic capture's currency from the reporting default or perform currency conversion.
- Authentication: an upload-only Shortcut secret bound to a configured source ID; Supabase email/password sign-in for this owner to read and edit.
- A source ID identifies a configured installation. Possession of its secret authenticates a request; it does not attest to the physical phone.
- One owner in this release. Apple Watch, online Apple Pay, bank synchronization, categories, budgets, and charts are outside this release.

## Facts and constraints

- At the start of planning, the repository contained only a placeholder README. The owner subsequently requested Next.js scaffolding, superseding the earlier plain-HTML/standalone-Node implementation choice while preserving the business requirements.
- [Apple documents the Wallet transaction trigger](https://support.apple.com/en-euro/guide/shortcuts/apd65c67538a/ios) for a selected card being tapped.
- [Apple documents JSON request bodies in Shortcuts](https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios). A GraphQL request is a JSON object containing the operation and its variables.
- Apple's trigger documentation does not define a complete transaction payload or guarantee delivery. Actual available properties, locked-phone behavior, local file permissions, and missed-trigger behavior require verification on the owner's iPhone.
- Capture records describe what the automation reported. They are not a bank settlement feed; manual corrections remain necessary for missing captures, cancelled payments, and adjusted amounts.
- [Supabase's Prisma guide](https://supabase.com/docs/guides/database/prisma) distinguishes runtime connections from migration connections and recommends disabling its Data API when Prisma is the only database API.
- Keep money exact in Postgres decimal fields and GraphQL decimal strings. No floating-point calculations for spending totals.
- No secrets in the repository, browser bundle, examples, or shared Shortcut exports. The browser may receive the public Supabase URL and publishable key only.

## Implementation shape

Use two TypeScript Next.js App Router applications in native npm workspaces, with a single root dependency lockfile:

- `apps/web`: the local mobile review app, using server components and ordinary CSS by default.
- `apps/api`: a headless Next.js backend using GraphQL Yoga route handlers, Prisma's PostgreSQL adapter, and the Supabase authentication SDK.

The scaffold uses the official Next.js 16.4.0 templates, TypeScript, and ESLint. The web page presents an honest empty setup state. The API's root and `Query.status` expose public service status without checking database connectivity. Purchase operations are now implemented with explicit upload/owner scopes; no personal records are public.

Only `apps/api` is intended for the hosted Vercel backend project. Keep the review pages and assets in `apps/web`, outside the backend app. The review app will call the owner-authenticated API over GraphQL. Database credentials stay on the API server. Local development binds to loopback by default; an explicit LAN command enables phone access.

Runtime configuration includes the Supabase connection URL, separate migration URL, Supabase URL/publishable key, allowed owner user ID, configured source ID, and a hash of the upload secret. Per-app environment templates exist. Use ignored `apps/api/.env.local` locally and Vercel environment settings when deploying; Infisical is deferred for this personal app. The API starts and compiles without configured credentials, but protected operations require them and an applied migration. `npm run shortcut:token` prepares a private ignored credential file. Next.js loads `.env.local` from each app's own directory.

## Scaffold milestone

Files: root `package.json`, `package-lock.json`, `.gitignore`, `.nvmrc`, and each app's package/configuration files and `src/app` routes.

- One root install covers both applications. No separate worktrees or nested Git repositories are needed.
- Root commands: `npm run dev`, `npm run dev:api`, `npm run dev:lan`, `npm run lint`, `npm run typecheck`, and `npm run build`.
- Web and API use ports 3000 and 3001 respectively. Configure the exact computer hostname/IP through `DEV_ORIGIN_HOST` when using the web app over home Wi-Fi.
- No mocked purchases, account access, database writes, or deployed service are implied by the scaffold.

Acceptance checks: dependency installation, static source review, ESLint, generated route types/TypeScript checks, and both production builds. Development-server, HTTP/GraphQL, and browser smoke checks remain behind the existing human confirmation gate.

## Task 1: exact, retry-safe capture storage

Files: `apps/api/prisma/schema.prisma`, the initial checked-in migration, `apps/api/prisma.config.ts`, and `apps/api/src/lib/transactions.ts`.

Produces: transaction storage with immutable capture identity and original input alongside editable review fields.

Implementation prepared: Prisma 7.10 client/configuration, PostgreSQL adapter, schema, checked-in initial SQL, canonical validation, capture/replay handling, exact CAD summary, manual entries, and row-locked corrections. The migration adds checks for money/capture shape, an immutable-metadata trigger, and RLS without client policies. It has not been applied or validated against a database. The runtime database role must own the tracker tables or bypass RLS.

- Generate a stable event ID on the phone before saving the pending file. Replay that same ID and input on every retry.
- Enforce uniqueness in Postgres, so concurrent retries cannot create additional purchases.
- A repeated event with the same original input acknowledges the existing record. Reuse of the event ID with different input fails explicitly.
- Editing a saved purchase must not change its original capture identity. A later retry must not overwrite a correction.
- Preserve unknown amount or currency as unknown; keep original amount text when available rather than guessing from an ambiguous currency symbol or locale.
- Report CAD totals only from complete, included CAD records. Show incomplete and other-currency captures for review without folding them into CAD totals.
- Allow the owner to exclude an erroneous record from totals without destroying the original capture.
- Record both capture time and server receipt time. Corrections may adjust the purchase date without rewriting the original capture.

Acceptance checks: exact decimal totals; missing fields excluded; duplicate and concurrent replay produce one record; changed-payload replay rejected; edits survive replay; reporting periods follow Toronto month boundaries including daylight saving time.

## Task 2: authenticated GraphQL operations

Files: `apps/api/src/lib/auth.ts`, `apps/api/src/lib/graphql.ts`, the existing `apps/api/src/app/api/graphql/route.ts`, and API configuration files.

Produces: one contract used by the capture/retry Shortcuts and the local review app.

Implementation prepared: scoped GraphQL resolvers, hashed upload credential, Supabase `getUser` verification restricted to the configured owner, generic unexpected-error responses, bounded list sizes, and an actual 32 KiB JSON request-stream limit. Setup and payload examples live in `apps/api/docs/setup.md`. Scope/error/request handling has been reviewed statically; live owner-token verification still requires Supabase configuration and runtime verification.

- The Shortcut principal may only submit a capture and receive its acknowledgement. It cannot list, inspect, alter, or exclude purchases.
- Resolve the owner and source from trusted server configuration; reject mismatched source IDs. A client-supplied owner ID is never an authority.
- Verify dashboard access tokens with Supabase and restrict review operations to the configured owner.
- Owner operations list purchases, return CAD totals and review counts, create manual entries, and update/exclude existing entries.
- Bound list sizes, input lengths, and request size. Do not expose raw database or authentication errors to callers.
- Treat a GraphQL response with `errors` as a failed upload even if HTTP status is 200.
- Keep hosted dashboard routes absent and browser database credentials inaccessible.

Acceptance checks: no authentication, wrong/revoked upload secret, wrong source, unrelated Supabase user, and upload-secret attempts to read or edit are rejected; the allowed owner can review and correct their records.

## Task 3: private mobile spending review

Files: `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`, and sign-in/editing components when their features are implemented.

Consumes: owner-authenticated GraphQL queries and mutations.

Produces: a small responsive page for sign-in, a month selector, CAD total and review counts, a transaction list, and add/edit forms.

- Provide useful empty, loading, error, incomplete, and excluded states.
- Show merchant, amount/currency, purchase time, and capture/manual source.
- Mark unknown values clearly and permit correction without silently defaulting an automatic capture to CAD.
- Use accessible controls and an ordinary narrow-screen layout.
- Keep the owner session separate from the phone upload credential; the upload secret is never included in the dashboard.

Acceptance checks: sign-in, list and month selection, manual CAD purchase, missing-value correction, exclusion and restoration, sign-out, error feedback, and phone-width layout.

## Task 4: phone automation, retry guide, and deployment setup

Files: `docs/shortcuts.md`, request examples, the per-app `.env.example` files, and `README.md`. Configure the Vercel project's root as `apps/api`; add deployment configuration only when the native Next.js defaults need an override.

- Document the actual GraphQL mutation, JSON variables, upload header, expected acknowledgement, and source/event IDs.
- Provide steps for assembling the capture Shortcut and attaching it to the Wallet automation on the owner's phone. Personal automation setup requires the owner's phone; no automatic installation is promised.
- Save one JSON file per event in a chosen folder under On My iPhone before making any network request. Avoid a single append-only queue that concurrent runs could overwrite.
- Delete that event's pending file only after a successful GraphQL acknowledgement matching its event ID. Retain files after network failures, authorization errors, malformed replies, or GraphQL errors.
- The retry Shortcut reads saved files and replays them unchanged. It may stop at a failed request; untouched files remain available for the next run.
- Describe the owner account setup, private environment configuration, migration application, local/LAN commands, and Vercel deployment steps.
- Update the README to reflect actual files and actual verification/deployment status.

Acceptance checks: one real phone tap persists and appears in review; an offline capture survives locally; retry creates one purchase and clears only the acknowledged file; repeat replay remains a single record; missing fields can be corrected.

## Integration, review, and execution

Execution: the user authorized next-step implementation and parallel agents for setup. Two agents handled dependency/client setup and focused static review; the main agent owns business behavior and integration. The user subsequently declined premature test scaffolding and requested static-only review. The prepared suites and their commands were removed without running them. The documentation commit and push were previously requested and completed. No new commit, push, deployment, or database write is part of this step. The user selected **prepare the migration for review**, so applying it remains deferred.

Routing: new-feature direction, using the retained personal workflow-router new-feature/shared-implementation playbooks. The repo-owned skill pool is empty. The implementation uses personal feature-development, authorized subagent-driven-development, Ponytail's minimal setup, and workflow-quality for main-agent assessment. The thread retains selected canonical paths, explicit file ownership, and the bounded storage/API contract.

The current delivery is the storage/API source, prepared migration, static review, and updated documentation. Later milestones retain the agreed capture, privacy, authentication, and CAD rules. The acceptance checks above describe eventual working-app behavior, not executed tests or a requirement to add suites now.

Current verification is static-only, as explicitly requested: source review, Prisma schema validation, lint, TypeScript, and production compilation. Runtime verification is deferred until the working app and separately authorized scope exist. Compiler/type checks and static review do not establish runtime behavior. Database migrations and deployment also need real private environment configuration; do not claim a live service from generated configuration alone.

## Completion evidence

- [x] Local plan and README describe the proposed app and distinguish starter code from pending functionality.
- [x] Next.js scaffold requested; the framework choice supersedes the earlier plain-HTML implementation choice.
- [x] Separate web and API apps created in npm workspaces with shared setup/check commands.
- [x] Scaffold static review, ESLint, TypeScript checks, and both production builds completed. Runtime/browser smoke checks remain deferred.
- [x] Capture schema, migration, and replay rules implemented; migration remains unapplied and behavior unverified.
- [x] Authenticated GraphQL API implemented; live Supabase verification remains pending.
- [ ] Local mobile review app implemented.
- [x] Backend setup and JSON/GraphQL examples saved in `apps/api/docs/setup.md`.
- [ ] Full phone capture/retry assembly guide and real device verification completed.
- [x] Backend static engineering review complete; concurrent-correction and Yoga context findings resolved.
- [x] README reflects the delivered implementation and real setup/run commands.
- [x] Static-only verification selected; premature unit/integration suites and commands removed without execution.
- [ ] Working-app runtime verification authorized and completed at a later milestone.
- [ ] Dedicated Supabase credentials configured and migration applied.
- [ ] Hosted API deployed and phone workflow verified, when its environment and execution are authorized.

## Backend static evidence and remaining limits

`npm run prisma:validate`, `npm run lint`, `npm run typecheck`, and `npm run build` passed. The Prisma client generated successfully without connecting to the database. Source review checked owner/upload separation, unique capture replay, row-locked corrections, exact CAD aggregation, bounded JSON requests, and migration constraints/immutability/RLS. The test suites were removed at the user's request; no behavioral checks have run.

Six API build traces reference no `apps/web` source, Prisma CLI/config, `mysql2`, `deepmerge-ts`, or `braces` package files. The original web source/configuration is unchanged; Next.js refreshed its ignored generated type declaration during compilation. Dependency audit still reports nine high advisories through the Prisma CLI and Next.js ESLint toolchain, with no in-range fixes. Development dependencies remain affected; no forced downgrade or unverified override was used.

Private API environment values have been supplied locally, but connectivity and authentication are unverified. `DATABASE_URL` still needs a PostgreSQL connection string rather than its current non-PostgreSQL URL, and `SHORTCUT_TOKEN_SHA256` is missing. Locally, both database variables can use the supplied direct PostgreSQL connection. The migration remains prepared only, as requested. No new commit, push, deployment, HTTP/DB check, or database write has been performed.
