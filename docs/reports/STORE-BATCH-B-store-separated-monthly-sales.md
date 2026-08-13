# STORE-BATCH-B — Store-Separated Monthly Sales (SAMPLAS 압구정 매장 / SAMPLAS VAIL)

**Date**: 2026-08-13
**Scope**: Add a Store Dimension (`storeCode: APGUJEONG | VAIL | null`) to ECOUNT offline sales, orthogonal to the existing (implicit) online/offline channel split, without changing any existing Marketing OS number by even 1원. Full implementation batch, per explicit instruction not to fragment across days.

---

## 1. Pre-flight

- Branch: `main`. Starting HEAD: `0216e90 feat(brand-intelligence): complete category score and actions`.
- Working tree at batch start already had unrelated in-progress edits (`.gitignore`, `intelligence-service.mjs`, `outputs/*`, `scripts/*`, `server.mjs`, `test/monthly-brand-sales.test.mjs`, `work/monthly/2026-07.json`) plus untracked BI-BATCH docs/scripts from prior batches — none of this was reverted or overwritten; STORE-BATCH-B changes are additive on top of it.
- STORE-BATCH-A (`docs/reports/STORE-BATCH-A-ecount-warehouse-audit.md`, investigation-only) confirmed via the user: ECOUNT 판매현황 has no per-row warehouse column, but the 조회(search) UI filters by warehouse; real operational codes are `100=매장` (압구정) and `200=SAMPLAS Veil` (VAIL).

## 2. STORE MASTER: **COMPLETE**

`work/store-master.json` (force-added past the blanket `work/` gitignore, same convention as `work/category-master.json` from BI-BATCH-I):

| storeCode | displayName (Marketing OS) | source.system | source.warehouseCode | source.warehouseName (ECOUNT raw) |
|---|---|---|---|---|
| `APGUJEONG` | 압구정 매장 | ECOUNT | `100` | 매장 |
| `VAIL` | SAMPLAS VAIL | ECOUNT | `200` | SAMPLAS Veil |

`SAMPLAS VAIL` (all caps) is the only Marketing OS display spelling; ECOUNT's raw `SAMPLAS Veil` is preserved only inside `source.warehouseName` metadata, never shown as a label.

## 3. MONTHLY SALES UPLOAD: **STORE-SEPARATED**

Upload identity comes from the slot, never from Excel content (업로드 슬롯이 store identity를 부여한다):

- Client wizard (`outputs/samplas-marketing-os.js`) now renders two independent slots (`ECOUNT_WIZARD_STORES`), each with its own file input / preview / apply button / status line.
- `POST /api/ecount-sales/import` now **requires** an `X-Ecount-Store-Code` header, validated against `work/store-master.json`; unknown or missing codes are rejected with 400 before any file processing happens.
- Target month is still derived from the filename (`YYYY-MM.xlsx`), unchanged from the pre-batch convention.

## 4. UPLOAD SLOTS: **2 (압구정 매장 / SAMPLAS VAIL)**

Each slot independently shows (after apply, and on wizard open via a live status fetch): source file name, uploaded-at (via `importedAt`), row count, and offline sales amount — verified live in Chrome (see §14).

## 5. STORE METADATA PRESERVED: **YES**

Every sales line and every snapshot carries `storeCode`, and every snapshot additionally carries `sourceWarehouseCode` / `sourceWarehouseName` copied verbatim from Store Master at upload time (`buildEcountSalesSnapshot` in `scripts/import-ecount-offline-sales.mjs`). Round-trip verified in `test/store-dimension.test.mjs` (test 12).

## 6. REUPLOAD SAFETY: **YES**

Storage is one file per `{month}.{storeCode}.json`, written via the pre-existing atomic-write-then-rename (`writeJsonAtomic`). A reupload of the same period+store fully replaces that file; it cannot accumulate, and it cannot touch the other store's separate file. Verified in `test/store-dimension.test.mjs` (tests 6, 7) and live in Chrome.

## 7. ALL RECONCILIATION: **APGUJEONG + VAIL = ALL** (verified live)

`readEcountOfflineSalesSnapshot(month, {})` (no `storeCode`) merges every `{month}.{storeCode}.json` found for that month and sums `totalOfflineSales`/lines/daily series — no new calculation, just concatenation of already-computed per-store sums. Live-verified via the real HTTP endpoint (not a mock): 압구정 100,000원 + VAIL 55,000원 → `GET /api/ecount-sales/monthly?month=2026-08` returned `totalOfflineSales: 155000, storesIncluded: ["APGUJEONG","VAIL"], storesMissing: []`, and the Today dashboard's 총매출 card updated to `17,135,196원 = 16,980,196원(온라인) + 155,000원(오프라인)` in real time. QA files were deleted immediately after and the legacy `2026-08.json` file (md5-verified byte-identical before/after) restored the original `79,144,800원` offline total exactly.

## 8. ONLINE REGRESSION: **PASS**

`buildCanonicalTotalSales`'s online computation (`onlinePaidAmount`) never references `storeCode` — confirmed both by static source-code assertion (`test/store-dimension.test.mjs`, test 4b) and live: 온라인 16,980,196원 was byte-identical before the store upload, during the partial/merged state, and after cleanup.

## 9. TOTAL SALES REGRESSION: **PASS**

`total = online + offline` held live at every step: `96,124,996 = 16,980,196 + 79,144,800` (baseline) → `17,135,196 = 16,980,196 + 155,000` (both stores uploaded, QA data) → `96,124,996 = 16,980,196 + 79,144,800` (after cleanup, restored). Existing 9 months of pre-batch data (2026-01 through 2026-08's real legacy file) are untouched on disk.

## 10. PARTIAL UPLOAD HANDLING: **YES, explicit — never fabricated as zero**

When only one store's file exists for a month, `readEcountOfflineSalesSnapshot` returns `storesIncluded`/`storesMissing` (never guessing the missing store as 0), and:
- The wizard's per-slot status shows `미업로드` (not "0원") for the missing store.
- The sidebar ECOUNT Offline data-refresh card shows a distinct **Partial** badge (amber) instead of Healthy/Error when one store is in but one is missing — verified live (card showed "Partial" while only 압구정 was uploaded, then flipped to "Healthy" once VAIL was added).
- For all 9 pre-batch months (no per-store files exist yet at all), the legacy fallback path returns `storesIncluded: []`, `storesMissing: [APGUJEONG, VAIL]`, and every line's `storeCode` is `null` (UNKNOWN) — never guessed as APGUJEONG.

## 11. STORE FILTER FOUNDATION: **YES (backend/data layer)**

`buildCanonicalTotalSales({ since, until, storeCode })` accepts an optional `storeCode` (`APGUJEONG | VAIL | ALL/undefined`), filtering only the offline-line summation; exposed via `GET /api/sales/total?store=`. `GET /api/ecount-sales/monthly?store=` also supports the same filter. Verified: store=APGUJEONG excludes VAIL's lines and vice versa (`test/store-dimension.test.mjs`, tests 9/10), and `store=ALL`/omitted preserves the exact pre-batch legacy-fallback result (test 11).

## 12. STORE UI FILTER: **DEFERRED**

No `STORE [ALL][압구정][VAIL]` selector was attached to Today/Monthly/Annual/Commerce in this batch. Per Part 8/9's explicit permission ("모든 UI 화면에 Store Selector를 억지로 붙이지 않는다" / "regression risk가 크면 foundation까지만"), this batch shipped the upload UI (mandatory) and the backend filter foundation (mandatory), and defers the visible filter UI to a follow-up batch to keep this batch's regression surface limited to upload + read-path merging, which is what carries the "existing totals must not change" risk.

## 13. INVENTORY WH_CD COMPATIBILITY: **YES (design note, no code)**

Store Master's `source: { system, warehouseCode, warehouseName }` shape is generic and already carries the exact same `100`/`200` codes ECOUNT's `창고별재고현황` (warehouse-scoped inventory) API expects via `WH_CD`. A future Inventory Store Filter can look up `WH_CD` for a given `storeCode` directly from `work/store-master.json` — no new master-data structure needed. No inventory code was touched this batch.

## 14. SELL-THROUGH FUTURE COMPATIBILITY: **YES (design note, no code)**

Because `storeCode` is preserved at the sales-line level (not just aggregated), a future Sell-through feature can join `APGUJEONG` sales lines against `APGUJEONG` inventory/receiving (via the same `WH_CD=100`) independently from `VAIL` (`WH_CD=200`), through the shared Store Master. The Sell-through formula itself was explicitly out of scope and not built.

## 15. TARGETED TESTS: **15/15 PASS**

New file `test/store-dimension.test.mjs` — covers all 12 of Part 13's required scenarios plus supporting coverage:

1. APGUJEONG file → APGUJEONG only — PASS
2. VAIL file → VAIL only — PASS
3. ALL = APGUJEONG + VAIL — PASS
4/5. Online unchanged; total = online + offline (live `buildCanonicalTotalSales` call + static source assertion) — PASS
6. Same period/store reupload does not duplicate — PASS
7. Reupload APGUJEONG does not overwrite VAIL (byte-identical file check) — PASS
8. Missing VAIL is not fabricated as zero-complete — PASS
9/10. Store filter APGUJEONG excludes VAIL and vice versa — PASS
11. `store=ALL` preserves the previous (legacy fallback) canonical result, including a precedence check that store-separated files, once present, take priority over the legacy file (no double counting) — PASS
12. Source warehouse metadata (`sourceWarehouseCode`/`sourceWarehouseName`) round-trips through both single-store reads and the merged `sources[]` array — PASS
- Plus: `refreshMonthlySales` threads `storeCode`/`sourceWarehouseCode`/`sourceWarehouseName` into `importSnapshot`, and `ecountOfflineSalesSnapshotPath` naming (`{month}.{storeCode}.json` vs legacy `{month}.json`) — PASS

## 16. FULL REGRESSION: **476/476 PASS**

Full suite (`node --test test/*.test.mjs`), run twice — once immediately after implementation, once again after live Chrome QA — both 476/476 (461 pre-existing + 15 new), 0 failures.

## 17. LIVE QA: **PASS**

Performed in Chrome against the real local server (`http://127.0.0.1:8787`, restarted mid-QA after discovering the long-running dev process predated today's code changes — the stale process was serving the pre-batch route logic, which is why the first wizard open incorrectly showed identical legacy totals in both slots; after restart, all subsequent checks reflected current code):

- Wizard opens with both slots correctly showing `미업로드` (fresh server, no per-store files yet) — no fabricated data.
- Uploaded a synthetic ECOUNT-format `.xlsx` (built by hand to match the real header layout confirmed in STORE-BATCH-A — no real ECOUNT file or Cafe24-style test fixture was available in this environment, consistent with STORE-BATCH-A's confirmed IP-allowlist restriction) into the 압구정 매장 slot for month 2026-08: slot showed `업로드 완료 · 2026-08.xlsx · 2행 · 100,000원`; VAIL slot remained untouched (`미업로드`); sidebar ECOUNT Offline card showed **Partial**.
- Uploaded a second synthetic file into the SAMPLAS VAIL slot: `업로드 완료 · 2026-08.xlsx · 1행 · 55,000원`; sidebar card flipped to **Healthy**; Today's 총매출 card live-updated to `17,135,196원 = 16,980,196원 + 155,000원`.
- Verified `GET /api/ecount-sales/monthly?month=2026-08` (no store) returned the correct merge (`155000`, both stores included) and `?store=APGUJEONG`/`?store=VAIL` returned each store's isolated amount.
- Console: no application-level errors (`ecount`/`wizard`/`store`/`api/` filtered pattern returned zero matches); the only console entries were generic Chrome-extension messaging noise unrelated to the app.
- Cleaned up: deleted the two QA per-store snapshot files; confirmed the legacy `2026-08.json` file was byte-identical (md5) before and after the whole QA sequence; confirmed the API and the Today dashboard both reverted to the exact original `96,124,996원 = 16,980,196원 + 79,144,800원`.
- 2026-09 (a future month relative to the sandboxed 2026-08-13 "today") was tried first as a safer target but correctly triggered a live Meta Ads Insights API rejection (`since cannot be in the future in time_range`) during the archive-rebuild step that only past/non-current months go through — this is expected, unrelated-to-this-batch behavior (`refreshMonthlySales` only skips archive rebuild for the *current* month), so QA was redirected to the real current month (2026-08) instead, which uses the snapshot-only fast path and was cleaned up immediately after verification.

## Files changed

- `work/store-master.json` (new, force-added past `.gitignore`)
- `scripts/read-ecount-offline-sales-snapshot.mjs` (rewritten: per-store path resolution, merge, legacy fallback with `storeCode: null`)
- `scripts/import-ecount-offline-sales.mjs` (store-scoped snapshot path + line tagging + source warehouse metadata)
- `scripts/refresh-monthly-sales.mjs` (threads storeCode/source warehouse metadata through; store-suffixed lock file)
- `server.mjs` (Store Master loader; `X-Ecount-Store-Code` header validation on upload; store-scoped GET; `buildCanonicalTotalSales` storeCode filter; `/api/sales/total?store=`)
- `intelligence-service.mjs` (`loadEcountClientLines` now reads through the shared merge-aware `readEcountOfflineSalesSnapshot` instead of raw per-file JSON.parse)
- `outputs/samplas-marketing-os.js` (two-slot wizard UI, per-slot status, Partial/Healthy/Error sidebar card state)
- `outputs/samplas-marketing-os.css` (store-slot styling)
- `test/store-dimension.test.mjs` (new, 15 tests)

## Commits

Not yet committed — pending user confirmation before `git add`/`git commit`.

## Final HEAD

`0216e90` (unchanged — all work is uncommitted in the working tree as of this report).

## PUSH: NONE
## DEPLOY: NONE

## Next recommended batch

Attach the visible `STORE [ALL][압구정][VAIL]` filter to Today/Monthly/Annual/Commerce (Part 9's deferred UI layer), reusing the now-complete backend foundation (`/api/sales/total?store=`) — this is additive UI work with low regression risk since the data layer is already tested and live-verified.
