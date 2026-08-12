# STEP67-10G-5 — 진단 보고서 (READ-ONLY)

진단 전용. 코드/HTML/CSS/JS/server/테스트/마스터 데이터 전부 미수정.
git 쓰기 명령 전부 미실행. 이번 STEP의 유일한 새 파일은 이 보고서다.

## 핵심 결론 (미리 요약)

**저장소 어디에도 "STEP67-10G-5"에 대한 사전 정의가 존재하지 않는다.**
`work/reports/`, `docs/`, `outputs/samplas-marketing-os.{js,html}`,
`test/*.mjs`, `server.mjs`, `intelligence-service.mjs` 전체를 검색했으나
"10G-5"/"STEP67-10G-5" 문자열은 0건이다. 따라서 이번 STEP은 "이미 정해진
계획을 확인"하는 것이 아니라, **STEP67-10G-0~4가 남긴 "다음 STEP"
추천 흔적에서 가장 근거가 강한 후보를 역추적**하는 작업이었다. 아래
§3에서 후보 3개를 근거와 함께 제시하고, 결론에서 어느 것도 사용자
확인 없이 단독으로 착수하지 않도록 GO/NO-GO를 판단한다.

## 1. 현재 branch / HEAD / git status

```
pwd:      /Users/binggu/Documents/Codex/2026-06-28/samplas-os-https-www-instagram-com
branch:   main
HEAD:     4f6f827 feat(work-data): support master data uploads
staged:   (없음, git diff --cached --name-only 빈 결과)
```

`git status --short` 결과: 이전 STEP들과 동일한 12개 tracked modified
(`.gitignore`, `intelligence-service.mjs`, `outputs/samplas-marketing-os.{css,html,js}`,
`scripts/*.mjs` 4개, `server.mjs`, `test/monthly-brand-sales.test.mjs`,
`work/monthly/2026-07.json`) + 다수 untracked(`.claude/`, 여러 설정 파일,
`test/*.mjs` 10개, `docs/DAILY_LOG/` 등) — STEP67-10G-4 종료 시점과
완전히 동일하다. STEP67-10G-4 이후 어떤 커밋도 없었고(HEAD 불변),
이번 진단에서도 아무것도 stage/commit하지 않았다.

## 2. STEP67 관련 최신 보고서 및 작업 이력

`work/reports/STEP67-10G-*.md` 5건을 모두 확인:

| STEP | 제목 | 상태 | 원래 "다음 STEP" 추천 |
|---|---|---|---|
| 10G-0 | Brand Comparison Gap Audit | PARTIAL(진단) | G-1(타임아웃 처리) 우선 |
| 10G-1 | YoY/Draft-Archive Timeout Fix | READY FOR USER QA | (명시적 다음 STEP 필드 없음, §16 "Remaining Gaps" 목록만) |
| 10G-2 | Comparison Summary Interpretation Architecture | READY(설계만) | STEP67-10G-3 규칙 엔진 구현 |
| 10G-3 | Comparison Summary Rule Engine Implementation | Tests 12/12, 회귀 266/266 PASS | Chrome QA 후 "cross-brand fact를 매출 외 지표로 확장" 또는 "channel dominance를 독립 fact로 승격" 검토 |
| 10G-4 | Partial-Period Consistency Audit & Fix | Tests 11/11(12개 시나리오), 회귀 277/277 PASS, **사용자 Chrome 실검수 PASS(이번 지시에서 확인)** | "if clean, no further partial-period work needed for this feature area" — 그 외 남은 Brand Comparison 격차(Custom Period, Category Intelligence)는 STEP67-10G-0부터 이미 별도 추적 중인 항목이라고 명시 |

**주의**: STEP67-10G-0의 원래 계획(§16 Minimum Implementation Plan)은
`G-1(타임아웃) → G-2(주석 정리) → G-3(custom 기간 UI) → G-4(테스트 보강)`
순서였다. 그러나 **실제로 실행된 STEP은 이 문자 그대로 이어지지
않았다** — 10G-2는 원래 계획의 "주석 정리"가 아니라 완전히 새로운
"Comparison Summary 해석 아키텍처 설계"였고, 10G-3은 "custom 기간 UI"가
아니라 "규칙 엔진 구현"이었으며, 10G-4는 원래 계획에 전혀 없던
"Partial-Period 일관성 버그 수정"이었다(10G-3의 Chrome QA 도중 실측으로
발견된 문제라서 새로 끼어든 것). 즉 **이 시리즈의 번호는 "사전에 확정된
계획표"가 아니라 "직전 STEP에서 발견된 다음 문제를 그때그때 이어붙인
로그"**다 — 이 사실이 이번 진단의 핵심 전제다.

## 3. STEP67-10G-5의 원래 정의 확인 결과

**검색 방법**: `grep -rln "10G-5"` 를 `work/reports/`, `docs/`,
`outputs/`, `test/`, `server.mjs`, `intelligence-service.mjs` 전체에
실행. 결과: **0건**. `docs/ROADMAP.md`/`docs/ROADMAP_BACKLOG.md`도
확인했으나 이 두 파일은 **2026-08-08 Today Closeout 시점에 마지막으로
갱신**되어(STEP67 시리즈 자체가 아직 시작되기 전) STEP67 어떤 하위
번호도 언급하지 않는다 — 즉 이 로드맵 문서들은 STEP67-9/10 시리즈
전체에 대해 stale 상태이며(예: `ROADMAP_BACKLOG.md`의 BACKLOG-008
"Brand Intelligence Compare Mode 실데이터 연결 OPEN"은 STEP67-9E~10G
시리즈에서 이미 LIVE로 해결된 상태를 반영하지 못하고 있다), 이번
진단의 근거로 사용할 수 없다.

**따라서 STEP67-10G-5는 이 저장소 안에 사전 정의가 존재하지 않는다.**
사용자가 이번 지시에서 "기존 계획에서 무엇을 의미하는지 확인하라"고
한 것은, 문자 그대로 존재하는 정의를 찾으라는 뜻이라기보다 **STEP67-10G
시리즈가 실제로 이어져 온 패턴(직전 STEP의 "다음 STEP" 추천을 따라가는
방식)에서 논리적으로 다음에 올 항목을 역추적하라**는 의미로 해석했다.
아래 3개 후보를 근거 강도 순으로 제시한다 — **어느 것도 확정하지
않았고, 사용자 확인 없이 착수하면 안 된다는 것이 이 진단의 결론이다**
(§8 GO/NO-GO 참고).

### 후보 A — Cross-Brand Fact 확장 / Channel Dominance 독립 fact화 (STEP67-10G-3 자신의 추천)

**근거**: STEP67-10G-3 보고서의 "Recommended Next STEP" 필드가 정확히
이렇게 적혀 있다: "Chrome QA per checklist above, then decide whether
to extend cross-brand facts beyond revenue or add single-brand channel
dominance as its own fact type, both of which the underlying helpers
already support but which Phase K's V1 priority list intentionally
excluded." — Chrome QA는 이제 완료됐다(STEP67-10G-4가 그 QA 과정에서
발견한 버그를 먼저 고치고 방금 PASS 판정을 받았으므로, "Chrome QA per
checklist above" 조건은 사실상 충족됐다). 코드 확인 결과 인프라가 이미
존재한다:
```
outputs/samplas-marketing-os.js:13553  const ENTITY_COMPARE_SUMMARY_CHANNEL_DOMINANT_SHARE = 0.70;  (정의만, 미사용)
outputs/samplas-marketing-os.js:13555  const ENTITY_COMPARE_SUMMARY_CUSTOMER_DOMINANT_SHARE = 0.60; (정의만, 미사용)
outputs/samplas-marketing-os.js:13618  function entityCompareSummaryCrossBrandFact(metric, aValue, bValue, ...)
  — 이미 4개 지표(revenue/quantitySold/orderCount/aov) 전부에 재사용 가능한 범용 함수.
    현재 buildComparisonSummaryFacts()는 이 함수를 revenue 지표 1개로만 호출한다(13827행).
```
가장 근거가 강함(가장 최근 STEP이 직접 명시), 가장 구체적으로 범위가
좁혀져 있음(정확히 어떤 함수/상수를 어떻게 확장하면 되는지 코드
수준으로 이미 알려짐), 새 아키텍처 결정이 필요 없음(STEP67-10G-2의
fact taxonomy §6에 UNITS_LEADER/ORDERS_LEADER/AOV_LEADER/CHANNEL_DOMINANT가
이미 정의돼 있으나 V1 우선순위에서 의도적으로 제외됐을 뿐).

### 후보 B — Custom Period(사용자 지정 비교 기간) 날짜 입력 UI

**근거**: STEP67-10G-0 §16(Minimum Implementation Plan G-3), §18(Recommended
Next STEP 목록)부터 STEP67-10G-1 §15(Custom Period Status: "사용자 지정 ·
미확정 그대로 유지")까지 반복적으로 "아직 구현되지 않았다"고 기록된
가장 오래된 미해결 항목. 코드 확인 결과 여전히 그대로다:
```
outputs/samplas-marketing-os.js:12417  select?.value === "custom" ? "사용자 지정 · 미확정" : "비교 대상 미확정"
outputs/samplas-marketing-os.js:13382  function entityComparePeriodKeyForMode(mode) { ... custom 분기 없음, null 반환 ... }
outputs/samplas-marketing-os.html      <option value="custom">직접 선택</option>/<option value="custom">사용자 지정</option> — 셀렉트만 있고 날짜 입력 컴포넌트 없음
```
근거는 있으나(반복적으로 "남은 항목"으로 언급됨), STEP67-10G-3/4가 이미
"어느 STEP도 이걸 다음으로 지정하지 않았다" — G-0은 이걸 "우선순위
낮음"으로 명시했었다(§17 Risk Assessment: "Custom 기간 UI(G-3)는 새
컴포넌트라 다른 옵션보다 범위가 크다 — 우선순위를 낮게 잡은 이유").
새 UI 컴포넌트(날짜 피커/입력 검증)가 필요해 지금까지의 10G 시리즈보다
범위가 크다.

### 후보 C — Monthly Trend 호버 툴팁의 진행 중 월 MoM% 표시 (STEP67-10G-4 Known Limitation)

**근거**: STEP67-10G-4 §22 "Known Limitations"에 명시적으로 남겨둠:
"The Monthly Trend chart's per-point hover tooltip (`entityTrendPointTooltipHtml`)
still shows a colored MoM% for the live point on hover... Flagged here
rather than silently left." 코드 확인:
```
outputs/samplas-marketing-os.js:14107  function entityTrendPointTooltipHtml(index) { ... entityTrendMoMPct(index) 그대로 사용, entityIsLiveMonthRow 가드 없음 ... }
```
가장 범위가 작고 리스크가 낮지만(단일 함수, 호버 시에만 노출되는
저노출 디테일), STEP67-10G-4 자신이 "Chart.js/SVG 리디자인 없음"이라는
제약 때문에 **의도적으로** 범위 밖에 남긴 것이지 "다음 STEP"으로
예약해 둔 것은 아니다 — 셋 중 사용자가 의도했을 가능성이 가장 낮다고
판단(우선순위/영향도 모두 낮음, "STEP"이라 부를 만큼 독립적인 작업
단위가 아닐 수 있음).

## 4. 현재 Brand Intelligence 코드에서 해당 기능과 연결되는 위치

세 후보 모두 동일 파일(`outputs/samplas-marketing-os.js`) 안,
동일 아키텍처 경계(STEP67-10G-2가 확정한 "순수 함수 규칙 엔진 +
DOM 렌더 분리") 안에 있다:

- **후보 A**: `buildComparisonSummaryFacts()`(13780행 부근, Phase F
  "CROSS_BRAND" 블록, 현재 revenue 지표 1개만 후보 목록에 추가)와
  `entityCompareSummaryChannelFact()`(13656행 부근, 현재 브랜드 간
  구조 차이만 판정하고 단일 브랜드 dominance는 판정하지 않음)를
  확장하는 형태가 될 것.
- **후보 B**: `entityComparePeriodKeyForMode(mode)`(13382행)의 `custom`
  분기 + `outputs/samplas-marketing-os.html`의 `#entityCompareTarget`
  select 옆에 날짜 입력 UI 신규 추가.
- **후보 C**: `entityTrendPointTooltipHtml(index)`(14107행) 단일 함수에
  `entityIsLiveMonthRow` 가드 추가(STEP67-10G-4가 이미 만든 헬퍼 재사용).

## 5. STEP67-10G-4와 충돌 가능성

**후보 A**: 충돌 없음. `buildComparisonSummaryFacts()`/`renderEntityCompareSummary()`는
STEP67-10G-4가 전혀 건드리지 않은 함수다(STEP67-10G-4 보고서 §15에서
직접 확인: "buildComparisonSummaryFacts()와 renderEntityCompareSummary()는
이 STEP에서 수정되지 않았다"). 확장 시에도 이미 확정된 Partial-Period
가드(§8/§17, `currentArchiveStatus === "live"`일 때 PERIOD_CHANGE류
fact 생성 금지, CROSS_BRAND는 예외)를 그대로 재사용해야 하며, 새 지표
확장이 이 가드를 우회하지 않도록 주의가 필요하다(예: quantitySold
cross-brand fact를 추가해도 quantitySold PERIOD_CHANGE 가드와는 무관한
별도 axis이므로 원칙적으로 안전하지만, 구현 시 재확인 필요).

**후보 B**: 충돌 가능성 낮음. Custom 기간 UI는 `entityComparePeriodKeyForMode`의
`custom` 분기만 채우면 되고, 나머지 계산 경로(`entityCompareKpiRowFromArchive`,
`entityCompareTargetPeriodData`, `buildComparisonSummaryFacts`)는 이미
prev/yoy와 동일하게 동작하도록 설계돼 있어(STEP67-10G-0 §6에서 이미
확인: "이전 달과 전년 동월은 동일한 코드 경로") custom도 유효한
`YYYY-MM` 키만 만들어주면 자동으로 STEP67-10G-3/4의 모든 가드(Partial
Period/Low Base/Null!=Zero)를 그대로 상속받는다. 단, 사용자가 미래
월이나 archive가 없는 월을 선택하는 새로운 edge case가 생기므로
STEP67-10G-1의 timeout/error 상태 처리와의 상호작용을 별도 검증해야 한다.

**후보 C**: 충돌 없음(STEP67-10G-4가 "알고 남긴" 항목). `entityIsLiveMonthRow`
헬퍼를 그대로 재사용하면 되므로 오히려 STEP67-10G-4 인프라를 완성하는
성격의 작업이다.

## 6. 구현 시 변경이 필요한 파일 (후보별)

| 후보 | 예상 수정 파일 |
|---|---|
| A | `outputs/samplas-marketing-os.js`(규칙 엔진 함수 확장만), `test/brand-comparison-summary.test.mjs`(기존 12개 시나리오에 새 fact 타입 검증 추가) |
| B | `outputs/samplas-marketing-os.js`(custom 분기 + 날짜 유효성 검증), `outputs/samplas-marketing-os.html`(날짜 입력 UI 신규), 신규 테스트 파일 |
| C | `outputs/samplas-marketing-os.js`(단일 함수 1건), 기존 `test/brand-intelligence-partial-period.test.mjs`에 케이스 추가 |

## 7. 예상되는 회귀 위험

- **공통 위험**: 세 후보 모두 STEP67-10G-3/4가 이미 통과시킨 회귀
  스위트(`test/brand-comparison-summary.test.mjs` 12/12,
  `test/brand-intelligence-partial-period.test.mjs` 11/11, 전체
  277/277)를 다시 깨뜨리지 않아야 한다 — 특히 Null≠Zero 원칙,
  Partial-Period 가드, Wording Contract(인과 표현 금지)는 이번 대화의
  사용자 지침에서도 다시 명시적으로 "회귀시키지 말 것"이라 확인됨.
- **후보 A 고유 위험**: Fact Priority(§14, 최대 3개)에 새 fact 후보가
  추가되면 기존 3개 우선순위 슬롯 경쟁이 바뀔 수 있다 — 기존 정상
  동작하던 CARNET ARCHIVE vs TROUBLED WATERS 실측 케이스의 요약 문장이
  달라질 수 있으므로 STEP67-10G-3의 §21 실측 시뮬레이션과 재대조 필요.
  Channel Dominance를 단일 브랜드 fact로 추가하면 "전체 우열 표현 금지"
  원칙(§9)과 겹치지 않도록 문구 재검토 필요.
- **후보 B 고유 위험**: 가장 크다 — 새 UI 컴포넌트(날짜 입력, 유효성
  검증, 미래 월/데이터 없는 월 처리)라 지금까지 10G 시리즈의 "기존
  요소만 재배선" 패턴을 벗어난다. Category Intelligence처럼 "공식
  source 미확정" 상태를 만들지 않도록, 유효하지 않은 custom 날짜 선택
  시 정직한 placeholder를 유지해야 한다.
- **후보 C 고유 위험**: 가장 작다 — 단일 함수, 호버 전용, 이미 있는
  가드 재사용.

## 8. 구현 후 자동 테스트 및 Chrome 실검수 항목 (후보별 계획)

공통(세 후보 모두): 구현 후 `node --test test/brand-comparison-summary.test.mjs
test/brand-intelligence-partial-period.test.mjs test/brand-intelligence-live-data.test.mjs
test/brand-intelligence-ui-restoration.test.mjs`로 회귀 우선 확인 후
`node --test test/*.mjs` 전체 실행. Chrome 실검수는 이번 대화에서
사용자가 이미 확정한 QA 브랜드 쌍(CARNET ARCHIVE/TROUBLED WATERS,
2026-08 vs 2025-08/2026-07)을 그대로 재사용해 회귀 여부를 먼저 확인한
뒤 신규 케이스를 추가하는 순서를 권장.

- **후보 A**: 신규 테스트 — quantitySold/orderCount/AOV cross-brand fact
  생성 조건(§7 materiality 그대로 재사용), channel dominance 단일 브랜드
  fact가 "전체 우열" 표현이 아님을 검증하는 wording-safety 케이스, 우선순위
  절단(§14)이 새 fact 타입 추가 후에도 3개로 유지되는지. Chrome: 실제
  브랜드 쌍으로 요약 문장이 늘어난 지표를 포함해도 3문장 이내인지,
  causal 표현이 여전히 없는지 육안 확인.
- **후보 B**: 신규 테스트 — 유효한 custom 날짜/무효 날짜/미래 날짜/
  archive 없는 과거 날짜 4가지 케이스. Chrome: 날짜 입력 → 실제 값 반영
  → Partial Period 가드가 custom 기간에도 동일하게 적용되는지.
- **후보 C**: 기존 파일에 1~2개 케이스 추가(`entityTrendPointTooltipHtml`이
  live 포인트에서 "진행 중" 또는 MoM% 숨김으로 표시하는지). Chrome:
  8월 포인트에 마우스오버 시 더 이상 "▼N%"가 색상과 함께 표시되지
  않는지.

## GO / NO-GO Recommendation

**NO-GO — 사용자 확인 대기.**

이유: 이 저장소에 "STEP67-10G-5"의 사전 정의가 존재하지 않으며, 세 후보
모두 나름의 근거가 있어 임의로 하나를 골라 구현을 시작하면 "추측해서
다음 기능을 만들지 말 것"이라는 이번 지시의 원칙을 정면으로 어기게
된다. 세 후보 중 **후보 A(Cross-Brand Fact 확장/Channel Dominance
독립화)가 가장 최근 STEP이 스스로 남긴 가장 구체적인 추천**이라 가장
유력하지만, 이것이 사용자가 실제로 의도한 "STEP67-10G-5"와 같다는
보장은 없다. 다음 지시에서 사용자가 세 후보 중 하나를 지정하거나 다른
범위를 알려주면 그 즉시 착수 가능한 상태로 코드/테스트/회귀 경로는
이미 이번 진단에서 확인을 마쳤다.

---

## STEP67-10G-5 정확한 목표

**확정되지 않음** — 이 저장소 안에 사전 정의가 없다. 사용자 확인 필요.
가장 유력한 후보(근거 순): (A) Cross-Brand fact를 매출 외 지표로 확장
+ Channel Dominance 독립 fact화, (B) Custom Period 날짜 입력 UI, (C)
Monthly Trend 호버 툴팁의 live-point MoM% 가드.

## 구현해야 하는 것

사용자가 A/B/C 중 하나(또는 별도 범위)를 확정하기 전까지 **없음**.

## 구현하지 말아야 하는 것

- Category Intelligence 임의 분류(공식 source 연결 전, 기존 정책 유지).
- Sell-through 임의 계산(공식 산식 확정 전, 기존 정책 유지).
- 현재 월 incomplete-period 정책(STEP67-10G-4 확정) 재작성 — Chrome
  QA로 이미 PASS 확정됨, 다시 손대지 않음.
- 매출/판매수량/주문수/객단가/Channel Mix/Monthly Trend/Customer
  Composition의 기존 정상 동작 회귀.
- 세 후보를 사용자 확인 없이 임의로 선택해 구현.

## 수정 예상 파일

후보 확정 후 §6 표 참고. 공통으로는 `outputs/samplas-marketing-os.js`가
중심이며, 후보 B만 `outputs/samplas-marketing-os.html`과 신규 UI가
추가로 필요.

## 테스트 계획

§8 참고 — 공통 회귀(4개 기존 focused 파일 + 전체 스위트) 먼저, 후보별
신규 시나리오는 후보 확정 후 정확한 개수/내용을 설계.

## Chrome 검수 계획

§8 참고 — CARNET ARCHIVE/TROUBLED WATERS, 2026-08 vs 2025-08/2026-07
케이스로 회귀 우선 확인 후 후보별 신규 케이스 추가.

## GO / NO-GO

**NO-GO(사용자 범위 확정 대기)**. 코드 미수정, commit/push 없음.
