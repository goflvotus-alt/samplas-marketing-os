# ROADMAP_BACKLOG.md — STOPPED / BACKLOG / Technical Debt

`ROADMAP.md`가 "지금 뭘 하는가"를 다룬다면, 이 문서는 "지금 하지 않기로 한 것과 그
이유"를 다룬다. 항목마다 이유/재개 조건/우선순위/영향도를 반드시 기록한다 — 이유 없이
그냥 "나중에"라고 적지 않는다.

마지막 갱신: 2026-08-08

---

## BACKLOG-001 — Inventory Identity Pipeline Migration 재개

- **상태**: STOPPED (STEP63-6)
- **이유**: Inventory가 쓰는 레거시 브랜드 레지스트리(`work/intelligence/brand-master-
  list.json`, 273개 브랜드, Brand Master와 다른 별도 파일)가 10,000개 SKU 중 5,213개
  (52.1%)를 canonical로 인식하지 못한다(BONNAE 포함). Integrated Pipeline을 우선
  적용하면 이 갭을 메울 수 있지만, 그 경우 `brandRollup`(브랜드별 재고 집계)의 버킷
  라벨이 대규모로 재분배된다 — 전체 재고 합계/SKU 수/음수재고 수는 불변이지만 "브랜드별
  재고 Diff 0" 요구와 충돌 소지가 있다. 사용자가 "Inventory는 SKU 단위 정확성이
  최우선이며, SKU·재고수량·음수재고가 변할 가능성이 있으면 Migration을 중단하고
  Validation만 수행하라"고 명시적으로 지시해 구현을 중단했다.
- **재개 조건**: 다음 중 하나를 사용자가 먼저 결정해야 재개 가능하다.
  1. Pipeline을 우선 적용하고 브랜드별 재고 재배치를 "의도된 개선"으로 명시 승인.
  2. 레거시 `work/intelligence/brand-master-list.json`을 (코드가 아니라) 데이터
     마이그레이션으로 먼저 `work/brand-master.json` 기준으로 교체/동기화한 뒤,
     Inventory 코드는 그대로 두고 데이터만 정합화.
  3. 완전 보수적 방식(기존 경로 실패 시에만 보조) — 이 경우 BONNAE 등 Critical
     Brand는 "미해결"로 남는다는 점을 사전에 승인.
- **우선순위**: 중간 — 사용자 확인 화면에서 매일 참조하는 재고 브랜드 뷰이므로 체감
  임팩트는 크지만, 숫자 자체(SKU 수/재고 수량)는 지금도 정확하다(브랜드 라벨만 부정확).
- **영향도**: 잠재적으로 5,213개 SKU(52%)의 브랜드 표시가 바뀔 수 있음 — Inventory
  화면의 "Brand Rollup" 테이블 사용자 경험에 직접 영향.
- **관련 STEP**: STEP63-6.

---

## BACKLOG-006 — Brand Intelligence Customer Composition 실데이터 연결

- **상태**: OPEN(하드코딩 Placeholder 확인됨, 2026-08-08 Today Closeout)
- **이유**: `BrandDashboard`의 Customer Composition(스타일리스트/일반고객/프레스
  도넛+테이블)이 `entityCompositionTypeStats`/`entityCompositionRows`(리터럴
  상수, 가상 인물명 포함)로 100% 하드코딩돼 있다 — 어떤 브랜드를 선택해도 값이
  바뀌지 않는다.
- **재개 조건**: Clients 화면이 이미 갖고 있는 고객 유형(stylist/press/customer)
  분류 로직을 브랜드별로 필터링해 재사용할 수 있는지 먼저 조사(새 Resolver 금지
  원칙 유지).
- **우선순위**: 낮음(MUST COMPLETE 목록 — `PROJECT_MEMORY.md` 14번 항목 — 에는
  포함되지 않음, "판단" 요소가 아니라 상세 탐색 기능이라 판단).
- **영향도**: Brand Intelligence 화면의 Customer 섹션 전체.
- **관련 STEP**: 2026-08-08 Today Closeout(최초 발견).

---

## BACKLOG-007 — Brand Intelligence Category Pie Chart 실데이터 연결

- **상태**: OPEN(하드코딩 Placeholder 확인됨, 2026-08-08 Today Closeout)
- **이유**: `const entityCategoryRows`가 리터럴 상수 — HTML 자체에도 "Category
  Pie Chart · Placeholder"로 표시돼 있다.
- **재개 조건**: 상품 카테고리 분류 체계가 어느 SoT에 있는지부터 확인 필요
  (Product Registry는 카테고리 필드가 없음 — STEP64-2에서 이미 확인).
- **우선순위**: 낮음.
- **영향도**: Brand Intelligence 화면의 Category 섹션 전체.
- **관련 STEP**: 2026-08-08 Today Closeout(최초 발견).

---

## BACKLOG-008 — Brand Intelligence Compare Mode 실데이터 연결

- **상태**: OPEN(하드코딩 Placeholder 확인됨, 2026-08-08 Today Closeout)
- **이유**: 비교 브랜드 선택 시 KPI/Trend/Category가 전부 `entityTrendCompareMonths`/
  `entityCategoryCompareRevenue`(리터럴 상수)로 표시된다 — 실제 비교 계산이
  전혀 없다. HTML 자체 배지: "Placeholder UI"/"Placeholder Insight".
- **재개 조건**: Hero KPI/Trend가 먼저 완전히 실데이터에 연결된 뒤(BACKLOG 상위
  항목 아님, `ROADMAP.md` 0순위 참고), 같은 fetch 경로를 비교 브랜드에도 한 번
  더 호출하는 방식으로 확장 가능한지 검토.
- **우선순위**: 낮음.
- **영향도**: Brand Intelligence 화면의 비교 모드 전체.
- **관련 STEP**: 2026-08-08 Today Closeout(최초 발견).

---

## BACKLOG-002 — Clients 화면 Confidence Contract 정책 결정

- **상태**: OPEN(정책 결정 대기, 코드는 이미 정상 동작 — "버그"가 아니라 "정책 선택
  대기" 상태)
- **이유**: STEP63-3에서 Integrated Pipeline을 Clients에 연결했지만, Confidence
  Contract(VERIFIED/REVIEWED만 canonical 자동 표시)에 따라 OUR(→OURSELVES REMAKE)를
  제외한 RAC/KAM/BON CO/SUN CO는 데이터 계층에서 CANDIDATE로만 해결되고(또는 아예
  미해결), 화면에는 여전히 원본 코드(RAC/KAM/BON CO/SUN CO)가 그대로 보인다. 이는
  버그가 아니라 "임의 승격 금지" 원칙을 지킨 결과다.
- **재개 조건**: 아래 세 옵션 중 사용자가 하나를 선택해야 한다(STEP63-3 보고서에
  이미 명시된 옵션 그대로).
  1. Clients에도 온라인 카탈로그 2차 조회(Priority 2b)를 연결한다 — 단, Cafe24 API를
     Clients 요청마다 새로 호출하지 않으려면 캐싱 전략(예: Monthly Report가 이미
     호출하는 `/api/diagnostics/brand-sales` 결과를 월 단위로 캐시해 재사용)이 먼저
     필요하다.
  2. CANDIDATE confidence도 화면에 표시하도록 Confidence Contract 자체를 완화한다
     (STEP63-1에서 정한 계약을 바꾸는 것이므로 별도 STEP·별도 승인 필요).
  3. Priority 3(Reviewed Alias)에 사람이 직접 RAC/KAM/BON CO/SUN CO alias를 승인해
     REVIEWED로 등록한다(`work/brand-alias-review-queue.json`, STEP62-4 산출물 재사용).
- **우선순위**: 낮음~중간 — 현재도 원본 코드가 표시되므로 사용자가 못 알아보는 수준은
  아니지만, canonical 표시로 개선하면 UX가 나아짐.
- **영향도**: Clients Timeline/Drawer에서 OUR을 제외한 나머지 CO 계열 브랜드 표시.
- **관련 STEP**: STEP63-3.

---

## BACKLOG-003 — Personal Payment Bridge

- **상태**: NO-GO(코드로는 해결 불가로 결론, 재검토는 별도 트랙)
- **이유**: STEP63-3B-0(데이터 관점)/STEP63-3B-1(아키텍처 관점)이 각각 독립적으로
  같은 결론에 도달했다 — Cafe24 개인결제창 주문과 ECOUNT 판매전표를 잇는 신뢰
  가능한 키가 없다(공유 주문번호 없음, 날짜 오프셋 0~8일 불규칙, ECOUNT 개인결제
  라인은 금액이 항상 null, ECOUNT 원천 자체에 Slip Header 개념이 없음).
- **재개 조건**: 코드 차원의 해법이 아니라 운영 프로세스 변경이 선행돼야 한다 —
  ECOUNT 입력 시 개인결제 라인에도 실제 금액을 남기도록 하거나, Cafe24/ECOUNT 양쪽에
  공유 가능한 주문 참조 번호를 추가하는 것. 이는 개발팀 단독으로 결정할 수 없고
  매장 운영 프로세스 변경이 필요하다.
- **우선순위**: 낮음 — 임팩트(온라인 개인결제창 주문의 상품/브랜드 정보 표시)에 비해
  코드로 풀 수 없는 문제라 로드맵상 대기.
- **영향도**: 온라인(개인결제창) 주문 전체 — Clients 화면에서 "브랜드 정보 없음"/
  "제품 정보 없음"으로 계속 표시됨.
- **관련 STEP**: STEP63-3B-0, STEP63-3B-1.

---

## BACKLOG-004 — Monthly Report(Resolver F) 미마이그레이션

- **상태**: 의도적으로 범위 밖(Technical Debt로 기록만, 당장 조치 없음)
- **이유**: STEP63-2A/63-2B에서 이미 Resolver F(`scripts/monthly-brand-sales.mjs`)의
  강점(온라인 카탈로그 기반 커버리지)을 Integrated Pipeline이 흡수했음을 실측으로
  증명했지만, Monthly Report 화면 자체는 모든 STEP63-x 작업에서 "건드리지 않는다"고
  명시적으로 범위에서 제외해 왔다. Resolver F 자체는 여전히 프로덕션에서 그대로
  쓰이고 있다.
- **재개 조건**: 별도 STEP으로 Monthly 전용 Migration을 명시적으로 요청받아야 한다.
  Monthly는 archived snapshot(과거월 고정 데이터)을 다루므로 Brand Dashboard/
  Commerce보다 회귀 리스크가 다르다는 점을 STEP0에서 별도로 조사해야 한다.
- **우선순위**: 낮음(현재 Resolver F 자체는 정확하게 동작 중, 급한 결함 없음).
- **영향도**: Monthly Report의 브랜드별 오프라인 매출 집계.
- **관련 STEP**: STEP63-2A, STEP63-2B(비교 대상으로만 언급, Monthly 코드는 미변경).

---

## BACKLOG-005 — Brand Master 이중 저장소(Technical Debt)

- **상태**: 발견됨(STEP63-6), 아직 정리 계획 없음
- **이유**: `work/brand-master.json`(291개, 공식 SoT)과 `work/intelligence/
  brand-master-list.json`(273개, Inventory 전용 레거시)이 같은 `brand_code` 네임스페이스
  (`B0000XXX`)를 쓰지만 서로 다른 두 개의 파일로 존재한다. 브랜드 수 차이(291 vs 273)
  자체가 이미 두 파일이 서로 드리프트했다는 증거다.
- **재개 조건**: BACKLOG-001(Inventory Migration)과 함께 처리하는 것이 자연스럽다 —
  둘 다 같은 근본 원인(Inventory가 SoT를 안 씀)을 다룬다.
- **우선순위**: 중간 — 지금 당장 장애를 일으키진 않지만, 두 파일이 계속 따로 갱신되면
  드리프트가 더 커진다.
- **영향도**: Inventory 화면의 브랜드 판정 정확도 전반.
- **관련 STEP**: STEP63-6.
