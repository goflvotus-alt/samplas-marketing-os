# BI-BATCH-B — Per-SKU Sales + Stock Drill-down

Implemented, tested, and verified in Chrome. One commit, no push, no deploy.

## Pre-Flight

```
branch = main
HEAD (start) = 92cba37bbe8fe5453c0737b6449238c8b4041ef2
```
Both prerequisite commits already existed at the start of this batch — `c9d90f4 fix(brand-intelligence): preserve null vs zero metric states` (BI-CORE-4) and `92cba37 feat(brand-intelligence): connect customer purchase detail` (BATCH A). Working tree was clean except the usual untracked `docs/reports/*.md` files. No checkpoint commit was needed; went straight to BATCH B.

## Exact Payload Trace (Phase 1)

**Sales** — `archive.commerce.productSales[]`, already present in every `/api/reports/monthly?month=X` response Brand Intelligence fetches via `refreshEntityTrendMonths()` (`server.mjs:3419+`). Confirmed live against `/api/reports/monthly?month=2026-08`:
```
{ productNo, productCode, productName, brand_code, brand_name, quantitySold,
  salesVelocityPerDay, orderCount, salesAmount, canonicalPaidAmount,
  canonicalDiscountAmount, sales: { grossAmount, paidAmount, discountAmount,
  discountRate, shippingAmount, basis } }
```
Online-only by construction (built from Cafe24 order lines) — never contains offline (ECOUNT) sales.

**Stock** — `GET /api/inventory/overview?brand=<brandKey>&limit=N` → `items[]` (`intelligence-service.mjs`, `scripts/inventory-overview-lib.mjs:filterAndSortItems`). Confirmed live:
```
{ brandKey, brandName, prodCd, barcode, productName, stockQuantity, status,
  locationCoverageStatus, recentSalesQty, ... }
```
Critical finding: `brand` filters on **exact `item.brandKey` string match**, and ECOUNT inventory brand identity is a **raw, unresolved key** (e.g. `raw:carnet archive`), not the canonical `brand_code`. `?brand=B00000KU` returns 0 items; `?brand=raw%3Acarnet+archive` returns the real 710 CARNET items. `refreshEntityInventory()` already resolves this correctly (exact canonical `brandKey` match, else unique raw-name match via `resolveRawBrandCanonical`) — this batch reuses that same resolved `row.brandKey`, it does not re-derive it.

**Join key** — Product Registry (`/api/intelligence/product-registry` → `registry.entries[]`), confirmed shape:
```
{ cafe24: { productNo, productCode, productName },
  ecount: { matchedProducts: [{ prodCd, barcode, ... }] },
  status, verified, confidence }
```
Only entries with `verified === true && status === "confirmed"` are used as the join — this is the project's own documented Priority-1 contract. `productName` text matching is never used as a join key, primary or fallback (Phase 5 Case D).

## Product Identity / Join Strategy (Phase 2 & 5)

No new resolver, no new fuzzy matching, no Product Registry redesign. `entitySkuStockFor(productNo, registryEntries, inventoryItems)` finds the one `verified+confirmed` entry whose `cafe24.productNo` exactly matches, unions its `ecount.matchedProducts[].prodCd` codes, sums `stockQuantity` across brand-inventory items whose `prodCd` is in that set. No match at any step → `stock: null`, never a fabricated `0`.

Four cases implemented exactly as specified:
- **Case A** (sales + stock both resolve) — one row with real revenue/quantity/orders + real stock.
- **Case B** (sales exists, no confirmed registry match, or match not found in this brand's inventory) — real sales fields, `stock: null` → renders `"-"`.
- **Case C** (stock resolves via a confirmed registry entry but the product has no row in this period's `productSales`) — a stock-only row is synthesized: `revenue/quantitySold/orderCount = 0` (a **confirmed real zero** — the period's own sales response legitimately has no entry for it — not a fetch failure), `stock` real.
- **Case D** (no registry match at all) — the SKU still appears (sales-anchored), stock stays `"-"`, unmatched count is tracked in `entitySkuJoinDiagnostics.unmatchedStock` for disclosure.

## Data Maturity Limitation (disclosed, not an implementation gap)

Live-verified this session: **CARNET ARCHIVE has 3 Product Registry entries, all `status: "ambiguous"` — zero `verified+confirmed`.** System-wide, only 17/177 registry entries are `verified+confirmed`, and none of those 17 correspond to a product that actually sold online in August 2026 for any brand. Consequence: a live "Case A" (real matched sales+stock) row cannot currently be demonstrated with real production data, for any brand, this period. The join logic itself is fully implemented and correctly exercised by synthetic-fixture unit tests (Cases A/B/C/D all covered, §Tests below) — this is a **live-data coverage gap**, not a missing code path. Live CARNET QA this session showed exactly the expected result of this gap: 3 real sales rows, all Case B (`stock: "-"`), 0 Case A, 0 Case C.

## Fetch Architecture (Phase 10 — no duplicate fetch)

- **Sales**: zero new fetch. `refreshEntityTrendMonths()` already awaits all trend-range archives; this batch just also reads `archives[months.indexOf(periodMonth)].commerce.productSales` (the already-fetched selected-period archive) and passes it to `refreshEntitySkuSales()`.
- **Stock**: `refreshEntityInventory(brandCode)` already does one `?limit=1` rollup fetch to resolve the correct ECOUNT `brandKey`. This batch adds exactly **one** additional fetch — `?brand=<resolved brandKey>&limit=5000` — reusing that same resolved key, so the same brand is never queried twice for the rollup and never queried more than once for items. Structural test confirms exactly 2 `getJson(intelligenceUrl(...inventory/overview...))` call sites in the function (the rollup + the items fetch), not more.
- **Product Registry**: `getSharedJson("/api/intelligence/product-registry", ...)` — already called once at page load by `initBrandSelector()`; this batch calls the same URL again through the shared in-memory cache (`getSharedJson`), so no new network request is issued.

## UI (Phase 4, 6, 7)

`entityDrawerConfig.sku` reuses the existing Entity Drawer shell unchanged (no new drawer). Row template (`entityDrawerSkuRowHtml`) now shows real `상품명`/`온라인 매출`/`온라인 판매수량`/`온라인 객단가`/`현재 재고`, all explicitly "온라인 " prefixed to keep the online-only sales semantic visible (per the task's explicit data principle). Drawer description now reads "선택한 브랜드의 온라인 판매 SKU 목록 (매출/수량/주문 · 재고는 항상 현재 시점 스냅샷) · 기준 기간: {period}" so the current-snapshot-vs-period distinction (Phase 6) is stated in the UI without any layout redesign. Search matches `productName`/`productCode` (was `row.name`/`row.id`, fields that don't exist on the real shape). Sort options were reduced to the four with real underlying data (`revenue_desc`/`qty_desc`/`orders_desc`/`stock_desc`); the old `aov_desc`/`mom_desc` options were removed — no MoM/AOV-trend source exists for SKUs and fabricating one was explicitly out of scope.

## State Semantics (Phase 9)

- Sales fetch failure → `entitySkuRows = []` (not a fabricated empty-but-successful state); `entitySkuSalesState.fetchFailed` tracked separately from "zero rows this period."
- Inventory fetch failure → every row's `stockUnavailable: true`, `stock: null`.
- Genuine zero online sales for a period (Case C) → real `0`, not `null` — a confirmed absence from the real `productSales` response is a real fact, not a missing-data state.
- Genuine zero quantity/revenue within an existing sales row → preserved as real `0`.
- **Brand switch**: `refreshEntityTrendMonths()` now closes an open `sku`-type drawer at its very first lines (mirrors BATCH A's `clientOrders` guard exactly); `rebuildEntitySkuRows()` additionally refuses to populate `entitySkuRows` unless `entitySkuSalesState.brandCode` still matches the live `brandIdentityState.brandCode` at every await boundary, so an in-flight response for an already-abandoned brand can never leak in. Verified live: opening the SKU Drawer, then calling `applyBrandIdentity("BONNAE")`, closed the drawer within one refresh cycle.
- **Period switch**: `entitySkuSalesState` is fully recomputed (not incrementally patched) on every `refreshEntityTrendMonths()` call, scoped to `periodMonth` — no old-period residue possible.

## Files Changed

- `outputs/samplas-marketing-os.js` (198 insertions, 23 deletions): `entitySkuSalesState`, `entityInventoryItemsState`, `entityProductRegistryEntriesPromise`, `entitySkuJoinDiagnostics`, `loadEntityProductRegistryEntries`, `entitySkuStockFor`, `entityRegistryEntryByProdCd`, `rebuildEntitySkuRows`, `refreshEntitySkuSales`, `refreshOpenEntitySkuDrawer`, rewritten `entityDrawerSkuRowHtml`, extended `refreshEntityInventory` (brand-filtered items fetch + stale-guard reset on failure), extended `refreshEntityTrendMonths` (period-scoped `productSales` extraction + SKU drawer stale-guard), corrected `entityDrawerConfig.sku`.
- `test/brand-intelligence-sku-sales-stock-drilldown.test.mjs` (new, 18 tests).

No HTML/CSS file touched — reuses the existing `.entity-drawer-row`/`.entity-drawer-*` markup shell verbatim.

## Tests

New file: **18/18 PASS** — brand filtering, period scoping, row population, inventory join, Case A/B/C/D (including the exact-productNo-vs-same-productName non-match test for Case D), sales/inventory fetch-failure-not-zero, genuine-zero preservation, brand-switch stale guard, period-switch stale guard structural check, real row template fields, search, sort (including null-stock-sorts-last), and two fetch-architecture structural checks (no new sales endpoint; exactly one rollup + one items inventory request).

Targeted (new file + Brand Intelligence + partial period + customer purchase detail + live-data + UI restoration + Brand Identity/resolver + monthly-brand-sales + master data/registry + cross-brand cutoff/partial-period + monthly archive freshness + entity-composition retry + comparison summary/timeout): **150/150 PASS**.

Full regression: **371/371 PASS, 0 fail, 0 skipped** (353 prior baseline + 18 new).

## Chrome QA

Real server, hard refresh, `CARNET ARCHIVE` / `2026년 8월`:
- Core Metrics unchanged: Revenue 10,883,059원 / Units 32개 / Orders 25건 / AOV 435,322원 / Inventory 272개— all pixel-identical to BATCH A's baseline.
- SKU Drawer (opened via `openEntityDrawer("sku")`, the same quick-jump entry point the Quick Profile "SKU" chip uses): **3 real rows** — `HAND COATED MASS VEST OIL BLACK` (628,139원 · 1개 · 628,139원 객단가), `Unearthed Fragment Chain Oil Black` (269,660원 · 1개), `Burnt Silver Dog Tag Burn Silver` (124,160원 · 1개) — matching "이번 기간 판매 상품 수 온라인 3개" already shown on the Hero. All 3 show 현재 재고 `-` (Case B — no `verified+confirmed` Product Registry entry for CARNET this session, the disclosed limitation above, not a bug).
- Search: typed "Burnt" → correctly filtered to the 1 matching row.
- Sort: "온라인 매출 높은 순" → correctly ordered 628,139 → 269,660 → 124,160.
- Brand-switch stale guard verified live: opened the SKU Drawer, called `applyBrandIdentity("BONNAE")`, drawer closed (`hidden: true`) within one refresh cycle. Switched back to CARNET ARCHIVE — Core Metrics and SKU Drawer both correctly repopulated with CARNET's real data again.
- BATCH A regression check: TOP5 customer "이지은 실장님" hover card still shows real purchase data (3,548,700원 / 7건 / 506,957원 / 2026-08-08) with real recent-order lines. Its "SKU" mini-chip correctly opened the same SKU Drawer with breadcrumb `CARNET ARCHIVE › SKU` — the Category→SKU navigation chain is intact.
- Console: zero application errors across the full session (only the 3 pre-existing, unrelated browser-automation-extension "message channel closed" artifacts noted in BATCH A's report, not application code).
- Not demonstrated live (disclosed above, not attempted further): a real Case A (matched sales+stock) row and a real Case C (stock-only) row — no brand currently has both a confirmed registry entry and an actual August online sale for the same product.

## Remaining Limitations (disclosed, not fixed in this batch)

- Product Registry confirmed-match coverage is very sparse (17/177 system-wide, 0/3 for CARNET) — most SKUs will show `현재 재고 -` until more registry entries are reviewed/confirmed. This is a data-maturity gap in an existing, out-of-scope system (Product Registry review workflow), not something this batch could or should fix.
- Category section still has no source (unchanged, BI-GAP-1) — the Category→SKU chain shows the same brand-wide SKU list regardless of which category was clicked from, exactly as before this batch.
- Order drawer (`next: "order"` from a SKU row) remains empty — no source exists, not force-extended with fake data, per explicit scope instruction.
- `entitySkuJoinDiagnostics` (matched/unmatched/stock-only counts) is computed and held in memory for potential future surfacing but is not yet rendered anywhere in the UI — no phase required a visible diagnostics panel, so none was added.

## Commit

```
92cba37 feat(brand-intelligence): connect customer purchase detail   (already committed, prerequisite)
<next>  feat(brand-intelligence): connect sku sales and stock drilldown   (this batch)
```

## Next Recommended Batch

Category Intelligence still has no canonical source (per BI-GAP-1) and remains the largest unconnected surface in Brand Intelligence. Outside that, improving Product Registry confirmed-match coverage (a data workflow, not a code batch) would be the highest-leverage next step to make Case A/C visible in Chrome QA for future batches.
