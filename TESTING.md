# Pilot test checklist

Use two or more eligible test accounts and a separate operator account.

## Authentication

- A valid `@iiti.ac.in` Workspace account can sign in after both consent checkboxes are selected.
- A personal Gmail account is rejected by the backend.
- A token created for a different OAuth client ID is rejected.
- A signed-in browser can refresh during the same tab session and restore the app.
- Closing the tab clears `sessionStorage`; the next tab requires sign-in.

## Profile and privacy

- Profile save rejects fewer than three interests and short/incomplete required fields.
- Institute email is never displayed on another student's discovery card.
- Turning discovery off removes the profile from new discovery results.
- Google profile photo works.
- Custom upload stays disabled unless the operator intentionally enables link-accessible Drive uploads.

## Swipe and match

- A pass is recorded and the same profile is not served again.
- A one-way like does not create a match.
- A reverse like creates exactly one deterministic match.
- A user cannot swipe on themselves or an unavailable/blocked profile.

## Chat

- Only members of an active match can read or send messages.
- Messages appear after polling and are capped at 1,000 characters.
- Blocking disables the match and hides it from both users' normal interaction flow.
- The UI always says that chats are not end-to-end encrypted.

## Safety and deletion

- Reports create an `OPEN` row in `REPORTS`.
- Blocking creates an active row in `BLOCKS` and disables the match.
- Account deletion anonymizes profile fields, hides discovery, and revokes active sessions.
- Operators can follow the documented escalation and access-control process.

## Sharding

For a safe test, temporarily change `MAX_ROWS_PER_SHARD` in Script Properties to `5`:

1. Create more than five swipe events and confirm `SWIPES_0002` is created.
2. Create more than five messages and confirm `CHAT_0002` is created.
3. Confirm the `SHARDS` rows accurately record spreadsheet ID, tab, sequence, row count, and status.
4. Restore the intended value, normally `40000`, after testing.
