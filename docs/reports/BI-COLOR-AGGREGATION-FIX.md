# BI COLOR AGGREGATION — INVESTIGATION REPORT

## 결론 먼저

**`entitySkuRows → rebuildEntityColorRows() → entityColorRows → renderEntityColorSection()`
데이터 흐름에는 버그가 없었다.** 요청받은 7가지 항목을 모두 실제 브라우저 런타임에서 직접
검사했고, "UNKNOWN 100% / 분류 매출 0원 / 컬러 커버리지 0%"는 현재 데이터 기준으로
**수학적으로 정확한 결과**임을 확인했다. 코드 수정은 하지 않았다(수정할 버그가 없었다) —
대신 이 정확한 동작을 고정하는 회귀 테스트 3건을 추가했다.

## 정확한 root cause (버그가 아니라 두 가지 사실의 조합)

CARNET ARCHIVE 2026년 8월, `entitySkuRows`는 실제로 5개 행이다:

| productNo | 상품명 | revenue | stockOnly | colorFamily |
| --- | --- | --- | --- | --- |
| 11753 | ZIP BELT EGG CLUSTER SLEEVE KNIT BLOUSE IVORY | 1,210,000 | false | UNKNOWN |
| 13383 | HAND COATED MASS VEST OIL BLACK | 628,139 | false | UNKNOWN |
| 12616 | Unearthed Fragment Chain Oil Black | 269,660 | false | UNKNOWN |
| 12610 | Burnt Silver Dog Tag Burn Silver | 124,160 | false | UNKNOWN |
| **9049** | **MASS DENIM JACKET DARK GREY** | **0** | **true** | **DENIM** |

**사실 1 — productNo 9049는 이번 기간 온라인 판매가 0건인 진짜 사실이다.**
`entitySkuSalesState.rows`(이번 기간 실제 온라인 판매 원본, Cafe24 데이터)를 직접 확인한
결과 `["11753","13383","12616","12610"]` 4개뿐이고 `"9049"`는 없다. 즉 이 SKU는 재고는
있지만(`stock:0`, ECOUNT로 확인됨) 이번 달 온라인으로 한 건도 안 팔렸다 — Case C(stockOnly)
행으로 정확히 분류된 것이고, `revenue:0`은 조작된 값이 아니라 "확인된 진짜 0"이다(Phase 9
원칙).

`rebuildEntityColorRows()`는 `if (row.stockOnly) return;`으로 이 행을 집계에서 제외한다.
**이것은 버그가 아니라, 사용자가 직접 지시했던 기존 설계 그대로다**
(BI-CATEGORY-COLOR-INTELLIGENCE-COMPLETION 배치 지시서 섹션 18: "stockOnly: 매출/판매수량
집계 제외"). 그리고 **Category도 정확히 같은 방식으로 이 SKU를 제외한다** — 아래 "Category와
비교" 참고. revenue가 0인 행은 revenue 기준 비중(%)에 어떤 정책으로도 영향을 줄 수 없다
(0을 더해도 분모/분자 둘 다 안 바뀐다) — "새로운 매출 계산 로직 추가 금지" 원칙상 이 SKU에
가짜 매출을 만들어 붙일 수도 없다.

**사실 2 — 실제 매출이 있는 나머지 4개 SKU는 Product Registry에 verified+confirmed 연결이
없다.** `loadEntityProductRegistryEntries()`로 받은 registry에서 4개 productNo(11753/
13383/12616/12610) 전부 `verified===true && status==="confirmed"`인 항목을 찾지 못했다
(`entryFound: false` 4건 전부). Color는 섹션 11 지시대로 **Cafe24 productName이 아니라
exact prodCd로 연결된 ECOUNT productName에서만** color evidence를 읽도록 설계되어 있어서
(`entityEcountProductNameFor`), registry 연결이 없으면 애초에 어떤 ECOUNT 텍스트도 읽을
방법이 없다 → `classifyEntityProductColor(null, colorMaster)` → `UNKNOWN`/`source:
"fallback"`. 이것도 버그가 아니라 fuzzy productName join을 금지한 기존 정책이 정확히
작동한 결과다.

이 사실 2는 **이전 배치 보고서(BI-CATEGORY-COLOR-INTELLIGENCE-COMPLETION.md, "22. 남은
제한사항")에 이미 기록되어 있던, 알려진 제약**이다 — Product Registry는 880건 중 103건
(11.7%)만 verified+confirmed 상태라 Color가 커버할 수 있는 실제 범위가 낮다.

### Category와 비교 (요청하신 "정상 작동하는 Category와 비교")

같은 브랜드/기간에 실제 브라우저에서 `entityCategoryRows`를 직접 조회했다:

```
TOP      1,210,000원  skuCount 1   (productNo 11753)
OUTER      628,139원  skuCount 1   (productNo 13383 — "HAND COATED MASS VEST", 9049 아님!)
JEWELRY    124,160원  skuCount 1   (productNo 12610)
ACCESSORY  269,660원  skuCount 1   (productNo 12616)
attributedRevenue: 2,231,959  coveragePct: 16.18%
```

Category의 OUTER 행은 `skuCount:1`이고 이건 productNo **13383**(VEST)이지 9049(DENIM
JACKET)가 **아니다** — 즉 **Category도 stockOnly인 9049를 자신의 집계에서 완전히
제외하고 있다**(Color와 완전히 동일한 원칙). Category가 "정상"으로 보이는 진짜 이유는
stockOnly 처리 차이가 아니라, **Category classifier에는 registry 연결이 없어도 동작하는
이름 기반 fallback(상품명 tail-first keyword rule)이 있어서** 11753/13383/12616/12610
4개 모두 registry 연결 없이도 Cafe24 productName만으로 분류에 성공했기 때문이다. Color는
섹션 11 요구사항대로 이 fallback을 의도적으로 갖고 있지 않다(fuzzy join 금지).

## 요청하신 7개 항목 확인 결과

1. **`rebuildEntityColorRows()` 실행 시점의 `entitySkuRows` 실제 내용** — 브라우저에서
   직접 `entitySkuRows` 전체를 덤프해 위 5행 그대로 확인. 최신 상태이고 stale 아님.
2. **집계 조건** — `row.colorFamily || "UNKNOWN"`을 family별로 revenue/quantitySold/
   skuCount/rawExpressions(Set으로 중복 제거)에 더하는 것 확인. 정상.
3. **stockOnly/revenue/quantitySold 필터가 잘못 제거하는지** — `stockOnly` 필터가 9049를
   제외하는 것은 사실이나, **의도된 정책이고 Category와 대칭**이다(위 비교 참고). 그 외
   revenue/quantitySold 필드 자체를 잘못 읽는 부분은 없었다.
4. **`entityColorRows`가 생성된 뒤 다른 비동기 흐름이 UNKNOWN으로 덮어쓰는지** — 실측한
   `entityColorRows`/`entityColorCoverage` 값이 화면에 표시된 값과 정확히 일치했고
   (`attributedRevenue:0`, `unattributedRevenue:13794759`, 화면 "분류 매출 0원"과 동일),
   `entityColorRows[0].revenue`(2,231,959)가 4개 UNKNOWN 행의 정확한 합계였다 — 덮어쓰기/
   stale 흔적 없음.
5. **`renderEntityColorSection()`이 stale 데이터를 읽는지** — 위와 동일 이유로 아니다.
   렌더된 DOM 텍스트가 그 시점의 `entityColorRows`/`entityColorCoverage`와 정확히 일치.
6. **Category와 Color의 rebuild/render 호출 순서 차이** — `rebuildEntitySkuRows()` 안에서
   `rebuildEntityCategoryRows()`와 `rebuildEntityColorRows()`가 **바로 옆줄에서 순서대로**
   호출되고, 브랜드 변경/재고 도착 시 조기 리턴 분기에서도 둘 다 항상 같이 호출된다 —
   호출 순서 차이로 인한 문제 없음.
7. **`refreshEntitySkuSales`/`refreshEntityInventory`/`rebuildEntitySkuRows` 비동기 순서에서
   Color만 stale이 남는지** — `refreshEntityInventory()`가 재고 도착 시점에
   `rebuildEntitySkuRows()`를 다시 호출하고, 그 안에서 Category/Color가 **함께** 재계산된다
   (Color만 별도 경로로 빠지는 지점 없음). 실측 시점에는 이미 재고가 도착한 뒤였다
   (`stockUnavailable: false` 전부, `stockMatched: true`) — 재고 로딩 타이밍 문제도 아니다.

## 수정 파일

**소스 코드는 수정하지 않았다**(수정할 버그가 없었다). `outputs/samplas-marketing-os.js`/
`.css`/`.html`은 이번 조사에서 변경 없음(git diff로 확인, 이전 배치 상태 그대로).

| 파일 | 종류 | 내용 |
| --- | --- | --- |
| `test/brand-intelligence-color-master.test.mjs` | 수정 | 회귀 테스트 3건 추가 |
| `docs/reports/BI-COLOR-AGGREGATION-FIX.md` | 신규 | 이 보고서 |

## Category 회귀 여부

**회귀 없음.** 코드를 수정하지 않았으므로 Category 동작은 애초에 바뀔 수 없었다. 추가로
같은 CARNET ARCHIVE 2026-08 데이터셋을 사용한 Category 전용 회귀 테스트를 새로 추가해
(`Category aggregation on the same CARNET ARCHIVE 2026-08 dataset is unaffected by the
stockOnly DENIM row`) OUTER 행이 여전히 `skuCount:1`(productNo 13383만), `revenue:628,139`,
`coveragePct: 16.18%`로 나오는 것을 고정했다.

## 테스트 결과

- **신규 3건** (`test/brand-intelligence-color-master.test.mjs`):
  1. `CARNET ARCHIVE 2026-08 regression: a real stockOnly DENIM row (0 revenue) does not
     change the UNKNOWN 100% result...` — 현재 화면 값(UNKNOWN 2,231,959원/skuCount 4,
     attributedRevenue 0, coveragePct 0)이 **올바른** 결과임을 고정. DENIM 행이 revenue
     기준 집계에 나타나지 않는 것(매출 0이므로)도 명시적으로 확인.
  2. `a DENIM row with real revenue is correctly aggregated into the DENIM family` —
     매출이 있는 SKU가 DENIM으로 분류되면 그 매출만큼 정확히 DENIM에 집계됨을 별도로
     증명(일반 정합성, 섹션 요청 "가능하면 DENIM 매출이 해당 SKU 매출만큼 정확히 집계되는지도
     검증" 대응).
  3. `Category aggregation on the same CARNET ARCHIVE 2026-08 dataset is unaffected...` —
     위 Category 회귀 확인.
- **Color Master 테스트 전체**: `node --test test/brand-intelligence-color-master.test.mjs`
  → **26/26 PASS**(기존 23 + 신규 3).
- **Category Intelligence 테스트**: `test/brand-intelligence-category-master.test.mjs` 포함,
  변경 없이 그대로 통과.
- **전체 테스트**: `node --test test/*.test.mjs` → **747/747 PASS, 0 fail**(기존 744 +
  신규 3). 어떤 assertion도 약화/삭제하지 않았다.

## 브라우저 검수 결과

**실제 브라우저(http://127.0.0.1:8787, CARNET ARCHIVE, 2026년 8월)에서 직접 확인했다** —
이번 조사 자체가 브라우저 콘솔에서 `entitySkuRows`/`entitySkuSalesState`/
`entityCategoryRows`/`entityColorRows`/`entityColorCoverage`/Product Registry를 실시간으로
조회하며 진행됐다(위 "정확한 root cause" 섹션의 모든 표/숫자가 이 실측값이다).

화면 표시 "컬러 커버리지 0% · 분류 매출 0원 · UNKNOWN 100% · 2,231,959원"은 **해결해야 할
문제가 아니라 현재 데이터를 정확히 반영한 정상 상태**임을 확인했다 — 코드를 바꾸지 않았으므로
화면도 바뀌지 않는다(재확인 스크린샷은 이전과 동일할 것이므로 별도로 다시 찍지 않았다).

## 남은 제한사항 (이전 보고서와 동일, 재확인됨)

- Color 커버리지는 Product Registry의 verified+confirmed 비율(현재 11.7%)에 의해 상한이
  걸린다. 이 브랜드/기간처럼 실판매 SKU가 하필 그 11.7% 밖에 있으면 Color는 정직하게
  UNKNOWN을 유지한다 — Category처럼 이름 기반 fallback을 추가하는 것은 섹션 11의 "fuzzy
  productName join 금지"·"ECOUNT-only" 명시적 요구와 충돌하므로 이번 조사에서 제안하지
  않았다. Registry 검수(별도 워크스트림)가 진행되면 Color 커버리지도 자연히 개선된다.
- stockOnly(재고만 있고 이번 기간 미판매) SKU는 Category/Color 양쪽 모두에서 매출 기준
  집계에 나타나지 않는다 — 이것도 이번 조사에서 확인된 기존 설계 그대로이며, 바꾸려면
  사용자의 별도 지시가 필요하다(현재 지시서는 오히려 이 정책을 유지하라고 명시했다).

## 현재 git status (이번 작업 관련分)

```
M test/brand-intelligence-color-master.test.mjs   (이번 작업: 회귀 테스트 3건 추가)
?? docs/reports/BI-COLOR-AGGREGATION-FIX.md         (이번 작업: 이 보고서)
```

그 외 나열되는 modified/untracked 파일(intelligence-service.mjs, server.mjs,
outputs/samplas-marketing-os.js 등)은 전부 이전 세션/이전 배치의 것으로 이번 조사는 전혀
건드리지 않았다.

## COMMIT 여부

**커밋하지 않았습니다.**
