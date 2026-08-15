# BI-GAP-1 — Brand Intelligence Single-Brand Complete Data-Connection Inventory

READ-ONLY DIAGNOSIS. No source, test, HTML, CSS, or server file modified. Nothing staged, committed, pushed, or deployed.

## 1. Git Pre-Flight

```
branch = main
HEAD   = 24cf20efd0142e18bd1cdf4b1c828bc720f9b7f4
status:
 M outputs/samplas-marketing-os.js
 M test/brand-intelligence-partial-period.test.mjs
?? docs/reports/BI-CORE-1-core-metrics-data-flow-diagnosis.md
?? docs/reports/BI-CORE-2-live-browser-zero-mismatch-diagnosis.md
?? docs/reports/BI-CORE-3-live-fetch-capture-and-minimum-fix.md
?? docs/reports/BI-CORE-4-null-zero-error-state-guard.md
diff --stat: outputs/samplas-marketing-os.js (78 lines), test/brand-intelligence-partial-period.test.mjs (119 lines)
diff --cached --stat: (empty — nothing staged)
```

**BI-CORE-4's changes are confirmed NOT committed, NOT staged.** Nothing else pre-existing was touched or cleaned up. This diagnosis produced only this one new report file.

## 2-4. Full UI Inventory + Data Trace + Classification

Traced `outputs/samplas-marketing-os.html:1262-1900` (`#BrandDashboard`, the single-brand view) top to bottom against `outputs/samplas-marketing-os.js`, `server.mjs`, and `intelligence-service.mjs`, including code paths hidden by `hidden` attributes or empty backing arrays, not just what's currently visible. Full field-by-field trace and classification is in the table (§10). Key architectural findings that shape the whole picture:

- **Brand Score is a fully-built, deliberately hidden section** (`outputs/samplas-marketing-os.html:1445-1479`, comment: "Brand Score는 실제 계산 근거가 아직 없어 숨긴다... 계산이 완성되면 이 한 줄만 되돌리면 된다"). No health-score calculation function exists anywhere server-side or client-side for real data — the only `health` values in the codebase are inside `entityOverviewRows` (`outputs/samplas-marketing-os.js:15294-15303`), a fully hardcoded 8-row placeholder array (`{ name: "Brand E", health: 70, ... }` — includes literal fake names) used only by the separate, out-of-scope `#EntityOverview` multi-brand screen. **H — SOURCE NOT DEFINED**, same category as Sell-through.
- **The "Entity Drawer" is one shared component (`entityDrawerConfig`, `outputs/samplas-marketing-os.js:14890-15036`) with 6 types**: `customer`, `category`, `sku`, `order`, `clientOrders`, `overview`. Only `customer` (backed by `entityCompositionRows`, real data) and `overview` (backed by the placeholder `entityOverviewRows`, out of scope) have non-empty backing data. **`category`/`sku`/`order`/`clientOrders` are backed by literal empty arrays** (`entityCategoryDrawerRows = []`, `entitySkuRows = []`, `entityOrderRows = []`, `entityClientRecentPurchases = []`) — the drill-down navigation chain (Category→SKU→Order→Client), search, and sort all work structurally, but every one of those 4 drawer types currently renders an empty list.
- **The "Client Workspace" modal** (`outputs/samplas-marketing-os.js:13001-13070`) — opened from a customer's Quick Profile card — has a real, connected Header/KPI block (reuses `entityCompositionRows`), but its "Brand" section, "Category" section, and "Recent Orders" section are each explicit static empty-state text (`"고객별 브랜드 구매 데이터 연결 대기"`, `"고객별 상품군 데이터 연결 대기"`, `"상품 단위 주문 데이터가 연결되지 않았습니다"`), and "고객 등급"/VIP ring is `"산식 연결 대기"` (H, same class as Brand Score).
- **Customer Composition is offline-only** — `buildBrandCustomerComposition()` (`server.mjs:4102-4158`) iterates exclusively over `readEcountOfflineSalesSnapshot()` lines; it never reads Cafe24 online orders. For CARNET ARCHIVE (9.4% online / 90.6% offline revenue split, confirmed BI-CORE-1/2), this means the entire Customer Composition donut/TOP5/type-breakdown structurally excludes online customers — not a bug, but a real, previously-undocumented completeness gap. **C — PARTIALLY CONNECTED.**
- **Category Intelligence has no canonical source anywhere in the codebase** — confirmed by grepping `server.mjs`/`intelligence-service.mjs`/`scripts/*.mjs` for ECOUNT category codes (BG/OT/ST/BT/AC per the code's own comments) or any `category_code`/`categoryCode` field: zero matches. `entityCategoryRows = []` (`outputs/samplas-marketing-os.js:14520`) is permanently empty and **test-locked** (`test/cross-brand-partial-period-p2.test.mjs` test #18 asserts this exact line stays unchanged). **H — SOURCE NOT DEFINED**, confirmed at the deepest level, not inferred from UI text alone.
- **A significant, low-risk, already-fetched source is sitting unused**: `archive.commerce.productSales` (fetched by every Brand Intelligence Monthly request already, `server.mjs:3448-3472`) has full per-SKU fields — `productNo`, `productName`, `brand_code`, `quantitySold`, `orderCount`, `salesAmount`/`sales.paidAmount`, `salesVelocityPerDay` — for **online** sales. Today the frontend only extracts a `Set` of product numbers from it (`skuCount`, `outputs/samplas-marketing-os.js:13312-13318`); the revenue/quantity/order fields are already in memory, unused. Wiring the drawer's `sku` type to this (online portion) requires **zero new network calls**.
- **`GET /api/intelligence/clients?since=&until=`** (`server.mjs:608-621`, backed by `buildClientsOverview()` in `intelligence-service.mjs:2569`) already returns, per customer group, a `purchaseDetails` array with `productName`, `quantity`, `salesAmount`, `date`, `source` ("online"/"offline"), and — since the Unified Identity Pipeline migration (STEP63-3) — `canonicalBrandCode`/`canonicalBrandName`/`brandConfidence` **per line**. This is a materially richer, already-canonical, already-brand-attributed source than anything Brand Intelligence currently uses for Customer Detail, and it is not brand-filtered server-side (would need client-side filtering by `canonicalBrandCode`, or a small server-side query-param addition — no new calculation). **D — SOURCE EXISTS / FRONTEND NOT CONNECTED**, and the single highest-leverage find in this inventory (see §7-9).
- **`GET /api/inventory/overview`** (`intelligence-service.mjs:370-419`) already supports `?brand=<code>&limit=&offset=&sort=&status=&search=` and returns per-SKU `items` (not just the brand rollup Brand Intelligence's Hero currently consumes). A real per-SKU stock table for the selected brand is one fetch away. **D — SOURCE EXISTS / FRONTEND NOT CONNECTED.**
- **"추천 Action" (Recommended Action) is not computed at all** — `renderEntityHeroInsight()`'s `actionListEl.innerHTML` is always the exact same static disclaimer sentence (`"공식 추천 규칙 미확정 — ... Action threshold가 확정되기 전에는 행동을 자동 추천하지 않습니다."`, `outputs/samplas-marketing-os.js`), regardless of any input data. **H — SOURCE NOT DEFINED** (depends on Sell-through's threshold definition, per the text itself).
- **Core Metrics, Channel Mix, SKU-count line, Monthly Trend (chart/stats/AI Summary), System Status, and the "customer" drawer/Quick-Profile-header path are all A — CONNECTED + VERIFIED**, confirmed both by code trace and by the live Chrome QA already performed across BI-CORE-1 through BI-CORE-4 (CARNET ARCHIVE / 2026-08: Revenue 10,883,059원, Units 32개, Orders 25건, AOV 435,322원, Online 1,021,959원, Offline 9,861,100원, Inventory 272개, System Status Cafe24 Healthy). Re-verified as regression-safe only (not re-derived from scratch), per the instruction to move fast on already-proven areas.

## 5. Placeholder-Text Discipline

Every "연결 대기"/"미확정"/`--` UI text found was traced to its backing JS variable/array before classification — none were taken at face value. Two cases where the UI text is more pessimistic than the underlying code turned out to be: **Category** ("연결되지 않았습니다") — genuinely true, zero source exists anywhere, confirmed by repo-wide grep. **Sell-through** ("공식 산식 필요") — genuinely true, `docs/PROJECT_MEMORY.md`/`docs/ROADMAP_BACKLOG.md` (reconciliation-era reading) confirm this is a deliberately deferred, separate-workstream business definition, not a wiring gap.

## 6. Canonical Source Reuse Search

Searched `server.mjs`, `intelligence-service.mjs`, `scripts/*.mjs` for every candidate area named in the task instructions:

| Candidate area | Existing canonical function/endpoint | Reusable for Brand Intelligence? |
|---|---|---|
| Monthly brand sales (online+offline merged) | `buildMonthlyArchiveBrandSales()`/`mergeOfflineBrandSales()` via `GET /api/reports/monthly` | Already the Core Metrics source (A) |
| Per-SKU online sales | `commerce.productSales` (same Monthly response) | Yes — unused fields, zero new fetch (§4) |
| Customer aggregate (offline) | `buildBrandCustomerComposition()` via `GET /api/brand-intelligence/{code}/customer-composition` | Already Customer Composition's source (C — offline only) |
| Customer purchase-line detail (online+offline, canonical brand per line) | `buildClientsOverview()` via `GET /api/intelligence/clients` | Not yet used by Brand Intelligence (D — highest leverage) |
| Inventory / per-SKU stock | `buildInventoryOverview()` via `GET /api/inventory/overview?brand=` | Already Hero's Inventory-value source; per-SKU `items` unused (D) |
| Category / product-group taxonomy | none found anywhere | Confirmed absent (H) |
| Health/Sell-through formula | none found anywhere | Confirmed absent (H) |
| Product Registry canonical names | `/api/intelligence/product-registry` | Already used for brand display-name resolution (A) |
| Brand Identity resolver | `scripts/unified-identity-resolver.mjs` | Already used throughout (A) |

**No duplicate calculation is proposed anywhere in this report.** Every "D" classification below points at an existing canonical source, not a new formula.

## 7. Dependency Graph

```
scripts/unified-identity-resolver.mjs (canonical brand identity)
  └─ mergeOfflineBrandSales() / buildMonthlyArchiveBrandSales()
       └─ GET /api/reports/monthly  ──────────────────────────► Core Metrics [A]
            │                                                    Channel Mix [A]
            │                                                    Monthly Trend chart/stats/AI Summary [A]
            └─ commerce.productSales (already fetched, unused fields)
                 └─ (wire only) ─────────────────────────────► SKU drawer, online half [D→A, LOW]

readEcountOfflineSalesSnapshot() + resolveIdentity()
  └─ buildBrandCustomerComposition() via /api/brand-intelligence/{code}/customer-composition
       └─ Customer Composition donut/TOP5/type-share [C — offline only, online gap]
       └─ SKU-count line, offline half [A]

buildClientsOverview() via /api/intelligence/clients  ◄── NOT YET CALLED BY BRAND INTELLIGENCE
  └─ purchaseDetails[] (per customer: product, qty, amount, date, channel, canonicalBrandCode)
       ├─ (wire, filter by canonicalBrandCode) ──► Client Workspace "Recent Orders" [D→A]
       ├─ (wire, aggregate by canonicalBrandCode) ──► Client Workspace "Brand" section [D→A]
       ├─ (wire) ──► entityDrawerConfig.clientOrders (currently empty) [D→A]
       └─ (wire, cross-reference online+offline) ──► Customer Composition online-gap fix [C→A]

buildInventoryOverview() via /api/inventory/overview?brand=
  ├─ (already used) brandRollup ──► Hero Inventory value [A]
  └─ (wire) items[] ──► per-SKU stock table / drawer "sku" type, stock half [D→A]

[NO SOURCE] Category taxonomy ──► Category Intelligence (donut/TOP/drill-down/AI Insight) [H, blocks Client Workspace "Category" section too]
[NO SOURCE] Health/Score formula ──► Brand Score, "고객 등급"/VIP ring [H]
[NO SOURCE] Sell-through formula ──► Hero Sell-through card, Recommended Action, Overview drawer sellthrough sort (out of scope) [H, DEFERRED]
```

**Single highest-leverage upstream connection**: wiring `GET /api/intelligence/clients` into Brand Intelligence (filtered client-side by `canonicalBrandCode === selectedBrandCode`, matched to the existing `entityCompositionRows` customer identity by name) simultaneously unlocks 3 currently-empty areas (`clientOrders` drawer, Client Workspace "Recent Orders", Client Workspace "Brand" section) from one additional fetch, reusing an endpoint and calculation that already exist and are already tested elsewhere (Clients screen).

## 8-9. Implementation Batch Roadmap

**BATCH A — Customer purchase-line detail (highest leverage)**
- Target: Client Workspace "Recent Orders" + "Brand" section, `entityDrawerConfig.clientOrders` (최근 주문 Drawer)
- Canonical source: `buildClientsOverview()` / `GET /api/intelligence/clients` (existing, no new calculation)
- Endpoint change: none required, or optionally a `brand` query param on `/api/intelligence/clients` for server-side pre-filtering (small, additive)
- Frontend change: fetch once per brand/period (or reuse if already fetched for Clients screen caching), filter `purchaseDetails` by matching customer name + `canonicalBrandCode`, populate `entityClientRecentPurchases`/Client Workspace sections instead of leaving them empty
- Expected files: `outputs/samplas-marketing-os.js` (client-side wiring only), possibly `server.mjs` (optional query param)
- Dependencies: none (Brand Identity, canonical purchase data already exist)
- Unlocks: 3 currently-empty UI areas simultaneously
- Regression scope: isolated to Client Workspace/`clientOrders` drawer type — does not touch Core Metrics, Monthly Archive, or Compare Mode code paths
- Risk: LOW · Complexity: MEDIUM (customer-identity matching between two independently-built data structures needs care)

**BATCH B — Per-SKU sales + stock drill-down**
- Target: `entityDrawerConfig.sku` (currently empty), Category→SKU→Order navigation's SKU level
- Canonical source: `commerce.productSales` (already fetched, online) + `GET /api/inventory/overview?brand=` (existing, stock)
- Endpoint change: none for online sales (already in the Monthly payload); none for stock (endpoint already parameterized)
- Frontend change: populate `entitySkuRows` from `archive.commerce.productSales.filter(p => p.brand_code === brandCode)`, cross-referenced by product code with an inventory-overview fetch for stock
- Expected files: `outputs/samplas-marketing-os.js`
- Dependencies: none
- Unlocks: SKU drawer level; partially unblocks the Order drawer level if order-level detail is added from the same `productSales`/`orderHistory` data (needs a closer look at `brandSalesInput.brandOrderHistory`, not fully traced in this pass — flag for the implementing session)
- Regression scope: isolated to the `sku` drawer type
- Risk: LOW · Complexity: LOW-MEDIUM (offline per-SKU sales are not currently available in this shape — online-only in this batch, disclosed rather than faked)

**BATCH C — Customer Composition online-inclusion**
- Target: Customer Composition donut/TOP5/type-share (currently offline-only)
- Canonical source: `buildClientsOverview()`'s `purchaseDetails` (same source as Batch A) filtered to the selected brand, merged with the existing offline `buildBrandCustomerComposition()` result
- Endpoint change: `buildBrandCustomerComposition()` (server-side) would need to also incorporate online orders — this is a genuine, non-trivial server calculation change (not just frontend wiring), so it carries more regression surface than A/B
- Expected files: `server.mjs` (server-side merge logic), `outputs/samplas-marketing-os.js` (if response shape changes)
- Dependencies: Batch A's customer-identity-matching approach should be resolved first (same underlying problem: matching an online Cafe24 customer identity to an offline ECOUNT customer identity, or accepting them as separate rows)
- Unlocks: Customer Composition completeness for online-heavy brands
- Regression scope: touches `buildBrandCustomerComposition()`, which BI-CORE-4/reconciliation testing already covers (`test/entity-composition-retry.test.mjs`) — must not weaken that coverage
- Risk: MEDIUM (server-side calculation change, customer-identity-matching ambiguity between channels) · Complexity: MEDIUM

**Not batched (explicitly deferred, per task instructions)**:
- Category Intelligence — H, no source, no definition; not started.
- Brand Score / "고객 등급" — H, no formula; not started.
- Sell-through — H, DEFERRED, separate workstream; not started. Downstream dependents recorded only: Hero Sell-through card (single-brand), Recommended Action (blocked on Sell-through's threshold), Overview drawer `sellthrough_desc` sort (multi-brand, out of scope).
- Compare Mode — out of scope. Checked for shared-code breakage risk only: `entityIsLiveMonthRow`, `entityTrendMoMPct`, `apiWon`/`apiNum` are shared between single-brand and Compare Mode and were already touched by BI-CORE-4; Compare Mode's own tests (`test/brand-comparison-summary.test.mjs`, `test/cross-brand-partial-period-p2.test.mjs`, 28+11 tests) pass unchanged, confirming no entanglement risk from that work. No Compare-Mode-specific code inspected further.

## 10. Complete Inventory Table

| SECTION | FIELD | CURRENT UI | STATUS | FRONTEND | FETCH | ENDPOINT | SERVER FUNCTION | SOURCE | CANONICAL? | VERIFIED? | DEPENDENCY | UNLOCKS | SELL-THROUGH DEP? | COMPLEXITY | RISK | BATCH |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Hero/Core | Revenue | 10,883,059원 | A | `renderEntityHeroKpiFromMonthlyState` | `refreshEntityTrendMonths` | `/api/reports/monthly` | `buildMonthlyArchiveBrandSales` | Monthly Archive | Yes | Yes | Brand Identity | — | No | — | — | done |
| Hero/Core | Units | 32개 | A | same | same | same | same | same | Yes | Yes | same | — | No | — | — | done |
| Hero/Core | Orders | 25건 | A | same | same | same | same | same | Yes | Yes | same | — | No | — | — | done |
| Hero/Core | AOV | 435,322원 | A | same (client-derived) | same | same | same | same | Yes | Yes | same | — | No | — | — | done |
| Hero/Core | Inventory (brand rollup) | 272개 | A | `refreshEntityInventory` | direct `getJson` | `/api/inventory/overview` | `buildInventoryOverview` | ECOUNT inventory | Yes | Yes | Brand registry | Batch B stock detail | No | — | — | done |
| Hero/Core | Sell-through | "정의 미확정" | H | static text | none | none | none | none | N/A | N/A | business definition | Recommended Action | — | — | — | DEFERRED |
| Brand Score | Score ring + 4 sub-metrics | hidden (`hidden` attr) | H | hidden by design | none | none | none | none | N/A | N/A | health formula | — | No | — | — | not started |
| Monthly | Revenue/Units/Orders/AOV trend | chart + summary correct | A | `renderEntityTrendSection`/`entityTrendChartSvg` | reuses Core fetch | same | same | same | Yes | Yes | Core Metrics | — | No | — | — | done |
| Monthly | Max/Min/평균 AOV/Trend state | correct, excludes live+failed months | A | same | same | same | same | same | Yes | Yes | Core Metrics | — | No | — | — | done (BI-CORE-4 hardened) |
| Monthly | AI Insight paragraph | correct wording, live-month-safe | A | `renderEntityTrendSection` insight block | same | same | same | same | Yes | Yes | Core Metrics | — | No | — | — | done |
| Customer Composition | Type breakdown (donut/legend) | shows offline-only split | C | `refreshEntityCustomerComposition` | direct `getJson` (retry) | `/api/brand-intelligence/{code}/customer-composition` | `buildBrandCustomerComposition` | ECOUNT offline only | Partially | Partially | Brand Identity | Batch C | No | MEDIUM | MEDIUM | C |
| Customer Composition | TOP 5 customers | offline-only | C | same | same | same | same | same | Partially | Partially | same | Batch C | No | MEDIUM | MEDIUM | C |
| Customer Composition | Offline SKU count (SKU line) | correct offline count | A | same | same | same | same | same | Yes | Yes | same | — | No | — | — | done |
| Customer Composition | AI Insight | derived from offline-only stats | C | `renderEntityCompositionSection`/insight | same | same | same | same | Partially | Partially | same | Batch C | No | — | — | C |
| Customer Detail | Quick Profile header/KPI | correct (총매출/주문/객단가/최근구매일) | A | `entityCompositionProfileHtml` | reuses composition fetch | same | same | same | Yes | Yes | Customer Composition | — | No | — | — | done |
| Customer Detail | "최근 주문" (Quick Profile) | "상품 단위 주문 데이터가 연결되지 않았습니다" | D | static empty state | none | none | none | `buildClientsOverview` (unused) | Yes (unused) | No | Batch A | Batch A | No | MEDIUM | LOW | A |
| Customer Detail | 고객 등급/VIP ring | "산식 연결 대기" | H | static | none | none | none | none | N/A | N/A | health formula | — | No | — | — | not started |
| Customer Detail | Client Workspace "Brand" section | "고객별 브랜드 구매 데이터 연결 대기" | D | static empty state | none | none | none | `buildClientsOverview` (unused) | Yes (unused) | No | Batch A | Batch A | No | MEDIUM | LOW | A |
| Customer Detail | Client Workspace "Category" section | "고객별 상품군 데이터 연결 대기" | H | static empty state | none | none | none | none | N/A | N/A | Category source | — | No | — | — | not started |
| Customer Detail | Client Workspace "Recent Orders" | "상품 단위 주문 데이터가 연결되지 않았습니다" | D | static empty state | none | none | none | `buildClientsOverview` (unused) | Yes (unused) | No | Batch A | Batch A | No | MEDIUM | LOW | A |
| Customer Detail | `entityDrawerConfig.clientOrders` (최근 주문 Drawer) | empty list | D | `entityDrawerClientOrderRowHtml` | none (empty array) | none | none | `buildClientsOverview` (unused) | Yes (unused) | No | Batch A | Batch A | No | MEDIUM | LOW | A |
| Category Intelligence | Donut / share | "상품군 데이터가 연결되지 않았습니다" | H | `renderEntityCategorySection` (empty branch) | none | none | none | none (confirmed repo-wide) | N/A | N/A | Category taxonomy | Client Workspace "Category" | No | — | — | not started |
| Category Intelligence | TOP list | empty | H | same | none | none | none | none | N/A | N/A | same | — | No | — | — | not started |
| Category Intelligence | AI Insight | not generated | H | same | none | none | none | none | N/A | N/A | same | — | No | — | — | not started |
| Category Intelligence | `entityDrawerConfig.category`/`.sku` (drill-down) | empty | H/G | `entityDrawerCategoryRowHtml`/`Sku` | none | none | none | none (category), partial (sku, see Batch B) | N/A/Partial | N/A | Category taxonomy | — | No | — | — | not started (category), B (sku online half) |
| Inventory | SKU-level stock table | not surfaced in Brand Intelligence | D | none built yet | — | `/api/inventory/overview?brand=` (exists, unused param) | `buildInventoryOverview` | ECOUNT inventory | Yes (unused) | No | none | Batch B | No | LOW | LOW | B |
| Inventory | Stock health / 확인 필요 count | shown in Hero note text only | A (as shown) | `refreshEntityInventory` | same as Hero Inventory | same | same | same | Yes | Yes | none | — | No | — | — | done |
| AI/Insight | Hero AI Summary | correct, NULL≠ZERO hardened | A | `renderEntityHeroInsight` | reuses Core fetch | same | same | same | Yes | Yes | Core Metrics | — | No | — | — | done (BI-CORE-4) |
| AI/Insight | 추천 Action | static disclaimer, never dynamic | H | `renderEntityHeroInsight` (fixed innerHTML) | none | none | none | none | N/A | N/A | Sell-through threshold | — | **Yes** | — | — | not started |
| System Status | Cafe24/Meta/Instagram/ECOUNT badges | all show real health | A | `refreshEntitySystemStatus` | direct `getJson` | `/api/status`, `/api/ecount-sales/monthly` | (status handlers) | live service checks | Yes | Yes | none | — | No | — | — | done |
| Brand Identity | Selector, resolution, alias match | correct (B00000KU FOUND) | A | `resolveBrandIdentity`/`applyBrandIdentity` | `/api/brand-master` | `/api/brand-master` | Brand Master read | Brand Master JSON | Yes | Yes | none | everything | No | — | — | done |
| Channel Mix | Online/Offline split + amounts | correct (9.4%/90.6%) | A | `renderEntityHeroChannelSplit` | reuses Core fetch | same | same | same | Yes | Yes | Core Metrics | — | No | — | — | done |

## 11. Highest-Leverage Connection

**`GET /api/intelligence/clients` (`buildClientsOverview()`'s `purchaseDetails`, per-line, canonical-brand-attributed) is not yet used by Brand Intelligence at all.** Wiring it in (Batch A) is the single move that unblocks the most currently-empty, user-visible UI simultaneously (Client Workspace "Recent Orders" + "Brand" section + the `clientOrders` drawer), at LOW risk (isolated to Customer Detail code paths, no touch to Core Metrics/Monthly Archive/Compare Mode), using an endpoint and calculation that already exist and are already covered by other tests.

## 12. Risk Notes

- Batch A/B are additive, frontend-and-optional-query-param-only — regression surface is contained to Customer Detail / SKU drawer code, does not touch `mergeOfflineBrandSales`, `buildMonthlyArchive`, or any canonical sales formula.
- Batch C is the one genuine server-side calculation change in this roadmap (merging online orders into `buildBrandCustomerComposition`) — recommend it come after A/B, and after resolving the cross-channel customer-identity-matching question once (reusable for both A and C).
- BI-CORE-4's changes remain uncommitted on disk; before starting any batch, they should be committed (or at minimum, the working tree state re-verified) so implementation work builds on a clean, known baseline rather than stacking on an uncommitted diff indefinitely.

## 13. Sell-Through — Downstream Dependency Only (not implemented, not diagnosed further)

Confirmed dependents, single-brand scope only: Hero KPI Sell-through card (`outputs/samplas-marketing-os.html:1581-1585`), Recommended Action's threshold gate (`renderEntityHeroInsight`'s static disclaimer text names Sell-through/Action threshold explicitly as the blocker). Multi-brand Overview drawer's `sellthrough_desc` sort option exists but is out of this task's scope (placeholder data, separate screen). No formula, no implementation, no deep diagnosis performed, per instructions.

## 14. Compare Mode — Out of Scope Statement

Not implemented, not redesigned. Checked only for shared-code breakage risk: `entityIsLiveMonthRow`, `entityTrendMoMPct`, `apiWon`, `apiNum` are shared between single-brand and Compare Mode code paths and were modified by BI-CORE-4; Compare Mode's own regression suite (`test/brand-comparison-summary.test.mjs` 28 tests, `test/cross-brand-partial-period-p2.test.mjs` 11 tests) passed unchanged in BI-CORE-4's targeted verification, confirming no entanglement. No other Compare-Mode-specific code was inspected in this diagnosis.
