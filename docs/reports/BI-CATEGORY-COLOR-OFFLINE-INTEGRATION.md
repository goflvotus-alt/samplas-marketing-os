# Brand Intelligence Category / Color ECOUNT Offline Integration

## 기준

- 시작 branch: `main`
- 시작 HEAD: `21771e3`
- 기존 dirty working tree를 유지했으며 reset/restore/checkout/clean을 사용하지 않았다.
- commit / push / deploy: 수행하지 않음

## 변경 전 구조

- `entitySkuRows`는 Monthly Archive의 Cafe24 `productSales`만 담는 온라인 전용 배열이다.
- Category와 Color가 이 배열만 합산해 분자는 온라인 매출, coverage 분모는 canonical 온라인+오프라인 총매출이었다.

## 변경 후 구조

- Product/SKU의 `entitySkuRows`와 온라인 전용 UI 의미는 그대로 유지했다.
- 기존 `/api/brand-intelligence/:brandCode/customer-composition`가 이미 수행하던 ECOUNT Snapshot + Unified Identity 판정을 재사용해, 선택 canonical 브랜드의 `offlineAttributionRows`만 additive하게 응답한다.
- 프런트의 별도 `entityOfflineAttributionState`가 해당 행을 기존 Category/Color classifier에 통과시킨 뒤 두 집계에만 합산한다.
- 별도 ECOUNT fetch/API/resolver/parser/fuzzy matching은 추가하지 않았다.

## 수정 파일

- `server.mjs`
- `outputs/samplas-marketing-os.js`
- `outputs/samplas-marketing-os.html`
- `test/brand-intelligence-offline-attribution.test.mjs`
- `docs/reports/BI-CATEGORY-COLOR-OFFLINE-INTEGRATION.md`

## Offline source와 canonical resolution

- Source: `readEcountOfflineSalesSnapshot()`의 `salesLines`
- 대상: `isOfflineRevenue === true`, 선택 월 범위, 선택 store(ALL/APGUJEONG/VAIL)
- canonical: 기존 `loadResolverContext({ onlineCatalog })` + `resolveIdentity({ productName, brandGroup })`
- 선택된 `brandCode`와 exact canonical 결과가 같은 행만 응답한다.
- 고객 집계는 기존대로 양수 구매만 사용하지만 Category/Color 귀속은 canonical 순매출 정합성을 위해 환불 음수 행도 포함한다.

## Classifier 재사용

- Category: `classifyEntityProductCategory(null, productName, productCode || null, categoryOverrides)`
- Color: `classifyEntityProductColor(productName, colorMaster)`
- ECOUNT 응답에 product code가 없으면 null로 유지한다. 값을 추정하지 않는다.
- Category/Color taxonomy와 Master 파일은 변경하지 않았다.

## Non-product 처리

- 새 문자열 필터를 만들지 않았다.
- `퀵비-1`은 Unified Identity에서 선택 canonical 브랜드로 resolve되지 않아 귀속 행에서 제외된다.
- 실제 CARNET 2026-08 검증에서 `퀵비-1` 혼입 0건을 확인했다.

## 합산과 coverage

- Revenue/quantity: 온라인 분류 행 + canonical offline attribution 행
- `skuCount`: 안정적인 Cafe24 SKU key가 없는 offline line은 세지 않고 기존 온라인 SKU count 의미 유지
- denominator: 기존 `entityTrendMonths` canonical revenue/units 그대로
- offline fetch 실패/응답 스키마 오류: coverage를 null로 두어 0원으로 위장하지 않음
- `UNCLASSIFIED` / `UNKNOWN`: 행은 유지하고 attributed numerator에서만 제외

## CARNET ARCHIVE 2026-08 smoke

- 온라인 Category/Color 매출: 2,231,959원 유지
- canonical offline attribution: 38행, 순매출 11,562,800원, 순수량 34개, 환불 음수 2행 포함
- canonical total denominator: 13,794,759원
- Category classified: 13,794,759원 / coverage 100%
- Color classified: 13,661,559원 / UNKNOWN 133,200원 / coverage 99%
- BLACK sample resolve/classify:
  - `CARNET ARCHIVE / A Soldier’s Dog Tag OIL BLACK`
  - `CARNET ARCHIVE / Unearthed Fragment Chain OIL BLACK`
- Product section은 계속 `PRODUCT INTELLIGENCE · ONLINE ONLY`, 온라인 4개/2,231,959원 의미를 유지했다.
- Store 변경 확인: VAIL에서 offline 0이 반영되고, APGUJEONG 복귀 시 11,562,800원이 다시 반영되어 stale data가 남지 않았다.

## 검증

- 신규 targeted test: 3/3 PASS
- Category/Color/Store/Product 관련 targeted regression: PASS
- full regression: 754/754 PASS
- JavaScript/server syntax: PASS
- `git diff --check`: PASS
- Chrome QA: PASS (`http://127.0.0.1:8787/outputs/samplas-marketing-os.html#brand-dashboard`)

## 제한

- Offline line에 Cafe24 productNo가 없어 Product/SKU drawer에는 넣지 않는다.
- Offline `skuCount`는 중복 가능성을 피하기 위해 확장하지 않았다.
- Store focus의 canonical denominator는 기존 Brand Intelligence 정책을 그대로 유지한다. 이번 변경은 store-scoped offline numerator만 기존 필터와 함께 갱신한다.
