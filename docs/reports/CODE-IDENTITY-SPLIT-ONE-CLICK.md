# Code Identity Split — One-Click Operational Automation (Phase 3B)

Date: 2026-10-07
Branch: `feat/split-one-click`. Commit `1a75853` on top of origin/main `ebed7fa`.
Status: **not pushed**. Nothing was written to Production. UNDER THE SIGN and PRAYING were not executed.

## Problem
Each split needed the operator to work in the Render Dashboard:
1. set `CODE_IDENTITY_SPLIT_WRITE=on`
2. Save and Deploy, then wait for the restart
3. execute the split through internal API calls run from the terminal
4. set `off`, then Save and Deploy again

That is two restarts per brand. Once (PERSONSOUL) the first "on" was never applied.

## New model
In Marketing OS: Dry Run → safety checks → execution token → 분리 실행 (one request) → server does everything → COMPLETE, or rollback.

## Kill switch
`CODE_IDENTITY_SPLIT_WRITE` keeps its name (option A). It is now a global emergency kill switch: set it `on` once and leave it. With `off`:
- execution is refused with 403 `SPLIT_WRITE_DISABLED`
- the maintenance routes (restore, archive rebuild) are refused too
- dry-runs still work and report `writeEnabled:false`

## Authorization
- `POST /api/pending-brands/split/dry-run` and `/split/execute` accept `isAuthorizedOperatorAction`: local, internal token, or a same-origin operator session. The operator session is the cookie from `/api/operator/session`, the same one the ECOUNT upload already uses; the UI asks for it on 401.
- The review route still dry-runs SPLIT but refuses `dryRun:false` with `SPLIT_TOKEN_REQUIRED`. The old untokened write path is gone.
- MCP is unchanged: GET-only allowlist with no split, review, restore or rebuild path (asserted in tests).

## Execution token
- Issued only when **all** of these hold:
  - status PLANNED
  - candidate PENDING / CODE_REUSE_SPLIT_REQUIRED / requiresIdentitySplit
  - classification MINTED_CODE_COLLISION
  - effective month present
  - every month preserved and balanced
  - each saved affected archive reproduces exactly (consistency rebuild, 0 changes)
  - the policy preview moves every old explicit row to the SPL identity
- 48-hex random nonce. The data it is bound to stays server-side in memory:
  - candidateId
  - version
  - owner and owner code
  - current Cafe24 brand
  - code
  - classification
  - effective month
  - sha256 of the reviewed dry-run (identities, diff, attribution)
- Lifetime rules:
  - TTL 10 min
  - single use: marked used before any work starts
  - valid only for its own candidate
  - invalid if the version or the dry-run hash changes
- A restart clears outstanding tokens; the operator runs the dry-run again.

## One-click flow (`createIdentitySplitRunner().execute`)
Stages:
1. `token`
2. `revalidate`: fresh dry-run plus checks; version and binding must match
3. `split`: SPLIT_CODE_IDENTITY non-dry; creates the automatic backup; a failed sourcing rebuild also counts as a failure
4. `verify`: read-back of Brand Master (both identities), policy (no row left on the code; moved rows on SPL), resolver (both names resolve to the right codes) and pending (APPROVED)
5. `archive`: for each ARCHIVE_REBUILD month, a dry-run, then a write; the saved rows must equal the preview's old/new totals
6. `final`: read-back again

Returns `COMPLETE` with the backupId and per-month amounts. Runs never overlap (`SPLIT_BUSY`).

## Rollback
- Any failure after the backup triggers `restoreIdentitySplitBackup`, a byte-exact restore including the archives. The candidate stays PENDING.
- The response gives `{stage, error, message, backupId, rolledBack}`.
- A failed restore is reported as `ROLLBACK_FAILED`.
- A write error inside the split now carries the backup, so even a partial atomic write is reverted.

## UI
- The Dry Run panel shows:
  - old and new brand, code, effective month
  - old policy move, new fallback (explicit none → SOURCING_DEFAULT with sourcing type), registry moves
  - per-month before/after, UNASSIGNED recovery, preserved/balanced
  - archive reproduction, the automatic backup notice, and token expiry
- 분리 실행 is enabled only when the dry-run is eligible and the kill switch is on.
- After 분리 실행: confirm → one request → result or failure stage, with rollback status.
- REVIEW_REQUIRED and CAFE24_CODE_REUSED show "수동 검토 필요 (원클릭 실행 불가)".

## Batch reuse
`runBatch([{id, token}])` is sequential and uses one token and one backup per candidate. It stops at the first failure.

## Automation levels
| Case | Handling |
|---|---|
| Ordinary NEW | Automatic, unchanged |
| MINTED_CODE_COLLISION | Detected automatically; Dry Run, then 분리 실행 |
| REVIEW_REQUIRED / CAFE24_CODE_REUSED | No token; manual review |
| ALIAS_CONFLICT / COLLABORATION | Manual, unchanged |

## Tests
- New `test/code-identity-split-runner.test.mjs`, 13 tests:
  - PERSONSOUL fixture and UNDER THE SIGN fixture (UNASSIGNED recovery), each a full one-click run
  - kill switch off
  - missing, invalid, wrong-candidate, expired and reused tokens
  - version change
  - dry-run result change
  - eligibility: REVIEW_REQUIRED, CAFE24_CODE_REUSED, preserved=false, balanced=false, policy mismatch, archive mismatch and archive changes
  - rollback on split write failure (byte-exact)
  - rollback on archive failure
  - rollback on attribution mismatch
  - no overlap; batch stops at the first failure
  - server auth wiring; MCP read-only
  - UI enable, execute and result
- Updated `code-identity-split.test.mjs`: the review route is dry-run only and the UI button changed.
- Updated `runtime-resolver-workdir.test.mjs`: 12 resolver calls (one new read-back).
- BLUEMARBLE ordinary-NEW auto-approval stays covered by `cafe24-code-reuse.test.mjs`.
- Full suite: 1343 tests, 1314 pass. The 27 failures are identical to a fresh origin/main baseline (environment-dependent).
- Local HTTP smoke (scratch WORK_DIR):
  - gate off → execute 403 `SPLIT_WRITE_DISABLED`
  - gate on → 403 `SPLIT_TOKEN_INVALID`
  - review route `dryRun:false` → 403 `SPLIT_TOKEN_REQUIRED`
  - the work dir was not touched, apart from boot logs

## Not done
- `/healthz` and core regressions (Clients, Ads and the rest) are not checked inside the server flow. A server cannot meaningfully check itself, so verification stays external, after COMPLETE.
- No pending refresh inside the flow. The candidate's APPROVED state is checked instead; in Production a refresh after the PERSONSOUL split did not re-create the candidate.

## Deploy steps (when approved)
1. Push and merge, then deploy.
2. Set `CODE_IDENTITY_SPLIT_WRITE=on` once (it stays on).
3. In the UI, run Dry Run on UNDER THE SIGN to get a new version and token, then click 분리 실행.
4. PRAYING later, the same way.

## Production deploy verification (2026-10-07 03:41–03:50 UTC)
- The operator pushed `1a75853` to origin/main. No rebase was needed: origin/main was `ebed7fa`. The 117 related tests passed again before the push.
- Deploy is live: new boot `2026-10-07T03:41:33.592Z` (before: `02:49:09Z`); `/healthz` 200; `/api/status` 200. No restart during the checks.
- Regressions are unchanged:
  - Inventory, Ads and NEW BRANDS (5) are unchanged.
  - MCP has 10 tools.
  - Sales 2026-09: online 30,967,793; offline 201,473,160.
  - Clients summary changed only through live October orders.
  - MCP get_brand differs only in `meta.coverage.naverCheckedAt`.
- PERSONSOUL / BORC are unchanged:
  - Brand Master entries are identical to the post-split snapshot.
  - In the 2026-09 archive, B0000BDG = PERSONSOUL 8,767,600 and SPL_00b4a2e6cc = BORC 6,000,000.
  - Pending: PERSONSOUL APPROVED; UNDER THE SIGN and PRAYING PENDING (22 PENDING / 6 APPROVED).
- Security:
  - No auth: dry-run, execute, review and restore all return 401. A forged operator cookie also returns 401.
  - Internal auth: dry-run is reachable (a probe id returns 404 NOT_FOUND).
  - Execute without a token returns 403 SPLIT_TOKEN_REQUIRED; with a wrong token, 403 SPLIT_TOKEN_INVALID.
  - The review route with `dryRun:false` returns 403 SPLIT_TOKEN_REQUIRED.
  - MCP: all 10 tools are `get_*`. An unknown write tool returns -32602. Write-style arguments are rejected with VALIDATION_FAILED.
- Finding: `CODE_IDENTITY_SPLIT_WRITE` is **already on** in Production. The restore probe returns 404, not 403, and execute reached the token check. No UNDER THE SIGN dry-run was run, no token was issued, and nothing was written.

## Production Dry Run — UNDER THE SIGN (2026-10-07)

Only the dry run was performed. `/split/execute` was not called and nothing was written to Production.

- Request: `POST /api/pending-brands/split/dry-run` with `{id: 0a2067742b57ff851f954125}`, sent at 2026-10-07T04:47:26Z using internal Basic auth. Response: HTTP 200.
  - The `x-samplas-internal-token` header from the local `.env` returned 401. The local `CAFE24_PROXY_SECRET` does not match the one on Render.
- Result: `ok: true`, `status: PLANNED`, `version: 4c44c679cab1b269`, `effectiveMonth: 2026-08`.
- Identities:
  - Old: GKL `B0000BDJ` becomes `SPL_e4af36d3ce` (`active: false`, formerCodes B0000BDJ / MARKETING_OS_MINTED).
  - New: UNDER THE SIGN `B0000BDJ` (`active: true`, cafe24 since 2026-08).
- Policy: 1 row, moving from `B0000BDJ` to `SPL_e4af36d3ce`.

| Month | Treatment | Offline total before → after | preserved | balanced | Archive reproduction |
|---|---|---|---|---|---|
| 2026-08 | ARCHIVE_REBUILD | 253,583,500 → 253,583,500 | true | true (5,265,600 = 5,265,600) | ok |
| 2026-09 | ARCHIVE_REBUILD | 201,473,160 → 201,473,160 | true | true (3,532,600 = 3,532,600) | ok |
| 2026-10 | UNAVAILABLE | 0 → 0 | true | true | — |

- Attribution moves:
  - 2026-08: UNDER THE SIGN gets 5,265,600 from UNASSIGNED. UNASSIGNED goes from 10,519,400 to 5,253,800.
  - 2026-09: GKL keeps 299,000. UNDER THE SIGN gets 3,233,600. UNASSIGNED goes from 9,580,100 to 6,346,500.
- Execution block:
  - `eligible: true`, `reasons: []`, `writeEnabled: true`.
  - A 48-character token was issued. Its value was redacted and never stored or used.
  - `expiresAt` is 2026-10-07T04:57:40.985Z, about 10 minutes after issue.
- The 분리 실행 button enables only when `ok && execution.eligible && execution.writeEnabled && execution.token` are all true. All four are true here, so the button would be enabled. It was not clicked.
- Post-check at 04:47:56Z: UNDER THE SIGN and PRAYING are still PENDING (22 PENDING / 6 APPROVED in total).
- Token expiry was not tested by calling execute. A mistimed call with a valid token would perform the real split. Expiry is covered by unit tests: `SPLIT_TOKEN_EXPIRED` in `test/code-identity-split-runner.test.mjs`.

## Production Split — UNDER THE SIGN / GKL (2026-10-07, approved by operator)

The operator approved one candidate only: `0a2067742b57ff851f954125`. PRAYING was not touched.

1. **Fresh dry-run (04:52:58Z, HTTP 200).**
   - The result was identical to the 04:47 dry-run: `version 4c44c679cab1b269`, identities, diff, attribution, `preserved` / `balanced` on all months, archiveChecks for 2026-08/09 ok, `eligible`, `writeEnabled`.
   - A new token was issued and used for execution. The earlier token was never used. Token values were never printed or stored.
2. **Execute (04:53:11Z, HTTP 200).**
   - `status: COMPLETE`.
   - Steps: token → revalidate → split → verify → archive (2026-08, 2026-09) → final.
   - No rollback was needed.
   - Backup: `2026-10-07T04-53-25-398Z-split-0a206774`.
3. **Read-back (before → after).**
   - Brand Master: GKL is now `SPL_e4af36d3ce` (inactive, formerCodes B0000BDJ). UNDER THE SIGN is now `B0000BDJ` (active, cafe24 since 2026-08).
   - GKL policy: `EXPLICIT_POLICY` 20% moved from B0000BDJ to SPL_e4af36d3ce.
   - UNDER THE SIGN policy: `SOURCING_DEFAULT` 20% (WHOLESALE).
   - Pending queue:
     - UNDER THE SIGN is `APPROVED / SPLIT_CODE_IDENTITY`.
     - PRAYING is still `PENDING`.
     - Totals went from 22 PENDING / 6 APPROVED to 21 / 7.
   - 2026-08 archive:
     - online 34,332,620, offline 253,583,500, total 287,916,120. All unchanged.
     - UNDER THE SIGN gets 5,265,600. UNASSIGNED offline goes from 10,519,400 to 5,253,800.
   - 2026-09 archive:
     - online 30,967,793, offline 201,473,160, total 232,440,953. All unchanged; these totals come from the execute archive check.
     - GKL keeps 299,000 under SPL_e4af36d3ce. UNDER THE SIGN gets 3,233,600. UNASSIGNED offline goes from 9,580,100 to 6,346,500.
   - MCP read tools (run against Render): `get_brand("UNDER THE SIGN")` returns B0000BDJ. `get_commercial_policy("UNDER THE SIGN")` returns SOURCING_DEFAULT 20%.
   - PERSONSOUL (B0000BDG) and BORC (SPL_00b4a2e6cc): Brand Master entries and MCP responses are identical before and after. 2026-09 amounts: 8,767,600 and 6,000,000.
   - `/healthz` returned 200. The boot marker (`instagramSync.lastAttemptAt` 03:41:33.592Z) was unchanged, so there was no restart.

## Production Split — PRAYING / LAMASKARADE (2026-10-07, approved by operator)

The operator approved one candidate only: `3929ec0523cf3368513b8e7d`. No other candidate was executed.

1. **Dry-run #1 (04:59:52Z, review).**
   - `version 21ce65632b6fc5e7`, effectiveMonth 2026-08.
   - Old identity: LAMASKARADE moves from `B0000BDM` to `SPL_4e0baa7a30` (inactive, formerCodes B0000BDM).
   - New identity: PRAYING becomes `B0000BDM` (active, cafe24 since 2026-08).
   - Policy: 1 row moves from B0000BDM to SPL_4e0baa7a30.
   - Attribution:
     - 2026-08: no change.
     - 2026-09: PRAYING gets 1,904,000 from UNASSIGNED.
   - `preserved` and `balanced` true on all months. archiveChecks 08/09 ok. `eligible`, `writeEnabled`.
   - The token from this dry-run was discarded unused.
2. **Dry-run #2 (05:00:05Z).**
   - Identical to #1 on version, identities, diff, attribution, preconditions and archiveChecks.
   - Its new token was the only one used.
3. **Execute (05:00:18Z, HTTP 200).**
   - `COMPLETE`. Steps: token → revalidate → split → verify → archive (2026-08, 2026-09) → final.
   - No rollback was needed.
   - Backup: `2026-10-07T05-00-31-188Z-split-3929ec05`.
4. **Read-back.**
   - LAMASKARADE is `SPL_4e0baa7a30` with `EXPLICIT_POLICY` 20%. The explicit policy moved with it.
   - PRAYING is `B0000BDM` with `SOURCING_DEFAULT` 20% (WHOLESALE). MCP `get_brand` and `get_commercial_policy` both return this.
   - Pending queue:
     - PRAYING is `APPROVED / SPLIT_CODE_IDENTITY`.
     - Totals went from 21 PENDING / 7 APPROVED to 20 / 8.
   - 2026-08 archive: online, offline and total unchanged (34,332,620 / 253,583,500 / 287,916,120). No row changes.
   - 2026-09 archive:
     - online, offline and total unchanged (30,967,793 / 201,473,160 / 232,440,953).
     - Only two rows changed: PRAYING +1,904,000, and UNASSIGNED offline 6,346,500 → 4,442,500.
   - PERSONSOUL, BORC, UNDER THE SIGN and GKL: Brand Master entries and MCP responses are identical before and after.
   - `/healthz` returned 200. The boot marker (03:41:33.592Z) was unchanged, so there was no restart.
