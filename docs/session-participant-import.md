# Private SESSION participant import

Review-only change, based on Backend `92171c9`. No Site/plugin changes, deployment, live participant writes, Google Sheet writes, DB or storage migration.

## Reused components

`readSheetRows` (existing SESSION server Sheets connection, read-only scope), `parseSheetRows`, historical 001 header/deduplication policy, `mergeSync`, and Dropbox `participants.json` add/update-rev storage remain the source of truth. The connected ChatGPT Google account is a separate credential boundary: its OAuth token is not available to Render. This PR does not copy/replace it or introduce another OAuth flow. Render needs the already-supported SESSION Sheets service-account configuration below; an installed ChatGPT Google connection alone does not satisfy that requirement.

## Setup before any real import

Check `GET /api/session-director/participants-import-status` through the existing authenticated server/operator path. It returns only `hmacKeyReady`, `sheetsConfigured`, and `syncEnabled` booleans. It does not expose key lengths/values, tokens, account JSON, or applicants. A configured account is not proof of sheet access: preview tests access without writing participants.

- `SESSION_PARTICIPANT_HMAC_KEY`: existing stable secret, at least 32 characters. Never put it in source, browser code, command arguments, logs or PR text. Do not rotate it after importing: matching identities depend on it. An import key fingerprint detects subsequent rotation; legacy nonempty stores with no matching identity fail closed.
- `SESSION_GOOGLE_SERVICE_ACCOUNT_JSON`: existing supported SESSION-only service-account JSON. Sheets read scope is `spreadsheets.readonly`. Share the specified Sheet to that account as **viewer**; never make it public. ChatGPT Google connection credentials are not exported or reused implicitly.
- `SESSION_PARTICIPANTS_SYNC=on` enables preview/commit only when both checks above pass. This PR does not enable it or change any Secret.
- Existing `SESSION_WEB_SECRET`, signed short-lived operator actor, operator allowlist, Dropbox refresh flow, Site ID, plugin ID and `SESSION_MCP_WRITES` remain unchanged. Generic API, Basic or MCP credentials do not open the import REST routes. No import MCP tool is added.

The current Vercel proxy is documented as using a fixed web actor. It must not receive applicant details. All participant REST and ordinary MCP responses therefore return aggregate counts, version and an empty `people` placeholder (`detailsWithheld:true`). No names, Instagram handles, masked contacts, questions, HMAC matching keys or application answers are returned. The existing UI can show totals but cannot display individual applicants with this change. A separately authenticated private detail UI is outside this PR. Existing operations and internal private storage are preserved; this is an intentional privacy compatibility change for review.

## Preview then explicit commit

All requests use the existing server-side SESSION web authentication. Never embed its credentials in frontend code. `id` is the query parameter. For SESSION 001, the server pins source to Sheet `1NSI14aywxS6qQkeR61C5GzXI-L38MwbuH28jmRnQ0Oc`, tab `설문지 응답 시트1`, historical profile. The initial participants version is 0 (not the project version).

1. `POST /api/session-director/participants-import-preview?id=session-001` with `{ "version": 0 }` reads the source and returns `preview.counts` with `rawResponses`, `validApplicants`, `duplicateResponses`, `excludedResponses`, capacity, version, an opaque signed `previewToken` and expiry. It writes nothing, including on errors.
2. Review those four actual counts. The previously reported 18 responses are not an expected-count override. Counts are derived from the current sheet. No real Sheet was read during implementation/tests.
3. Only after separate approval to import, `POST /api/session-director/participants-import?id=session-001` with `{ "version": 0, "previewToken": "<returned token>" }`. Source may be omitted for 001; when supplied it must match the pinned source.
4. The backend validates token signature, actor, target, source, version, Dropbox rev and ten-minute expiry, then re-reads the Sheet and checks its keyed content digest. Changed source data requires a new preview. Writes use Dropbox CAS once, then exact readback; success includes `verified:true`, saved version, result and aggregate summary.
5. `GET /api/session-director/participants?id=session-001` or existing `getSessionParticipants` returns aggregate counts/version for independent verification. No import/commit retry is automatic. On a lost reply or readback failure, read current state before deciding what happened.

The old `participants-sync` URL now aliases the guarded commit and requires the same preview token. A legacy client sending only a version must upgrade to preview first. Legacy internal sync helpers are not exposed by REST/MCP import routes.

For other sessions, source must match the configured sheet, standard profile and explicit tab. Qualified legacy ranges like `'Responses'!A:H` normalize to `'Responses'!A1:H10002`; previously unqualified ranges require an explicit tab. Test sessions may use a synthetic source with `profile:"session-001"` to exercise the historical policy. Bounded reads include a sentinel row; over 10,000 response rows, malformed/empty data or changed/duplicate headers are refused rather than silently importing partial data or marking everybody removed.

## Data behavior

- Historical 001 uses exact phone + normalized Instagram identity; additional responses and source row references remain in the private document. Same phone with a different Instagram identity follows existing duplicate flags. No response row is deleted from Google.
- All new people are `applied`, notices `none`, check-in null. Attendance/filming/interview answers do not confirm attendance or invent privacy consent. Capacity is preserved (15 for 001); importing 18 applications does not fill/confirm 15 seats automatically.
- Resync replaces response content while preserving IDs, confirmed/waitlisted/cancelled states, notice, memo and check-in. Missing rows are flagged by existing mergeSync, never deleted. Empty imports are rejected.
- Raw phone/email columns are read only into server memory: the existing parser persists masked contact + keyed matching fields only. Other application details live only in the existing private Dropbox participant file, not session.json, its snapshots, logs, browser output or MCP responses. Free-text answers are private records and must not be published.
- Preview/commit errors use controlled codes and omit Google response bodies, dynamic header text and application content. New code does not log request bodies, sheet data, tokens or imported records. Infrastructure/proxy request-body logging must also remain disabled.

## Verification

Run `node --test test/session*.test.mjs`. All new import tests use `test-session-908`, synthetic rows and in-memory Dropbox/Sheets. They cover 18 applied rows, duplicates/exclusions, no preview writes, ops preservation, stale versions/rows/revs, expiry/tampering/cross-actor reuse, key changes, strict historical headers, readback/ambiguous write failures, auth, old URL bypass prevention and aggregate-only REST/MCP output. No real participants are test fixtures.

Before an actual import: review/merge PR, deploy Backend separately, confirm the three readiness flags and Sheet viewer access, run a no-write preview, review actual counts and approve the commit. Do not create another Site/plugin or redeploy the unchanged Site for these backend-only routes.
