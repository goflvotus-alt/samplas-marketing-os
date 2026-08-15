# BI CATEGORY + COLOR INTELLIGENCE COMPLETION BATCH

## 1. 작업 요약

Brand Intelligence에 상품 판매를 두 개의 독립 축으로 완성했다:

- **CATEGORY INTELLIGENCE** (무엇이 팔렸는가) — 기존 BI-BATCH-I 구현을 감사하고, 발견된
  connection gap 1건만 최소 수정했다. 새로 **subcategory hover/detail**을 추가했다
  (기존 확정 subcategory 정책만 사용, 새로 추측하지 않음).
- **COLOR INTELLIGENCE** (어떤 컬러가 팔렸는가) — 이 배치에서 전체 구현. `work/color-master.json`
  (다른 세션이 이미 만들어 staged 상태였던 canonical source, 36 families / 124 aliases)을
  런타임 source로 그대로 사용해 deterministic classifier, `entityColorRows` 집계,
  독립 UI 섹션, RAW hover를 새로 만들었다.

두 축 모두 같은 `entitySkuRows`(canonical online sales + stock join)를 spine으로 공유하지만
taxonomy는 전혀 합치지 않았다.

**커밋하지 않았습니다.** `git add .`/`git add -A`/`git reset --hard` 등 파괴적 명령을 전혀
쓰지 않았고, 이미 존재하던 modified/untracked 파일(다른 세션의 Color Master API/
pathToFileURL fix 등)은 그대로 보존했다.

## 2. 수정 파일 목록

### 이번 배치에서 실제로 수정한 부분

| 파일 | 종류 | 이번 배치 변경 내용 |
| --- | --- | --- |
| `outputs/samplas-marketing-os.js` | 수정 | Color Master loader/classifier(`loadEntityColorMaster`, `classifyEntityProductColor` 등 8개 함수/상수), `entityEcountProductNameFor`, `entityColorRows`/`rebuildEntityColorRows`/`renderEntityColorSection`/quick-profile-card 6종, `entityCategorySubcategoryBreakdown` + `entityCategoryProfileHtml` 확장, `rebuildEntitySkuRows`에 color 필드 배선, Case C `categorySubcategoryCode` 누락 수정 |
| `outputs/samplas-marketing-os.html` | 수정 | Color Intelligence 섹션 마크업 추가, CSS/JS 버전 쿼리스트링 갱신(캐시 버스팅) |
| `outputs/samplas-marketing-os.css` | 수정 | `.brand-color-section` order 규칙, `#entityColorEmpty[hidden]`/`#entityColorToggle[hidden]` 강제 숨김 규칙(브라우저 검수 중 발견한 버그 수정) — 그 외 새 CSS 없음(기존 클래스 전량 재사용) |
| `test/brand-intelligence-category-master.test.mjs` | 수정 | subcategory hover 신규 테스트 2건 추가 |
| `test/brand-intelligence-customer-purchase-detail.test.mjs` | 수정 없음(이전 배치 diff, 이번엔 무변경) |
| `test/brand-intelligence-sku-sales-stock-drilldown.test.mjs` | 수정 | `rebuildEntitySkuRows` 소스 추출 테스트가 새 Color 의존성(`loadEntityColorMaster`/`classifyEntityProductColor`/`rebuildEntityColorRows`/`entityEcountProductNameFor`)을 인식하도록 업데이트 |
| `test/brand-intelligence-color-master.test.mjs` | 신규 | Color Master/classifier/aggregation 전용 테스트 24건 |
| `docs/reports/BI-CATEGORY-COLOR-INTELLIGENCE-COMPLETION.md` | 신규 | 이 보고서 |

### 이번 배치가 손대지 않은, 이미 존재하던 변경(보존함)

`intelligence-service.mjs`, `server.mjs`(pathToFileURL fix, color-master API route/handler),
`work/color-master.json`(staged), `scripts/load-ecount-offline-sales.mjs`,
`test/monthly-performance-ia.test.mjs`, `test/store-intel-ui-a.test.mjs`, `work/category-master.json`
— 전부 이번 세션 시작 전부터 이미 modified/staged 상태였고, 이번 배치는 이 파일들을
전혀 수정하지 않았다(git status로 확인 가능).

## 3. Category canonical source

- Taxonomy: `work/category-master.json`(manualOverrides + modelAssignments) — 그대로 유지.
- 대분류 11개(TOP/BOTTOM/OUTER/DRESS/BAG/FOOTWEAR/HEADWEAR/JEWELRY/ACCESSORY/OTHER/
  UNCLASSIFIED) 변경 없음.
- 감사 결과(섹션 12 체크리스트 8항목 중 7항목은 이미 정확히 구현되어 있었다 — 재작성하지
  않았다):
  1. Category Master가 `entitySkuRows`에 실제 적용됨 — `classifyEntityProductCategory()`가
     모든 온라인 판매 행 + Case C(재고만 있는 행)에 이미 호출되고 있었다.
  2. `modelAssignments`가 실제 productCode에 적용됨 — `loadEntityCategoryManualOverrides()`가
     `byProductCode` 맵으로 이미 연결하고 있었다.
  3. `categorySubcategoryCode` 생성 정책 — `CATEGORY_ECOUNT_SUBCATEGORY_MAP`(suffix 기반)과
     `CATEGORY_NAME_SUBCATEGORY_BY_KEYWORD`(이름 tail-first 기반)가 이미 존재, 그대로 재사용.
  4. UNCLASSIFIED가 숨겨지지 않음 — `entityCategoryRows`에 항상 포함, coverage%의
     attributed에서만 제외.
  5. coverage가 canonical revenue(`entityTrendMonths`)와 비교됨 — 이미 구현.
  6. stockOnly가 Category 매출 집계에서 제외됨 — 이미 구현.
  7. Category revenue/quantity가 `entitySkuRows` 값만 사용 — 새 계산 없음, 이미 구현.
  8. 브랜드 변경 시 stale guard — 이미 구현(`entitySkuSalesState.brandCode !== brandCode` 체크).
- **발견해서 수정한 유일한 gap**: Case C(재고만 있는 stockOnly 행) 생성 블록에
  `categorySubcategoryCode` 필드가 누락되어 있었다(온라인 판매 행에는 있었지만 이전 배치의
  `replace_all` 편집이 들여쓰기 차이로 이 두 번째 지점을 못 잡았던 것으로 추정). 한 줄
  추가로 수정.

## 4. Category classifier 구조

변경 없음(기존 확정 구조 그대로): manual override → 개별 모델/상품 예외 → 확정 ECOUNT
suffix/RESURRECITON 13 내부 품번 → 상품명 tail-first → UNCLASSIFIED. Cafe24 categoryNos
미사용, 런타임 AI/LLM 미사용.

## 5. Category subcategory 구조 (신규: hover/detail만 추가)

기존에 이미 확정되어 있던 `categorySubcategoryCode` 값(예: `SHORT_SLEEVE`/`LONG_SLEEVE`/
`HOODIE`/`SHIRT`/`DRESS`/`BAG`/`UNDERWEAR`/`SWIMWEAR`/`OVERALL`/`SET_UP` 등, Category Phase
2에서 확정한 정책)을 새로 만든 `entityCategorySubcategoryBreakdown(code)`가 `entitySkuRows`에서
집계해(stockOnly 제외) Category quick-profile-card(hover/focus)에 "DETAIL" 섹션으로 보여준다.
확정된 값이 없으면 "확정된 세부 분류 없음"이라고 정직하게 표시한다 — 상품명에서 즉석으로
새 subcategory를 추측하지 않는다.

## 6. Category coverage

변경 없음 — `entityCategoryCoverage`(totalRevenue/attributedRevenue/unattributedRevenue/
coveragePct)는 기존 구현 그대로.

## 7. Color canonical source

`work/color-master.json`(v1, 이미 staged 상태로 존재 — 이번 배치가 만들지도 수정하지도
않았다) — `GET /api/intelligence/color-master`(`intelligence-service.mjs`의
`handleColorMasterGet`, 역시 이번 배치 이전부터 존재)로만 읽는다. 런타임에 families/
aliases/policy를 다시 하드코딩하지 않았다 — `loadEntityColorMaster()`가
`getSharedJson("/api/intelligence/color-master")`를 캐시된 Promise로 감싸 재사용한다
(`loadEntityCategoryManualOverrides`와 동일 패턴).

## 8. Color classifier 구조

```
classifyEntityProductColor(productName, colorMaster) → { family, raw, matchedAliases, source }
```

우선순위:
1. 텍스트에 매칭된 family 중 `MULTI` alias 자체가 있으면 즉시 `MULTI`(explicit MULTI rule).
2. `colorMaster.policy.specialFamilyPriority`(CAMO > LEOPARD > CHECK > STRIPE > DENIM > PRINT,
   **데이터에서 읽음, 코드에 하드코딩 안 함**) 순서대로 매칭되는 첫 special family가 승리.
3. special family가 없고 "진짜 색상" family(= special/MULTI/OTHER 제외)가 2개 이상 매칭되면
   `MULTI`(첫 번째를 임의로 고르지 않음).
4. 1개만 매칭되면 그 family.
5. `OTHER`만 매칭되면 `OTHER`.
6. 아무 evidence도 없으면 `UNKNOWN`(source: `fallback`) — 브랜드/상품종류/가격/이미지/
   카테고리/재고/유사상품으로 절대 추측하지 않는다.

Alias 매칭은 Category classifier와 동일한 유니코드 인식 경계(`(?<![\p{L}\p{N}])...
(?![\p{L}\p{N}])`)를 재사용해 `RED`가 다른 단어 내부에서 오탐되지 않는다.

## 9. 36 families / 124 aliases

`work/color-master.json`에서 그대로 읽음(검증: `test/brand-intelligence-color-master.test.mjs`
테스트 1이 파일에서 직접 세어 36/124를 확인, 실패 시 테스트가 즉시 잡아낸다).

## 10. special priority

`CAMO > LEOPARD > CHECK > STRIPE > DENIM > PRINT` — `colorMaster.policy.specialFamilyPriority`
배열을 그대로 순회. 실측 케이스 전부 통과: DENIM+CAMO→CAMO, LEOPARD+BROWN+PRINT→LEOPARD,
CHECK+PRINT+RED→CHECK, STRIPE+PRINT→STRIPE, DENIM+PRINT+BLUE→DENIM, CAMO DENIM→CAMO,
BLUE DENIM→DENIM.

## 11. MULTI 정책

Special family 없이 진짜 color family 2개 이상 검출 시 `MULTI`(첫 컬러 임의 선택 안 함).
`BLACK WHITE` → `MULTI` 실측 통과. 이 "파생 MULTI"의 경우 대표 RAW 텍스트가 하나로 정해지지
않아 `raw: null`로 두고(억지로 조합 텍스트를 만들지 않음), `matchedAliases`에 실제 매칭된
alias 전부를 담는다.

## 12. UNKNOWN 정책

Evidence 없으면 `UNKNOWN`/`source: "fallback"`/`raw: null`/`matchedAliases: []`. UI 목록에서
숨기지 않는다(`entityColorRows`에 항상 포함, coverage%의 attributed에서만 제외 — Category의
UNCLASSIFIED와 동일 원칙). 실측: CARNET ARCHIVE/ALIVEFORM 두 브랜드 모두 이번 기간 온라인
판매 SKU가 Product Registry verified+confirmed 커버리지(880건 중 103건, 11.7%) 밖에 있어
실제로 UNKNOWN 100%가 나왔다 — 아래 "22. 남은 제한사항" 참고.

## 13. RAW color 보존 방식

`entityColorProfileHtml`(hover 카드)이 `row.rawExpressions`(entitySkuRows가 채운 `colorRaw`를
family별로 중복 제거해 모은 것)를 "RAW COLORS" 아래 그대로 나열한다. 실제 존재하는 값만
보여주고, 없으면 "상세 컬러 표현 없음"이라고 표시한다.

RAW 추출(`extractColorRawForFamily`)은 매칭된 alias 원문을 기본으로 하되, **Color Phase 1
raw-review audit(`scripts/audit-product-color-compression.mjs`)이 실제 카탈로그 감사로 이미
확정한 서술어 목록(`COLOR_RAW_MODIFIER_WORDS`)에 있는 단어만** 바로 앞에 붙여
"DIRTY WHITE" 같은 phrase를 보존한다 — 임의 단어("Shirt", "Cotton" 등)를 색상 서술어로
추론하지 않는다(초기 구현에 이 버그가 있었고 테스트로 잡아 수정함, 아래 21번 참고).

## 14. entitySkuRows 통합 구조

각 행에 Category와 Color 필드가 동시에 존재한다(기존 Category 필드는 전혀 제거하지 않음):

```js
{
  ...,
  categoryCode, categorySubcategoryCode, categorySource,      // 기존, 무변경
  colorFamily, colorRaw, colorSource, colorMatchedAliases      // 신규
}
```

Color evidence는 **Cafe24 productName이 아니라, verified+confirmed prodCd로 정확히 연결된
ECOUNT item의 실제 productName**에서만 읽는다(`entityEcountProductNameFor`, `entitySkuStockFor`/
`entityEcountProdCdFor`와 동일한 join 로직 재사용 — fuzzy productName join 없음). 재고
(inventoryItems)가 아직 로드되지 않았으면 이번 렌더에서는 UNKNOWN — 재고가 로드되면
`rebuildEntitySkuRows`가 다시 돌아 자연히 재분류된다(추측이 아니라 기존 "재고 조회 중" 패턴과
동일).

## 15. Category aggregation

변경 없음 — `rebuildEntityCategoryRows()`.

## 16. Color aggregation

신규 `rebuildEntityColorRows()` — `entitySkuRows`만 재사용(새 매출 계산 없음), family별로
revenue/quantitySold/skuCount/rawExpressions(중복 제거) 집계. stockOnly 제외, UNKNOWN 포함.
Coverage(`entityColorCoverage`)는 Category coverage와 상태를 공유하지 않는 완전히 독립된
계산(totalRevenue/attributedRevenue/unattributedRevenue/coveragePct, UNKNOWN은 attributed에서
제외하되 목록에서는 숨기지 않음).

## 17. UI 구현

Category Intelligence 섹션 바로 다음에 독립 섹션 추가(CSS `order: 11` + HTML 소스 순서로
tie-break). 기존 Category 컴포넌트/CSS 클래스를 전량 재사용했다 — 새 디자인 시스템 없음:
`section-title`/`product-action-filters`/`brand-customer-grid`/`brand-category-grid`/
`brand-customer-donut`/`brand-customer-top5`/`intelligence-action-summary` 등. Color 전용
donut swatch 색상표(`entityColorSwatches`, `entityCategoryColors`와 같은 스타일의 flat hex
map) 하나만 새로 추가했다. 구성: Color share donut, Color TOP list, 매출/판매수량 toggle,
coverage note, AI Insight — 요구 사항 그대로.

## 18. hover/detail 구현

이 프로젝트에 이미 있던 **quick profile card 패턴**(`entityCategoryProfileCard` —
`position: fixed`, `getBoundingClientRect` 기반 위치 계산, 180ms show / 120ms hide 지연,
mouseover/mouseout/focusin/focusout 이벤트 위임, `Overview` 섹션도 이미 같은 패턴을 씀)을
우선 재사용했다 — 처음엔 다른 hover 패턴(`monthlyIntelLink`/`.monthly-intel-popover`)도
검토했지만, 이 프로젝트에 이미 있던 quick-profile-card가 on-page 상세 드릴다운에 더 적합해
그것을 재사용하기로 했다.

- **Category**: `entityCategoryProfileHtml`에 "DETAIL"(subcategory breakdown) 섹션 추가.
- **Color**: `entityColorProfileCard`/`showEntityColorProfileCard`/`hideEntityColorProfileCardSoon`/
  `positionEntityColorProfileCard` 등을 Category 것과 동일한 구조로 새로 만들되, 내부 콘텐츠
  섹션(`.brand-customer-profile-section-title`, `.brand-customer-profile-recent-preview`)은
  Client Quick Profile이 이미 쓰던 클래스를 그대로 재사용해 **새 CSS를 전혀 추가하지 않았다**.
- 키보드 포커스(`focusin`/`focusout`, `:focus-visible` 스타일 상속)까지 기존 패턴 그대로 동작.

## 19. stale/failure/null/zero 처리

`rebuildEntityColorRows()`는 `rebuildEntityCategoryRows()`와 정확히 동일한 stale guard를
쓴다(`!brandCode || entitySkuSalesState.brandCode !== brandCode || entitySkuSalesState.fetchFailed`
→ `entityColorCoverage = null` + 빈 목록). 브랜드/기간 변경 시 `rebuildEntitySkuRows`가 이미
`entitySkuRows.length = 0`으로 초기화한 뒤 다시 채우고, 그 안에서 Category/Color 재계산을
모두 호출하므로 별도 로직 없이 기존 refresh 흐름을 그대로 재사용했다. NULL(브랜드 미선택/
로딩 중) != ZERO(진짜 0) != ERROR(fetch 실패) 문구를 Category와 동일한 방식으로 분리
유지했다.

## 20. 테스트 목록과 결과

- **신규**: `test/brand-intelligence-color-master.test.mjs` — 24건(Color Master 구조,
  API route 등록, 특수 우선순위 5종, MULTI, UNKNOWN, RAW 보존, word-boundary 안전성, null
  colorMaster 방어, `rebuildEntityColorRows` 집계/stockOnly 제외/coverage 독립성, Category/
  Color taxonomy 비독립 방지, `entitySkuRows` 필드 완전성, ECOUNT-only join 검증).
- **확장**: `test/brand-intelligence-category-master.test.mjs` — subcategory breakdown
  집계 테스트 2건 추가.
- **수정**: `test/brand-intelligence-sku-sales-stock-drilldown.test.mjs` — 새 Color
  의존성을 인식하도록 소스 추출/주입 목록 갱신(로직 자체는 미변경).
- **전체 실행**: `node --test test/*.test.mjs` → **744/744 PASS, 0 fail**(기존 719 → 신규
  24 + 확장 2 - 1 net, 실제로는 24+2=26개 신규 통과 케이스가 늘었고 스킵/삭제 없음). 어떤
  assertion도 약화/삭제하지 않았다.

## 21. 브라우저 검수 결과

**실제로 로컬 서버(http://127.0.0.1:8787, 이번 배치 진행 중 재시작함)에서 Chrome으로
검수했다.** 확인된 것과 코드로만 구현된 것을 구분해 기록한다.

**실제 브라우저에서 확인함**:
1. 기존 Brand Intelligence 정상 — CARNET ARCHIVE/ALIVEFORM 두 브랜드 모두 KPI/Monthly
   Trend/Product/System Status 정상 렌더링.
2. Category Intelligence 표시 — 실 데이터(상의 54%/아우터 28%/액세서리 12%/주얼리 6%).
3. Category 대분류 표시 — 확인.
4. Category detail/subcategory 표시(hover) — "상의" hover 시 "DETAIL: SHIRT · 1개" 실제
   확인.
5. Color Intelligence 독립 표시 — Category 섹션 바로 아래 별도 섹션으로 렌더링 확인.
6. Color 매출/판매수량 toggle — 클릭 시 "2,231,959원" ↔ "5개"로 전환 확인, **Category
   toggle과 완전히 독립**(Category는 매출 모드 유지) 확인.
7. Color normalized family 표시 — "UNKNOWN 100%" 실제 렌더링 확인.
8. UNKNOWN 표시 — 숨기지 않고 목록/도넛/Insight 문장 전부에 노출됨을 확인.
9. Category/Color coverage note — 둘 다 실제 숫자로 렌더링, 서로 다른 값(독립) 확인.
10. 브랜드 변경 stale 없음 — CARNET ARCHIVE → ALIVEFORM 전환 시 Category(상의→신발)와
    Color(둘 다 UNKNOWN이지만 스크린샷 갱신 값 확인) 즉시 갱신, 이전 브랜드 데이터 잔류
    없음 확인.
11. Product/Monthly 정상 — 확인.
12. Console error 없음 — 확인(확장 프로그램발 "message channel closed" 노이즈 3건만 존재,
    앱 코드 관련 ReferenceError/TypeError/SyntaxError 없음).
13. **실제 버그 1건을 브라우저 검수 중 발견해서 수정함**: `#entityColorEmpty`/
    `#entityColorToggle`에 대한 `[hidden]` 강제 숨김 CSS 규칙이 빠져 있어, 브랜드가 선택된
    상태에서도 "브랜드를 선택하세요" 빈 상태 메시지와 실제 데이터가 동시에 표시되는 버그가
    있었다 — `outputs/samplas-marketing-os.css`에 `#entityColorEmpty[hidden]`/
    `#entityColorToggle[hidden] { display: none; }`을 추가해 수정하고 재검수로 확인했다.
    같은 검수 과정에서 CSS/JS 정적 파일의 캐시 버스팅 버전 쿼리스트링도 갱신했다(실사용자
    브라우저 캐시로 이 버그가 안 보일 위험 방지).

**코드로만 구현하고 유닛 테스트로 검증했으나 브라우저에서 육안으로 직접 재현하지는 못한 것**
(데이터 제약 때문 — 아래 22번 참고):
- CAMO/DENIM 독립 분류, MULTI 표시(실 데이터에 매칭 SKU가 없어 라이브 화면에서 못 봄,
  단 유닛 테스트 11건으로 결정론적 검증 완료).
- Color RAW hover에 실제 raw 표현이 채워진 상태의 화면(테스트 브랜드 둘 다 UNKNOWN이라
  "상세 컬러 표현 없음" 분기만 봤다 — 이 분기 자체와 hover 메커니즘은 확인했지만, 채워진
  리스트 렌더링은 유닛 테스트로만 검증).
- 기간(월) 변경 시 stale 없음 — 브랜드 변경은 확인했지만 기간 변경은 별도로 클릭해보지
  않았다(코드상 동일한 guard를 공유하므로 위험은 낮다고 판단했지만, 육안 확인은 아니다).
- Customer 섹션 — 렌더링 자체는 확인했으나 ALIVEFORM에서 "고객 구성을 확인할 수 없습니다"
  라는 기존(이번 배치 미변경) 문구가 떴다 — 이번 배치와 무관한 기존 동작으로 보이며 더
  조사하지 않았다.

## 22. 남은 제한사항

- **Product Registry 커버리지가 Color 정확도의 상한이다.** Color evidence는 verified+confirmed
  registry 연결을 통한 ECOUNT productName에서만 읽도록 설계했는데(섹션 11 요구사항 그대로),
  현재 registry는 880건 중 103건(11.7%)만 verified+confirmed 상태다. 이번 기간 실제
  검수한 두 브랜드(CARNET ARCHIVE, ALIVEFORM) 모두 이번 기간 온라인 판매 SKU가 하필 이
  11.7% 밖에 있어 Color가 100% UNKNOWN으로 나왔다 — 이는 버그가 아니라 설계된 대로
  정직하게 "증거 없음"을 보여준 것이지만, 실사용 체감 커버리지는 Product Registry 검수가
  더 진행되기 전까지 낮을 수 있다. Category는 이름 기반 fallback이 있어 이 제약의 영향을
  덜 받는다(레지스트리 연결 없이도 상품명만으로 분류 가능) — Color는 사용자가 명시적으로
  ECOUNT-only 원칙을 요구했으므로 같은 fallback을 추가하지 않았다.
- Color Compare Mode(브랜드 A/B 비교 상단 행)는 이번 배치 범위 밖이라 만들지 않았다
  (Category의 기존 Compare Mode 비교 행도 이번 배치가 손대지 않음).
- Color "전체 보기" Drawer는 만들지 않았다 — Category의 "TOP" 리스트도 실제로는 전체
  entityCategoryRows를 다 보여주고 있어(잘림 없음) 별도 Drawer가 기능적으로 불필요하다고
  판단, Color도 동일하게 리스트만으로 전체를 보여준다.
- `COLOR_RAW_MODIFIER_WORDS`(RAW phrase 확장용 서술어 화이트리스트)는 Color Phase 1
  raw-review audit 결과를 재사용한 것이지만, 카탈로그가 커지면 새 서술어가 추가로 필요할
  수 있다 — 이번 배치에서 새로 발견된 서술어는 추가하지 않았다(범위 밖).

## 23. git diff --stat

```
 intelligence-service.mjs                           |   60 +-   (이전 세션 것, 이번 배치 무변경)
 outputs/samplas-marketing-os.css                   |  226 +-   (이번 배치: order 규칙 + hidden 버그 수정, 나머지는 이전 세션 것)
 outputs/samplas-marketing-os.html                  |   85 +-   (이번 배치: Color 섹션 마크업 + 버전 갱신)
 outputs/samplas-marketing-os.js                    | 1256 ++-- (이번 배치: Color 전체 구현 + Category subcategory hover + Case C fix)
 scripts/load-ecount-offline-sales.mjs              |    7 +-   (이전 세션 것, 이번 배치 무변경)
 server.mjs                                         |  182 +-   (이전 세션 것, 이번 배치 무변경)
 test/brand-intelligence-category-master.test.mjs   |  250 +-   (이번 배치: subcategory 테스트 2건 + 이전 배치分)
 test/brand-intelligence-customer-purchase-detail   |   12 +-   (이전 배치 것, 이번 배치 무변경)
 test/brand-intelligence-sku-sales-stock-drilldown  |    7 +-   (이번 배치: Color 의존성 주입 갱신)
 test/monthly-performance-ia.test.mjs               |   30 +-   (이전 세션 것, 이번 배치 무변경)
 test/store-intel-ui-a.test.mjs                     |   53 +-   (이전 세션 것, 이번 배치 무변경)
 work/category-master.json                          |  108 +-   (이전 배치 PACOSPLY 저장, 이번 배치 무변경)
 12 files changed, 1965 insertions(+), 311 deletions(-)
```

신규(untracked) 파일 중 이번 배치가 만든 것: `test/brand-intelligence-color-master.test.mjs`,
`docs/reports/BI-CATEGORY-COLOR-INTELLIGENCE-COMPLETION.md`. 그 외 untracked 파일(다수의
`docs/reports/*.md`, `scripts/*.mjs`, `test/*.test.mjs`, backup 파일들)은 전부 이전 세션들이
만든 것으로 이번 배치는 건드리지 않았다.

## 24. git status --short (이번 배치 완료 시점)

```
 M intelligence-service.mjs                              (이전 세션 것)
 M outputs/samplas-marketing-os.css                       (이번 배치 포함)
 M outputs/samplas-marketing-os.html                       (이번 배치 포함)
 M outputs/samplas-marketing-os.js                        (이번 배치 포함)
 M scripts/load-ecount-offline-sales.mjs                  (이전 세션 것)
 M server.mjs                                             (이전 세션 것)
 M test/brand-intelligence-category-master.test.mjs        (이번 배치 포함)
 M test/brand-intelligence-customer-purchase-detail.test.mjs (이전 배치 것)
 M test/brand-intelligence-sku-sales-stock-drilldown.test.mjs (이번 배치)
 M test/monthly-performance-ia.test.mjs                    (이전 세션 것)
 M test/store-intel-ui-a.test.mjs                          (이전 세션 것)
 M work/category-master.json                               (이전 배치 것)
A  work/color-master.json                                  (이전 세션 것, staged 그대로 보존)
?? test/brand-intelligence-color-master.test.mjs            (이번 배치 신규)
?? docs/reports/BI-CATEGORY-COLOR-INTELLIGENCE-COMPLETION.md (이번 배치 신규)
 ... (그 외 다수 untracked 파일 — 전부 이전 세션 것, 무변경)
```

## COMMIT 여부

**커밋하지 않았습니다.** 사용자 검수 후 별도로 진행해 주세요.
