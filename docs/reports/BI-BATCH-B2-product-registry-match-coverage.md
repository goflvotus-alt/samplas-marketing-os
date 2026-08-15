# BI-BATCH-B2 — Product Registry Confirmed-Match Coverage + Live SKU Join Verification

Investigated, safely promoted through the existing pipeline, and verified live. One commit (registry data only), no push, no deploy.

## Pre-Flight

```
branch = main
HEAD (start) = 2c9067794c938291bb88b6f02e00c23d6f6d83b1
```
`c9d90f4` (BI-CORE-4), `92cba37` (BATCH A), `2c90677` (BATCH B) all present. Working tree clean except the usual untracked `docs/reports/*.md` files. No unexpected source modification found — proceeded directly.

## Phase 1 — Product Registry Pipeline (existing, unmodified)

- **Diagnostic builder**: `scripts/diagnose-cafe24-ecount-product-matching.mjs` → `buildCafe24EcountProductMatchingDiagnostic()`. Normalizes Cafe24 product names/brands and ECOUNT product names/brands, computes exact and token-similarity ("fuzzy") matches, classifies every Cafe24×ECOUNT pairing into `exact_one_to_one` / `exact_one_to_many` / `fuzzy_high_confidence` / `fuzzy_ambiguous` / `cafe24_only` / `ecount_only` / `consignment_candidate` / `excluded_qqq`. Output: `work/cafe24-ecount-product-matching-diagnostic.json`.
- **Registry builder**: `scripts/build-product-registry.mjs` → `buildProductRegistryFromDiagnostic()`. Groups diagnostic results by Cafe24 `productNo`. **Deterministic promotion rule (unchanged, existing project policy)**: `verified = status === "confirmed" && confidence === 100`, and `status === "confirmed"` requires the group to contain *exactly one* diagnostic type (`exact_one_to_one`) *and* exactly one matched ECOUNT product (`ecountProducts.size === 1`). Any `exact_one_to_many` (multiple ECOUNT candidates) or `fuzzy_*` classification is `ambiguous`/`candidate`, never auto-verified. Output: `work/product-registry.json` + `work/product-registry-review-queue.json`.
- **Cafe24 identifier**: `cafe24.productNo` (canonical anchor) + `cafe24.productCode`. **ECOUNT identifier**: `ecount.matchedProducts[].prodCd` (+ `barcode`). No other identifier is used as a join key anywhere in this pipeline.
- **Review queue / manual override mechanism**: `work/product-registry-review-queue.json`, prioritized HIGH/MEDIUM/LOW by classification, intended for human review — no automated promotion path exists for non-`exact_one_to_one` entries, and none was added in this batch.
- **Tests**: `test/product-registry.test.mjs`, `test/product-registry-bootstrap.test.mjs`, `test/meta-product-registry-link.test.mjs`, `test/intelligence-brand-registry.test.mjs`, `test/unified-identity-resolver.test.mjs` — all exercise the matching/promotion/consumption logic against fixtures, not the live data file.

## Phase 2/3 — CARNET's 3 August Sales Products: Evidence + Root Cause

| productNo | Cafe24 name | Registry status (before) | Registry status (after rebuild) | ECOUNT candidate(s) | Classification |
|---|---|---|---|---|---|
| 13383 | HAND COATED MASS VEST OIL BLACK | not in registry at all | `ambiguous`, confidence 78 | `CAR261OT01203`, `CAR261OT01204` (2 codes, identical normalized name — almost certainly size/option variants) | **D. Multiple ECOUNT candidates** (`exact_one_to_many`) |
| 12616 | Unearthed Fragment Chain Oil Black | not in registry at all | `ambiguous`, confidence 78 | `CAR253AC01500`, `POP254CAR047` (2 codes — the second has a *different* ECOUNT product-family prefix, a genuine collision risk, not obviously a size variant) | **D. Multiple ECOUNT candidates** (`exact_one_to_many`) |
| 12610 | Burnt Silver Dog Tag Burn Silver | not in registry at all | `candidate`, confidence 80 | `CAR253AC01800` (1 code, but token-similarity only — "Burn Silver" vs ECOUNT's "BURNT SILVER" fails exact string normalization) | **B/G. Existing pipeline match, fuzzy only, not exact** (`fuzzy_high_confidence`) |

**Root cause was two-layered, and only the first layer was fixable this batch**:
1. **Registry staleness (systemic, fixed)** — none of these 3 productNos existed anywhere in the pre-existing diagnostic (`work/cafe24-ecount-product-matching-diagnostic.json`, generated 2026-07-19 from a 177-product window, `work/product-dashboard-proxy-2026-06-24_2026-07-18.json`). They simply were never evaluated.
2. **Genuine matching ambiguity (not fixable without human review)** — after rebuilding the diagnostic against the full current catalog, all 3 are still correctly *not* `exact_one_to_one`: two have multiple ECOUNT candidates, one is fuzzy-only. Per the existing pipeline's own policy, none of these qualifies for automatic promotion. **No forced promotion was made.**

## Phase 4 — System-Wide Coverage

| | BEFORE | AFTER (merged) |
|---|---|---|
| Total registry entries | 177 | 880 |
| Confirmed + verified | 17 | 103 |
| Ambiguous | 109 | 402 |
| Candidate | 5 | 12 |
| Unmatched (`cafe24_only`) | 46 | 363 |

**CARNET was not unusual — this was a systemic staleness issue.** The diagnostic's Cafe24-side source (`work/product-dashboard-proxy-2026-06-24_2026-07-18.json`, 177 products, a narrow Dashboard-cache date window) covered only a small fraction of the real catalog. Confirmed live: `work/product-dashboard-proxy-2026-08-01_2026-08-31.json` (today's sync, `catalogSyncedAt: 2026-08-12T08:28:15Z`) has 824 products across the same brand set, including CARNET's full 32-product catalog (vs. 3 in the stale registry). Rebuilding against this fresher, larger catalog raised confirmed+verified from 17 to 97 (+80) via the existing deterministic rule alone. A further 56 previously-tracked entries not covered by the fresher source were merged back unchanged (rollback safety, see Phase 6/7), bringing verified to 103 — **86 net new confirmed matches, zero forced/fuzzy.**

## Phase 5 — Why Direct Regeneration Needed a Workaround (disclosed, not invented)

`scripts/diagnose-cafe24-ecount-product-matching.mjs` now fetches the full Cafe24 catalog via `fetchAllCafe24ProductsFullCatalog()` (direct Cafe24 admin API, paginated). Running it directly failed: `Invalid access_token (invalid_token)`. This is a **known, documented, structural limitation** of this local environment, not a credentials mistake — `server.mjs:4449-4452`: *"로컬(proxy 모드)에서는 상품 카탈로그를 Cafe24에 직접 요청하지 않는다 — 로컬 .env의 Cafe24 토큰은 재인증(콜백이 Render로 감) 이후 더 이상 갱신되지 않아 invalid_token이 난다"* (local's Cafe24 token can no longer refresh because the OAuth callback targets the Render deployment, not localhost). The live app itself already works around this by routing all product-catalog reads through `CAFE24_PROXY_BASE_URL` (Render), which is exactly how `work/product-dashboard-proxy-*.json` files are produced and kept fresh (confirmed: one was regenerated today at 21:31, well before this batch started).

**No new pipeline was built.** `buildCafe24EcountProductMatchingDiagnostic()` already exposes an `options.cafe24ProductsOverride` parameter for exactly this scenario (supplying an already-fetched product list instead of live-fetching). A small one-off runner script (kept in the session scratchpad, not added to `scripts/`) called this existing, unmodified function with the current `product-dashboard-proxy` catalog as the override — no new matching logic, no new normalization rule, same deterministic algorithm the pipeline already uses.

## Phase 6 — Rollback Safety

Before any write: hashed and copied `work/product-registry.json`, `work/product-registry-review-queue.json`, `work/cafe24-ecount-product-matching-diagnostic.json` to a session scratchpad backup, and recorded `git status --short` and before-counts. (These 3 files turned out to be git-tracked despite living under the generally-ignored `work/` directory — confirmed via `git ls-files`; the rollback backup was redundant with `git checkout` but was taken first regardless, per instruction.)

## Phase 7 — Registry Delta Verification

Ran the existing `build-product-registry.mjs` unmodified against the rebuilt diagnostic, then merged back 56 previously-tracked entries the fresher catalog source didn't cover (append-only, no field changes to any entry that *was* rebuilt) — done specifically because a naive overwrite would have silently dropped 56 previously-tracked Cafe24 products (6 of them previously `verified:true`) that simply weren't present in the newer, still-partial `product-dashboard-proxy` snapshot. This is the safe, conservative choice: never let an incomplete newer source erase a previously-established mapping.

**Verified after merge**: of the 17 previously-`verified:true` entries — **17/17 unchanged** (same status, same verified flag, same matched ECOUNT codes). **0 downgraded, 0 remapped, 0 missing.** No duplicate `canonicalProductId` or duplicate Cafe24 `productNo` anchor in the final 880-entry registry.

CARNET's 3 August sales products: **0/3 confirmed before → 0/3 confirmed after** (correctly — see Phase 2/3, genuine ambiguity/fuzzy, not staleness). One *other* CARNET product not among the 3 (`productNo 9049`, "MASS DENIM JACKET DARK GREY") newly became `exact_one_to_one`/confirmed/verified — confirmed live in the SKU Drawer as a real Case C (stock-only) row.

## Phase 8 — Registry Tests

```
node --test test/product-registry.test.mjs test/product-registry-bootstrap.test.mjs test/meta-product-registry-link.test.mjs test/intelligence-brand-registry.test.mjs test/unified-identity-resolver.test.mjs
→ 35 tests, 35 pass, 0 fail
```
All existing tests run against fixtures (not the live data file), so the data rebuild introduces no risk to them — confirmed unaffected. No new test was needed: no new code path was introduced, only fresher input data through the existing, already-tested pipeline.

## Phase 9/10 — BATCH B Re-Verification + Full Regression

```
node --test test/brand-intelligence-sku-sales-stock-drilldown.test.mjs test/brand-intelligence-partial-period.test.mjs test/brand-intelligence-customer-purchase-detail.test.mjs test/brand-intelligence-live-data.test.mjs test/brand-intelligence-ui-restoration.test.mjs test/product-registry*.test.mjs test/meta-product-registry-link.test.mjs test/intelligence-brand-registry.test.mjs test/unified-identity-resolver.test.mjs test/monthly-brand-sales.test.mjs test/master-data-phase1.test.mjs test/cross-brand-period-cutoff.test.mjs test/cross-brand-partial-period-p2.test.mjs test/brand-comparison-summary.test.mjs test/brand-comparison-yoy-timeout.test.mjs
→ 143 tests, 143 pass, 0 fail

node --test test/*.test.mjs
→ 371 tests, 371 pass, 0 fail, 0 skipped
```
No test was weakened. 371 matches the exact BATCH B baseline (no new tests were added this batch — no source code changed).

## Phase 11 — Live CARNET QA

Hard refresh, `CARNET ARCHIVE` / `2026년 8월`:
- Core Metrics **unchanged**: Revenue 10,883,059원 / Units 32개 / Orders 25건 / AOV 435,322원 / Inventory 272개.
- SKU Drawer: **4 rows** (up from 3) — the original 3 sales rows unchanged (stock still `-`, correctly, per Phase 2/3), plus a new real Case C row: "MASS DENIM JACKET DARK GREY" — 온라인 매출 0원 / 판매수량 0개 / 현재 재고 0개 (all real confirmed values, not fabricated).
- Search ("MASS DENIM") → 1 matching row. Sort (재고 많은 순 / `stock_desc`) → the real-`0` stock row correctly sorts above the three `null`-stock rows.
- Console: zero application errors (only the pre-existing, unrelated browser-extension "message channel closed" artifact noted in prior reports).

**Real matched-SKU acceptance test — demonstrated on AIVER (`B00000ZK`)**, chosen because it has a verified+confirmed registry entry *and* online sales this period *and* current inventory (found by scanning: 7 brands system-wide now have a productSales row matching a confirmed registry entry; AIVER and BLACKMEANS also have that ECOUNT code present in their live inventory items — no data was altered to manufacture this, it already existed once the registry was correctly rebuilt):
- Core Metrics: Revenue 239,400원 / Units 3개 / Orders 4건 / AOV 59,850원 / Inventory 45개.
- SKU Drawer, **3 rows**, first two are real Case A:
  - `30MM D-RING LEATHER BELT BLACK` — 온라인 매출 126,000원 · 판매수량 1개 · 객단가 126,000원 · **현재 재고 1개** (all on the same row; independently confirmed via `curl .../api/inventory/overview?brand=B00000ZK` → `AIV261AC01504.stockQuantity === 1`).
  - `25MM D-RING LEATHER BANGLE DARK BLACK` — 온라인 매출 63,000원 · 판매수량 1개 · 객단가 63,000원 · **현재 재고 3개** (independently confirmed: `AIV261AC01200.stockQuantity === 3`).
  - `Studs Leather Bangle Black` — a Case C row (0원/0개/현재 재고 0개).
- Console: zero application errors.

**Real sales + stock joined SKU: VERIFIED (YES), live, on real production data, on the same row, with independent server-side confirmation of the stock figure.**

## Phase 12 — Stock Query Identifier Check

Traced end to end: `refreshEntityInventory(brandCode)` resolves the correct ECOUNT `brandKey` first (exact canonical `brand_code` match against `brandRollup`, else unique raw-name match), *then* BATCH B's own code fetches `/api/inventory/overview?brand=${encodeURIComponent(row.brandKey)}` using that **already-resolved** key — confirmed live: `?brand=B00000KU` (canonical code) → `itemsTotal: 0`; `?brand=raw:carnet archive` (the correctly-resolved key BATCH B actually sends) → `itemsTotal: 710`. **This is not a bug** — BATCH B was already using the correct identifier both before and after this batch. The "STOCK ROWS = 0" figure in the original BATCH B report referred to *joined* SKU rows (post Product-Registry match), not the raw brand-filtered items fetch, which was always correct. **STOCK QUERY BUG: NO.**

## Files Changed

- `work/product-registry.json`, `work/product-registry-review-queue.json`, `work/cafe24-ecount-product-matching-diagnostic.json` — data only, rebuilt via existing, unmodified scripts. (These 3 files are git-tracked despite `work/` being generally ignored.)
- No `outputs/samplas-marketing-os.js`, `server.mjs`, `intelligence-service.mjs`, or test file was touched — Phase 12 found no bug requiring a source fix.

## Manual Review Still Required

CARNET's 3 August-sold products remain genuinely unconfirmed and need human judgment, not automation:
- `13383`/`12616`: pick the correct single ECOUNT SKU among 2 same-named candidates (likely a size/option split — needs the actual size sold, which BATCH B's sales row doesn't carry).
- `12610`: confirm "Burn Silver" (Cafe24) and "BURNT SILVER" (ECOUNT) are the same product, then either fix the naming or extend the normalizer's known-typo list (out of scope for a data-only batch).
These are exactly the kind of decisions the review queue exists for — none were resolved here, consistent with "do not guess."

## Commit

```
2c90677 feat(brand-intelligence): connect sku sales and stock drilldown   (BATCH B, prerequisite)
43ed178 data(product-registry): promote deterministic sku matches        (this batch)
```
No BATCH B source fix commit — Phase 12 found no bug to fix.

## Next Recommended

Category Intelligence (still no source, per BI-GAP-1) remains the largest unconnected Brand Intelligence surface. Separately: CARNET's 3 unconfirmed matches and the broader 402-entry ambiguous queue are now accurately reflected and ready for a human review pass through the existing review-queue UI (Product Registry screen) — not a code batch.
