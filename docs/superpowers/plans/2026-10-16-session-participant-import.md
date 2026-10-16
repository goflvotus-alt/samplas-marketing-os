# SESSION participant import implementation plan

Goal: add a private preview/commit path using the existing Sheets reader, historical 001 parser, mergeSync and participants.json CAS storage. No live data changes or deployments in this PR.

- [x] Add synthetic test-session coverage: 18 applications stay applied with capacity 15, legacy duplicate/exclusion counts, ops preserved, preview no writes.
- [x] Add server-only import service: readiness booleans; exact source profile for SESSION 001; short-lived HMAC preview bound to actor, target, source, participants version/rev and sheet content; commit re-reads Sheets and CAS-saves once then verifies.
- [x] Wire authenticated REST readiness/preview/commit routes. Keep existing auth and paths. Reject caller-supplied rows. Keep raw rows and application details out of responses/errors/logs.
- [x] Make standard MCP participant output count-only before imported data is present; keep eight tools, names and auth.
- [x] Verify stale versions, sheet/source changes, tampering, cross-user reuse, expiry, disabled config, malformed input, readback failure, ambiguous writes and concurrent CAS conflicts.
- [x] Run all SESSION regression tests, inspect diff/privacy, document setup and usage, create draft PR on isolated branch. Never merge/deploy/import live sessions.

Review focus: empty/truncated sheets; changing HMAC key; conflicting writes; untrusted source selectors; errors containing response data.
