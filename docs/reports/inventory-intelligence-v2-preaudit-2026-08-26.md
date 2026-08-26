# Inventory Intelligence V2 — Read-Only Pre-Audit — 2026-08-26

**상태: READ ONLY PRE-AUDIT — 코드/데이터 무수정, report만 생성**

## Purpose

현재 Inventory Overview 화면(단순 재고 조회)을 실제 운영 의사결정 도구로
확장할 수 있는지, 현재 존재하는 데이터/코드 구조만을 기반으로 전면
분석한다. 이 문서는 설계 리서치이며 어떤 구현도 포함하지 않는다.

## A. Current Inventory Architecture

### A.1 실제 존재하는 화면 — 2개, 이름 충돌 주의

**중요한 선행 발견**: 코드베이스에 "Inventory"라는 이름이 붙은 화면이
**이미 2개** 존재하며, 서로 완전히 다른 것이다.

| 화면 | route | 성격 | 상태 |
|---|---|---|---|
| `InventoryOverview`(label "Inventory") | `inventory-overview` | **실제 재고 조회 화면**(이 감사의 대상) — `GET /api/inventory/overview`만 읽음 | public, 표시됨 |
| `InventoryIntelligence`(label "Inventory Intelligence") | `inventory-intelligence` | **Cafe24 vs ECOUNT 재고 수치 reconciliation 진단 화면** — `GET /api/inventory/intelligence/health`를 읽고, `scripts/diagnose-inventory-reconciliation.mjs` 실행 결과에 의존. 화면 자체에 "Diagnostic Only 화면입니다. 재고를 직접 수정하지 않으며 운영 판단의 최종 근거로 사용하지 않습니다"라고 명시 | **hidden: true**, 숨김 |

**권장**: 이번에 설계하는 "Inventory Intelligence V2"는 **이름을
"Inventory Intelligence"로 재사용하지 말 것** — 이미 그 이름은 다른
기능(Cafe24↔ECOUNT 정합성 진단)을 가리키고 있어 혼동 위험이 크다. `Inventory
Insights` 또는 `Inventory Overview v2`처럼 구분되는 이름을 권장(§H에서
다시 언급).

### A.2 InventoryOverview(실제 감사 대상)의 현재 제공 범위

`scripts/inventory-overview-lib.mjs`(순수 계산, 435줄) +
`intelligence-service.mjs::handleInventoryOverviewGet()`(893~989줄, I/O
담당)로 구성. 현재 제공:

- **summary cards 원재료**: `totalKnownStock`, `inStockSkuCount`,
  `depletedSkuCount`, `negativeReviewSkuCount`, `unknownStockSkuCount`,
  `lowStockCandidateCount`, QQQ 전용 4개 카운터, 유형별 SKU 수
  (`generalSkuCount`/`adminCodeSkuCount`/`qqqSkuCount`).
- **brandRollup**: 브랜드별 `totalSku`/`knownStock`/`depletedCount`/
  `negativeReviewCount`/`lowStockCandidateCount`/`qqqEstimatedSoldQuantity`/
  `qqqSkuCount`/`recentSalesQty`.
- **SKU item 배열**: 아래 §C 전체.
- **filters/sort**: `brand`, `status`(6종 view), `search`(브랜드/상품명/
  prodCd/barcode), `sort`(`stock-asc`/`stock-desc`/`recent-sales-desc`/
  기본 status-priority 정렬). `filterAndSortItems()`가 순수 함수로 처리.
- **coverage/policy 메타**: `inventoryPolicy`(ECOUNT가 유일한 재고
  source-of-truth, Cafe24 재고 미사용, QQQ 음수=추정판매, 0=재고소진
  후보, location 가용 여부), `coverage`(stock/location known·unknown
  카운트).
- **negative inventory handling**: 단순 `negativeReviewSkuCount`(일반)
  + `qqqEstimatedSoldSkuCount`(QQQ, 별도 그룹) 카운트만 존재 — 브랜드별/
  절대수량/매출연계 등 세분화된 인텔리전스는 아직 없음(§I에서 설계).
- **category**: 현재 InventoryOverview 응답에 category 필드 자체가 없음
  (§K에서 타당성 검토).
- **recentSalesQty**: `work/ecount-sales/*.json`(오프라인 매출만) 기반
  30일 rolling — **온라인(Cafe24) 판매는 전혀 포함되지 않음**(§N에서
  중요하게 다룸).

## B. Data Source Map

| Source | Canonical/Derived | Update Frequency | Fields(Inventory가 실제 쓰는 것만) | Used By | Production Authority |
|---|---|---|---|---|---|
| `work/ecount-inventory/latest.json` | Derived(ECOUNT API, `sync-ecount-inventory.mjs`) | 수동 실행(주기 없음, 최근 2026-08-25) | productCode, productName, specification, barcode, stockQuantity, purchasePrice, salesPrice | InventoryOverview 유일한 재고 수량 source | Render 업로드 필요(allowlist 있음) |
| `work/ecount-inventory/diagnostic.json` | Derived(같은 sync 실행의 부산물) | 상동 | `finishedAt`(→ `generatedAt`으로 노출), `counts.purchasePriceCount` | `generatedAt` 표시용 | 상동 |
| `work/brand-master.json` → `work/intelligence/brand-master-list.json`/`brand-aliases.json` | Canonical→Derived | 수동 편집 + auto-rebuild(Batch 7) | id, name, alias | ECOUNT 원문 브랜드 문자열 → canonical 브랜드 매핑 | 최근 동기화 완료(Batch 7 후속) |
| `work/ecount-sales/*.json`(월별) | Derived(ECOUNT 판매현황 업로드) | 월별 업로드 | productName, specification, quantity, date, isOfflineRevenue | `recentSalesQty`/`lastSaleDate`(오프라인만) | **§B.1 pipeline gap 있음(아래)** |
| `work/product-registry.json` | Canonical(사람 검토) | SAFE-N 배치 단위 | `ecount.matchedProducts[].prodCd` | `registryLinked` boolean 플래그만 | Local canonical, Render 동기화됨(Batch 6) |
| `work/category-master.json` | Canonical(manualOverrides) + 코드 내 결정론적 규칙 | 드묾(8건 modelAssignments, 15개 prodCd 커버) | categoryCode, subcategoryCode | 현재 InventoryOverview 미사용 — Brand Intelligence Category 화면만 사용 | 로컬 전용, coverage 낮음 |
| Cafe24 온라인 주문/`work/product-sales-history.json` | Live API + Derived cache | 실시간/캐시 | productNo별 온라인 판매수량 | Today/Product Sync 등, **Inventory와 미연결** | N/A |
| Store Master(`work/store-master.json`) | Canonical | 드묾 | 매장 코드/표시명 | Today/Monthly의 매장 구분 | Inventory는 미사용(창고 dimension 자체가 없음) |

### B.1 확인된 pipeline gap(이번 감사에서 신규 발견, 코드 수정 안 함)

`intelligence-service.mjs::buildEcountOfflineSalesIndexFromDisk()`(라인
1020~1033)는 `work/ecount-sales/` 디렉터리에서 파일명이 정확히
`/^\d{4}-\d{2}\.json$/`인 것만 읽는다. 그런데 실제 디렉터리에는:
```
2026-08.json, 2026-08.APGUJEONG.json, 2026-08.VAIL.json, 2026-09.APGUJEONG.json
```
가 공존한다 — warehouse-routing(2026-08+ store-separated) 도입 이후,
**"매장별 분리 파일만 있고 병합된 평문 `YYYY-MM.json`이 아직 없는 달"은
이 정규식에 전혀 걸리지 않는다.** 현재 8월은 마침 병합 파일(`2026-08.json`,
446 rows)이 같이 존재해 문제가 드러나지 않지만, `2026-09.APGUJEONG.json`은
대응하는 `2026-09.json`이 없다 — 다음 달 판매현황이 매장별 파일로만
업로드되면 Inventory의 `recentSalesQty`/`lastSaleDate` 계산이 그 달
데이터를 **조용히 통째로 누락**한다(Clients/Sales 쪽은 `readEcountOfflineSalesSnapshot()`이
`storesIncluded`/`storesMissing`을 명시적으로 처리하는 별도 reader라 이
문제가 없음 — Inventory만 구식 reader를 쓰고 있음). **V2 구현 전 반드시
고쳐야 할 pipeline 전제조건**(§J).

## C. Available SKU Fields(실제 확인된 것만)

```
prodCd(barcode와 동일), productName(파싱된), rawProductName(원문),
brandKey, brandName, brandCanonical(bool), brandRaw, parseConfidence,
specification("규격", 사실상 size/variant), productType(general/admin_code/qqq),
stockQuantity(nullable), status(6종), lowStockCandidate(bool),
estimatedSoldQuantity(QQQ 전용), locations(항상 null), locationCoverageStatus(항상 "unavailable"),
purchasePrice(ECOUNT IN_PRICE/PUR_PRICE 등), salesPrice(ECOUNT OUT_PRICE/SALE_PRICE 등),
recentSalesQty(30일, 오프라인만), lastSaleDate(오프라인만), registryLinked(bool)
```

없는 필드: color(별도 필드 없음, `specification`에 혼재될 수 있으나
구조화 안 됨), warehouse/store(§F 참조), Cafe24 productNo(item 레벨에
직접 노출 안 됨 — Product Registry를 거쳐야 접근 가능), cost 분리 없음
(purchasePrice가 사실상 cost 후보, 아래 §14 참조), 최초 매입일/입고일
없음, size는 `specification` 문자열 안에 있을 수 있으나 구조화된 필드
아님.

## D. What We Cannot Currently Know(추측 없이 source 부재만 기록)

| 항목 | 상태 |
|---|---|
| 실제 원가(cost) | `purchasePrice`가 후보이나 신뢰도 미검증(§Metric E "Margin" 참조) |
| 입고일/최초 매입일 | source 없음 |
| 리오더 lead time | source 없음 |
| reorder quantity 기준(MOQ) | source 없음 |
| 시즌 코드 | source 없음(브랜드/카테고리 규칙에 시즌 힌트가 간접적으로 있을 수 있으나 구조화 필드 아님) |
| SKU lifecycle state(신상/이월/단종) | source 없음 |
| 반품 예정 재고 | source 없음(ECOUNT 판매현황의 음수 quantity=반품으로 이미 순매출에 반영되나, "예정" 반품은 없음) |
| 홀딩 재고 | source 없음 |
| 매장별 physical stock(APGUJEONG/VAIL 구분) | **source 없음** — ECOUNT 재고 API 자체가 창고 미구분(§F) |
| 온라인 예약 재고 | source 없음(Cafe24 재고 자체를 정책상 사용하지 않음) |

## E. Metric Feasibility Matrix

| Metric | 판정 | 근거 |
|---|---|---|
| **Sell-through** | **NOT POSSIBLE(정확), APPROXIMATE(대체 지표만)** | 정석 공식(판매수량/(기간초재고+판매수량))에 필요한 "기간 시작 재고"가 없음 — 재고 snapshot이 `latest.json` 하나뿐(§18/§F). 대체: `recentSalesQty(30d) / (currentStock + recentSalesQty)` 형태의 **근사 proxy**는 계산 가능하나 진짜 sell-through가 아니므로 별도 이름 필요(예: `stockTurnoverProxy30d`) — §29 분포상 30일 판매 0인 SKU가 94.5%라 이 proxy조차 대부분 SKU에서 무의미(0/0류). |
| **Velocity(7/14/30일)** | **APPROXIMATE, 30일만** | 현재 `recentSalesQty`는 30일 고정 window, 오프라인만. 7/14일 세분화는 `work/ecount-sales/*.json`의 일자별 라인이 있어 코드상 계산은 가능하나(§29 분포: 9,452/10,000이 30일간 판매 0 — 표본 자체가 매우 희소해 7/14일은 더 희소) 신뢰도 낮음. |
| **Days of Supply** | **APPROXIMATE, 커버리지 낮음** | `stockQuantity / (recentSalesQty/30)` 계산 가능하나 분모가 0인 SKU가 94.5% → `daysOfSupply`가 정의되지 않는(Infinity) 케이스가 대부분. 실사용 가능한 것은 "최근 30일 내 판매가 실제로 있었던 548개 SKU"로 한정. |
| **Stockout Risk** | **APPROXIMATE, 위와 동일 이유로 母집단 작음** | `daysOfSupply < N` 방식은 판매 이력 있는 SKU에서만 유의미. |
| **Slow Mover** | **APPROXIMATE(정의 가능)** | `stock>0 AND recentSalesQty(30d)=0` 정의는 즉시 계산 가능 — 실제로 §29 분포상 이 조건에 해당하는 SKU가 매우 많음(대부분의 in_stock SKU). |
| **Dead Stock** | **APPROXIMATE, "age" 없이는 근사치만** | stock age(입고일)가 없어 "재고를 오래 들고 있었는지"는 판정 불가 — 대신 "판매 이력 자체가 있었는지"만으로 근사(§7). |
| **Inventory Value** | **APPROXIMATE** | `stockQuantity × salesPrice`(또는 purchasePrice)는 계산 가능하나 음수 재고(975개) 처리 규칙이 필요(§15). |
| **Brand Inventory Health** | **APPROXIMATE~EXACT(구성요소별 혼재)** | 기존 `brandRollup`이 이미 기반 제공 — stock/negative/lowStock/qqq는 EXACT 집계, velocity/sell-through 계열은 위와 동일한 희소성 한계 상속. |
| **Category Inventory Health** | **NOT POSSIBLE(현재), 향후 APPROXIMATE** | `category-master.json`의 `modelAssignments`가 15개 prodCd만 커버(총 10,000의 0.15%) — 카테고리 매핑 자체가 사실상 없음. Brand Intelligence 쪽에 더 큰 키워드 기반 카테고리 엔진(`matchCategoryByNameKeywords` 등, `outputs/samplas-marketing-os.js`)이 존재하나 Inventory 데이터에 아직 적용된 적 없음 — 재사용 시도는 가능하나 이번 감사 범위에서 coverage 실측 안 됨. |
| **Restock Attention** | **APPROXIMATE(운영 신호로만)** | lead time/MOQ 없이 정확한 재주문 수량은 불가 — "velocity 대비 재고 적음" 신호 정도만 가능(§19). |
| **Margin** | **APPROXIMATE(신뢰도 미검증), EXACT 아님** | ECOUNT `purchasePrice`가 100% 커버리지(`diagnostic.json.counts.purchasePriceCount: 10000`)로 존재해 완전히 NOT POSSIBLE은 아니지만, 실측 결과 purchasePrice==salesPrice인 SKU가 **정확히 4,103/10,000(41.0%)** — 이 41%는 "진짜 매입가"가 아니라 판매가를 그대로 복사해 넣은 placeholder일 가능성이 높다(ECOUNT 데이터 입력 관행상 흔함). 나머지 59%(5,897건)는 서로 다른 값이라 진짜 매입가일 가능성이 높으나, 이번 read-only 감사에서 실제 브랜드 몇 건을 사람이 검증하지 않고는 확정할 수 없다. **"Margin" 기능을 만들기 전 이 필드의 신뢰도를 별도로 검증(스팟체크)하는 것을 강력히 권장** — 검증 없이 노출하면 잘못된 마진 숫자를 운영 판단에 쓰게 될 위험이 있음. |

## F. Current Data Distribution(Local, 실측 2026-08-25 스냅샷 기준, 10,000 SKU)

```
stockQuantity 분포(전체 10,000):
  null(재고 미수신)     7,295  (73.0%)
  negative              975  (9.75%)
  0                       1  (0.01%)
  1~2                 1,556  (15.6%)
  3~5                   146  (1.5%)
  6~10                   12  (0.1%)
  >10                    15  (0.15%)

status 분포: negative_review 583, unknown 7,200, qqq_estimated_sale 392,
  depleted_candidate 1, qqq_unknown 95, in_stock 1,729

productType 분포: general 9,377 / admin_code 136 / qqq 487

registryLinked: true 6,328(63.3%) / false 3,672(36.7%)
brandCanonical: true 9,480(94.8%) / false 520(5.2%)

recentSalesQty(30일, 오프라인만) 분포:
  0                    9,452  (94.5%)
  1~2                    517  (5.2%)
  3~5                     29  (0.3%)
  >5                       2  (0.02%)
lastSaleDate가 하나라도 있는 SKU: 3,198/10,000(32.0%)

purchasePrice/salesPrice: 둘 다 100% 존재(결측 0건).
  두 값이 동일: 4,103/10,000(41.0%) — margin 신뢰도 이슈(§E 참조)
```

**가장 중요한 시사점**: 재고 수량 자체를 "안다"고 할 수 있는 SKU는 전체의
27%(2,705/10,000)뿐이다. Inventory V2의 모든 velocity/sell-through/
stockout 계열 기능은 이 27%(그리고 그중에서도 30일 판매 이력이 있는
5.5%)라는 훨씬 좁은 母집단 위에서만 신뢰할 수 있다 — UI는 이 좁은
母집단을 "전체 10,000개 중 몇 %"로 항상 명시해야 한다(§27 coverage
설계와 직결).

## G. Operational Questions — 현재 데이터로 답변 가능 여부

| 질문 | 가능 여부 |
|---|---|
| 1. 지금 가장 빨리 빠지는 상품은? | **APPROXIMATE** — `recentSalesQty` 내림차순 가능하나 모집단이 548개뿐(5.5%) |
| 2. 곧 품절될 상품은? | **APPROXIMATE** — daysOfSupply 계산 가능한 SKU가 매우 적음, "곧"의 기준 자체가 근사 |
| 3. 재고는 많은데 안 팔리는 상품은? | **APPROXIMATE** — "많다"의 기준을 데이터 분포로 잡아야 함(§F, stock>10은 15건뿐이라 "많다"의 절대 기준 자체가 낮게 잡힐 것) |
| 4. 브랜드별 재고 부담은? | **EXACT**(기존 brandRollup으로 이미 가능, stock/SKU 수 집계는 정확) |
| 5. 음수 재고 문제는 어디에 집중? | **EXACT**(브랜드/건수 집계 가능, §9) |
| 6. 매출 대비 재고 과다 상품은? | **APPROXIMATE** — 매출(30일 오프라인만)과 재고 비율 계산은 가능하나 온라인 매출 미포함이라 편향 위험 |
| 7. 판매 대비 재고 부족 브랜드는? | **APPROXIMATE**(상동) |
| 8. 온/오프라인 수요가 다른 상품은? | **NOT POSSIBLE(현재), 향후 APPROXIMATE** — 온라인 SKU 판매수량이 Inventory에 아직 연결 안 됨(§B, Product Registry 매칭 필요) |

## H. Inventory V2 Information Architecture(제안)

기존 SAMPLAS UI 컨벤션(카드 → 상태 배지 → 테이블, `refresh-*`/`ad-status-banner`
클래스 재사용) 기준. **이름은 "Inventory Insights"(가칭)로, 기존
"Inventory Intelligence" 이름은 피함(§A.1).**

```
## TOP SUMMARY (전부 §F 실측 근거 있는 것만)
- Known Stock(2,705/10,000, 27%)   ← coverage 명시 필수
- In Stock SKUs(1,729)
- Negative Review(583, 오프라인 매출로 이미 정정될 수 있는 항목 배제 필요)
- Slow/No-Recent-Sales(30d 판매 0인 in_stock, 근사치)
- Restock Attention(velocity 있는 SKU 중 daysOfSupply 낮은 것, 母집단 작음을 배지로 표시)

## ATTENTION
- Restock Attention(모집단 5.5%임을 명시)
- Slow/Dead Stock 후보(WATCH/SLOW/DEAD 3-tier, §7)
- Negative Review(브랜드별 Top, §9)

## BRAND
- 기존 brandRollup 확장(velocity/근사 sell-through 열 추가, 모두 "근사" 배지)

## SKU TABLE
Product | Brand | Stock | 30D Sales(오프라인) | Velocity(근사) | Days Supply(계산 가능한 것만) | Risk | Price
```

## I. MVP / V2 / V3 Split

### MVP(현재 데이터만으로 안전·정확하게 구현 가능)
- Coverage-first summary(known/unknown stock %, registry-linked %, 온라인 미포함 명시)
- 음수 재고 브랜드별/건수 breakdown(§9, EXACT)
- Slow mover 정의(stock>0 AND recentSalesQty30d=0) — WATCH tier만
- Inventory Value(재고금액, salesPrice 기준, 음수 처리 규칙 명시, §15)
- 기존 brandRollup 확장 표

### V2(작은 pipeline 추가 필요)
- §B.1 pipeline gap(월별 오프라인 매출 store-suffix 파일 인식) 수정 —
  **이건 사실 MVP 착수 전 선행조건에 가깝다(버그 수정 성격).**
- purchasePrice 신뢰도 검증(브랜드 표본 스팟체크) 후 margin 근사치 조건부 도입
- 온라인(Cafe24) SKU 판매수량을 Product Registry 매칭을 통해 Inventory에 join(registryLinked=63%에서만 가능)
- Category rollup(기존 Brand Intelligence 카테고리 엔진 재사용 시도, coverage 실측 후)

### V3(새 데이터 source 필요)
- 매장별(APGUJEONG/VAIL) 재고 구분(ECOUNT 창고별 재고조회 API 신규 연동 필요)
- 진짜 sell-through(기간 시작 재고 필요 → 주기적 inventory snapshot 아카이브 신설)
- Stock trend/시계열(§18, snapshot history 저장 구조 신설)
- Reorder recommendation 정밀화(lead time/MOQ 소스 신설)
- SKU lifecycle/시즌 코드(신규 마스터 데이터)

## J. Required Data Pipeline Changes

1. **[선행조건, 버그 수정]** `buildEcountOfflineSalesIndexFromDisk()`의
   파일명 정규식을 warehouse-suffixed 파일(`YYYY-MM.APGUJEONG.json` 등)도
   인식하도록 확장 — 이미 존재하는 `scripts/render-snapshot-manifest.mjs`의
   `RENDER_SNAPSHOT_MONTHLY_PATTERN`이나 `readEcountOfflineSalesSnapshot()`의
   기존 로직을 재사용/공유하는 방향 권장(새 정규식을 또 하나 만들지 않음).
2. purchasePrice 신뢰도 검증 스크립트(1회성 진단, 브랜드별 purchasePrice==salesPrice 비율 산출 — 이미 이번 감사에서 41%를 확인했으나 브랜드/카테고리별 분포까지는 미확인).
3. (V2) Product Registry 매칭을 통한 온라인 SKU 판매수량 join.
4. (V3) 주기적 inventory snapshot 아카이브(예: `work/ecount-inventory/archive/{date}.json`) — 현재는 `latest.json` 하나뿐이라 시계열 완전 불가.

## K. Implementation Plan(MVP 기준, Codex 참고용 — 이번 batch에서 구현하지 않음)

| Step | Files | 내용 |
|---|---|---|
| 1 | `intelligence-service.mjs`(§B.1 수정) 또는 신규 shared helper | 오프라인 매출 월별 파일 discovery를 warehouse-aware로 교체 |
| 2 | `scripts/inventory-overview-lib.mjs` | `buildInventoryOverview()`에 `slowMoverTier`(WATCH만), `inventoryValue`(salesPrice 기준, 음수 규칙 명시) 필드 추가 — 순수 함수 확장, 기존 반환 필드 유지 |
| 3 | `intelligence-service.mjs::handleInventoryOverviewGet()` | coverage 객체에 `recentSalesCoverage`(30일 판매 이력 있는 SKU 비율) 추가 |
| 4 | Frontend(`outputs/samplas-marketing-os.js`) | 신규 뷰(가칭 Inventory Insights) 또는 기존 InventoryOverview 확장 — coverage 배지 우선 노출 |
| 5 | Tests | `test/inventory-overview.test.mjs`(기존 파일 확장) — slow mover 분류, inventory value 음수 처리, coverage 계산 |
| 6 | Production validation | `npm run verify:production --only inventory` |

## L. Test Plan

최소: negative stock 처리, zero stock(depleted_candidate), unmapped
brand(`brandCanonical:false`), unmapped product/registry(`registryLinked:false`),
0 sales(대다수 케이스), high velocity(희소 케이스), no recent sales(대다수),
malformed source(latest.json 배열 아님 등 기존 에러 핸들링 유지), Product
Registry missing(`work/product-registry.json` 없을 때 `registryProdCds`
빈 Set으로 폴백하는 기존 동작 유지 확인), Local/Render parity(`npm run
verify:production --only inventory`).

## M. Risks

- 기존 기능(Today/Monthly/Annual/Clients/Store/Brand/Price Audit/현재
  Inventory) 중 어느 것도 이번 감사에서 건드리지 않았음 — read-only 준수.
- **가장 큰 리스크는 §B.1 pipeline gap을 모른 채 V2를 만드는 것** — velocity
  계열 지표가 다음 달부터 조용히 틀린 값(0)을 낼 수 있다.
- Margin/purchasePrice를 검증 없이 노출하면 41%가 placeholder일 가능성이
  있는 숫자를 신뢰도 표시 없이 보여주는 위험.
- 좁은 母집단(30일 판매 이력 5.5%) 위에서 계산된 지표를 "전체 재고
  인텔리전스"인 것처럼 보여주면 오해를 유발 — coverage 배지 필수.

## N. Development Report

이 문서 자체가 report:
```
path: docs/reports/inventory-intelligence-v2-preaudit-2026-08-26.md
```
git add/commit/push 수행하지 않음(지시 준수) — 사용자가 별도로 커밋 여부 결정.

## O. Final Recommendation

```
INVENTORY INTELLIGENCE V2 REQUIRES DATA PIPELINE WORK FIRST
```

MVP 항목들(coverage-first summary, negative inventory breakdown, slow
mover WATCH tier, inventory value)은 안전하게 바로 구현 가능하다. 하지만
**§B.1의 오프라인 매출 파일 discovery gap은 이미 존재하는 실제 버그이자
V2의 velocity/sell-through 계열 지표 전체의 입력 데이터에 영향을 주므로,
V2를 "설계대로 신뢰할 수 있는 상태"로 만들려면 이 pipeline 수정이
선행되어야 한다.** 또한 margin 기능은 purchasePrice 신뢰도 검증(스팟체크)
전까지 보류를 권장한다. 이 두 가지를 제외한 나머지 MVP 범위는
`INVENTORY INTELLIGENCE V2 READY FOR IMPLEMENTATION`에 준하는 상태다.
