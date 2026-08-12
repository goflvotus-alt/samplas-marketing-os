# DECISIONS.md — 프로젝트 의사결정 로그

이 문서는 "왜 이렇게 하기로 했는가"를 기록한다. 코드를 보면 "무엇을" 했는지는 알 수
있지만 "왜"는 알 수 없다 — 그 배경을 여기 남긴다. 새 Decision을 추가할 때는 번호를
이어서 매기고, 절대 기존 Decision을 삭제하지 않는다(결정이 번복됐다면 새 Decision을
추가하고 옛 Decision에 "Decision-0XX에 의해 대체됨"이라고 표시한다).

---

## Decision-001 — Identity Resolution과 Revenue/Inventory Calculation을 항상 분리한다

- **날짜**: 2026-08 초(STEP63-1 확정, 이후 모든 STEP에서 재확인)
- **배경**: 여러 화면이 브랜드 판정과 매출 계산을 뒤섞어 처리하고 있어서, 브랜드 판정
  로직을 고치려 할 때마다 매출 계산까지 실수로 바뀌는 리스크가 있었다.
- **검토한 대안**:
  1. 브랜드 판정과 매출 계산을 한 함수 안에서 함께 리팩터링.
  2. 판정 로직만 별도 함수로 분리하고 매출 계산 함수는 절대 건드리지 않는다.
- **최종 결정**: 2번. Identity Resolver(`resolveIdentity()`)는 순수 함수로 유지하고
  ("이 판매행이 누구인가"까지만 답한다), 매출/재고 합산 로직은 별도 함수에서 그
  결과값(brand_code 등)만 대입받는다.
- **영향**: STEP63-3(Clients)/STEP63-4(Brand Dashboard) 모두 "판정 결과를 대입하는
  한 줄"만 교체하고 나머지 집계 로직은 무수정으로 유지하는 패턴을 따랐다.
- **관련 STEP**: STEP63-1, STEP63-3, STEP63-4.

---

## Decision-002 — Confidence Contract: VERIFIED/REVIEWED만 canonical 자동 표시/자동 귀속 허용

- **날짜**: STEP63-1
- **배경**: productName 파싱 기반 브랜드 추정(Priority 2)은 사람이 검토하지 않은
  자동 매칭이라, 화면에 "확정된 사실"처럼 보여주면 잘못된 신뢰를 줄 위험이 있었다.
- **검토한 대안**:
  1. 해결(resolved)되면 confidence와 무관하게 전부 canonical로 표시.
  2. VERIFIED/REVIEWED(사람 검토를 거쳤거나 Product Registry가 이미 확정한 것)만
     canonical로 표시하고, CANDIDATE는 데이터에는 채우되 화면에는 원본 그대로 유지.
- **최종 결정**: 2번.
- **영향**: STEP63-3에서 Clients Timeline이 OUR(→OURSELVES REMAKE, CANDIDATE)을
  포함해 대부분의 CO 계열 브랜드를 여전히 원본 코드로 표시하는 결과로 이어졌다 —
  이는 버그가 아니라 이 Decision의 직접적 결과다. STEP63-4에서도 동일 원칙을
  Brand Dashboard의 브랜드 버킷 귀속에 적용했다(CANDIDATE는 브랜드 버킷을 바꾸지
  않음, VERIFIED만 허용).
- **관련 STEP**: STEP63-1, STEP63-3, STEP63-4. 재검토 필요 시 BACKLOG-002 참고.

---

## Decision-003 — BrandGroup(ECOUNT)은 Operational Metadata이지 Canonical Brand가 아니다

- **날짜**: STEP63-0
- **배경**: ECOUNT의 `brandGroup`(원본 컬럼명 "품목그룹1명")은 매장 운영 편의를 위한
  분류 태그일 뿐, 정식 브랜드 마스터 데이터가 아니다. 실측 결과 BON CO/SUN CO는
  한 브랜드로 수렴하지만, POP CO는 6개 이상, QQQ 퀵은 43개 이상의 실제 브랜드를
  아우르고 있었다.
- **검토한 대안**:
  1. brandGroup 자체를 브랜드 귀속 근거로 직접 사용(빠르지만 POP CO/QQQ에서 확실히
     틀림).
  2. brandGroup은 절대 canonical 판정에 쓰지 않고, productName 기반 Identity
     Pipeline만 canonical 판정에 사용하며 brandGroup은 원본 그대로 병기만 한다.
- **최종 결정**: 2번. `scripts/brand-engine.mjs` 헤더에 "brandGroup을 브랜드 귀속
  근거로 사용 금지" 정책이 명시돼 있으며, 이후 모든 Identity Pipeline 호출부가 이
  원칙을 지킨다.
- **영향**: BON CO/SUN CO조차도 "브랜드GROUP이 곧 브랜드"라는 지름길을 타지 않고
  반드시 productName 기반 판정을 거치게 됐다 — 그 결과 BON CO/SUN CO는 온라인
  카탈로그 2차 조회(Priority 2b)가 연결된 화면(STEP63-2B 검증 범위)에서만 해결되고,
  Clients처럼 2b가 연결되지 않은 화면에서는 여전히 미해결로 남는다(Decision-002와
  결합된 결과).
- **관련 STEP**: STEP63-0, STEP63-2B, STEP63-3.

---

## Decision-004 — Identity Pipeline 적용 시 "기존 정확한 경로 우선, Pipeline은 보조"

- **날짜**: STEP63-4
- **배경**: Brand Dashboard의 온라인 상품은 이미 Cafe24 자체 `brand_code` 필드로
  Brand Master와 1:1 연결돼 있어 매우 정확했다. Identity Pipeline을 무조건 먼저
  적용하면 이미 맞는 값을 재해석해서 오히려 정확도를 떨어뜨릴 위험이 있었다.
- **검토한 대안**:
  1. 모든 상품에 대해 Identity Pipeline을 먼저 돌리고 그 결과를 우선.
  2. 기존 경로(Cafe24 brand_code → productBrandMap 백필)를 먼저 시도하고, 그 두
     경로가 모두 실패했을 때만(UNASSIGNED가 될 상황에서만) Pipeline을 보조로 호출.
- **최종 결정**: 2번.
- **영향**: STEP63-4에서 `resolveOnlineProductBrandCode()`가 이 우선순위로 구현됨.
  2026-07 데이터에서는 UNASSIGNED가 이미 0건이라 실측 변화는 없었지만(Brand Coverage
  SAME), 메커니즘 자체는 검증됨. 이 패턴은 이후 Commerce(STEP63-5, 코드 변경 불필요
  로 이어짐)와 Inventory 논의(STEP63-6)에서도 기준점으로 재사용됐다.
- **관련 STEP**: STEP63-4.

---

## Decision-005 — Inventory는 SKU 단위 정확성을 Brand Identity 개선보다 우선한다

- **날짜**: STEP63-6 (사용자 직접 결정)
- **배경**: Inventory는 Decision-004와 반대 상황이었다 — 기존 경로(레거시
  `work/intelligence/brand-master-list.json`)가 오히려 부정확했다(SKU의 52%가
  canonical 미해결). Pipeline을 우선 적용하면 정확도는 개선되지만, 브랜드별 재고
  버킷(`brandRollup`)이 대규모로 재분배되는 부작용이 있었다.
- **검토한 대안**(사용자에게 직접 질의, `AskUserQuestion`):
  1. Pipeline 우선 적용(Critical Brand 검증 개선, 브랜드별 재고 버킷 이동 발생,
     전체 합계는 불변).
  2. 완전 보수적 — 레거시 경로 우선, Pipeline은 기존 경로 실패 시에만 보조
     (브랜드별 재고 Diff 0에 가장 가깝지만 BONNAE 등은 계속 미해결).
- **최종 결정**: 둘 다 아님 — 사용자가 "Inventory는 SKU 단위 정확성이 최우선이다.
  Brand Identity보다 SKU Identity를 우선하며, SKU·재고수량·음수재고가 변할 가능성이
  있으면 Migration을 중단하고 Validation만 수행하라"고 지시. 두 옵션 모두 브랜드별
  재고 버킷에 "변할 가능성"이 있다고 판단해(옵션 1은 명백히, 옵션 2도 완전히 안전을
  보장하지 못함) 이번 STEP에서는 **구현 자체를 하지 않기로** 결정.
- **영향**: STEP63-6은 코드 변경 없이 STOPPED로 종료. Inventory는 여전히 레거시
  레지스트리를 쓴다. 재개 조건은 BACKLOG-001에 기록.
- **관련 STEP**: STEP63-6.

---

## Decision-006 — Personal Payment Bridge는 코드로 풀지 않는다(NO-GO)

- **날짜**: STEP63-3B-0, STEP63-3B-1
- **배경**: Clients 화면에서 온라인 개인결제창 주문에 실제 상품/브랜드 정보를 보여줄
  수 있는지 조사했다. 이름+날짜 근접 매칭을 시도해봤으나 실측 데이터(6개 실제 고객
  사례)에서 날짜 오프셋이 0~8일로 불규칙했고, ECOUNT 개인결제 라인은 금액이 항상
  `null`이라 금액 검증도 불가능했다.
- **검토한 대안**:
  1. 이름+날짜 근접 휴리스틱으로 자동 연결.
  2. 이름+날짜+금액 조합으로 자동 연결(금액 축이 원천적으로 없어 불가).
  3. 연결하지 않는다 — "브랜드 정보 없음"/"제품 정보 없음"을 그대로 유지.
- **최종 결정**: 3번. 추측 연결을 도입하지 않고 현재 상태를 유지한다.
- **영향**: 온라인 개인결제창 주문은 계속 상품/브랜드 정보 없이 표시된다. 재검토
  조건은 BACKLOG-003(운영 프로세스 변경) 참고.
- **관련 STEP**: STEP63-3B-0, STEP63-3B-1.

---

## Decision-007 — ESC 키 레이어링(모달 위 드로어) 버그: 리스너 등록 순서로 해결

- **날짜**: STEP62-1B/62-2
- **배경**: Order Detail Drawer를 Clients Detail Modal 위에 여는 구조를 만들었는데,
  ESC 키를 한 번 누르면 두 레이어가 동시에 닫히는 버그가 발생했다.
- **원인 분석**: `document.addEventListener("keydown", ...)`는 등록 순서대로
  실행된다. 모달의 가드 리스너(`if (드로어가 열려 있으면 return)`)가 드로어 자신의
  닫기 리스너보다 **나중에** 등록돼 있었다 — 드로어가 먼저 스스로를 닫아버리면 그
  시점에는 이미 "드로어가 열려 있음" 조건이 거짓이 되어 모달의 가드가 무력화됐다.
- **검토한 대안**:
  1. 별도의 "레이어 스택" 상태 관리자 도입.
  2. 리스너 등록 순서만 바꿔서(가드를 먼저 등록) 해결.
- **최종 결정**: 2번 — 최소 변경으로 물리적 순서만 재정렬.
- **영향**: 새 상태 관리 코드를 추가하지 않고 기존 구조 그대로 버그 해결. 이후 모든
  Modal-over-Drawer 패턴에 적용 가능한 참고 사례로 남김.
- **관련 STEP**: STEP62-1B, STEP62-2.

---

## Decision-008 — Timeline은 구매 이력만, KPI는 반품 포함 순매출 — 통일하지 않는다

- **날짜**: STEP63-0(발견), STEP63-3(유지 재확인)
- **배경**: Clients Timeline(`purchaseDetails`)의 합계가 공식 KPI 총매출과 일치하지
  않는다는 의문이 있었다. 조사 결과 Timeline은 `offlinePositiveLines`(양수 라인만,
  반품 제외)를 쓰고 KPI는 전체 라인(반품 포함)을 쓰기 때문이었다(권순환 고객 기준
  -11,858,000원 차이, 전체 -46,477,750원).
- **검토한 대안**:
  1. Timeline도 반품 라인을 포함하도록 통일.
  2. 두 개념(구매 이력 vs 순매출)이 원래 다른 것이므로 그대로 유지하고 문서화만 한다.
- **최종 결정**: 2번. Timeline은 "이 고객이 무엇을 샀는가"를 보여주는 이력이고, KPI는
  "실제 매출이 얼마인가"를 보여주는 재무 지표다 — 서로 다른 질문에 답하는 다른
  숫자다.
- **영향**: STEP63-3에서도 이 정의 차이를 바꾸지 않고 그대로 유지, 보고서에 명시.
- **관련 STEP**: STEP63-0, STEP63-3.

---

## Decision-009 — Commerce/Brand Dashboard는 하나의 공유 엔드포인트를 쓴다 — 중복 구현 금지

- **날짜**: STEP63-5
- **배경**: STEP63-5(Commerce Migration) 시작 시점에 Commerce 전용 Identity 로직을
  새로 만들어야 하는지 조사했다.
- **검토한 대안**:
  1. Commerce 전용 브랜드/상품 판정 함수를 별도로 구현.
  2. 기존 소비 구조(Commerce가 `/api/diagnostics/brand-sales`를 그대로 쓰는 구조)를
     확인하고, 이미 STEP63-4가 그 엔드포인트를 마이그레이션했다면 아무것도 새로
     만들지 않는다.
- **최종 결정**: 2번 — 조사 결과 Commerce는 자체 판정 로직이 전혀 없었다. 새 코드를
  작성하지 않기로 결정.
- **영향**: STEP63-5는 코드 변경 없이 검증만으로 PASS 판정. "새 Resolver/새 Pipeline
  생성 금지" 원칙을 지키는 가장 직접적인 사례.
- **관련 STEP**: STEP63-5.

---

## Decision-010 — 화면/기능 완료 기준: DATA COMPLETE → UX/UI COMPLETE → REAL USER FLOW QA → DOCUMENT 4단계

- **날짜**: 2026-08-08(Today Closeout, 사용자 직접 지시로 확정)
- **배경**: 2026-08-08 오전까지 Brand Intelligence(`BrandDashboard`) 데이터 연결
  작업을 진행하던 중, 모든 데이터 연결이 끝나기 전에 Promotion Intelligence 신규
  개발(STEP64-4~STEP65-6)과 Design System/UI 재설계(STEP66-0~STEP66-2)로 작업이
  넘어갔다. 그 결과 Brand Intelligence는 Hero KPI 4개+Trend는 실데이터에 연결됐지만
  Health Score/AI Summary/추천 Action/System Status/Customer Composition/Category
  Pie/Compare Mode는 여전히 하드코딩 Placeholder인 채로 남아 있다(상세:
  `PROJECT_MEMORY.md` 14번 항목). "일부만 연결된 화면"에서 다음 기능으로 넘어가는
  패턴이 반복되면 어떤 화면도 끝까지 완성되지 않는 위험이 있다고 판단했다.
- **검토한 대안**:
  1. 이대로 계속 화면을 넓혀가며(Promotion → Commerce → 다음 화면) 나중에 한꺼번에
     Placeholder를 정리.
  2. 화면마다 "완료"라고 부를 수 있는 명확한 4단계 기준을 세우고, 다음 화면으로
     넘어가기 전에 현재 화면을 그 기준까지 끝낸다.
- **최종 결정**: 2번. 앞으로 모든 화면/기능은 (1) DATA COMPLETE(실제 API/계산에
  연결, Placeholder 없음) (2) UX/UI COMPLETE(Design System 반영) (3) REAL USER
  FLOW QA(실제 Chrome, Debug URL 아닌 클릭 동선) (4) DOCUMENT/SAVE POINT
  UPDATED — 4단계를 전부 통과해야 "COMPLETE"로 기록한다. 중간 상태에서 다음
  기능으로 넘어간 경우 그 화면은 COMPLETE로 표시하지 않는다.
- **영향**: 다음 세션(2026-08-09 이후)의 첫 작업은 **BRAND INTELLIGENCE DATA
  COMPLETION**으로 고정된다 — Promotion Intelligence 신규 기능, Commerce 신규
  기능, 새 Intelligence/Dashboard 개발보다 우선한다. Brand Intelligence가 DATA
  COMPLETE 판정을 받기 전에는 그 화면의 신규 UI 재설계나 다른 화면 개발로 넘어가지
  않는다.
- **관련 STEP**: STEP64-4~STEP66-2(전체 오늘 세션), Today Closeout(2026-08-08).
