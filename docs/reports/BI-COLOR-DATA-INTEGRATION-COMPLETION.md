# BI Color Data Integration Completion

## 판정

SAFE STOP. 현재 Color 집계/렌더링 파이프라인은 정상이며, 코드 결함이 아니라 승인된 상품 식별 근거와 실제 매출의 불일치가 원인이다. 자동 Registry 승인이나 매출 생성 없이 요구된 `DENIM` 매출을 만들 수 없다.

## 실제 원인

현재 경로는 `commerce.productSales` → `entitySkuSalesState.rows` → `rebuildEntitySkuRows()` → `rebuildEntityColorRows()` → `renderEntityColorSection()`이다.

- Color는 `verified === true && status === "confirmed"`인 Product Registry의 exact `prodCd`로 ECOUNT 상품명을 찾은 경우만 분류한다.
- 2026-08 CARNET ARCHIVE 온라인 실제 매출 상품은 4개이며 모두 이 조건을 충족하지 않는다.
- productNo `9049`는 confirmed이고 `DENIM`으로 정상 분류되지만, 2026-08 `commerce.productSales`에 없고 ECOUNT 오프라인 판매행에도 없다. 따라서 `stockOnly: true`, revenue `0`, quantitySold `0`이며 기존 정책에 따라 Color 집계에서 제외된다.
- 비동기 rebuild 누락, stale brand/period state, 잘못된 renderer source는 발견되지 않았다. 7월→8월 전환 시 값이 즉시 해당 기간 값으로 교체됐다.

## 수정 파일

없음. 계산 코드, Product Registry, Category/Color Master를 변경하지 않았다.

## CARNET ARCHIVE 2026-08 Runtime

### Before

- canonical total: 13,794,759원
- online: 2,231,959원
- offline: 11,562,800원
- Color: UNKNOWN 100%
- coverage: 0%
- classified revenue: 0원
- unattributed/offline: 13,794,759원

온라인 판매 행:

| productNo | revenue | quantity | Registry |
|---|---:|---:|---|
| 11753 | 1,210,000원 | 2 | entry 없음 |
| 13383 | 628,139원 | 1 | ambiguous / unverified |
| 12616 | 269,660원 | 1 | ambiguous / unverified |
| 12610 | 124,160원 | 1 | candidate / unverified |

### After

코드 및 데이터 무변경. 위 값과 동일하다. 근거 없는 분류를 만들지 않았다.

## Product 9049

- productName: MASS DENIM JACKET DARK GREY
- canonicalProductId: CP-C24-9049
- Registry: verified / confirmed
- exact ECOUNT prodCd: CAR253OT00702
- runtime colorFamily/colorRaw/source: DENIM / DENIM / color_master
- 2026-08 online revenue: 0원 (productSales에 없음)
- 2026-08 offline revenue: 0원 (ECOUNT salesLines에 없음)
- runtime role: stockOnly row
- 결과: 분류는 정상이나 실제 매출이 없어 DENIM 매출 집계 없음

## Color Coverage

- before: 0%
- after: 0% (정확성 정책에 따라 유지)
- 판매수량 모드: UNKNOWN 5개 / 100%
- 매출 모드: UNKNOWN 2,231,959원 / 100%

## UNKNOWN 매출의 남은 원인

온라인 2,231,959원은 실제 판매 4개의 Product Registry가 미확정이라 exact ECOUNT 상품명 evidence를 사용할 수 없다. 오프라인 11,562,800원은 현재 Color 섹션이 명시적으로 온라인 `entitySkuRows`만 집계하고 canonical total에서 오프라인을 미분류로 표시하는 기존 정책이다.

해소하려면 사람의 Revenue Priority Review로 해당 상품 연결을 승인해야 한다. 자동 confirmed, fuzzy join, QQQ 자동 연결은 금지되어 있어 이번 작업에서 수행하지 않았다.

## Category Regression

CARNET ARCHIVE 2026-08 유지:

- 상의 54% / 1,210,000원
- 아우터 28% / 628,139원
- 액세서리 12% / 269,660원
- 주얼리 6% / 124,160원

## Tests

- JavaScript syntax: PASS
- Color/Category/Product Registry targeted: 64/64 PASS
- full regression: 751/751 PASS
- git diff --check: PASS

## Browser QA

- 8787 CARNET ARCHIVE / 2026-08 직접 확인: PASS
- 매출 모드: UNKNOWN 100%, 2,231,959원 (현재 evidence와 일치)
- 판매수량 모드: UNKNOWN 100%, 5개 (현재 evidence와 일치)
- 기간 전환 2026-08 → 2026-07 → 2026-08: stale 없음
- Category 결과 유지: PASS
- 렌더링/API 오류: 관찰되지 않음

## 남은 제한사항

1. `9049`에 2026-08 매출이 있다는 완료 조건은 현재 실제 API/ECOUNT 데이터와 불일치한다.
2. 온라인 4개 상품은 대표 승인 전까지 UNKNOWN이 정상이다.
3. 오프라인 상품명 기반 Color 집계는 현재 정책 밖이며, 별도 승인 없이 새 데이터 경로를 추가하지 않았다.
4. Product Registry master는 변경하지 않았다.

## Git

No commit / no push / no deploy.
