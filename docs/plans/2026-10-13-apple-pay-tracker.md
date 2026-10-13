# Apple Pay spending tracker implementation plan

Date: 2026-10-13

Status: Planning only. The owner requested a commit of this plan and the app README; application implementation is deferred for now.

## Goal and agreed scope

Capture this owner's in-person iPhone Apple Pay taps through a personal Shortcuts automation, save them in the existing dedicated Supabase project, and review spending through a mobile web app served from the owner's computer on home Wi-Fi.

- Project: `/Users/admin/GitHub/apple-pay`.
- Backend: a custom authenticated GraphQL API prepared for Vercel.
- Database: the dedicated Supabase Postgres project the owner has already created; Prisma owns the application's schema and migrations.
- Phone: save each capture locally before attempting an upload; provide a separate manually run retry Shortcut.
- Review: transaction list, CAD totals, corrections, and manual entries.
- Incomplete captures: retain missing values and expose them for correction; exclude them from spending totals until complete.
- Defaults: CAD for manual entries and America/Toronto for reporting periods. Do not infer an automatic capture's currency from the reporting default or perform currency conversion.
- Authentication: an upload-only Shortcut secret bound to a configured source ID; Supabase email/password sign-in for this owner to read and edit.
- A source ID identifies a configured installation. Possession of its secret authenticates a request; it does not attest to the physical phone.
- One owner in this release. Apple Watch, online Apple Pay, bank synchronization, categories, budgets, and charts are outside this release.

## Facts and constraints

- At the start of planning, the repository contained only a placeholder README. This documentation step adds the app description and plan; application code and local application conventions do not yet exist.
- [Apple documents the Wallet transaction trigger](https://support.apple.com/en-euro/guide/shortcuts/apd65c67538a/ios) for a selected card being tapped.
- [Apple documents JSON request bodies in Shortcuts](https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios). A GraphQL request is a JSON object containing the operation and its variables.
- Apple's trigger documentation does not define a complete transaction payload or guarantee delivery. Actual available properties, locked-phone behavior, local file permissions, and missed-trigger behavior require verification on the owner's iPhone.
- Capture records describe what the automation reported. They are not a bank settlement feed; manual corrections remain necessary for missing captures, cancelled payments, and adjusted amounts.
- [Supabase's Prisma guide](https://supabase.com/docs/guides/database/prisma) distinguishes runtime connections from migration connections and recommends disabling its Data API when Prisma is the only database API.
- Keep money exact in Postgres decimal fields and GraphQL decimal strings. No floating-point calculations for spending totals.
- No secrets in the repository, browser bundle, examples, or shared Shortcut exports. The browser may receive the public Supabase URL and publishable key only.

## Implementation shape

Use one small TypeScript project with GraphQL Yoga, Prisma's PostgreSQL adapter, and the Supabase authentication SDK. Use native HTTP and browser fetch APIs, simple HTML/CSS, and a small browser bundle. No React, Apollo client, background workers, native app, or additional service is needed for this scope.

The hosted artifact contains only the API. A separate local entry point serves the review app and the same GraphQL implementation; the local entry point and review assets are excluded from the Vercel deployment. Database credentials stay on the server. Bind the local server to a LAN interface only when the owner opts into phone access.

Runtime configuration includes the Supabase connection URL, a separate migration URL, Supabase URL/publishable key, allowed owner user ID, configured source ID, and a hash of the upload secret. Supply an environment template and credential-generation command; account secrets are configured privately after the files are reviewable.

## Task 1: exact, retry-safe capture storage

Files: `prisma/schema.prisma`, the initial checked-in migration, `prisma.config.ts`, and `src/transactions.ts`.

Produces: transaction storage with immutable capture identity and original input alongside editable review fields.

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

Files: `src/auth.ts`, `src/graphql.ts`, `api/graphql.ts`, `src/local.ts`, and configuration/build files.

Produces: one contract used by the capture/retry Shortcuts and the local review app.

- The Shortcut principal may only submit a capture and receive its acknowledgement. It cannot list, inspect, alter, or exclude purchases.
- Resolve the owner and source from trusted server configuration; reject mismatched source IDs. A client-supplied owner ID is never an authority.
- Verify dashboard access tokens with Supabase and restrict review operations to the configured owner.
- Owner operations list purchases, return CAD totals and review counts, create manual entries, and update/exclude existing entries.
- Bound list sizes, input lengths, and request size. Do not expose raw database or authentication errors to callers.
- Treat a GraphQL response with `errors` as a failed upload even if HTTP status is 200.
- Keep hosted dashboard routes absent and browser database credentials inaccessible.

Acceptance checks: no authentication, wrong/revoked upload secret, wrong source, unrelated Supabase user, and upload-secret attempts to read or edit are rejected; the allowed owner can review and correct their records.

## Task 3: private mobile spending review

Files: `web/index.html`, `web/styles.css`, `web/app.ts`, and local asset/build handling.

Consumes: owner-authenticated GraphQL queries and mutations.

Produces: a small responsive page for sign-in, a month selector, CAD total and review counts, a transaction list, and add/edit forms.

- Provide useful empty, loading, error, incomplete, and excluded states.
- Show merchant, amount/currency, purchase time, and capture/manual source.
- Mark unknown values clearly and permit correction without silently defaulting an automatic capture to CAD.
- Use accessible controls and an ordinary narrow-screen layout.
- Keep the owner session separate from the phone upload credential; the upload secret is never included in the dashboard.

Acceptance checks: sign-in, list and month selection, manual CAD purchase, missing-value correction, exclusion and restoration, sign-out, error feedback, and phone-width layout.

## Task 4: phone automation, retry guide, and deployment setup

Files: `docs/shortcuts.md`, request examples, `.env.example`, `vercel.json`, `.vercelignore`, and `README.md`.

- Document the actual GraphQL mutation, JSON variables, upload header, expected acknowledgement, and source/event IDs.
- Provide steps for assembling the capture Shortcut and attaching it to the Wallet automation on the owner's phone. Personal automation setup requires the owner's phone; no automatic installation is promised.
- Save one JSON file per event in a chosen folder under On My iPhone before making any network request. Avoid a single append-only queue that concurrent runs could overwrite.
- Delete that event's pending file only after a successful GraphQL acknowledgement matching its event ID. Retain files after network failures, authorization errors, malformed replies, or GraphQL errors.
- The retry Shortcut reads saved files and replays them unchanged. It may stop at a failed request; untouched files remain available for the next run.
- Describe the owner account setup, private environment configuration, migration application, local/LAN commands, and Vercel deployment steps.
- Update the README to reflect actual files and actual verification/deployment status.

Acceptance checks: one real phone tap persists and appears in review; an offline capture survives locally; retry creates one purchase and clears only the acknowledged file; repeat replay remains a single record; missing fields can be corrected.

## Integration, review, and execution

Execution: one main agent. The owner explicitly authorized the documentation commit. This plan does not itself authorize subagents, pushes, runtime checks, database changes, or deployment.

Routing: new-feature direction, using the personal workflow-router new-feature/shared-implementation playbooks. The repo-owned skill pool is empty. Personal methods selected so far are workflow-router, grill-me → grilling, and writing-plans; resolve implementation and platform methods before coding and record their canonical paths in the thread.

The current delivery is the plan and README commit. Resume application implementation when the owner requests it, carrying forward the agreed decisions and any remaining shared-design confirmation required by the invoked grilling method. Finish implementation and static engineering review before runtime verification.

The standing developer instruction requires human engineer confirmation before unit, integration, E2E, or automated browser checks. Prepare meaningful checks, but defer their execution until that confirmation. Compiler/type checks and static review do not establish runtime behavior. Database migrations and deployment also need real private environment configuration; do not claim a live service from generated configuration alone.

## Completion evidence

- [x] Local plan and README describe the proposed app and clearly identify its planning-only status.
- [ ] Shared understanding confirmed.
- [ ] Capture schema, migration, and replay rules implemented.
- [ ] Authenticated GraphQL API implemented.
- [ ] Local mobile review app implemented.
- [ ] Capture/retry instructions and examples match the API.
- [ ] Static engineering review complete and findings resolved.
- [ ] README reflects the delivered implementation and real setup/run commands.
- [ ] Human engineer confirmation for runtime checks received.
- [ ] Authorized runtime checks completed; results recorded.
- [ ] Dedicated Supabase credentials configured and migration applied.
- [ ] Hosted API deployed and phone workflow verified, when its environment and execution are authorized.
