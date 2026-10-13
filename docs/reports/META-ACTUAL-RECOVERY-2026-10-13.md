# Meta actual-order recovery — 2026-10-13

## Existing structure and evidence

Base: GitHub main b234a85, independently cloned without modifying the original dirty local repository. Previous db33ef5 / f518e23 / b2788c3 changes are present on main. b0dcbfb introduced the Analytics join and 6df079a re-applied strict inflow query provenance. There is no independent evidence establishing a date when the complete production pipeline previously worked; this investigation verifies the existing matching helper against current production records.

- `server.mjs`: `fetchCafe24AnalyticsOrderDetails` reads Cafe24 Analytics `/sales/orderdetails`; `fetchCafe24ActualOrdersForWeeklyReport` queries five existing ghost tracking codes; `cafe24GetOrders` retrieves Admin orders and item details.
- `scripts/meta-actual-products-sold.mjs`: exact `order_id` Analytics join; `ad=ig`, `medium=paid` establishes paid Meta acquisition, `content` matches the exact Meta ad ID. Actual products, quantities and payments come exclusively from Admin Orders. Canonical amount/cancellation helpers are shared with existing commerce.
- `scripts/meta-ads-weekly-report.mjs`: current/prior Meta Insights by campaign/adset/ad; ACTUAL_PRODUCTS_SOLD; original workbook sheets remain.
- `intelligence-service.mjs`: advertising overview previously hardcoded `actualCommerce: null`. The MCP read tool already passes this field through; it does not itself collect commerce.
- Runtime data remains on the Render work/persistent store: Meta snapshots, Cafe24 canonical caches, orders-debug log and token store. No token, tracking store or cache was explicitly deleted or reset in this task. Existing automatic GET cache/log/token-refresh behavior remains intact. Only existing authenticated GET endpoints were called in production; existing server-side GET cache/log behavior was not changed.

## Exact causes

1. Overview actualCommerce was explicitly disconnected/hardcoded null, independently of order authentication.
2. The weekly collector returned only orders found by five inflow_path filters. All five current and prior-period requests succeeded with zero rows. This discarded the Analytics-paid order already supported by the matching helper. Reproducing the old collector inputs produces zero verified actual orders; adding exact Admin/Analytics evidence yields one.
3. The automatic Meta report uses Monday–Sunday and its latest status path was META_ADS_WEEKLY_2026-10-05_2026-10-11.xlsx, rather than the requested Tuesday–Monday period. The recovery explicitly requests 2026-10-06–2026-10-12 and compares 2026-09-29–2026-10-05, without silently changing the scheduler default.
4. Orders is already called with API version 2026-03-01 (both response and debug log), not a pre-2025-07-01 version. Production status/Orders/Analytics requests succeeded with HTTP 200 using existing internal authentication.

## Minimal changes

- Keep five inflow queries, their validation, conflict handling, legacy-unreliable labels and fail-closed rules. The weekly generator opts into an additional unfiltered strict Admin reader; Analytics `ig/paid` IDs are joined exactly to it and unioned with confirmed inflow orders.
- Never use Analytics order_amount or Meta purchaseValue as actual paid amount. Incomplete collection/capped responses or an Analytics-paid order missing its Admin match are unavailable.
- Advertising overview reuses the same existing matching helper, with complete direct Orders and Analytics inputs. Verified production-capture replay changes actualCommerce from null to a summary with one paid order / 198000 KRW, while both platform metric objects remain byte-equivalent.
- Remove campaign-first-ad name guessing; unknown content IDs stay explicitly unidentified.
- Distinct order_item_code/item_no values are distinct lines even for the same SKU. Repeated item snapshots and order IDs are deduplicated. Existing canonical cancellation/refund/partial-claim rules remain unchanged.
- Add explicit seven-day period and optional common REPORT rendering to the Meta generator. Existing default generator/scheduler sheet/date behavior remains unchanged. CTR inputs are ratio values and use true Excel percent formatting (0.007715 => 0.77%).
- The Git-tracked 1-page REPORT template exists for Instagram/Naver, not Meta; no Meta-specific original was found locally or in Git history and the Dropbox connector was unavailable. This workbook reuses the existing shared SAMPLAS layout, retains all original Meta detail sheets, and is a review copy pending any supplied Meta-specific original.

## Verified commerce

Current: Analytics 29 records, Admin 33 orders; all 29 Analytics order IDs match Admin. Five ghost filters are 0. Nine Admin orders are excluded by the existing cancellation/refund rule; one partial-claim order retains canonical handling. Raw duplicate order IDs: 0.

- Order: 20261011-0000055, placed 2026-10-11 20:33:59 +09:00, paid=T, canceled=F.
- Analytics: ad=ig, medium=paid, campaign=120216362640650277, content/ad=120250012266880277.
- Exact Meta ad name: 착장 광고.
- Product: [Meantime : 민타임] Schwarze Stunde wax coated multi panels denim pants black.
- Option: COLOR=BLACK, SIZE=XL. Quantity 1. Verified actual payment 198000 KRW. This order has one active item and no cancelled claim quantity.
- Prior period: one confirmed paid order, 78000 KRW.
- Current Meta platform metrics remain separate: spend 797020 KRW, purchases 7, attributed revenue 1720000 KRW, ROAS 2.158038694, CPA 113860 KRW, CTR 0.771513353%, CPC 267.7258986 KRW.

The verified one order is not asserted to cover every Meta-influenced sale; untracked orders are never inferred as ad orders.

## Validation

- Related Cafe24 / Meta / Instagram / Naver weekly, scheduler, one-page, Analytics and canonical tests: 171 PASS.
- Final whole repository suite with `--test-concurrency=4`: 1559 tests, 1528 PASS / 29 baseline FAIL / 2 SKIP.
- Unchanged current-main baseline, same setting: 1550 tests, 1519 PASS / 29 FAIL / 2 SKIP. Failure locations match exactly; new failures 0. Earlier unconstrained parallel execution caused three timing failures, which disappeared under bounded concurrency.
- `npm run check`, `node --check intelligence-service.mjs`, `git diff --check`: PASS.
- REPORT print area renders as a single A3 portrait page. Korean font rendering was verified with an isolated Fontconfig configuration. Workbook readback confirms exact dates, 198000 actual payment, one quantity, separate Meta values and unmodified ratio CTR. Repeated item/order and cancellation/refund/partial cancellation scenarios pass.
- Final JSON/XLSX were scanned against configured credential values: 0 matches. Customer names, addresses, email, banking details and tokens are not included in output evidence.

## Outputs and production status

Output folder: /Users/binggu/Desktop/SAMPLAS CONTENTS/REPORTS/META/2026-10-06_2026-10-12

- META_ADS_WEEKLY_2026-10-06_2026-10-12_VERIFIED.xlsx
- VERIFICATION.json: sanitized Admin/Analytics order evidence, actual and platform summaries, cancellation audit and capture hashes.
- API_BEFORE_AFTER.json: current production null versus the modified local handler replay on production snapshots; platform values unchanged.

No push, deployment, remote report upload or production code/config changes. Production still returns actualCommerce:null until approved deployment. Risks: overview adds two authenticated Cafe24 reads; weekly adds an unfiltered strict Orders read; caps above the existing 100 Analytics / 500 Orders bounds explicitly return unavailable. Deployment approval must cover the reviewed commit, then repeat GET verification and compare the exact paid order/amount. Original local changes remain untouched.

## Existing baseline failure locations

- test at test/api-read-auth.test.mjs:16:1
- test at test/brand-intelligence-offline-attribution.test.mjs:71:1
- test at test/brand-master-integrity-audit.test.mjs:77:1
- test at test/cafe24-full-product-catalog.test.mjs:88:1
- test at test/category-review.test.mjs:46:1
- test at test/category-review.test.mjs:64:1
- test at test/category-review.test.mjs:130:1
- test at test/monthly-performance-ia.test.mjs:43:1
- test at test/production-ecount-import.test.mjs:84:1
- test at test/runtime-resolver-workdir.test.mjs:19:1
- test at test/store-filter.test.mjs:59:1
- test at test/store-filter.test.mjs:67:1
- test at test/store-filter.test.mjs:81:1
- test at test/store-filter.test.mjs:94:1
- test at test/store-filter.test.mjs:105:1
- test at test/store-filter.test.mjs:124:1
- test at test/store-filter.test.mjs:138:1
- test at test/store-filter.test.mjs:150:1
- test at test/store-filter.test.mjs:159:1
- test at test/store-intelligence-live-data.test.mjs:128:1
- test at test/store-performance.test.mjs:45:1
- test at test/store-performance.test.mjs:56:1
- test at test/store-performance.test.mjs:73:1
- test at test/store-performance.test.mjs:88:1
- test at test/store-performance.test.mjs:182:1
- test at test/unified-identity-resolver.test.mjs:177:1
- test at test/unified-identity-resolver.test.mjs:188:1
- test at test/unified-identity-resolver.test.mjs:205:1
- test at test/unified-identity-resolver.test.mjs:227:1

## Changed files

- server.mjs
- intelligence-service.mjs
- scripts/meta-actual-products-sold.mjs
- scripts/meta-ads-weekly-report.mjs
- scripts/weekly-onepage-report.mjs
- test/meta-analytics-recovery.test.mjs
- test/meta-inflow-weekly-orders.test.mjs
- test/advertising-overview.test.mjs
- docs/reports/META-ACTUAL-RECOVERY-2026-10-13.md
