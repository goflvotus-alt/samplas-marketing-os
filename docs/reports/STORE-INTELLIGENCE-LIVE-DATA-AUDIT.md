# STORE INTELLIGENCE LIVE DATA FOUNDATION / ARCHITECTURE AUDIT

- Audit date: 2026-08-14 KST
- Starting branch / HEAD: `main` / `21771e3`
- Scope: architecture and data-connection audit only
- Code modified: **NO**
- Canonical sales calculation changed: **NO**

## Executive conclusion

두 Store Intelligence renderer는 현재 `MOCK_APGUJEONG_INTELLIGENCE`와 `MOCK_VAIL_INTELLIGENCE`만 읽는다. 따라서 Store Intelligence 화면 안에서 실제 데이터에 연결된 metric은 **0개**다. 다만 기반 데이터는 이미 상당 부분 존재한다.

- 즉시 연결 가능: store 매출, 일별/오늘 매출, 판매수량, `(date, documentNo/slipNo)` 기준 주문수, 객단가, store-scoped 고객/고객유형/스타일리스트 고객 순위, canonical 브랜드 매출·수량·주문수.
- 추가 foundation 필요: 재구매/신규 정의, 고객×브랜드 교차 집계, canonical 상품 집계, Category 집계.
- 현재 연결 불가: 담당 판매자(직원) attribution, 스타일리스트별 담당 고객 수, 매장별 재고, 입고일 기반 sell-through, 신규 입점일, 자동 인사이트.
- 다음 구현은 새 계산식을 만들지 말고 기존 store snapshot, `buildClientsOverview()`, `loadResolverContext()` + `mergeOfflineBrandSales()`를 하나의 read-only Store Intelligence payload에서 조합하는 것이 가장 안전하다.

### Status legend

- **A**: 현재 canonical source/helper로 즉시 연결 가능
- **B**: 원천 일부는 있으나 정의 또는 safe join/aggregation foundation이 추가로 필요
- **C**: 현재 canonical source/attribution이 없어 연결 불가
- **D**: Store Intelligence 화면에 이미 live 연결됨

## Full UI and metric inventory

| Page | Section | Metric | Current Source | MOCK? | Available Canonical Source | Store Attribution | Status A/B/C/D | Recommended Implementation |
| ---- | ------- | ------ | -------------- | ----- | -------------------------- | ----------------- | -------------- | -------------------------- |
| APGUJEONG | KPI | 오늘 매출 | `MOCK_APGUJEONG_INTELLIGENCE.kpis` 8,420,000원 | YES | store snapshot `salesLines`의 해당 날짜 `isOfflineRevenue` 합계 | `storeCode=APGUJEONG` 확정 | A | store snapshot의 실제 최신일/조회일 합계를 사용; online은 매장 추정 귀속 금지 |
| APGUJEONG | KPI | 구매 고객 수 | MOCK 18명 | YES | `/api/intelligence/clients?...&store=APGUJEONG` → `summary.totalClients` | store-scoped offline lines만 포함 | A | 기존 `buildClientsOverview()` 결과 재사용 |
| APGUJEONG | KPI | 주문 건수 | MOCK 22건 | YES | Clients `summary.offlineOrderCount`; ECOUNT `(date, slipNo/documentNo)` distinct | 확정 | A | 기존 order grouping 그대로 사용; salesLines 수 사용 금지 |
| APGUJEONG | KPI | 객단가 | MOCK 382,700원 | YES | Clients `summary.avgOrderValue` = store offline sales / canonical offline orders | 확정 | A | 기존 Clients summary 재사용 |
| APGUJEONG | KPI | 재구매 고객 비중 | MOCK 41% | YES | 고객별 `purchaseDateCounts`/purchase history 일부 존재 | 현재 period/store와 과거 store history의 정의 필요 | B | 신규/재구매 기준일과 denominator를 먼저 고정한 뒤 Clients pipeline에서 계산 |
| APGUJEONG | Stylist Performance | 스타일리스트 매출 비중 | MOCK 34/27/21/18% | YES | Clients `typeBreakdown[type=stylist].salesAmount`, `stylistTop10` | store-scoped offline | A | 고객 유형 `stylist`의 실제 매출/전체 실제 매출 비중 사용 |
| APGUJEONG | Stylist Performance | TOP 스타일리스트(매출) | MOCK 5명/금액 | YES | Clients `stylistTop10` | store-scoped offline | A | 기존 ranking 재사용; 여기서 stylist는 판매직원이 아니라 stylist 유형 고객임을 UI에 명시 |
| APGUJEONG | Stylist Performance | 스타일리스트별 고객 수 | MOCK 41/33/27/19/15명 | YES | 없음 | 판매행에 담당 판매자/스타일리스트 관계 없음 | C | 숫자 삭제 후 `담당 관계 데이터 미연결`; 고객인 stylist 수와 혼동 금지 |
| APGUJEONG | Brand × Stylist | 스타일리스트별 TOP 브랜드 | MOCK 5행 | YES | store client purchase lines + Unified Identity Resolver는 각각 존재 | store는 가능, 고객×canonical brand 교차 payload 없음 | B | `buildClientsOverview()` purchaseDetails를 같은 resolver로 server-side 교차 집계; 문자열 브랜드 merge 금지 |
| APGUJEONG | Customer Type | 고객 유형 구성 | MOCK stylist/customer/press/foreign | YES | Clients `typeBreakdown` (`stylist`, `customer`, `samplas_press`, `foreign`, `ff`) | store-scoped offline | A | 실제 clientCount 또는 salesAmount 중 UI 기준을 명시해 그대로 렌더 |
| APGUJEONG | Recent Customers | 고객명 | MOCK 5명 | YES | Clients `clients[]` | store-scoped offline | A | `latestPurchaseDate` 정렬, 개인정보 노출 정책은 기존 Clients와 동일 적용 |
| APGUJEONG | Recent Customers | 최근 구매일 | MOCK | YES | Clients `latestPurchaseDate` | store-scoped offline | A | 기존 필드 재사용 |
| APGUJEONG | Recent Customers | 구매 횟수 | MOCK | YES | Clients `purchaseCount` / `purchaseDateCounts` | store-scoped offline | A | 기존 Clients 정의 재사용 |
| APGUJEONG | Recent Customers | 총 구매 금액 | MOCK | YES | Clients `totalSales` | store-scoped offline | A | 기존 Clients 정의 재사용 |
| APGUJEONG | Recent Customers | 담당 스타일리스트 | MOCK 인명 | YES | 없음 (`salesStaff`를 뒷받침할 ECOUNT 필드 없음) | 불가 | C | 컬럼을 unavailable state로 유지; 추정 금지 |
| APGUJEONG | Insight | 오늘의 인사이트 3개 | hardcoded 문장 | YES | 정식 rule/decision source 없음 | 해당 없음 | C | 가짜 문장 제거 후 `인사이트 규칙 미정의` 표시 |
| VEIL | KPI | 오늘 매출 | `MOCK_VAIL_INTELLIGENCE.kpis` 5,180,000원 | YES | VAIL snapshot 날짜별 실제 매출 | `storeCode=VAIL` 확정 | A | 실제 최신일/조회일 매출 사용; 사용자 표기는 VEIL |
| VEIL | KPI | 판매 수량 | MOCK 64개 | YES | revenue `salesLines.quantity` 순합 | 확정 | A | 반품 음수 포함 기존 ECOUNT quantity 의미 유지 |
| VEIL | KPI | 주문 건수 | MOCK 31건 | YES | Clients `summary.offlineOrderCount`; `(date, document)` distinct | 확정 | A | 기존 grouping 재사용 |
| VEIL | KPI | 객단가 | MOCK 167,100원 | YES | Clients `summary.avgOrderValue` | 확정 | A | 실제 1건이면 70,200원 그대로 표시 |
| VEIL | KPI | 신규 고객 비중 | MOCK 58% | YES | 고객 purchase history 일부 존재 | 신규 기준/과거 store history 정의 미확정 | B | 재구매 지표와 함께 정책 확정 전 unavailable |
| VEIL | TOP Product | 순위/브랜드/상품/수량/매출 | MOCK TOP 5 | YES | raw ECOUNT `productName`, `specification`, quantity, amount은 존재 | store 확정; canonical product ID 없음 | B | snapshot에 공식 `prodCd`가 보존되기 전에는 canonical TOP PRODUCT 금지; raw 단일 판매행은 진단 표시만 가능 |
| VEIL | TOP Product | 상품 이미지 | `이미지 준비 중` shell | NO value | Cafe24 catalog 이미지가 있으나 ECOUNT 판매행과 canonical product join 필요 | join 불가 | B | confirmed Product Registry join 이후에만 이미지 연결 |
| VEIL | Brand Performance | 브랜드별 매출/순위 | MOCK TOP 5 | YES | `/api/ecount-sales/monthly?includeStoreBrands=1`의 `storeBrandSales.VAIL`, Unified Resolver + `mergeOfflineBrandSales()` | 확정 | A | Monthly Store Performance의 동일 결과를 재사용; 실제 PACOSPLY 1개만 표시 |
| VEIL | Brand Performance | 브랜드별 수량/주문수 | MOCK shell에는 매출 중심 | YES | `mergeOfflineBrandSales()`의 `quantitySold`, `orderCount` | 확정 | A | 동일 canonical bucket의 additive fields 재사용 |
| VEIL | Category | 카테고리 매출 비중 | MOCK 34/27/21/18% | YES | Category Master v1 정책은 존재하나 manual override 0, store 판매행에 `prodCd/productNo` 없음 | store는 확정, canonical product→category join 불완전 | B | Product Registry confirmed join을 먼저 확보하고 기존 Category v1 정책/UNCLASSIFIED coverage를 server-side 재사용 |
| VEIL | Sell-through | 7/14/30일 | MOCK 22/41/68% | YES | 현재 재고에는 입고량/입고일 없음 | 매장별 재고도 없음 | C | 숫자 삭제, `입고 데이터 미연결` 표시 |
| VEIL | Inventory | 총 재고 수량 | MOCK 1,240개 | YES | ECOUNT 회사 전체 `stockQuantity`는 존재 | 매장별 창고 재고 attribution 없음 | C | 매장별 ECOUNT 재고조회가 확보될 때까지 unavailable |
| VEIL | Inventory | 재고 금액 | MOCK 182,600,000원 | YES | 회사 전체 purchase/sales price 일부 존재 | 매장별 수량 없음 | C | 매장 재고 source 확보 전 계산 금지 |
| VEIL | Inventory | Dead Stock | MOCK 37개 | YES | 회사 전체 inventory helper는 상태를 제공하나 입고/매장 source 없음 | 불가 | C | 현재 정책상 확정 Dead Stock으로 부르지 말고 unavailable |
| VEIL | New Brands | 브랜드/입점일 | MOCK 3행 | YES | Brand Master에 store 입점일 source 없음 | 불가 | C | `입점일 데이터 미연결` |
| VEIL | New Brands | 7일 매출 | MOCK | YES | 매출은 있으나 입점 시작 window 없음 | store 매출 가능, 시작점 불가 | C | 입점일 canonical source 전까지 계산 금지 |
| VEIL | New Brands | Sell-through(7일) | MOCK | YES | 입고량/입고일 없음 | 불가 | C | unavailable |
| VEIL | Insight | 오늘의 MD 인사이트 4개 | hardcoded 문장 | YES | 정식 rule/decision source 없음 | 해당 없음 | C | 가짜 문장 제거 후 `인사이트 규칙 미정의` |

**D 판정:** Store Intelligence 두 화면에는 없음. Monthly Store Performance의 store 매출/브랜드는 live지만, 두 Store Intelligence renderer는 그 응답을 아직 읽지 않는다.

## Actual ECOUNT store snapshot schema

실제 두 JSON을 read-only로 검사했다.

### Snapshot metadata

| Store | Period | Offline | Revenue lines | All salesLines | Revenue quantity | Distinct `(date, document)` | Distinct revenue customer names |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| APGUJEONG | 2026-08-01 ~ 2026-08-14 | 97,177,900 | 493 | 558 | 348 | 164 | 81 |
| VEIL (`VAIL`) | 2026-08-03 ~ 2026-08-13 | 70,200 | 1 | 7 | 1 | 1 | 1 |

### `salesLines` actual fields

`date`, `slipNo`, `documentNo`, `productName`, `specification`, `quantity`, `brandGroup`, `customerName`, `poNo`, `salesAmount`, `isPersonalPayment`, `personalPaymentReason`, `isOfflineRevenue`, `storeCode`.

Not present: `prodCd/productCode/barcode`, category, salesperson/staff/stylist assignment, warehouse per line, inventory quantity, receipt/arrival date, canonical customer ID.

Consequences:

- Safe now: revenue, daily revenue, net quantity, transaction count by existing document rule, raw customer name grouping, canonical brand aggregation through Unified Identity.
- Unsafe now: treating line count as orders; product-name fuzzy merging; category guessing outside approved policy; staff attribution; store inventory; sell-through.

## APGUJEONG

### Immediately connectable

- Today/period offline sales and quantity from `2026-08.APGUJEONG.json`.
- Orders and AOV from existing Clients order rule. Audit execution for 2026-08-01~14 returned 164 orders and AOV 231,392.53; this is evidence of capability, not a new persisted metric.
- Store-scoped clients and type composition from `buildClientsOverview({storeCode:"APGUJEONG"})`. Audit returned 60 grouped clients: stylist 47, customer 1, press 9, foreign 1, FF 2.
- Stylist-type customer ranking and spend from existing `stylistTop10`.
- Canonical brand ranking from existing Unified Identity + `mergeOfflineBrandSales()`.

### Additional foundation required

- New/repeat policy and comparison period.
- Customer/stylist × canonical brand aggregation using existing purchase lines and resolver.
- Canonical product identity: sales snapshot must retain an official product code that Product Registry can join.

### Currently impossible

- Assigned staff/stylist per transaction and number of customers managed by each stylist. `salesStaff` is not sourced by ECOUNT salesLines.
- Rule-generated daily insights until an approved rule source exists.

## VEIL

### Immediately connectable

- Actual sales 70,200, quantity 1, transaction 1, AOV 70,200 for the one current revenue transaction.
- Canonical brand PACOSPLY only. A real response must render one row, not pad to five.
- Store coverage/period metadata and honest empty states.

### Additional foundation required

- New customer definition/history.
- Canonical product join. The current line identifies `PACOSPLY / WonderLand T-shirts BLACK`, specification `2`, but has no `prodCd`; grouping it into a canonical product by text would violate the identity policy.
- Category aggregation after canonical product join. Category Master v1 exists, but `work/category-master.json` has zero manual overrides and the current store line lacks Product Registry keys.

### Currently impossible

- Store-specific inventory: current inventory API is company-total and explicitly reports location coverage unavailable.
- Sell-through and new-brand 7-day response: no canonical arrival/receipt date or opening-date source.
- Rule-generated MD insights.

## Customer and stylist capability

`/api/intelligence/clients` already accepts `store`, and `buildClientsOverview()` filters only ECOUNT offline lines whose `storeCode` matches. It intentionally excludes Cafe24 online orders in Store Focus Mode because online orders have no physical-store attribution. This is the correct reusable boundary.

The pipeline safely provides client type, grouped customer, purchase dates/details, spend, quantity, orders, type breakdown, and stylist/press/FF rankings. It does **not** provide a relationship of “staff stylist → managed customer.” The APGUJEONG UI currently conflates stylist-type customers with assigned sales staff in some labels; implementation must keep the former and mark the latter unavailable.

## Order count and AOV

The existing canonical offline order rule is distinct `(date, slipNo || documentNo)`. Both `mergeOfflineBrandSales()` and `buildClientsOverview()` use this document foundation. Therefore order count and AOV are A-status when this existing rule is reused. `salesLines.length` is never an order count.

## Product identity and Category Master

- Product Registry exists: 880 entries, 103 `verified:true + status:"confirmed"` at audit time.
- Unified Identity Resolver exists and is already the brand authority.
- Store salesLines do not contain the Product Registry join keys (`prodCd`, `productNo`, barcode). `poNo` must not be reinterpreted as a product ID.
- Category Master v1 exists, but its stored manual overrides are empty. Existing Brand Intelligence adds audited deterministic name/suffix rules and preserves `UNCLASSIFIED`; that policy can be reused only after a safe product input/join is defined. A second category guesser must not be created.

## Existing reusable foundation

| Existing path | Reuse decision |
| --- | --- |
| `work/store-master.json` | Canonical store identity; keep internal `VAIL`, display VEIL |
| `readEcountOfflineSalesSnapshot(month,{storeCode})` | Store snapshot/coverage source; reuse |
| `/api/sales/total` `offlineSales.byStore` | Existing company/store reconciliation; reuse, never re-sum with a new formula |
| `/api/ecount-sales/monthly` | Store raw snapshot GET; reuse |
| `/api/ecount-sales/monthly?includeStoreBrands=1` | Existing store canonical brand payload; reuse |
| `loadResolverContext()` + `mergeOfflineBrandSales()` | Canonical brand aggregation and document order rule; reuse |
| `/api/intelligence/clients?...&store=` / `buildClientsOverview()` | Store customer/order/AOV/type source; reuse |
| Product Registry API | Reuse only with verified/confirmed official key join |
| Category Master v1 | Reuse policy and UNCLASSIFIED behavior; do not clone rules |
| Inventory Overview | Company-total only; do not present as VEIL inventory |

## Shared Store Foundation

Recommended flow:

`Store Master identity` → `readEcountOfflineSalesSnapshot(store)` → existing canonical brand + Clients aggregations → one Store Intelligence payload → APGUJEONG/VEIL renderers.

A dedicated `GET /api/intelligence/store?store=...&since=...&until=...` is justified as a **thin composition endpoint**, not a new calculation pipeline. Extending `/api/ecount-sales/monthly` with customer, inventory and UI-specific sections would mix raw snapshot semantics with Intelligence concerns. The endpoint should only orchestrate existing helpers and expose per-section `available/coverage/reason`; no persistence and no duplicate totals.

Minimum common payload:

- identity/display metadata and coverage
- sales: period/daily/latest-day revenue, net quantity, canonical document orders, AOV
- brands: existing canonical store brand buckets
- clients: existing store-scoped summary/type/rankings
- products/categories/inventory/sellThrough: explicit availability plus data only when an approved source exists

APGUJEONG and VEIL may retain different presentation sections, but must consume this same foundation.

## MOCK Inventory

Every item below is hardcoded and must either be replaced with live data or removed in favor of an unavailable state.

### APGUJEONG mock values

- KPI: 8,420,000원, 18명, 22건, 382,700원, 41%, and all comparison deltas.
- Stylist share: 김민지 34%, 박서연 27%, 이하늘 21%, 기타 18%.
- Stylist ranking: 김민지 3,120,000; 박서연 2,480,000; 이하늘 1,930,000; 최도윤 1,210,000; 정유진 980,000 and bar shares.
- Stylist customer counts: 41, 33, 27, 19, 15.
- Stylist × brand: five names, five brands, all sales/share values.
- Customer type: stylist 41/44%, customer 28/30%, press 14/15%, foreign 10/11%.
- Recent customers: all five names, dates, counts, totals and assigned stylists.
- Insights: “스타일리스트 매출 상승”, “VIP 고객 재방문”, “브랜드 재고 주의”.

Replacement: live-connect A metrics; B metrics become `정의/연결 대기`; C metrics become explicit unavailable. No placeholder number remains.

### VEIL mock values

- KPI: 5,180,000원, 64개, 31건, 167,100원, 58%, and all comparison deltas.
- TOP products: all five fabricated products, quantities and sales.
- Brand ranking: all five brands, amounts and shares.
- Category: 34/27/21/18%.
- Sell-through: 22/41/68%.
- Inventory: 1,240 units, 182,600,000원, Dead Stock 37.
- New brands: all three brands, opening dates, 7-day sales and sell-through.
- Insights: all four hardcoded MD statements.

Replacement: actual VEIL revenue scope is one PACOSPLY transaction, so live sections show exactly that coverage. Unsupported sections keep the UI shell but show reasoned unavailable states.

## Recommended Next Batch

### `STORE INTELLIGENCE LIVE DATA FOUNDATION + ALL CURRENTLY AVAILABLE METRICS`

One safe batch should:

1. Add one thin read-only Store Intelligence composition endpoint using existing snapshot, Clients, resolver and brand aggregation helpers.
2. Connect every A metric on both pages in one pass.
3. Remove every hardcoded number/string from both mock objects.
4. Preserve all UI shells; render B/C fields as `정의 미확정`, `상품 식별자 미연결`, `담당 관계 데이터 없음`, or `매장별 재고 미지원`.
5. Keep VEIL’s one real transaction as one result—never pad rankings.
6. Add reconciliation assertions: APGUJEONG 97,177,900 + VAIL 70,200 = offline 97,248,100; online 18,113,792 remains unattributed and unchanged; total remains 115,361,892.

Explicitly exclude from that batch: parser/schema expansion for product code, store inventory ingestion, arrival data, new/repeat policy invention, insight rules, and internal `VAIL` migration. Those should begin only when their authoritative inputs/policies exist.

## Audit integrity

- Code Review Graph was called first as required, but its graph was stale and resolved nodes to the former Documents repository (`built_at_sha c75528f`, current Dropbox HEAD `21771e3`). Findings above therefore use direct read-only inspection of the current Dropbox source and actual `work/` JSON.
- No code, work data, snapshot, archive, workbook, or existing report was modified.
- No commit, push, deploy, Render operation, or server/browser execution was performed.
