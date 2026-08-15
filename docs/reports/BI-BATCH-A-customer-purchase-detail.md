# BI-BATCH-A — Customer Purchase Detail

Implemented, tested, and verified in Chrome. Two commits, no push, no deploy.

## Pre-Flight

```
branch = main
HEAD (start) = 24cf20efd0142e18bd1cdf4b1c828bc720f9b7f4
status: outputs/samplas-marketing-os.js modified, test/brand-intelligence-partial-period.test.mjs modified,
        5 BI-CORE/BI-GAP reports untracked, nothing staged — exactly the state BI-GAP-1 recorded.
```

## BI-CORE-4 Checkpoint

Staged exactly `outputs/samplas-marketing-os.js` + `test/brand-intelligence-partial-period.test.mjs` (verified via `git diff --cached --stat` before committing — the 5 report files were confirmed still untracked afterward). Committed as `c9d90f4 fix(brand-intelligence): preserve null vs zero metric states`. This is the NULL != ZERO error-state guard from the prior session (targeted 108/108, full regression 342/342, Chrome QA already re-confirmed then and again in this session).

## Exact Clients Payload Trace (Phase 2 — read from source, not assumed)

`GET /api/intelligence/clients?since=YYYY-MM-DD&until=YYYY-MM-DD` (`server.mjs:608-621`) → `buildClientsOverview()` (`intelligence-service.mjs:2569-2915`, unmodified — this batch only *reads* it).

Top-level response: `{ ok, periodStart, periodEnd, summary, typeBreakdown, stylistTop10, pressTop10, ffTop10, clients: [...] }`.

Each `clients[]` entry:
```
{ clientId, name, clientType, salesStaff, contact, latestPurchaseDate, purchaseCount,
  onlineSales, offlineSales, totalSales, avgOrderValue, aliases: [...], purchaseDetails: [...],
  purchaseDateCounts, products }
```

Each `purchaseDetails[]` line:
```
{ date, orderId, productName, brand, canonicalBrandCode, canonicalBrandName, brandConfidence,
  operationalBrandGroup, quantity, salesAmount, source: "online" | "offline", rawName }
```

**Granularity is mixed, confirmed live**: offline lines are per-product-line (multiple lines can share one `orderId` = ECOUNT `slipNo`/`documentNo`); online lines are per-Cafe24-order with no product breakdown (`productName: null` always — personal-payment orders carry no real product data). **`canonicalBrandCode` is structurally `null` for every online line, always** (`intelligence-service.mjs:2757-2760`, by explicit prior design — "온라인(개인결제창) 주문은... canonical 조회를 시도하지 않는다") — offline lines get a real resolved code via `resolveIdentity()`. This means: filtering by `canonicalBrandCode` structurally surfaces offline purchases only. This is not a limitation introduced by this batch; it is inherited, disclosed, and not worked around (no new inference was added).

Live-verified against the real server (`GET /api/intelligence/clients?since=2026-08-01&until=2026-08-31`): 55 customers for August, 14 with at least one CARNET-attributed (offline) line, `orderId` present and populated for offline lines, field names exactly as above.

## Identity Matching Decision (Phase 3)

Searched for existing normalization helpers before writing anything: `intelligence-service.mjs` already computes `clientMergeKey()`/`extractClientMatchKey()`/`classifyClientType()` to merge every raw ECOUNT name variant (e.g. 23 aliases for one real person, confirmed live) into one `clients[]` entry, exposing the full alias list as `client.aliases`. `buildBrandCustomerComposition()` (Brand Intelligence's existing Customer Composition source) does **not** merge aliases — its `row.name` is one specific raw ECOUNT name.

**Decision**: no new normalization rule was written. `entityClientOverviewMatchFor(row)` matches `row.name` against `client.name === row.name || client.aliases.includes(row.name)` — exact string matching only, against the alias list `buildClientsOverview()` already computed correctly. This reuses the existing canonical merge result rather than re-deriving identity client-side.

## Brand Filter (Phase 5)

`entityClientPurchaseLinesFor(row)` = matched client's `purchaseDetails.filter(line => line.canonicalBrandCode === brandIdentityState.brandCode)`. Uses the canonical `brand_code` already resolved by `resolveBrandIdentity()`/the Unified Identity Pipeline — no text/name matching against brand at any point.

## Fetch/State Architecture (Phase 4)

One new fire-and-forget call, `refreshEntityClientsOverview(periodMonth)`, added alongside the existing `refreshEntityCustomerComposition`/`refreshEntityInventory`/`refreshEntityCompareKpi` calls inside `refreshEntityTrendMonths()` — the single existing trigger point for brand/period changes. Fetches **once per period** (brand-independent — the endpoint returns the whole company's clients), reusing `getSharedJson`/`intelligenceUrl`/`monthlyReportMonthRange`, exactly the pattern every other Brand Intelligence secondary fetch already uses. Brand filtering happens at read time (`entityClientPurchaseLinesFor`), so switching brands within the same period costs zero additional network calls. A dedicated `entityClientsOverviewRefreshSeq` counter guards against a stale in-flight response overwriting a newer one, mirroring `entityTrendRefreshSeq`'s existing pattern exactly.

## UI Areas Unlocked

- **Quick Profile card** "최근 주문": up to 3 real lines (date/product/amount), or the appropriate empty/loading/failure state.
- **Client Workspace "Brand" section**: real total (구매금액/수량/건수/최근구매일) for the selected brand.
- **Client Workspace "Recent Orders" section**: up to 5 real lines, reusing the previously-unwired `clientWorkspaceOrderRowHtml`.
- **`entityDrawerConfig.clientOrders`** (the full "최근 주문 Drawer"): real, searchable, sortable rows via the corrected `entityDrawerClientOrderRowHtml` (old placeholder fields `product`/`amount`/`variant` — none of which exist in the real payload — replaced with `productName`/`salesAmount`/a real `source` channel badge; the fabricated "옵션" stat was removed rather than filled with a fake value).
- **Category section**: left exactly as-is ("고객별 상품군 데이터 연결 대기") — out of scope, no source exists (BI-GAP-1 §4).

## State Semantics (Phase 10)

Three states, one shared helper (`entityClientPurchaseStateHtml`), used identically by Quick Profile and Client Workspace:
- fetch failure → "구매 내역을 불러오지 못했습니다." (never "없습니다")
- not yet loaded → "불러오는 중..."
- loaded, zero brand-matching lines → "이 브랜드 구매 내역이 없습니다."
- loaded, real lines → real rows.

**Brand/period switch stale-data guard**: `refreshEntityTrendMonths()` now closes any open Client Workspace and any open `clientOrders` Drawer at its very first lines, before any brand/period branching — verified structurally (test #10) and live in Chrome (see QA below): opening the Workspace, then re-applying brand identity, closed it within one refresh cycle every time.

## Files Changed

- `outputs/samplas-marketing-os.js` (164 insertions, 29 deletions this batch — separate from the already-committed BI-CORE-4 diff)
- `test/brand-intelligence-customer-purchase-detail.test.mjs` (new, 11 tests)

No HTML/CSS file touched — all new content reuses existing markup shells (`.entity-detail-empty`, `.cards.brand-hero-kpi-grid`, `.action-item.ad-core-kpi-card`, `.client-workspace-order-row`, `.entity-drawer-row`).

## Tests

New file: 11/11 PASS (matching/filtering, both state-html branches, Workspace Brand-section totals, Recent-Orders row content excludes other brands, drawer row template fields, population-before-open wiring, stale-data guard placement, fetch-architecture reuse).

Targeted (new file + Brand Intelligence + Brand Identity + Compare Mode + STEP67-adjacent): **106/106 PASS**.

Full regression: **353/353 PASS, 0 fail, 0 skipped** (342 prior baseline + 11 new).

## Chrome QA

Real server, hard refresh, `CARNET ARCHIVE` / `2026년 8월`:
- Core Metrics unchanged: Revenue 10,883,059원 / Units 32개 / Orders 25건 / AOV 435,322원 / Inventory 272개.
- TOP5 customer "이지은 실장님" (real, 3,548,700원 / 7건 / 506,957원 / 2026-08-08): Quick Profile "최근 주문" showed 3 real product lines with real amounts (previously the static "연결되지 않았습니다" text).
- "최근 주문 보기" opened the drawer with 7 real rows, breadcrumb "CARNET ARCHIVE › 최근 주문", working search/sort controls.
- "고객 상세 Workspace 열기" opened the Workspace: Customer section unchanged, **Brand section populated with real totals** (previously static empty text), **Recent Orders populated with 5 real rows** + a working "최근 주문 Drawer 열기" button, Category section correctly untouched.
- Brand-switch stale-data guard verified live: opened the Workspace (`hidden: false`), called `applyBrandIdentity()` (the function the Brand Selector itself calls), Workspace closed automatically (`hidden: true`) within one refresh cycle.
- Console: zero errors or warnings from this batch's code across the entire session (the only console exceptions present are a generic, unrelated "message channel closed" artifact from the browser-automation extension itself, not application code); the only `[Brand Identity]`/`[Brand Intelligence]` log lines were the pre-existing successful `FOUND` diagnostic — no `clients fetch failure` warning ever fired, confirming every fetch in this QA session succeeded.

## Remaining Limitations (disclosed, not fixed in this batch)

- Online (Cafe24 personal-payment) purchases never appear in Brand/Recent Orders for any brand — structural, inherited from `buildClientsOverview()`'s existing design (no product data exists to resolve a brand from), not something this batch could safely infer without violating the codebase's own "no guessing" principle.
- Category section remains unconnected (Category Intelligence has no canonical source anywhere, per BI-GAP-1).
- Quick Profile's hover card does not live-update if the clients fetch is still in flight when first hovered (disclosed design choice, BI-GAP-1/this report — the fetch starts as soon as brand/period changes, so in practice it is almost always settled before a user hovers a TOP5 row).
- `next: "sku"` on the drawer's row click still lands on the (separately, honestly) empty SKU drawer — unchanged pre-existing behavior, SKU drawer implementation is explicitly out of this batch's scope.

## Commits

```
c9d90f4 fix(brand-intelligence): preserve null vs zero metric states   (BI-CORE-4 checkpoint)
<next>  feat(brand-intelligence): connect customer purchase detail     (BATCH A)
```

## Next Recommended Batch

BI-BATCH-B — Per-SKU sales + stock drill-down (per BI-GAP-1's roadmap: `commerce.productSales`, already fetched by every Monthly request, has full per-SKU online revenue/quantity/order-count fields currently unused beyond a `Set`-based count; `GET /api/inventory/overview?brand=` already supports per-SKU stock queries).
