# B0000COL pre-emptive re-key — design and dry-run (2026-10-07)

Scope: design and dry-run only.
- No Production write. No re-key was executed.
- Production requests were GET only: `/api/brand-master`, `/api/intelligence/commercial-policy`, `/api/pending-brands`, `/api/ecount-sales/monthly`, `/api/status`, `/healthz`, and the MCP read tools.
- `/api/reports/monthly` was not called, because its GET can re-save a stale archive.

New code, local only, not committed or deployed:
- `scripts/identity-rekey.mjs`: the `REKEY_INTERNAL_IDENTITY` planner and a read-only impact preview.
- `test/identity-rekey.test.mjs`.

## A. Current B0000COL identity (Production)

| Field | Value |
|---|---|
| Code | `B0000COL` |
| brand_name | MEANTIME X SUNDAYOFFCLUB |
| Aliases | `SOC X MEANTIME`, `선데이오프클럽 X 민타임` |
| active | false |
| nameSource | confirmed |
| identity metadata | none (no identityCode / externalCodes / formerCodes) |
| Sourcing | WHOLESALE (sourcing master: 9 wholesale products, 66 resolved sales lines) |
| Policy | no explicit row; SOURCING_DEFAULT 20% (MCP `get_commercial_policy` says the same) |

**Drift, not fixed here:** local DEV `work/brand-commercial-policy.json` has an explicit row for B0000COL that Production does not have:
- CONSIGNMENT 10%, "Manual operational confirmation 2026-08-22"
- note: "콜라보 전용 브랜드 — 일반 MEANTIME(B00000HM)/SUNDAYOFFCLUB(B00000HD) 정책과 별개"

The operator needs to decide which one is correct. The re-key moves whatever row exists, so it works either way.

## B. Cafe24 ownership evidence

- The Cafe24 brand list (175 live) has no `B0000COL`.
- The live maximum is `B0000BEI` (BLUEMARBLE, 2026-10-05). Codes are issued in strictly increasing order: 175 of 175 live brands follow it.
- `B0000COL` is above the maximum, so it is unissued. It was minted by Marketing OS: it is not in any Brand Master backup up to 2026-08-18, it first appears in the 2026-08-22 policy file, and "COL" is a mnemonic rather than a sequence value.
- No pending candidate exists on the code, and only one identity uses it.

## C. Re-key target code

- Target: `SPL_92ce8d7290` = `internalIdentityCode("B0000COL", "MEANTIME X SUNDAYOFFCLUB")`. This is the same deterministic rule the splits use.
- After the re-key, the entry gains `identityCode: SPL_92ce8d7290`, `externalCodes.cafe24: null` and `formerCodes: [{ code: "B0000COL", source: "MARKETING_OS_MINTED", until: null }]`.
- Unchanged: name, aliases, active, nameSource, instagram_tag.
- No second identity is created.

## D. Reference graph (every B0000COL reference)

| Area | Before | After (dry-run) |
|---|---|---|
| Brand Master | 1 entry | same entry keyed `SPL_92ce8d7290`, metadata as in C |
| Commercial policy | Production 0 rows (DEV 1 row) | rows re-keyed with `identity_rekey {fromBrandCode, action, at}`. Production: none to move. |
| Product registry | 0 entries | 0 |
| Compatibility (`intelligence/brand-master-list.json`, `brand-aliases.json`) | id B0000COL; aliases: 2 name aliases + code alias `B0000COL` | Rebuilt by `buildIntelligenceBrandRegistry`: id `SPL_92ce8d7290`, the 2 name aliases follow it, the code alias becomes `SPL_92ce8d7290`, and `B0000COL` no longer resolves. This is intended. |
| Sourcing master | `B0000COL` WHOLESALE, 9 products / 66 lines | `SPL_92ce8d7290` WHOLESALE, 9 / 66 (identical evidence) |
| Resolver | 3 names → B0000COL | 3 names → `SPL_92ce8d7290`. MEANTIME → B00000HM and SUNDAY OFF CLUB → B00000HD are unchanged. |
| Monthly archives | brandSales row B0000COL in 2026-08 and 2026-09 | relabel through `rebuildArchiveBrandSales` (see G) |
| Pending queue | none | none. A re-key needs no candidate. |

## E. Policy impact

- Production: no explicit row. Before and after are both SOURCING_DEFAULT 20% WHOLESALE, because the sourcing evidence moves 1:1 with the identity.
- DEV: the one explicit row (CONSIGNMENT 10%) would move to the SPL code unchanged.
- In both cases the stylist discount is unchanged.

## F. Sales attribution (Production state, official resolver plus `mergeOfflineBrandSales`)

| Month | B0000COL before | SPL after | B0000COL after | Month offline total before = after | Balanced | Other brands unchanged |
|---|---|---|---|---|---|---|
| 2026-08 | 1,612,800 | 1,612,800 | 0 | 253,583,500 | yes | yes |
| 2026-09 | 2,798,000 | 2,798,000 | 0 | 201,473,160 | yes | yes |
| 2026-10 | 0 (no Production ECOUNT snapshot yet, 404) | 0 | 0 | 0 | yes | yes |

DEV gives the same picture with DEV snapshots: 08: 1,285,200; 09: 2,798,000; 10: 908,000. All moved 1:1 with totals preserved.

## G. Archive impact

- Closed months that are affected: 2026-08 and 2026-09. Online is 0 in both, so only offline rows are relabelled.
- DEV archives:
  - 2026-09: reproduction **OK**. Totals unchanged: salesAmount 250,522,053, offline 217,878,860, online 32,643,193. Changes: `B0000COL` 2,798,000 → 0, and a new `SPL_92ce8d7290` row of 2,798,000.
  - 2026-08: reproduction **FAILED** with `ARCHIVE_SOURCE_MISMATCH` (saved UNASSIGNED 9,197,000 vs recomputed 4,953,800). The cause is DEV drift: the DEV 08 archive was saved from older ECOUNT snapshots, as noted in the Phase 2 report. It is unrelated to the re-key. The rebuild refuses to write when this happens, which is the intended safety.
- Production archives: not read here, because the monthly GET can re-save.
  - Indirect evidence: 2026-08 and 2026-09 reproduced exactly on Production at 05:00Z (the PRAYING dry-run archiveChecks and rebuild).
  - Brand Master, policy and pending hashes are unchanged since then, and the ECOUNT imports are unchanged (09 importedAt 2026-09-29).
  - The direct check is gate 1 of the Production dry-run route (J).

## H. Dry-run result

- Production-state planner:
  - `status: PLANNED`, `version 6c5627a5c14935ff`.
  - Preconditions: code B0000COL; name, aliases, active false, confirmed; `cafe24MaxCode B0000BEI`; target `SPL_92ce8d7290`.
  - The planner also refuses when the code is live in Cafe24 (`CAFE24_OWNED`), when Cafe24 has already passed it (`NOT_AHEAD_OF_CAFE24`), when the Cafe24 list is missing, when a pending candidate exists on the code (`COLLISION_PENDING`), and when the version is stale.
- `ALREADY_REKEYED` when re-planned on its own output.
- Tests:
  - `test/identity-rekey.test.mjs`: 2/2 pass.
  - Together with the split, runner and code-reuse suites: 39/39 pass.

## I. Regression check

- Planner output on Production state:
  - All other 304 Brand Master entries are byte-identical.
  - All other policy rows are identical.
  - The brand count stays at 305.
- Resolver after the re-key:
  - PERSONSOUL → B0000BDG, BORC → SPL_00b4a2e6cc
  - UNDER THE SIGN → B0000BDJ, GKL → SPL_e4af36d3ce
  - PRAYING → B0000BDM, LAMASKARADE → SPL_4e0baa7a30
  - All identical to before.
- Offline buckets of every other brand are identical in each month.

## J. Implementation design (next phase, not implemented)

1. **Production dry-run route** `POST /api/brands/rekey/dry-run {code}`.
   - Auth: operator session or internal auth, like `/split/dry-run`.
   - Runs `planInternalRekey` with the live Cafe24 list, then `previewInternalRekey` on Production `workDir`.
   - The preview includes the archive reproduction for closed months (gate 1) and the compatibility diff via `buildIntelligenceBrandRegistry`.
   - Issues a 10-minute single-use token through the existing `createSplitTokenRegistry`, only when every gate passes:
     - planner PLANNED
     - attribution balanced and preserved for every month
     - other brands unchanged
     - archive reproduction OK for every closed month
     - `CODE_IDENTITY_SPLIT_WRITE` on
2. **Execute** `POST /api/brands/rekey/execute {code, token}`. Same shape as the split runner:
   1. Re-plan with `expectedVersion`.
   2. Back up with `backupWorkFiles`: Brand Master, policy, registry, compatibility, sourcing, and the affected `monthly/*.json`.
   3. One `writeFilesAtomically` for Brand Master, policy, registry and compatibility, then `refreshBrandSourcingMaster`.
   4. Read-back: resolver maps the 3 names to SPL; nothing remains on B0000COL; formerCodes are present.
   5. `rebuildArchiveBrandAttribution(month, backupId)` for 2026-08 and 2026-09. It already handles a new code row through the `names` map.
   6. Read-back again. Any failure restores the backup byte for byte (`restoreIdentitySplitBackup`).
   - The runner can be shared by giving `createIdentitySplitRunner` a plan/verify pair per action. No new kill switch.
3. **UI:** none for now. This is a one-off operator action. Add UI when the detector produces more candidates.
4. **MCP:** stays GET-only. `get_brand("MEANTIME X SUNDAYOFFCLUB")` will return the SPL code.

Detector link, for later:
- The audit rule `CODE_AHEAD_OF_CAFE24` (code above the live maximum, not live) plus minted evidence (no Cafe24 owner, no `externalCodes.cafe24`) gives status `PREEMPTIVE_REKEY_REQUIRED`.
- That status shares the planner's eligibility checks: it is exactly the set where `planInternalRekey` returns PLANNED.
- If Cafe24 issues the code before the re-key runs, the planner refuses (`CAFE24_OWNED`) and the normal MINTED_CODE_COLLISION split flow takes over.

## K. Write status

- Production: 0 writes. Pending, Brand Master and policy hashes are identical to the audit baseline.
- `/healthz` 200. The boot marker is unchanged since 05:09:29Z.
- DEV `work/`: not modified. Brand Master, policy, registry, sourcing, compatibility, pending and monthly file mtimes are all earlier than today.
- Scratch only: the Production-state workDir was built in the session scratchpad.
- Repo: two new files, uncommitted.

## L. Verdict

B0000COL PREEMPTIVE REKEY — DRY RUN READY.

One gate remains before execution: a direct archive reproduction on Production for 2026-08 and 2026-09. It runs inside the Production dry-run route, which needs a deploy. The operator also needs to decide on the DEV/Production policy drift (CONSIGNMENT 10% vs SOURCING_DEFAULT 20%).
