# PROJECT_MEMORY.md — SAMPLAS Marketing OS 프로젝트 헌법

이 문서는 Claude / Codex / ChatGPT 등 이 프로젝트에서 작업하는 모든 AI 에이전트와 사람이
공통으로 따라야 하는 **거의 바뀌지 않는** 규칙을 기록한다. 매일 바뀌는 진행 상황은
`ROADMAP.md`/`DAILY_LOG/`에 기록하고, 이 문서는 정책·아키텍처·금지 사항만 담는다.

이 문서와 실제 코드가 어긋나면 코드가 최신 사실이다 — 이 문서를 읽는 에이전트는 정책의
"의도"를 여기서 확인하고, 정책이 실제로 어디에 구현돼 있는지는 반드시 코드(특히
`code-review-graph` MCP)로 재확인해야 한다.

---

## 1. 프로젝트 목적

SAMPLAS(패션 편집숍, Instagram 기반 마케팅 운영)의 "Entity Intelligence Framework" /
"Marketing Operating System"을 구축한다. 하나의 SPA(`outputs/samplas-marketing-os.{html,
css,js}`)와 두 개의 백엔드 진입점(`server.mjs`, `intelligence-service.mjs`)이 Cafe24
(온라인 쇼핑몰), ECOUNT(오프라인 판매/재고 ERP), Meta Ads, Instagram 네 개의 외부
데이터 소스를 하나의 화면 세트(Today/Monthly/Annual/Clients/Inventory/Commerce/
Content/Product Registry/Intelligence/Master Data/Settings/Brand Dashboard)로
통합해서 보여준다.

핵심 문제의식: 여러 외부 시스템(Cafe24 online, ECOUNT offline)이 브랜드/상품을 서로
다른 방식으로 표기하기 때문에("BONNAE" vs "본네", brand_code vs productName 파싱 등),
화면마다 독립적으로 브랜드를 추측해 왔고 그 결과가 서로 어긋났다. 이 프로젝트의 최근
작업 축(STEP62~STEP63 시리즈)은 이 문제를 "하나의 Identity Pipeline"으로 통일하는
것이다 — 단, 매출 계산 자체는 절대 건드리지 않는다.

## 2. Source of Truth(SoT)

| 데이터 | SoT 파일 | 비고 |
|---|---|---|
| 브랜드 canonical identity | `work/brand-master.json` | 291개 브랜드. `{brand_code, brand_name, name_aliases, instagram_tag, active, nameSource}` |
| 상품 canonical identity | `work/product-registry.json` | 177개 entry, 17개만 `verified:true`+`status:"confirmed"`(Phase 1 진단 전용, "Only exact_one_to_one entries are verified in Phase 1") |
| 온라인 매출 | Cafe24 canonical paid 기준(`server.mjs`의 Cafe24 주문/카탈로그 API 응답) | |
| 오프라인 매출 | ECOUNT 판매현황(`work/ecount-sales/*.json`, `salesAmount`/`isOfflineRevenue`) | |
| 오프라인 재고 | ECOUNT 재고(`work/ecount-inventory/latest.json`, `stockQuantity`) | Cafe24 재고는 절대 사용하지 않음(정책 명시) |

**주의(기술 부채, 아직 해소되지 않음)**: `scripts/inventory-overview-lib.mjs`(Inventory
화면)는 아직 `work/brand-master.json`을 쓰지 않고 별도 레거시 파일
(`work/intelligence/brand-master-list.json` 273개, `work/intelligence/brand-aliases.json`)
을 쓴다. 이 레거시 경로는 SKU의 52%를 canonical로 인식하지 못한다(STEP63-6에서 실측
확인). 이 문서 작성 시점 기준 아직 Brand Master로 통합되지 않았다 — `ROADMAP_BACKLOG.md`
참고.

## 3. Brand Master 정책

1. `work/brand-master.json`이 브랜드 canonical identity의 **유일한** SoT다.
2. `brand_code`가 canonical key다. `brand_name`은 한글/영문이 섞여 있다(예: "본네"=BONNAE,
   "카미긴"=KAMIGIN, "레이서 월드 와이드"=RACER WORLDWIDE) — 대부분 한글이며, 온라인
   productName에서 뽑히는 영문 후보와 정확히 일치하지 않는 경우가 많다(정확 일치 실패의
   근본 원인).
3. `name_aliases`는 거의 항상 비어 있다(291개 중 1개만 채워짐).
4. Brand Master는 `readBrandMasterWithSeed()`(server.mjs)를 통해 Cafe24 브랜드
   목록(`fetchCafe24BrandList()`)으로 자동 시딩되고, `brand_code`는 그 결과
   Cafe24의 manufacturer_code와 1:1로 대응한다 — 온라인 상품의 `product.brand_code`는
   이미 이 SoT와 직접 연결돼 있어 별도 판정 없이도 신뢰할 수 있다.
5. **Brand Master 파일 자체를 프로그램적으로 임의 수정하지 않는다.** 사용자가 명시적으로
   요청한 STEP에서만, 명시된 방식으로만 수정한다.

## 4. Product Registry 정책

1. `work/product-registry.json`이 상품 identity의 SoT다. Phase 1 진단 전용 모드이며
   `verified:true`+`status:"confirmed"`(현재 17건)만 "확정"으로 취급한다.
2. 각 entry는 `{canonicalProductId, brandId, brandName, canonicalProductName, status,
   confidence, verified, cafe24:{productNo, productCode, productName},
   ecount:{matchedProducts:[{prodCd, barcode, productName, size, ...}]}}` 형태다.
3. ECOUNT 판매 원본 라인(`work/ecount-sales/*.json`)에는 barcode/prodCd가 없다 —
   productName 텍스트가 오프라인 쪽의 유일한 조인 키다. Cafe24 온라인 주문/상품에는
   `product_no`/`product_code`/`variant_code`가 있다.
4. Product Registry는 읽기 전용으로만 참조한다. 새 Master를 만들거나 항목을 임의로
   verified로 승격하지 않는다.

## 5. Revenue 정책

1. **온라인 매출**: Cafe24 canonical paid 기준(`totals.paidAmount` 등, `server.mjs`의
   `buildBrandSalesDiagnostics`/`buildCanonicalTotalSales`).
2. **오프라인 매출**: ECOUNT 판매현황 기준(`isOfflineRevenue === true`인 라인의
   `salesAmount` 합계). 개인결제창(Personal Payment) 라인은 `salesAmount`가 항상 `null`
   이며 `isOfflineRevenue: false`로 처리돼 오프라인 매출 집계에서 자동 제외된다(이중
   계상 방지 — 그 금액은 Cafe24 쪽에서 이미 잡힌다).
3. **Identity Resolution ≠ Revenue Calculation** — 이 프로젝트에서 가장 중요한 분리
   원칙이다. 브랜드/상품 판정 로직이 매출 합산 공식을 바꾸는 일은 절대 없어야 한다.
   구현 패턴: 기존 매출 계산 파이프라인은 그대로 두고, 그 안의 "이 라인이 어느
   브랜드인가"를 답하는 한 지점만 Identity Pipeline으로 교체/보강한다.
4. 반품/환불 처리와 Timeline(구매 이력) 표시는 서로 다른 라인 집합을 쓸 수 있다(Clients
   화면: `purchaseDetails`는 `offlinePositiveLines`만, KPI 총매출은 반품 포함 전체
   라인) — 이는 의도된 설계이지 버그가 아니다.

## 6. Identity Pipeline 정책

`scripts/unified-identity-resolver.mjs`(export: `resolveIdentity(input, context)`,
`loadResolverContext(options)`)가 **유일한 통합 Identity Resolver**다. 새 Resolver를
만들지 않고 이 모듈을 재사용한다.

**Output Contract**: `{resolved, productIdentity:{barcode, ecountProdCd,
cafe24ProductNo, productName, matchedVia}, brand:{brandCode, canonicalName, confidence}
| null, operational:{brandGroup}, evidence:[...], source, unresolvedReason}`.

**Resolution 순서**:
1. Priority 1 — Product Registry 검증(verified:true+confirmed, `ecountProdCd`/
   `barcode`/`cafe24ProductNo` 정확 일치) → confidence `VERIFIED`.
2. Priority 2a — productName에서 브랜드 후보 추출(`brand-engine.mjs`의
   `extractBracketBrandCandidate`/`extractSlashBrandCandidate`) 후 Brand Master 직접
   일치 → confidence `CANDIDATE`.
3. Priority 2b(선택) — 그 기간 온라인 Cafe24 카탈로그를 2차 레지스트리로 추가 조회
   (호출자가 `onlineCatalog`를 넘겼을 때만) → confidence `CANDIDATE`.
4. Priority 3 — Reviewed Brand Alias(`work/brand-alias-review-queue.json`에 사람이
   `APPROVED`로 승인한 항목) → confidence `REVIEWED`. 현재 승인된 항목이 없어 항상
   placeholder로 통과한다.
5. Unresolved — `operational.brandGroup`은 해결 여부와 무관하게 항상 보존된다.

**Confidence Contract(절대 규칙)**: `VERIFIED`/`REVIEWED`만 canonical로 자동 표시/자동
귀속할 수 있다. `CANDIDATE`는 데이터 계층에는 채워도 되지만 사람이 보는 화면에
canonical인 것처럼 자동 표시하거나, 매출을 특정 브랜드 버킷에 자동 귀속시키는 데
쓰면 안 된다. 임의의 confidence 숫자로 자동 승격하지 않는다.

**적용 패턴(모든 화면 공통)**: 기존 화면/API가 이미 갖고 있는 판정 경로(있다면)를 절대
재해석하지 않는다 — 그 경로가 실패했을 때만 Identity Pipeline을 보조로 호출한다. 이미
정확한 경로 위에 새 Pipeline을 강제로 얹어 데이터를 악화시키지 않는다.

## 7. Inventory SKU First 정책

Inventory 화면은 **SKU 단위 정확성을 브랜드 Identity 개선보다 우선한다.** Identity
Pipeline을 Inventory에 연결하려는 시도가 SKU 수, 재고 수량, 음수 재고 분류 중 어느
것이라도 바뀔 가능성이 있으면 즉시 중단하고 구현 대신 검증(Validation)만 수행한다
(STEP63-6에서 확립된 규칙, 사용자 직접 지시). 브랜드별 재고 버킷(`brandRollup`)이
재분배되는 것조차 이 정책상 신중하게 다뤄야 한다 — 전체 합계가 불변이어도 개별 브랜드
버킷 라벨이 바뀌는 것은 "가능성이 있는 변화"로 간주한다.

## 8. QQQ 정책

- `QQQ`로 시작하는 productCode는 미등록 외부 판매/임시 상품이다.
- QQQ는 **canonical 브랜드가 아니다.** "QQQ" 자체를 브랜드 이름으로 취급하지 않는다.
- 각 QQQ 라인은 대괄호 표기(`[BRAND : 한글명] ...`)를 개별 파싱해 그 라인의 실제 근원
  브랜드를 찾으려 시도할 수 있다(라인 단위 Product Identity resolution). 그러나 이는
  브랜드 하나로 묶는 group-level canonical 매핑이 아니다.
- Inventory에서 QQQ의 음수 재고는 "추정 판매수량" 신호(`estimatedSoldQuantity`)로
  취급하며, 일반 상품의 `negative_review` KPI와 절대 합산하지 않는다.

## 9. CO(Operational Metadata) 정책

- ECOUNT `brandGroup`(원본 컬럼명 "품목그룹1명")은 **Operational Metadata이지 Canonical
  Brand가 아니다.** 이 필드를 브랜드 귀속 근거로 직접 사용하지 않는다
  (`scripts/brand-engine.mjs` 헤더에도 명시된 정책).
- `BON CO`/`SUN CO`는 실측상 같은 레코드의 productName 증거가 ~100% 일관되게 단일
  브랜드(BONNAE/SUNDAY OFF CLUB)를 가리키지만, 그렇다고 `brandGroup` 값 자체를 canonical
  로 승격하지 않는다 — canonical 판정은 반드시 productName 기반 Identity Pipeline을
  통과해야 한다.
- `POP CO`/`QQQ 퀵`은 진짜 다중 브랜드/비브랜드 그룹이다(POP CO는 6개 이상의 서로 다른
  실제 브랜드를, QQQ 퀵은 43개 이상의 브랜드를 아우른다) — 이 두 그룹은 **어떤 경우에도**
  단일 canonical 브랜드로 매핑하지 않는다.
- 원본 `brand`/`brandGroup` 필드는 canonical 필드를 추가할 때도 **절대 덮어쓰지 않는다**
  (별도 필드로 병기).

## 10. Personal Payment 정책

- Cafe24 개인결제창(personal payment) 주문은 실제 상품 데이터가 없는 결제 식별용
  placeholder 거래다(`productName`이 "이름 개인결제창 [날짜]" 형태 텍스트일 뿐).
- ECOUNT 쪽 개인결제 라인(`isPersonalPayment: true`)은 `salesAmount`가 항상 `null`이다
  (금액은 Cafe24 쪽에서만 잡음, 이중 계상 방지).
- **Cafe24 개인결제창 주문과 ECOUNT 실제 판매전표를 연결하는 신뢰 가능한 Bridge는
  현재 존재하지 않는다**(STEP63-3B-0/3B-1에서 실측 결론: 공유 주문번호 없음, 날짜
  오프셋 0~8일로 불규칙, 금액 검증 불가, ECOUNT에 Slip Header 자체가 없음 — 두 개의
  독립적인 조사가 같은 결론에 도달).
- 온라인 개인결제창 주문의 productName/brand는 추측하지 않고 `null`로 두며, 화면에는
  "브랜드 정보 없음"/"제품 정보 없음"으로 표시한다. 이것은 버그가 아니라 설계다.
- 이 문제를 다시 풀려면: (a) 이름+날짜 근접 후보를 **사람이 검토하는 큐**로만 생성,
  (b) ECOUNT 원천에 실제 금액을 남기도록 운영 프로세스 변경 중 하나가 필요하다 — 코드로
  자동 추론하지 않는다.

## 11. 현재 Architecture

```
Cafe24(온라인) ──┐                     ECOUNT(오프라인 판매/재고) ──┐
                 │                                                │
     server.mjs(온라인 API, 브랜드/상품 집계)      intelligence-service.mjs(Clients,
     buildBrandSalesDiagnostics()                  Inventory Overview 등)
     aggregateCafe24BrandSalesByBrandCode()                       │
                 │                                                │
                 └──────────────┬─────────────────────────────────┘
                                 ▼
              scripts/unified-identity-resolver.mjs
              resolveIdentity() / loadResolverContext()
                                 │
                    work/brand-master.json (SoT)
                    work/product-registry.json (SoT)
                                 ▼
                 outputs/samplas-marketing-os.js (SPA 프론트엔드)
```

**여러 개의 독립적인 병렬 브랜드 판정 경로("Resolver A~G")가 역사적으로 존재해 왔다** —
이 프로젝트의 최근 STEP들은 이들을 하나씩 Identity Pipeline으로 마이그레이션하거나,
이미 정확한 경로는 그대로 두고 Pipeline을 보조로만 연결하는 작업이다.

| 코드 | 위치 | 화면 | 현재 상태 |
|---|---|---|---|
| A | `aggregateCafe24BrandSalesByBrandCode`(server.mjs) | Brand Dashboard/Commerce, ONLINE ONLY | STEP63-4에서 Integrated Pipeline을 UNASSIGNED 보조 경로로 연결 완료(PASS) |
| B | `resolveDisplayBrand`(scripts/inventory-overview-lib.mjs) | Inventory | **아직 미마이그레이션** — 레거시 `work/intelligence/brand-master-list.json` 사용 중, STEP63-6에서 SKU 우선 정책에 따라 구현 STOPPED |
| C | `brandCanonicalDisplayName`(outputs/*.js) | 프론트엔드 표시 캐시 | 유지, Cafe24 productName 대괄호 파싱 |
| D | `resolveBrandIdentity`(outputs/*.js, STEP61-1) | Brand Selector | 유지, canonical name→brand_code 역방향 |
| E | `resolveRawBrandCanonical` / `clientsTimelineBrandDisplay`(outputs/*.js) | Clients Timeline/Drawer | STEP63-3에서 Integrated Pipeline을 1차, 레거시를 fallback으로 연결 완료(PASS) |
| F | `mergeOfflineBrandSales`(scripts/monthly-brand-sales.mjs) | Monthly Report | **의도적으로 범위 밖** — 이번 STEP63 시리즈 전체에서 건드리지 않음 |
| G | `scripts/build-brand-alias-candidates.mjs` | 오프라인 검토 큐 생성 | 사람 검토 전용, 자동 적용 없음 |

## 12. 절대 금지 사항

아래 항목은 사용자가 명시적으로, 개별적으로 요청하지 않는 한 **어떤 STEP에서도** 하지
않는다:

- Brand Master(`work/brand-master.json`) 임의 수정
- Product Registry(`work/product-registry.json`) 임의 수정
- Brand Universe / Brand Sourcing 관련 산출물 임의 수정
- Alias 자동 승인(REVIEW → APPROVED 자동 전환)
- 새 Resolver / 새 Master / 새 canonical 저장소 생성
- 새 Pipeline 생성(기존 `unified-identity-resolver.mjs` 재사용이 원칙)
- Fuzzy matching / substring 추측 도입
- BrandGroup을 canonical brand로 직접 사용
- Revenue 계산 공식 변경
- Inventory 재고 수량 변경
- 이미 정확한 판정 경로를 새 Pipeline으로 덮어써서 데이터를 악화시키는 것
- `git add` / `git commit` / `git push` / deploy(사용자가 명시적으로 요청하지 않는 한)

## 13. 개발 원칙

1. **기존 자산 우선(STEP0 마인드셋)**: 새 코드를 쓰기 전에 반드시 `code-review-graph`
   MCP(`query_graph_tool`, `semantic_search_nodes_tool`, `get_review_context_tool` 등)
   로 기존 함수/호출 관계부터 조사한다. 이미 있는 것으로 풀리면 새로 만들지 않는다.
2. **Identity Resolution과 나머지 Calculation을 분리**: 브랜드/상품 판정 로직 변경이
   매출/재고/주문수 계산 로직에 손대는 일이 없도록, 항상 "판정 결과를 대입하는 지점"
   하나만 교체한다.
3. **추가만, 덮어쓰기 금지**: 원본 필드(브랜드 원본 코드, brandGroup 등)는 canonical
   필드를 새로 추가할 때도 절대 지우거나 덮어쓰지 않는다.
4. **정확도가 불충분하면 구현하지 않는다**: 실측 데이터로 매칭 정확도를 검증할 수
   없다면(예: Personal Payment Bridge), "지금은 구현하면 안 된다"는 결론을 그대로
   보고서에 남긴다 — 억지로 완성하지 않는다.
5. **모든 변화는 Before/After/Reason으로 설명**: 브랜드별 숫자가 재배치되는 등 의도된
   변화가 발생하면 반드시 보고서에 이유와 함께 남긴다. 설명되지 않는 차이는 FAIL이다.
6. **총계 정합성은 협상 불가**: 어떤 화면을 마이그레이션하든 동일 기간의 총매출/총수량/
   총주문수는 Diff 0이어야 한다.
7. **회귀 검증은 명시적으로**: 건드리지 않은 화면(Clients/Brand Dashboard/Commerce/
   Monthly/Inventory 등)은 매 STEP마다 실제로 API/Chrome으로 재확인하고 보고서에
   남긴다 — "안 건드렸으니 안전하다"고 가정하지 않는다.
8. **git 변경은 diff로 증명**: 매 STEP 전후로 `git status --short`/`git diff --stat`/
   `git diff --check`/`git diff --cached --name-only`를 실행해 의도한 파일만 바뀌었음을
   확인한다.

## 14. Brand Intelligence Data Completion 상태(2026-08-08 실측, 코드 근거)

`BrandDashboard`(`outputs/samplas-marketing-os.html` 1262행, Sidebar 라벨
"Brand Intelligence", STEP65-6에서 정식 연결)를 코드 레벨로 정밀 조사한 결과다.
**추측 없이** HTML의 자체 라벨("Placeholder UI · 실데이터 연결 전" 등)과, 각
DOM 타깃을 실제로 쓰는 JS 함수가 있는지(`grep`)로만 판정했다.

### 이미 연결 완료(실데이터, 코드로 확인)

- **Brand Selector**: `/api/brand-master`(291개 브랜드) 실시간 조회, 검색/최근
  목록 정상 동작(`initBrandSelector()`).
- **Hero KPI 4개**(매출/판매수량/객단가/주문 수) + MoM 증감: `refreshEntityTrendMonths()`
  → `/api/reports/monthly`(Monthly Archive, 브랜드별 `brandSales`)를 실제로
  fetch해 `renderEntityHeroKpiFromMonthlyState()`가 `#entityHeroKpiSales` 등
  4개 id에 실제 값을 쓴다(STEP61-3 "Hero/KPI Data Binding" 주석 확인).
- **Monthly Trend 7개월 라인 차트**: 같은 fetch 결과로 `entityTrendChartSvg()`가
  실제 좌표를 그린다. 브랜드 변경/기간 변경 시 다시 fetch됨.
- **선택된 브랜드명 표시**: `resolveBrandIdentity()`가 Brand Master 기준으로
  canonical 이름을 표시.

### 아직 연결되지 않음(Placeholder, 코드로 확인 — 브랜드를 바꿔도 값이 변하지 않음)

- **Health Score 게이지(78/Strong) + 서브지표 4개(매출성장/재고건전성/판매회전율/
  고객성장)**: HTML에 리터럴로 하드코딩. `.brand-hero-score-value` 등을 쓰는 JS
  없음(grep 0건). HTML 자체 배지: "Placeholder UI · 실데이터 연결 전".
- **AI Summary 텍스트**: 하드코딩. HTML 자체 주석: "Placeholder 데이터 · 실데이터
  연결 예정".
- **추천 Action 2개 항목**: 텍스트에 "(Placeholder)"가 그대로 붙어 있음.
- **Hero KPI 중 Sell-through/재고/SKU 3개**: 위 4개(매출/수량/객단가/주문)와 달리
  고유 id가 없어 JS가 쓸 수 없는 구조 — 항상 정적.
- **System Status 행**(Cafe24/Meta Ads/Instagram/ECOUNT의 Healthy/Delay 배지):
  자체 Placeholder 라벨이 **없어서** 실시간처럼 보이지만, `.brand-hero-status-grid`/
  `.brand-hero-status-item`을 쓰는 JS가 전무(grep 0건) — 항상 같은 고정 문구
  ("2분 전 동기화" 등)를 보여준다. **가장 오인 소지가 큰 항목**(스스로 Placeholder라고
  밝히지 않음).
- **Customer/Composition 섹션**(스타일리스트/일반고객/프레스 도넛+테이블): `const
  entityCompositionTypeStats`/`entityCompositionRows`가 리터럴 상수이며, 심지어
  가상 인물명("권순환/차정원/박지은..." 등)이 하드코딩돼 있다 — 실제 Clients 데이터가
  아니다.
- **Category Pie Chart**: `const entityCategoryRows`가 리터럴 상수. HTML 자체
  라벨: "Category Pie Chart · Placeholder".
- **Compare Mode 전체**(비교 브랜드 선택 시 KPI/Trend/Category 전부): `entityTrendCompareMonths`/
  `entityCategoryCompareRevenue`가 리터럴 상수. HTML 자체 배지: "Placeholder UI"/
  "Placeholder Insight". 비교 계산/실데이터 연결 전혀 없음("실데이터/증감 계산
  없이 화면 표시만 전환한다" — 코드 주석).

### 부분 연결

- **Hero KPI 전체**: 7개 카드 중 4개(매출/판매수량/객단가/주문 수)만 연결, 3개
  (Sell-through/재고/SKU)는 미연결 — 같은 그리드 안에서 혼재.

### 정확도 검증이 필요(UNKNOWN, 다음 세션에서 확인)

- Hero KPI/Trend가 읽는 `/api/reports/monthly`는 Resolver F(Monthly,
  `scripts/monthly-brand-sales.mjs`) 기준이다. `PROJECT_MEMORY.md` 11번 항목/
  `ROADMAP_BACKLOG.md` BACKLOG-004에 따라 **Monthly는 Identity Pipeline
  마이그레이션 범위 밖**으로 명시적으로 남아 있다 — 즉 Brand Intelligence의
  "연결된" 부분조차 Integrated Identity Pipeline이 아니라 구형 Resolver F 기준일
  가능성이 있다. 이번 조사에서 `monthlyReportBrandCode()`가 정확히 무엇을
  참조하는지까지는 추적하지 못했다 — **UNKNOWN, 다음 세션 Data Completion Audit의
  1차 확인 항목**.

### 향후 연결하기로 이미 결정된 항목

`PROJECT_MEMORY.md`/`ROADMAP.md`/`ROADMAP_BACKLOG.md` 어디에도 위 Placeholder
항목들을 "언제 연결할지" 명시한 기존 결정이 없다 — 이번이 최초의 공식 기록이다
(**UNKNOWN as of 2026-08-07 이전**).

### Backlog가 아니라 반드시 완료해야 하는 항목(MUST COMPLETE)

"3초 안에 판단"이라는 화면 목표에 직접 관련되거나, 사용자를 오인시킬 수 있는
항목은 선택적 Backlog가 아니라 **Brand Intelligence Data Completion의 필수
범위**로 지정한다:
1. Health Score + AI Summary + 추천 Action(화면 최상단 "판단" 요소).
2. System Status 행(자체 라벨 없이 가짜 실시간처럼 보이는 것이 가장 위험).
그 외(Customer Composition/Category Pie/Compare Mode)는 `ROADMAP_BACKLOG.md`
BACKLOG-006~008에 기록한다(15번 항목의 완료 정책과 별개로 우선순위는 낮음).

## 15. 완료 기준 정책(Decision-010)

앞으로 모든 화면/기능은 아래 4단계를 **전부** 통과해야 "COMPLETE"로 기록한다:

1. **DATA COMPLETE** — 실제 API/계산에 연결, 하드코딩 Placeholder 없음.
2. **UX/UI COMPLETE** — `docs/DESIGN_SYSTEM.md` 기준 반영.
3. **REAL USER FLOW QA** — 실제 Chrome, Debug URL 직접 입력이 아니라 클릭 동선
   기준(Sidebar 클릭 등).
4. **DOCUMENT / SAVE POINT UPDATED** — `ROADMAP.md`/`DAILY_LOG/`/필요 시
   `DECISIONS.md` 갱신.

중간 상태에서 다음 기능으로 넘어간 화면은 COMPLETE로 기록하지 않는다 — 이번
Brand Intelligence가 바로 그 사례(UX/UI는 STEP58~61에서 상당 부분 진행됐으나
DATA COMPLETE 이전에 Promotion Intelligence로 작업이 이동함, 상세는 14번 항목).
