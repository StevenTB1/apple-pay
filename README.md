# Apple Pay spending tracker

A private personal spending tracker designed to record in-person Apple Pay purchases made with your iPhone and help you review spending from a mobile web app on home Wi-Fi.

**Current status: planning only.** This repository contains the app description and implementation plan. Application code, phone Shortcuts, and deployment have not been implemented or verified. A dedicated Supabase project has already been created; connecting it to the app is future work.

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
| Vercel backend | Custom TypeScript GraphQL API using GraphQL Yoga; authentication, validation, and capture acknowledgement |
| Prisma | Application database schema, migrations, and server-side queries |
| Supabase Postgres | Persistent purchase storage with exact decimal amounts |
| Supabase Auth | Owner sign-in for reviewing and editing purchases |
| Local review server | Mobile dashboard and owner-authenticated GraphQL operations, served from your computer |

The hosted backend will be reachable away from home. The review app will be served locally and excluded from the hosted deployment.

The phone's credential can submit captures and receive acknowledgements; it cannot read or edit spending records. Its source ID labels the configured installation. Authentication verifies possession of the secret, rather than proving which physical phone sent a request.

Database credentials stay on the server. The dashboard and shared examples must not contain database passwords or the phone's upload secret. The planned implementation uses a small TypeScript project, native HTTP/browser APIs, and simple HTML/CSS.

## Capture scope and verification

[Apple documents a Wallet card-tap trigger](https://support.apple.com/en-euro/guide/shortcuts/apd65c67538a/ios) and [JSON API requests from Shortcuts](https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios). Available transaction fields, operation while the phone is locked, and local file permissions still need verification on the actual iPhone and card.

The tracker records what the automation reports. It cannot promise that every payment is captured or that a captured amount matches the final bank charge. Missing captures, cancelled payments, and later amount adjustments can be corrected manually.

Apple Watch purchases, online Apple Pay, other bank transactions, categories, budgets, charts, and bank reconciliation are outside version one.

## Implementation plan

See [the local implementation plan](docs/plans/2026-10-13-apple-pay-tracker.md) for the agreed design, proposed files, delivery steps, and acceptance checks. Implementation is deferred for now; there are no app setup or run commands yet.
