# BI-BATCH-H — Brand Intelligence UX Reorganization

Single-Brand Brand Intelligence의 정보 구조를 승인된 새 순서(01 PERFORMANCE → 02 TREND →
03 CHANNEL → 04 CUSTOMER → 05 PRODUCT → 06 INTELLIGENCE → 07 FUTURE/BLOCKED → SYSTEM
STATUS)로 재배치했다. 기존 계산/데이터 소스/formula는 전혀 손대지 않았다 — 이번 배치는
순수 레이아웃 재구성 + 이미 완성된 SKU 데이터를 새 Product 섹션으로 노출하는 것뿐이다.

## Pre-Flight

```
branch = main
STARTING HEAD = a94c0bc6ab021ad1efc6f3072b4397a808243420
```
BI-BATCH-G(`a94c0bc`)가 이미 커밋되어 있었다. 작업 전 `git status`는 report 파일들만
untracked인 clean 상태였다 — Phase 0 체크포인트 커밋 불필요.

## Preservation Inventory (Phase 1)

재배치 전 `#BrandDashboard`의 모든 직계 자식과 그 안의 기능을 전수 조사했다: 브랜드
선택기, 기간 툴바, Compare 토글/헤더, KPI 6종(매출/판매수량/객단가/주문수/Sell-through/
현재재고), Period Performance 비교 표, Channel Mix, Customer Composition(도넛/TOP5/전체
보기/Drawer/최근 구매), Category Intelligence(항상 동시 렌더되는 empty+content 버그
포함), Monthly Trend(차트/Trend Summary/AI Insight), AI Summary/추천 Action, Brand
Score 블록, System Status. 이 인벤토리를 기준으로 아래 재배치를 설계했다.

## 재배치 메커니즘: CSS `order`만 사용, HTML 소스 이동 없음

`#BrandDashboard.view.active`가 이미 flexbox이고, 모든 섹션이 이미 `#BrandDashboard`의
직계 자식이며, 이 코드베이스는 `$("#id")` 기반 조회만 쓰기 때문에(STEP58-4C 선례),
**HTML 소스 순서를 옮기지 않고 CSS `order` 값만 재배정**해서 화면 순서를 바꿨다. JS 로직
파손 위험이 있는 "블록을 물리적으로 옮기는" 방식보다 훨씬 낮은 리스크다.

### OLD ORDER (order 값)
```
1 브랜드 선택 → 2 기간 툴바 → 3 Compare 헤더 → 4 타이틀 →
5 KPI 6종 → 6 SKU 라인 → 7 Channel Mix → 8 [Monthly Trend + Hero(Score+AI+Action)] →
9 Customer → 10 Category → 11 System Status
```

### NEW ORDER (order 값)
```
1 브랜드 선택 → 2 기간 툴바 → 3 Compare 헤더 → 4 타이틀 →
5 01 PERFORMANCE(KPI 6종) → 6 02 TREND(Monthly Trend) → 7 03 CHANNEL(Channel Mix) →
8 04 CUSTOMER → 9 05 PRODUCT(SKU 라인 + 신규 Product 섹션) →
10 06 INTELLIGENCE(AI Summary + 추천 Action) →
11 07 FUTURE/BLOCKED(Score 블록 + 신규 상태 리스트 + Category) →
12 SYSTEM STATUS
```

## Phase 별 구현

### Phase 3 — 01 PERFORMANCE
`#entityHeroEmptyKpi`/`#entityHeroKpiGrid` 두 곳 모두 카드 순서를 매출→판매수량→주문수→
객단가→현재재고→Sell-through로 재배열했다. id/데이터 바인딩/계산 로직은 100% 동일 —
`<article>` 블록 위치만 바꿨다. 새 delta/MoM 계산은 추가하지 않았다(기존 매출 MoM 줄만
그대로 유지).

### Phase 4 — 02 TREND
`.brand-monthly-trend-section`이 더 이상 Intelligence와 좌우 2-column을 공유하지 않아
기존 `flex:1 1 460px` 페어링 규칙을 제거하고 전체 폭을 쓰게 했다. 차트 자체의
`entityTrendChartSvg()`는 `viewBox`만 쓰고 literal width/height가 없어(이미 반응형)
JS/SVG 변경 없이 `.brand-monthly-trend-main`의 `grid-template-columns`를 `7fr 3fr` →
`3fr 1fr`로만 넓혔다.

### Phase 5/6 — 03 CHANNEL / 04 CUSTOMER
order 값만 재배정, 마크업/로직 변경 없음.

### Phase 7 — 05 PRODUCT (신규 가시 섹션)
`renderEntityProductSection()`(`outputs/samplas-marketing-os.js`)를 신규 작성해
`entitySkuRows`(BATCH B/B2가 이미 계산해 둔 온라인 매출+ECOUNT 현재 재고 join 결과, SKU
Drawer가 쓰는 것과 동일 배열)를 매출 순 상위 5개만 노출한다. 새 fetch/새 계산 없음 —
기존 배열을 매출 내림차순 정렬해 슬라이스할 뿐이다. `rebuildEntitySkuRows()`의 기존 두
exit point(early-return / populated) 모두에 호출을 추가해 `refreshOpenEntitySkuDrawer()`
와 동일한 dual-call-site 패턴을 그대로 따랐다. 마크업은 `.brand-customer-top5-list` 계열
클래스를 그대로 재사용(새 CSS 컴포넌트 없음). 행 클릭/"전체 보기" 모두 기존
`openEntityDrawer("sku")`를 그대로 호출 — 별도 SKU 상세 시스템 없음. 현재 재고 null은
`"-"`로(NULL != ZERO), 실제 판매 0건인 Case C 행은 그대로 0으로 표시.

### Phase 8 — 06 INTELLIGENCE
`renderEntityHeroInsight()`의 문장 join 구분자를 `" "` → `"\n"`으로 바꾸고(이미 이전
세션에서 적용됨), CSS `#entityHeroAiSummary { white-space: pre-line; font-size: 15px;
line-height: 1.5; }`를 추가해 여러 사실 문장이 짧은 줄 목록처럼 보이게 했다. 새 문장/새
판단 로직 없음 — 기존 사실 목록 자체는 그대로. `#entityHeroContent`(AI Summary + 추천
Action)는 order 10으로 이동.

### Phase 9 — 07 FUTURE/BLOCKED
- **Score 블록 분리**: 기존 `#entityHeroContent` 안에 있던 `.brand-hero-score-block`을
  별도 최상위 `<div id="entityHeroScoreBlock" class="brand-hero" hidden>`로 분리했다.
  `renderEntityHeroState()`에 `$("#entityHeroScoreBlock")?.toggleAttribute("hidden",
  !selected);` 한 줄을 추가해 기존 `#entityHeroContent`와 정확히 같은 hidden 토글을
  받게 했다 — 표시 로직 변경 없음, 위치만 이동.
- **신규 정적 상태 리스트**: `#entityFutureBlockedStatus`를 새로 추가했다. Category/
  Score/Sell-through/추천 Action 4개 모두 영구 BLOCKED 확정 상태(BI-BATCH-C/D/F/이전
  배치)라 조건부 로직 없이 System Status와 동일한 `.brand-hero-status-*` 클래스를
  재사용한 정적 HTML로만 작성했다.
- **Category 컴팩트화(CSS-only)**: `renderEntityCategorySection()`은
  `entityCategoryRows.length`가 항상 0이라 `#entityCategoryEmpty`와
  `#entityCategoryContent`를 동시에 렌더한다(기존 버그, JS는 그대로 둠). 이 함수는 손대지
  않고, `.brand-category-section .brand-category-grid`와
  `.brand-category-section .brand-customer-insight-card`에 `display: none`만 추가해
  도넛+TOP 리스트+AI Insight 카드를 숨겼다. `#entityCategoryEmpty`(이미 컴팩트)와 compare
  전용 `#entityCategoryCompareTop`은 그대로 보인다.

### Phase 10 — SYSTEM STATUS
`.brand-hero-status-row`는 order 12로, 항상 마지막에 위치(변경 전에도 이미 마지막이었음
— 유지만 확인).

## Tests (Phase 15)

새 파일 `test/brand-intelligence-ux-reorganization.test.mjs` (13 tests):
- 섹션 order 값 대소관계(01<02<03<04<05<06<=07<SYSTEM STATUS)
- KPI 카드 순서(매출/판매수량/주문수/객단가/재고/Sell-through)
- Product 섹션이 `entitySkuRows`만 재사용(새 fetch 없음)
- Product 섹션 온라인 전용 라벨링
- Product 현재 재고 NULL != ZERO 처리
- Product 행/전체보기가 기존 SKU Drawer(`openEntityDrawer("sku")`)를 그대로 여는지
- `rebuildEntitySkuRows()`가 두 exit point 모두에서 `renderEntityProductSection()` 호출
- AI Summary pre-line CSS + `\n` join
- Category grid/AI Insight 카드가 CSS로만 숨겨졌는지 + JS 블록 로직 미변경 회귀 가드
- Future/Blocked 정적 상태 리스트에 4개 항목 모두 존재
- Score 블록 분리 + `renderEntityHeroState()` 동일 토글
- Trend 차트 grid 비율 변경 + SVG viewBox 템플릿 미변경
- Category/Score/Sell-through/Action 공식 미정의 회귀 가드

기존 `test/brand-intelligence-sku-sales-stock-drilldown.test.mjs`는 `rebuildEntitySkuRows`
를 소스 슬라이싱 + `Function()` 샌드박스로 격리 실행하는 구조라, 새로 추가된
`renderEntityProductSection()` 호출을 위해 `renderEntityDrawerBody`와 동일한 방식으로
no-op stub을 주입 파라미터에 추가했다(로직 변경 없음, 테스트 하네스만 갱신).

## Regression

**Targeted**: 신규 13개 전부 PASS. 기존 SKU join 테스트 12개 전부 PASS(stub 추가 후).

**Full regression**: `node --test test/*.test.mjs`
```
baseline: 403/403 PASS (배치 시작 전)
after:    416/416 PASS (403 + 신규 13, 0 fail)
```

## Live Chrome QA (CARNET ARCHIVE / 2026-08)

로컬 서버(`localhost:8787`, 이미 실행 중)에서 실시간 확인, 값은 하드코딩하지 않고 현재
API 응답을 그대로 읽었다:
- **01 PERFORMANCE**: 매출 11,488,059원 / 판매수량 33개 / 주문수 26건 / 객단가
  441,848원 / 현재재고 272개 / Sell-through 정의 미확정(BLOCKED) — 순서와 실값 모두 확인.
- **02 TREND**: 차트가 눈에 띄게 넓어짐(Trend Summary 컬럼 대비), 실제 8개월 라인/AI
  Insight("최근 3개월은 조정 국면입니다. 5월이 최고점입니다.") 정상.
- **03 CHANNEL**: ONLINE 14.2% / OFFLINE 85.8%, 실금액 정상.
- **04 CUSTOMER**: 도넛 31건, TOP5 5명, 클릭 시 Quick Profile 카드(총매출/주문/객단가/
  최근 구매일/최근 주문 3건/SKU·Orders 버튼/Workspace 열기) 정상 동작 확인.
- **05 PRODUCT**: "주요 판매 상품 (온라인)" 5행 실데이터(HAND COATED MASS VEST OIL BLACK
  628,139원 외), 뱃지 "4개"(온라인 판매 확인 SKU 수), AI 인사이트 "온라인 매출 1위 상품:
  ..." 정상. 행 클릭 → 기존 SKU Drawer 정상 오픈 확인(별도 상세 화면 없음).
- **06 INTELLIGENCE**: AI Summary가 4줄로 분리 표시("8월 현재 누적 매출은
  11,488,059원입니다." / "매출의 85.8%가 오프라인에서 발생했습니다." / "이번 기간 온라인
  판매가 확인된 상품은 4개입니다." / "현재 재고는 272개입니다."), 추천 Action은 컴팩트
  블록 상태 텍스트로 정상.
- **07 FUTURE/BLOCKED**: Score 블록("--"/산식 연결 대기) + 신규 4항목 상태 리스트
  (Category/Score/Sell-through/추천 Action 모두 BLOCKED+사유) + Category 섹션(컴팩트,
  도넛/TOP/AI Insight 숨김, "상품군 데이터가 연결되지 않았습니다"만 표시) 정상.
- **SYSTEM STATUS**: 최하단 유지, Cafe24/Meta/Instagram/ECOUNT 상태 정상.
- **Compare Mode(AIVER)**: ON 전환 → KPI 2-column도 새 순서 유지, Period Performance
  표(매출/판매수량/주문수/객단가 4개 모두 실제 증감 값), Comparison Summary 문장 정상,
  Customer Composition 듀얼 도넛(CARNET 31건 vs AIVER 2건) 정상, Category compare-top
  양쪽 "데이터 연결 대기" 정상 — 회귀 없음.
- **Console**: 전체 세션 동안 에러/예외 0건.

## Files Changed

```
outputs/samplas-marketing-os.html   (+90/-…: KPI 재배열, Score 블록 분리, 05 PRODUCT
                                      신규 섹션, 07 FUTURE/BLOCKED 신규 상태 리스트)
outputs/samplas-marketing-os.js     (+85/-…: renderEntityProductSection() 신규,
                                      rebuildEntitySkuRows() 2곳 호출 추가,
                                      renderEntityHeroState() 1줄 추가,
                                      bind() 클릭 핸들러 2개 + init 호출 1개 추가,
                                      AI Summary join 구분자 변경(이전 세션))
outputs/samplas-marketing-os.css    (+80/-…: order 재배정, Trend 차트 grid 비율,
                                      Category 컴팩트화, Product 섹션 커서/서브라인,
                                      AI Summary pre-line)
test/brand-intelligence-sku-sales-stock-drilldown.test.mjs (샌드박스에 stub 파라미터 추가)
test/brand-intelligence-ux-reorganization.test.mjs (신규, 13 tests)
```

## Out of Scope (미실행, 지시대로)

Category taxonomy 정의, Brand Score 공식, Sell-through 공식, 추천 Action 정책 정의,
입고 데이터 수집, 사이드바/전역 OS 리디자인, Compare Mode 재설계, 캐노니컬 매출/고객
분류 계산 변경, Product Registry 강제 매핑, 오프라인 SKU 매출/과거 재고 생성 — 전부
손대지 않았다.

## Commit

```
feat(brand-intelligence): reorganize single-brand decision UX
```
소스+테스트만 커밋(이 report는 커밋하지 않음).

## Final Summary

```text
====================
BI-BATCH-H
BRAND INTELLIGENCE UX REORGANIZATION
====================

STARTING HEAD:
a94c0bc6ab021ad1efc6f3072b4397a808243420

OLD ORDER:
KPI(매출/판매수량/객단가/주문수/Sell-through/재고) → SKU라인 → Channel →
[MonthlyTrend + Hero(Score+AI+Action)] → Customer → Category → SystemStatus

NEW ORDER:
01 PERFORMANCE(매출/판매수량/주문수/객단가/재고/Sell-through) → 02 TREND →
03 CHANNEL → 04 CUSTOMER → 05 PRODUCT(신규) → 06 INTELLIGENCE(AI+Action) →
07 FUTURE/BLOCKED(Score+상태리스트+Category) → SYSTEM STATUS

01 PERFORMANCE: PASS
02 TREND: PASS (차트 폭 확장, viewBox 미변경)
03 CHANNEL: PASS
04 CUSTOMER: PASS (Drawer/Quick Profile 정상)
05 PRODUCT: PASS (신규, entitySkuRows 재사용, 온라인 전용 라벨)
06 INTELLIGENCE: PASS (pre-line 4문장)
07 FUTURE/BLOCKED: PASS (Score 분리 + 상태 리스트 + Category 컴팩트)
SYSTEM STATUS: PASS (최하단 유지)

PRODUCT SOURCE:
entitySkuRows (BATCH B/B2, 새 fetch/계산 없음)

ONLINE-ONLY LABEL:
있음 ("Product Intelligence · Online Only", "온라인 매출 TOP")

CURRENT STOCK SEMANTICS:
NULL → "-", 확인된 real 0 → 0 (변경 없음)

CUSTOMER DRAWER:
PASS (Quick Profile 카드 라이브 확인)

SKU DRAWER (05 PRODUCT 행 경유):
PASS (기존 Drawer 그대로 오픈)

AI SUMMARY:
PASS (기존 사실만, pre-line 4문장)

RECOMMENDED ACTION / CATEGORY / SCORE / SELL-THROUGH:
전부 BLOCKED 유지 (공식 미정의, 변경 없음)

COMPARE REGRESSION:
NONE (AIVER 비교 라이브 확인 — Period Performance/Comparison Summary/듀얼 Customer
도넛/Category compare-top 전부 정상)

PARTIAL-PERIOD SAFETY:
변경 없음 (계산 로직 미변경)

ZERO != FAILURE:
변경 없음 (NULL != ZERO 원칙 유지, Product 섹션도 동일 원칙 적용)

TARGETED TESTS:
13/13 PASS (신규) + 12/12 PASS (기존 SKU join, stub 추가 후)

FULL REGRESSION:
416/416 PASS (baseline 403 + 신규 13, 0 fail)

CHROME QA:
DONE (CARNET ARCHIVE 라이브, 하드코딩 없음)

CONSOLE:
0 errors

COMMIT:
feat(brand-intelligence): reorganize single-brand decision UX

FINAL HEAD:
(커밋 직후 별도 확인)

FILES CHANGED:
outputs/samplas-marketing-os.html, outputs/samplas-marketing-os.js,
outputs/samplas-marketing-os.css,
test/brand-intelligence-sku-sales-stock-drilldown.test.mjs,
test/brand-intelligence-ux-reorganization.test.mjs

REPORT:
docs/reports/BI-BATCH-H-brand-intelligence-ux-reorganization.md

PUSH:
NONE

DEPLOY:
NONE

SAFE TO CONTINUE:
YES

NEXT:
VISUAL REVIEW WITH USER
====================
```
