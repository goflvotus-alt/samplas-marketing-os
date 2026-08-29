# Production ECOUNT XLSX Direct Import — BATCH 15

## A. Baseline

- Repository: `/Users/binggu/Dropbox/SAMPLAS WORK/INTELLIGENCE/SAMPLAS Marketing OS DEV`
- Branch: `main`
- Starting HEAD / `origin/main`: `b3256f0`
- Ahead/behind: `0/0`
- Staged/tracked modified: `0/0`
- Unrelated untracked files: 142, preserved.

## B. Unauthorized root cause

The browser posted the raw XLSX to `POST /api/ecount-sales/import` with only
`X-Ecount-File-Name`. The route allowed an existing internal authorization or
a localhost request. Local therefore passed through `isLocalRequest()`, while
Render rejected the request with 401 before XLSX parsing because the browser
had neither the server-side internal token nor Basic authorization. This was
an intentional local/internal-only write guard, not an importer failure.

## C. Auth and security design

- Existing operational Basic/internal authorization remains the root of trust.
- `POST /api/operator/session` validates it and returns only an opaque random
  session in an `HttpOnly; SameSite=Strict; Secure` Production cookie (8-hour
  maximum lifetime).
- Import accepts localhost, existing internal authorization, or a valid
  operator session from the exact same origin.
- Secrets are entered at runtime, are not embedded or persisted by frontend
  source, and are never returned by the server.
- Unauthorized requests receive an actionable Korean message.
- Existing 30 MB limit, `.xlsx`/filename-month validation and raw-body handling
  remain in force; the endpoint is not a generic file writer.

## D. Import architecture

The route writes the body to a temporary XLSX and calls the existing
`refreshMonthlySales()` → `importEcountOfflineSalesSnapshot()` path. Production
uploads force a real parse even when a prior snapshot appears fresh. The
canonical parser preserves exclusions/dedupe, TAXFREE/QQQ and legacy behavior.

For 2026-08 and later, canonical warehouse routing maps `매장` to APGUJEONG and
`SAMPLAS Veil` to VAIL. Blank or unknown warehouses abort before mutation.
2026-07 and earlier retain the store-header contract. Filename month and parsed
content month must match.

## E. Atomicity and failure safety

Both store snapshots are built and validated before commit. Existing
`writeJsonSetAtomic()` prepares both temporary files, renames the pair, and
restores previous bytes if the second commit fails. The last complete pair
survives parse, validation or write failure. No permanent backup junk was added.

Render writes the canonical persistent `WORK_DIR` at
`/var/data/samplas-dashboard/work`. Readers load snapshots per request, so no
restart or cache invalidation layer is needed.

## F. UI update

The modal now says one XLSX is warehouse-routed and applied immediately to the
current operating environment. Local-only/separate Render-sync wording was
removed. A 401 prompts for operator credentials, creates the protected session,
and retries once. Success shows month, stores, totals and `importedAt` from the
structured response.

## G. Tests

- Focused importer, warehouse, policy, adversarial, auth/UI and parity tests:
  PASS.
- Full suite: 829 total / 827 pass / 2 known failures / 0 new failures.
- Known failures remain the offline-total and Today Overview fixtures.
- A focused parity regression test confirms separate Local/Production
  `importedAt` values do not hide source-identity drift.

## H. Local E2E

An isolated temp `WORK_DIR` imported the real `2026-08.xlsx`:

- APGUJEONG: 1,007 rows / 206,752,900 KRW
- VAIL: 134 rows / 16,575,200 KRW
- Combined: 1,141 rows / 223,328,100 KRW
- Period: 2026-08-01 through 2026-08-28
- Snapshot: PASS; archive: SKIP (current month)

The same file then passed the canonical Local endpoint, confirming Local
compatibility and downstream parity.

## I. Git and deployment

- Implementation: `5038c4e` — `feat(ecount): enable protected Production XLSX import`
- Only BATCH 15 code/tests were staged in the implementation commit.
- Normal `origin/main` push deployed the code; no force push or unrelated
  snapshot upload was used.

## J. Production direct-upload acceptance

After Render served the deployed bundle, the exact Production import endpoint
received the real August XLSX using existing operational authorization. It
returned HTTP 200 and persisted:

- APGUJEONG: 1,007 rows / 206,752,900 KRW
- VAIL: 134 rows / 16,575,200 KRW
- Combined: 1,141 rows / 223,328,100 KRW
- Period: 2026-08-01 through 2026-08-28
- `importedAt`: `2026-08-28T10:05:45.954Z`
- Snapshot: PASS; archive: SKIP (current month)

An unauthenticated Production request was rejected with HTTP 401 before parsing.
The acceptance upload was idempotent in business data.

## K. Downstream reconciliation

Fresh Production reads saw the data without restart. Final parity:

- Monthly current total: 257,710,398 KRW
- Annual 2026-01 through 2026-08: 2,201,350,209 KRW
- Clients: 110 clients / 473 orders
- ECOUNT offline: APGUJEONG + VAIL = 223,328,100 KRW
- Store Master: APGUJEONG and VAIL resolve identically
- Inventory: summary/coverage/brand rollup match; 246 brands
- Today, historical monthly, registries and Price Audit also match.

## L. Production verification

Final `npm run verify:production` result: 13/13 PASS,
`PRODUCTION BASELINE HEALTHY`.

## M. Operating workflow after BATCH 15

The canonical workflow is:

`Render Monthly Sales UI → authorize operator → upload XLSX → validate and route → atomic Production snapshots → immediate downstream reads`

Local remains development/validation. Manual snapshot upload is reserved for
explicitly approved recovery or historical correction.

## N. Scope

No unrelated Meta, Naver, Cafe24, Instagram, OAuth, Product Matching, canonical
data, snapshot or repository changes were made. Existing untracked files were
preserved.

## O. Final state

Production direct import, warehouse hard gates, atomic pair commit, legacy
compatibility, Local compatibility, immediate readers and parity are verified.

## P. Verdict

`PRODUCTION ECOUNT DIRECT IMPORT — VERIFIED`
