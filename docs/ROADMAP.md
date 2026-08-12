# ROADMAP.md — SAMPLAS Marketing OS 개발 순서

이 문서는 "지금 어디까지 왔고, 다음에 뭘 하는가"를 추적한다. 정책/아키텍처 설명은
`PROJECT_MEMORY.md`, 중단된 작업과 기술 부채는 `ROADMAP_BACKLOG.md`, 의사결정 배경은
`DECISIONS.md`를 참고한다.

마지막 갱신: 2026-08-08 (Today Closeout, STEP66-2 종료 시점 기준)

**⚠ 다음 세션 첫 작업 고정**: **BRAND INTELLIGENCE DATA COMPLETION**. Promotion
Intelligence/Commerce 신규 기능, 새 Intelligence/Dashboard 개발보다 우선한다.
근거·범위는 `PROJECT_MEMORY.md` 14번/15번 항목, `DECISIONS.md` Decision-010 참고.

---

## 이미 완료

### Identity 이전 단계 — Clients Timeline/Drawer 기능 구축 (STEP62-1 ~ STEP62-5)

Clients 화면에 "Customer Purchase Timeline"(고객별 최근 구매 이력)과 "Order Detail
Drawer"(주문 상세 패널)를 새로 구축한 단계. 이 과정에서 브랜드 판정이 여러 화면에
독립적으로 흩어져 있다는 사실이 드러났고, 이것이 STEP63 시리즈(Identity Pipeline
통합)로 이어졌다.

- **STEP62-1/62-1A/62-1B**: Customer Purchase Timeline 최초 구축, Personal Payment
  Attribution 감사, Timeline Payment Type Badge 수정.
- **STEP62-2**: 공유 Order Detail Drawer 구축(Timeline 카드 클릭 → 상세 패널). ESC
  레이어링 버그(모달 2개가 ESC 한 번에 같이 닫히는 문제) 발견·수정 — 원인은
  `keydown` 리스너 등록 순서 문제였고, 가드 리스너를 드로어 자체 리스너보다 먼저
  등록하도록 재정렬해서 해결.
- **STEP62-3**: Identity Layer(브랜드+상품) 최초 도입, `resolveRawBrandCanonical()`
  (Brand Master 정확 일치만 시도)를 Timeline/Drawer에 연결.
- **STEP62-4**: Brand Alias Candidate Builder(`scripts/build-brand-alias-candidates.mjs`)
  — brandGroup+Product Registry prodCd 기반 오프라인 배치, 사람 검토 큐 전용, 자동
  적용 없음.
- **STEP62-5**: Product Identity Resolver Architecture Review — 코드베이스 전체에서
  최소 6~7개의 독립적인 병렬 브랜드 판정 경로("Resolver A~G")가 공존한다는 사실을
  최초로 문서화(`work/reports/STEP62-5-architecture.md`). STEP63 시리즈의 출발점.

### Identity Pipeline 설계·구축 (STEP63-0 ~ STEP63-2B)

- **STEP63-0**: Brand Identity Reconciliation Audit — CO 접미사 코드(BON CO/SUN CO/
  POP CO/QQQ 퀵)의 실제 브랜드 일관성을 실측 검증. BON CO/SUN CO는 단일 브랜드로
  수렴하지만 POP CO/QQQ 퀵은 진짜 다중 브랜드임을 확인. Timeline-vs-KPI 매출 불일치의
  정확한 원인(반품 라인 포함 여부)도 이 단계에서 규명.
- **STEP63-1**: Unified Brand/Product Resolver Specification —
  `work/reports/STEP63-1-resolver-spec.md`. Output Contract, Confidence 등급
  (VERIFIED/REVIEWED/CANDIDATE/UNRESOLVED), Confidence Contract(자동 승격 금지 규칙)를
  최초로 확정.
- **STEP63-2**: Unified Resolver Foundation — `scripts/unified-identity-resolver.mjs`
  최초 구축(`resolveIdentity`/`loadResolverContext`). 아직 어떤 화면에도 연결하지 않은
  순수 함수 단계.
- **STEP63-2A**: Shadow Reconciliation — 기존 Resolver F(Monthly)와 신규 Unified
  Resolver를 같은 2026-07 오프라인 라인(1,178건)에 나란히 돌려 비교. Total 매출은
  양쪽 다 Diff 0이었으나 브랜드 커버리지는 서로 다른 강점을 가짐을 확인.
- **STEP63-2B**: Identity Pipeline Integration — Unified Resolver에 "온라인 카탈로그
  2차 조회"(Priority 2b)를 추가해 Resolver F의 강점까지 흡수. 최종 실측: 오프라인 총
  237,972,530원(Diff 0), 해결 브랜드 수 60개(F=47, 기존 Unified=36 대비 UP), UNASSIGNED
  47,696,300원(F의 91,113,160원보다 감소).

### Clients 화면 마이그레이션 (STEP63-3 ~ STEP63-3B-1)

- **STEP63-3 (PASS)**: Clients Identity Pipeline Integration — `purchaseDetails`에
  canonical 필드 4개(`canonicalBrandCode`/`canonicalBrandName`/`brandConfidence`/
  `operationalBrandGroup`)를 원본 `brand` 필드를 건드리지 않고 추가. Timeline Card/
  Drawer를 `clientsTimelineBrandDisplay()` 함수로 통일. Confidence Contract에 따라
  CANDIDATE 확신도는 화면에 자동 표시되지 않음(OUR→OURSELVES REMAKE는 데이터 계층
  에서는 정확히 해결되지만 CANDIDATE라 화면엔 원본 그대로 표시 — 의도된 동작).
  Revenue Diff 0원.
- **STEP63-3A (PASS)**: Online Clients Regression Audit — "온라인 고객 일반"의
  "브랜드 정보 없음"/"제품 정보 없음" 표시가 STEP63-3 이전부터 있던 사전 존재 동작임을
  git diff로 확인. Regression 아님.
- **STEP63-3B-0 (NO-GO)**: Personal Payment Bridge Feasibility Audit — Cafe24
  개인결제창과 ECOUNT 판매전표를 잇는 신뢰 가능한 키가 없음을 실측 8건으로 확인
  (날짜 오프셋 0~8일, 금액 검증 불가, 이름 불일치 사례 존재).
- **STEP63-3B-1 (NO-GO)**: ECOUNT Slip Architecture Audit — ECOUNT 판매 데이터
  자체가 Line 단위 Excel export일 뿐 Slip Header(전표 헤더) 개념이 애초에
  시스템에 없음을 독립적으로 재확인. 3B-0과 다른 각도에서 같은 결론에 도달해 신뢰도
  보강.

### Brand Dashboard / Commerce / Inventory 마이그레이션 (STEP63-4 ~ STEP63-6)

- **STEP63-4 (PASS)**: Brand Dashboard Identity Pipeline Migration —
  `aggregateCafe24BrandSalesByBrandCode`(server.mjs)에 `resolveOnlineProductBrandCode()`
  보조 함수 추가. Cafe24 자체 brand_code가 실패했을 때만(UNASSIGNED일 때만) Product
  Registry Priority 1(VERIFIED만)로 보조 조회. 2026-07 기준 UNASSIGNED가 이미 0건이라
  실측 Brand Coverage는 SAME(메커니즘 자체는 검증됨, 향후 갭이 생기면 자동 작동).
  Revenue/Quantity Diff 0.
- **STEP63-5 (PASS)**: Commerce Identity Pipeline Migration — 조사 결과 Commerce는
  자체 브랜드/상품 판정 로직이 전혀 없고 100% `/api/diagnostics/brand-sales`(STEP63-4
  가 이미 마이그레이션한 바로 그 엔드포인트)를 소비할 뿐임을 확인. **코드 변경 없이
  검증만으로 PASS** — STEP63-4의 변경을 이미 상속받고 있었음.
- **STEP63-6 (STOPPED)**: Inventory Identity Pipeline Migration — Inventory가
  Brand Master가 아닌 별도 레거시 파일(`work/intelligence/brand-master-list.json`)을
  쓰고 있으며, SKU의 52%(5,213/10,000)가 canonical로 인식되지 않음을 발견(BONNAE 포함).
  Pipeline을 우선 적용하면 Critical Brand 검증은 개선되지만 브랜드별 재고 버킷이
  재분배될 위험이 있어, 사용자 지시("SKU 정확성 최우선, 가능성 있으면 중단")에 따라
  구현을 중단하고 현재 상태만 문서화했다.

### 문서 시스템

- **Documentation Foundation**: `docs/PROJECT_MEMORY.md`, `docs/ROADMAP.md`,
  `docs/ROADMAP_BACKLOG.md`, `docs/DECISIONS.md`, `docs/DAILY_LOG/` 생성(이 작업).

### Promotion Intelligence 신규 구축 (STEP64-4 ~ STEP65-6)

- **STEP64-4(WARNING)~STEP64-6(PASS)**: Cafe24 Promotion 실제 운영 구조 조사(카테고리
  기반, 브랜드별 다른 기간할인), Category/Benefit Source Integration 코드 작성,
  Proxy Route 활성화 계획.
- **STEP65-1(PASS)~STEP65-2(PASS)**: Runtime Derived Object 모델 확정,
  `GET /api/promotion/:categoryNo/summary` API 구현(기존 Brand Intelligence 엔진
  재사용, 새 Revenue 계산 없음).
- **STEP65-3(PASS)~STEP65-6(PASS)**: Promotion Summary UI 구축, Selector 추가(실제
  스토어에서 ONLINE GARAGE=category 425/이런 ㅅㅂ=category 437 실측 확인), Sidebar
  Navigation Integration, Sidebar 재배치 정정(Brand Intelligence를 올바른 화면
  `BrandDashboard`로 재연결).

### Design System Foundation + UI/UX Rebuild (STEP66-0 ~ STEP66-2)

- **STEP66-0(PASS)**: `docs/DESIGN_SYSTEM.md` 생성. Brand Intelligence 실제 CSS
  값을 코드에서 추출해 문서화(Typography/Spacing/Card/KPI/Button/Badge/Status
  Color). 기존 불일치(Ghost/Danger 버튼 부재 등)도 정직하게 기록.
- **STEP66-1(PASS)**: Promotion Intelligence를 Design System 기준으로 재설계
  (Hero 카드/KPI 3단 계층). QA 중 Selector `opacity:0`/`[hidden]` 무효화 버그 2건
  발견·수정.
- **STEP66-2(PASS)**: Commerce를 Design System 기준으로 재설계(Hero/Primary·
  Secondary KPI/Sales Summary/Channel/Detail). QA 중 Sales Summary stale 데이터
  버그 발견·수정.

### 2026-08-08 Today Closeout — Brand Intelligence Data Completion Audit

Brand Intelligence(`BrandDashboard`)를 코드 레벨로 정밀 조사해 **DATA
INCOMPLETE** 판정을 확정했다. Hero KPI 4개/Monthly Trend는 실데이터 연결
확인됐지만, Health Score/AI Summary/추천 Action/System Status/Customer
Composition/Category Pie/Compare Mode는 전부 하드코딩 Placeholder임을 확인
(상세: `PROJECT_MEMORY.md` 14번 항목). Decision-010(4단계 완료 기준 정책)을
확정했다.

---

## 진행 중

현재 활성 작업 없음 — 2026-08-08 세션은 Today Closeout(문서 갱신)으로 종료됐다.
**다음 세션 첫 작업은 아래 "다음 STEP"의 1번(Brand Intelligence Data Completion)
으로 고정**이며, 다른 후보로 먼저 넘어가지 않는다(Decision-010).

---

## 다음 STEP

### 0순위(고정) — BRAND INTELLIGENCE DATA COMPLETION

`PROJECT_MEMORY.md` 14번 항목의 "Backlog가 아니라 반드시 완료해야 하는 항목"
전부를 실데이터에 연결하기 전에는 Promotion Intelligence 신규 기능, Commerce
신규 기능, 새 Intelligence/Dashboard 개발로 넘어가지 않는다.

1. **정확도 검증 먼저**: Hero KPI/Trend가 읽는 `/api/reports/monthly`
   (Resolver F 기준)가 Integrated Identity Pipeline과 얼마나 정합적인지
   `monthlyReportBrandCode()`부터 추적해 확인(현재 UNKNOWN).
2. **Health Score + AI Summary + 추천 Action** 연결 — 화면 최상단 "판단" 요소,
   무엇을 근거로 계산할지부터 설계 필요(새 계산식이 될 가능성이 높으므로 STEP0
   조사 먼저).
3. **System Status 행** 연결 — 실제 `/api/status` 등 기존 헬스체크 결과를 연결.
   가장 오인 소지가 크다(자체 Placeholder 라벨이 없음).
4. (완료 후) `ROADMAP_BACKLOG.md` BACKLOG-006~008(Customer Composition/Category
   Pie/Compare Mode)로 우선순위 낮게 이어감.

### 1순위 이하(기존 후보, 순서 변경 없음 — Data Completion 이후)

`ROADMAP_BACKLOG.md`에 상세 기록. 요약만 여기 남긴다.

1. **Inventory Migration 재개 여부 결정**(STEP63-6 후속): Pipeline 우선 적용 방식으로
   진행할지, 레거시 `work/intelligence/brand-master-list.json`을 Brand Master로
   교체하는 별도 데이터 마이그레이션(코드 아님, 파일 교체)을 먼저 할지 결정 필요.
2. **Confidence Contract 정책 결정**(STEP63-3 후속): OUR/RAC/KAM/BON CO/SUN CO가
   Clients 화면에서 여전히 원본 코드로 보이는 문제 — (a) Clients에 온라인 카탈로그
   2차 조회 연결(캐싱 전략 필요), (b) Confidence Contract 완화, (c) Reviewed Alias
   사람 승인 중 택1 필요.
3. **Monthly Report(Resolver F) 마이그레이션 여부**: 지금까지 모든 STEP63 작업에서
   의도적으로 범위 밖으로 남겨둔 마지막 주요 화면.
4. **Personal Payment Bridge**: NO-GO로 결론났으나, ECOUNT 운영 프로세스 변경(실제
   금액을 라인에 남기는 방식)이 가능하다면 재검토 가치 있음 — 코드 문제가 아니라
   운영 프로세스 문제이므로 이 프로젝트의 개발 로드맵과는 다른 트랙.
5. **Promotion Category/Benefit Proxy 배포**: STEP64-5/64-6에서 작성한 코드가
   실제 Proxy(Render)에 배포돼야 ONLINE GARAGE/이런 ㅅㅂ의 실제 이름·기간·상태가
   Promotion Intelligence에 채워진다(현재는 카테고리 번호만 알고 이름/Benefit은
   미배포로 조회 불가).

---

## 장기 계획

- 6~7개로 흩어진 병렬 Resolver(A~G, `PROJECT_MEMORY.md` 11번 항목)를 전부 Identity
  Pipeline 하나로 수렴시키는 것이 궁극적 목표다. 단, 매 단계마다 "이미 정확한 경로를
  악화시키지 않는다"는 원칙을 지키며 점진적으로 진행한다 — 한 번에 전체를 갈아엎지
  않는다.
- Brand Universe / Brand Sourcing 관련 Master Data 작업(work/monthly 자동화,
  master-data-phase1 등, git status상 이미 존재하는 uncommitted 작업)은 이 Identity
  Pipeline 트랙과 별개 트랙으로 진행 중이며 이 로드맵의 범위 밖이다.
