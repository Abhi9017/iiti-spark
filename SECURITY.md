# Security model and limitations

## What this pilot does

- Uses the official Google Identity Services browser button.
- Sends the Google ID token to the Apps Script backend over HTTPS.
- Checks token audience, issuer, expiry, verified email, signed hosted-domain claim, and `@iiti.ac.in` suffix.
- Uses Google's immutable `sub` claim as the user identifier.
- Generates an application session token and stores only its SHA-256 hash.
- Keeps the raw session token in browser `sessionStorage`, not a spreadsheet.
- Uses a sandboxed Apps Script bridge iframe restricted to configured parent origins.
- Uses server-side authorization for discovery, matches, messages, blocks, and reports.
- Uses output-safe DOM APIs for user-generated profile/message text.
- Applies basic request rate limits and script locks.

## What this pilot does not do

- **No end-to-end encryption.** Spreadsheet administrators can access messages.
- No HttpOnly same-site authentication cookie; a browser bearer token is used.
- No production-grade media authorization; optional Drive uploads are link-accessible.
- No device binding, MFA enforcement, formal penetration test, DLP, SIEM, malware scanning, or automated content moderation.
- No guaranteed real-time delivery; chat uses polling.
- No scalable indexed database queries; some lookups scan Sheets rows.
- No verified student enrolment status beyond an active Workspace-domain token.

## Google token verification limitation

Apps Script has no first-party Google Auth Library for locally verifying the ID-token RSA signature. The pilot calls Google's `tokeninfo` endpoint and then validates audience/domain claims. Google documents `tokeninfo` as useful for debugging and warns that it can be throttled and is not the recommended production verifier.

For a public launch, move authentication to Cloud Run, Cloud Functions, Firebase Functions, or another supported server runtime and use the official Google Auth Library to verify tokens locally. Issue a Secure, HttpOnly, SameSite cookie from the same site/backend origin.

## Recommended production migration

- Frontend: static hosting or a standard web framework.
- Identity: Google Identity Services + official server-side ID-token verification.
- Database: Firestore, PostgreSQL, or another access-controlled database.
- Chat: authorized real-time database/channel with abuse throttling.
- Media: private object storage with validated uploads and signed URLs.
- Secrets: managed secret store, never client JavaScript.
- Audit: immutable access logs and moderator-action history.
- Privacy: documented retention, export, deletion, breach response, and lawful-disclosure procedures.
- Safety: trained moderators, response SLAs, appeals, emergency escalation, repeat-offender controls, and clear contact channels.

## False security claims

Never display “end-to-end encrypted,” a lock badge implying E2EE, or similar wording unless messages are encrypted on the sender's device with keys unavailable to the server/operator and independently reviewed. HTTPS and Google Workspace encryption at rest are not end-to-end encryption.
