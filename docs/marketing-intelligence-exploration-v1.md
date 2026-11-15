# SAMPLAS Marketing Intelligence | Exploration Workspace v1

Status: DESIGN ONLY / READ-ONLY / NO PRODUCTION CHANGE  
Date: 2026-11-15 (KST)  
Basis: production source on GitHub main + live read-only Marketing OS CRM, acquisition, advertising and sales endpoints inspected on 2026-11-15.

## 1. Product contract

**Marketing Intelligence is a self-directed analysis workspace, not a report which announces a strategy.** A marketer chooses the question and time period, sees how the result was calculated, segments it, compares it, traces evidence, then makes an independent decision. New-customer growth and repurchase are *available lenses*, never the predetermined conclusion.

Acceptance question: "What changed? Where? Which customers/products/brands/channels contributed? What is observed versus merely suspected? What should I check next?" Every number is explainable in one click.

### Non-goals
- No automatically asserted causes ("Meta caused sales", "need more new customers").
- No marketing spend, coupon issuance, CRM messaging, product tagging or order mutation.
- No fabricated attribution when joining Meta/Naver click events to Cafe24 orders.
- No separate marketing-intelligence browser page: keep existing OS sidebar and content view.
- Do not change unrelated Marketing, Content, Commerce, store dashboards or data collectors.

## 2. Navigation and experience

Keep one sidebar entry: **Marketing Intelligence**. Inside it use **4 analysis tabs** with persistent filters:

1. **Overview (매출 구조)**: sales, order count, paid amount/order, customer/order type mix, period comparison, exact contribution to change.
2. **Customers (고객 흐름)**: first confirmed purchase, verified repeat purchase, unidentified/guest/NaverPay/personal-payment breakdown, 30/60/90-day cohort maturity, purchase frequency. Do NOT call a guest a first-time customer.
3. **Acquisition & Campaigns (유입·광고)**: actual first-purchase attribution recorded in Cafe24 Analytics, Meta/Naver platform spend, impressions, clicks and *platform-reported* conversions clearly separated. Show link/tracking coverage and UNKNOWN, not a fictional cross-platform ROAS.
4. **Products & Content (상품·콘텐츠)**: brand/product sales contribution, entry price band, stock and availability, organic content performance and creative-type classification, event/popup exposure. Implement as source-backed drilldown only once a safe product/order/brand and post/product mapping exists.

Navigation starts from a question, not a KPI list. Offer neutral entry shortcuts such as:
- "매출이 변한 이유를 살펴보기" -> revenue decomposition.
- "처음 구매한 사람은 어디서 왔나?" -> acquisition with tracking caveats.
- "어떤 구매 고객이 다시 구매하나?" -> cohort.
- "어떤 브랜드·상품이 변화를 만들었나?" -> product/brand sales when identity coverage is proven.
- "콘텐츠 반응과 구매는 어떻게 다른가?" -> content + commerce side-by-side, explicitly not causal when no joining key.

### Initial desktop wireframe

```text
┌── existing SAMPLAS OS sidebar ─┬────────────────────────────────────────────────────────────┐
│ Today · Commerce · Content     │ Marketing Intelligence                                     │
│ Marketing Intelligence [active]│ [기간: 2026-10 ▾] [비교: 직전 월 ▾] [매장/채널: ONLINE ▾]   │
│ ...                            │ [Overview] [Customers] [Acquisition] [Products & Content]│
│                                │                                                            │
│                                │ 온라인 매출  | 주문 건수  | 주문당 평균 결제금액            │
│                                │ [vs comparison] + details on each metric                 │
│                                │                                                            │
│                                │ ① 매출 구성: NEW | REPEAT | GUEST | PERSONAL | UNVERIFIED │
│                                │    [stacked shares] -> click a segment -> orders/brands   │
│                                │ ② 증감 기여: which component contributed ± amount         │
│                                │ ③ 월별 흐름 + drilldown by brand/product/channel          │
│                                │                                                            │
│                                │ 알아낸 사실 / 확인되지 않은 가설 / 다음 확인할 데이터     │
│                                │ [Data quality ▸]                                           │
└────────────────────────────────┴────────────────────────────────────────────────────────────┘
```

On mobile use stacked cards, one accessible horizontal scroll for wide period tables, and no whole-page overflow.

## 3. Filter contract

- Default: **latest fully elapsed calendar month in Asia/Seoul**; do not default to a hardcoded 7–10 month range.
- Presets: 1/3/6/12 completed months, custom YYYY-MM range, optionally future daily granularity only where ALL implicated sources support day-level correctly.
- Comparison: prior period equal length; same period previous year; manually entered equal-length period; no comparison. Comparison dates and labels MUST update every panel. Never use a hardcoded "작년/올해" label under a prior-month comparison.
- Online vs offline channel is a separate dimension. Current customer segmentation is *online Cafe24 only*. Do not blend with offline customer types or falsely apply a store filter to CRM data.
- All metric tiles and drilldowns must state active range, comparison range, basis and whether provisional. Debounce filter changes, cancel or ignore stale requests, return a per-panel error rather than blanking the whole UI.
- If any needed comparison month predates coverage, current numbers remain visible, comparison marked unavailable. Missing is null, never zero.
- Persist the selected tab and filters in shareable URL query/hash without leaking private customer data. "Back" restores state. This is a *future implementation target*, not yet implemented.

## 4. KPI dictionary and accounting rules

| Metric | Business meaning | Formula / source | Watch out |
|---|---|---|---|
| Online paid sales | Actual Cafe24 paid order revenue | canonical paid amount /api/crm/monthly or /api/sales/total | agree on consistent order/cancel cut; not ad platform conversions |
| Orders | Valid orders in same population | CRM monthly total.orders | must match the revenue numerator population |
| Amount/order | Online paid sales / valid orders | only when both available and orders > 0 | don't label as customer lifetime value |
| New verified member sales | Verified first-purchase customer orders, according to current CRM classification | /api/crm/monthly newMembers.amount | purchase history may be incomplete |
| Repeat verified member sales | Member orders with earlier verified purchases | repeatMembers.amount | not equal to repeat *rate* |
| Unverified-member sales | Member historical first purchase unknown | unverifiedMembers.amount | not automatically NEW/REPEAT |
| Guest sales | Anonymous Cafe24 orders including NaverPay | guests.amount | do NOT assume guest = new customer |
| Personal-payment sales | Separate special payment-window orders | personalPayment.amount | do NOT assume stylist/staff |
| Unknown identity | Orders where even member/guest status is unverified | identityUnknown.amount | display separately |
| 30/60/90d repurchase | Cumulative repeat rate for first-purchase cohort | /api/crm/cohort status=MATURE only | IMMATURE/UNVERIFIED = not a usable rate |
| Acquisition channel | Tracked channel/medium on first confirmed purchase | /api/crm/acquisition firstPurchaseChannels | order join coverage != attribution validity |
| Paid-platform metrics | impressions/clicks/spend/platform conversions | /api/advertising/overview | platform ROAS cannot be relabeled Cafe24 realized ROAS |
| Content engagement | views/reach/saves etc per social post | /api/instagram/range /monthly and content sources | engagement and sales are separate funnels |
| Brand/product contribution | order-line paid sales allocated to canonical brand/product | Product Sales/identity API: JOIN validation needed | NEVER infer from product catalog only |

**Accounting invariant** for matched periods:  
`total.amount = newMembers.amount + repeatMembers.amount + unverifiedMembers.amount + guests.amount + personalPayment.amount + identityUnknown.amount`.  
Do not render the stacked percentage as reconciled if any part null, unequal, or overlapping. Detailed classes must not double-count.

**Period comparison**: absolute difference, % difference only with nonzero verified baseline; use contribution waterfall (component Δs exactly sum to total Δ). Compare *order count* and *average order value* in the same period to identify mechanical drivers, without making causal claims.

## 5. Drilldown contract (what click should do)

Every visual supports a breadcrumb and "Back to the same selection":

**Revenue amount** -> segments NEW / REPEAT / GUEST / PERSONAL / UNVERIFIED / UNKNOWN -> monthly trend -> segmented orders / brands / products ONLY when a server endpoint exists with complete accounting and safe identifiers.

**New customers** -> first verified purchases -> month/time -> acquisition classified/direct/unknown -> landing/page/category and entry-price band IF sourced; show "Not measured" when there is no join. A default direct group is not necessarily organic or unattributed advertising.

**Repeat customers** -> cohort month -> completed 30/60/90d windows -> counts, denominator, eligible population and maturity, by product/brand only if joined safely.

**Brand/product** -> revenue contribution -> order-count/average-price/discount/stock/availability -> exposure from social/paid as adjacent signals. No creative attribution unless reliable post-click/order product join exists.

**Content** -> account (SAMPLAS vs SAMPLAS_VEIL), format (Reels/feed/cardnews/story/event-popup), publish period -> reach/engagement/save rate -> links and actual recorded purchases side-by-side. Highlight mapping coverage and content taxonomy limitations.

Each chart has a short "이 숫자는?" explanation, exact numerator/denominator, source, freshness, filters, caveats, and a "원천 근거" expandable section. No 70-row diagnostics on the primary canvas.

## 6. Source inventory: verified existing vs missing work

Existing and observed:
- /api/crm/monthly: online member new/repeat/unverified, guest/NaverPay, personal payment, unknown, orders and paid amounts; read-only; quality PARTIAL.
- /api/crm/cohort: 30/60/90d maturity status, currently some IMMATURE.
- /api/crm/acquisition: firstPurchaseChannels, allOrderChannels, analyticsCoverage, matchRate; PARTIAL and known Naver attribution anomaly.
- /api/crm/data-quality: closeStatus=NOT_FINAL and POST_SNAPSHOT_CANCELS_UNVERIFIED, history gaps.
- /api/advertising/overview: Meta/Naver platform spend/click/conversions, but currency_unverified and attribution limitations.
- /api/sales/total: online/offline overall paid sums; **sales endpoint COMPLETE does not upgrade CRM customer attribution to COMPLETE**.
- /api/instagram/monthly, /api/instagram/range, /api/instagram/stories are implemented server routes.
- /api/products/dashboard and /api/intelligence/brands, /api/intelligence/product-registry, /api/intelligence/clients exist as separate business APIs. Their source agreement and join cardinality need verifying before customer-product conversions are shipped.

Not yet proven or absent in reviewed contracts:
- Cross-order-line/brand/customer acquisition fact with stable, validated product identity & net paid allocation.
- Reliable stylist/staff online-order tag.
- Trustworthy paid click → session → order joined identity for incremental campaign ROI.
- SAMPLAS_VEIL IG account historical data coverage and consistent post classification.
- Trustworthy brand/category/entry-price purchase funnel and stock aligned to order date.
- Action or campaign impact evaluation with measured control periods.

**No front-end claims without a tested source contract.** New read-only aggregate endpoint should be added only as needed, e.g. `GET /api/marketing-intelligence/explore?start=...&end=...&compareStart=...&compareEnd=...&dimension=...`. This is PROPOSED, NOT an existing route. Return `{ok,data,meta:{source,period,coverage,completeness,dataAsOf,closeStatus,issues}}` and explicit nulls.

## 7. Observed reality check (2026-10, source-backed, not finalized)

- CRM monthly 2026-10: online paid revenue 39,462,706 KRW across 106 valid orders.
- Composition: new 6,142,730; repeat 16,654,950; unidentified-history members 1,378,000; guest 13,503,726 (NaverPay subset 12,825,726); personal-payment 1,783,300; unknown identity 0. Reconciles to 39,462,706.
- CRM quality: PARTIAL and NOT_FINAL with unverified post-snapshot cancellations and history gap.
- Acquisition: Oct first purchases direct/no ad 17 members, IG social 3, Naver Shopping 1; these numbers are tracked classification, not verified causal attribution.
- Advertising Oct: Meta spend 2,297,946; Naver spend 590,633; platform conversions 60/202; Meta/Naver issue currency_unverified. Never treat paid-platform conversions as Cafe24 order count.
- Sales summary online 39,462,706 and offline 317,013,300. Offline must remain out of online CRM cohort denominators.

## 8. Insight and causal-language policy

The interface has **three layers**, explicitly separate:
1. **FACT** (observed): e.g. "신규 회원 매출 -X vs previous period", with date, source, coverage.
2. **QUESTION / HYPOTHESIS**: e.g. "Was decline driven by fewer orders, smaller baskets, entry-price availability, or misattributed acquisition?"
3. **NEXT DATA TO INSPECT**: named drilldown, required join, or checklist. Do not output "must increase new customer sales" as a foregone strategy.

Recommendation text is optional, generated only from available evidence and worded as *investigate/experiment/measure*. Every candidate has evidence references, expected measurable output, and limitation. No assistant-sounding advice banner or definitive marketing orders.

Example grounded inquiry:
"Online paid revenue changed -12.3% vs same period last year, but new-member revenue changed -15.4m while personal payments rose +8.4m. Check first purchase count and tracked channel history; do NOT assert the Naver drop is caused by ads until tracking is audited."

## 9. User actions and drill-down states

- Click filter: all panels update atomically with the same dates and comparison; stale requests ignored.
- Click KPI: open diagnostic detail with formula, monthly trend, segmentation, source quality, possible next drilldowns.
- Click segment: preserve selection, show contribution and eligible details; when missing, explain required data.
- Click a comparison cell: show numerator/baseline/absolute/% and data coverage.
- Switch to "No comparison": suppress comparative conclusions and show absolute distribution only.
- Data quality: single collapsible label (VERIFIED/REVIEW/BLOCKED **per metric**, not global) with source and action.
- Empty/error states: "No verified data" and "API failed" remain distinct; use partial other panels without crashing.
- Download CSV/export: only after query contract, permissions and reconciliation tests; all rows carry period/source/quality metadata.
- Note/bookmark an insight: design later after identity/privacy/storage approval; do not create persistent records yet.

## 10. Build plan and release gates

**Phase A (existing API, low risk)**: consistent tabbed exploration, unified date/compare context, dynamic revenue breakdown and waterfall, order-count/AOV decomposition, quality tooltip, monthly graphs, working drilldowns to supported totals. Avoid touching server data models.

**Phase B (read-only join verification)**: prove brand/product order sales, catalog identity, refunds, personal payments and store selection reconciliation for the same dates; only then add brand/product drilldown.

**Phase C (channel & content)**: align Instagram SAMPLAS/VEIL account coverage and event/popup taxonomy, show channel performance with consistent dates, monitor Naver tracking gaps, keep Meta/Naver platform metrics distinct from actual orders. Avoid cross-account reach summation without deduping.

**Phase D (decision notebook)**: optional user-selected hypotheses and experiment/results tracking after earlier data and permissions are trustworthy. No auto execution.

Release is **blocked** until all of these pass:
- test every 1/3/6/12/custom period, previous/year/custom/no comparison; timezone/year boundaries, invalid dates, baseline zero, max 12 months, missing history.
- numeric conservation for revenue segments and Δ waterfall; no double counts.
- data source coverage status reflected in each panel and period; NOT_FINAL not converted to VERIFIED.
- zero vs null handling, canceled/returned orders, guests/NaverPay, personalPayment, first purchase history uncertainty.
- back/forward navigation, segment drilldowns, proper mobile table overflow, keyboard/accessibility, no external-page tab.
- real authenticated desktop and mobile screenshots verified.
- regression of existing Content/Commerce/Marketing/Clients/Inventory and auth, no new failures.
- no code changes outside explicit scope; approved PR + deployment + production read-back.
- on failure: leave existing production untouched or rollback to known live commit, record what failed.

## 11. First implementation ticket

**MI-EXPLORER-001:** Replace single long report canvas with four navigation tabs and a reusable metric/period/quality/drilldown contract. Read only existing data. First functional vertical slice:

1. Overview: select 2026-10 vs 2026-09.
2. Revenue 39,462,706 split exactly across verified NEW/REPEAT/GUEST/PERSONAL/UNVERIFIED/UNKNOWN.
3. Click guest -> NaverPay subset, with 'unknown new/repeat' warning.
4. Click new -> acquisition source table, with Naver tracking quality warning.
5. Switch to 2026-08 to 2026-10 vs prior 3 months; all chart titles, totals, comparison deltas and detail links update together.
6. Change to custom comparison; preserve same month length, show per-metric completeness.
7. Click brand/product and show explicit "needs validated source" until join proof exists, not synthetic sales.
8. Exit to Commerce and back; former state preserved; no other view changed.

No production writes from this design task. Submit frontend/server schema changes only in separately reviewed implementation PRs.
