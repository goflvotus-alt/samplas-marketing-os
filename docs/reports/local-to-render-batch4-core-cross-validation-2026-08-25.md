# SAMPLAS Local → Render Migration — Batch 4: Core Dashboard Cross-Validation — 2026-08-25

**상태: BLOCKED — 신규 구조적 mismatch 발견 (2026-01~06 Monthly/Annual 아카이브)**

## 1. Purpose

Batch 1~3.5로 정렬된 항목들이 실제로 안정적인지, 그리고 지금까지 검증하지
않았던 Annual(과거월 아카이브) 영역까지 포함해 Local↔Render 핵심 기능을
전수 재검증하여 Render를 메인 운영 baseline으로 전환해도 되는지 최종
판정한다.

## A. Precheck

```
HEAD = origin/main = ba10669dd163c1e5196cd909c86279b3c0965a69 (0/0)
staged: 없음
unrelated unstaged 2개(diagnose-cafe24-ecount-product-matching.mjs, load-ecount-offline-sales.mjs): 보존
untracked: 116
LOCAL /api/status: 200 / RENDER /api/status: 200
```

## B. Today (`/api/sales/total`)

연속 조회(같은 순간):
```
LOCAL:  total 196,511,398 / online 29,146,898 / offline 167,364,500 / byStore {APGUJEONG: 157,300,800, VAIL: 10,063,700} / coverage.complete true
RENDER: total 196,511,398 / online 29,146,898 / offline 167,364,500 / byStore {APGUJEONG: 157,300,800, VAIL: 10,063,700} / coverage.complete true
```
**완전 일치.**

## C. Monthly (2026-08, 현재 진행월)

```
LOCAL:  total 196,511,398, online 29,146,898, offline 167,364,500, coverage {online:true, offline:false, complete:false, partialMonths:["2026-08"]}
RENDER: 동일
```
ECOUNT `/api/ecount-sales/monthly?month=2026-08`:
```
LOCAL/RENDER 완전 일치: source ecount_sales_status_excel_store_separated, storesIncluded [APGUJEONG, VAIL]
APGUJEONG: 816 rows / 157,300,800
VAIL:       90 rows /  10,063,700
combined:  906 rows / 167,364,500
```
Batch 1에서 확정한 안정 baseline과 정확히 일치. **완전 일치.**

## D. Annual — **BLOCKER 발견**

`/api/reports/monthly?month=YYYY-MM`을 과거 각 월(archiveStatus 확인 목적)에
대해 Local/Render 비교:

| month | LOCAL total | RENDER total | diff | archiveStatus |
|---|---|---|---|---|
| 2026-01 | 251,557,086 | 250,102,958 | **+1,454,128** | saved (양쪽 다) |
| 2026-02 | 188,254,020 | 186,329,089 | **+1,924,931** | saved |
| 2026-03 | 335,103,568 | 330,054,363 | **+5,049,205** | saved |
| 2026-04 | 355,645,683 | 354,304,011 | **+1,341,672** | saved |
| 2026-05 | 350,503,662 | 344,037,071 | **+6,466,591** | saved |
| 2026-06 | 209,187,510 | 205,267,886 | **+3,919,624** | saved |
| 2026-07 | 273,544,433 | 273,544,433 | 0 | saved |

**6/7개월에서 LOCAL이 RENDER보다 1.3M~6.5M원 높음.** 두 환경 모두
`archiveStatus: "saved"`(정적으로 저장된 과거 아카이브, 매 요청마다
재계산되지 않음)이므로, 이건 **live Cafe24 timing drift가 아니라 구조적
데이터 불일치**다. 유일하게 2026-07만 정확히 일치하는데, 이는 과거
`docs/reports/NEXT-JULY-RENDER-PERSISTENT-ARCHIVE-DEPLOYMENT.md`에서 7월
아카이브 하나만 별도로 Render에 업로드했던 이력과 정합적이다 — **2026-01~06은
그 이후 한 번도 Render에 재업로드된 적이 없는 것으로 보인다.**

이 batch는 READ ONLY이므로 원인을 더 깊이 파고들거나 수정하지 않았다 —
**production readiness의 명확한 blocker로 기록**하고 다음 단계(별도 Batch)로
넘긴다.

## E. Clients (2026-08)

```
LOCAL:  totalClients 97, orderCount 376, totalSalesAmount 195,361,398, online 29,146,898, offline 166,214,500
RENDER: 완전 동일
typeBreakdown: 완전 동일
```
**완전 일치.**

## F. Store Intelligence

```
APGUJEONG — LOCAL/RENDER: totalClients 86, orderCount 256, totalSalesAmount 156,150,800, HTTP 200, schema/coverage 동일
VAIL       — LOCAL/RENDER: totalClients 19, orderCount 36,  totalSalesAmount 10,063,700,  HTTP 200, schema/coverage 동일
```
**완전 일치.**

## G. Inventory

```
generatedAt: 2026-08-25T10:14:37.733Z (동일)
summary: 완전 동일 (negativeReviewSkuCount 583=583, totalKnownStock 2936=2936)
coverage: 완전 동일
brandRollup: count 246=246, key-set diff 0, non-recentSalesQty 필드 diff 0
raw: 미해결 카운트: 140=140 (동일)
```
`recentSalesQty`(live rolling metric)만 별도 분리해 제외 — 그 외 완전 일치.
**완전 일치.**

## H. Brand Registry

```
/api/intelligence/brands: LOCAL 278/361, RENDER 278/361 (완전 일치)
resolve 5개 표본(604SERVICE, CARNET ARCHIVE, XLIM, BONNAE, SURGERY): 5/5 LOCAL=RENDER=canonical
```
**완전 일치.**

## I. Price Audit

```
LOCAL:  generatedAt 2026-08-25T02:40:11.541Z, MATCH 2977, ECOUNT_HIGHER 75, ECOUNT_LOWER 43, MATCH_REQUIRED 169, REVIEW_REQUIRED 332
RENDER: 완전 동일
```
**완전 일치.**

## J. Frontend

```
GET https://.../outputs/samplas-marketing-os.js  SHA256: 334e305b1d0241993f53e386e7dca3aa46e1cb793e4b8bcda04d918ff4fc291a
git show HEAD:outputs/samplas-marketing-os.js     SHA256: 334e305b1d0241993f53e386e7dca3aa46e1cb793e4b8bcda04d918ff4fc291a
```
**byte-identical.** 주요 메뉴 문자열 spot-check(Render bundle 기준): "Today" 164회,
"Monthly" 115회, "Annual" 27회, "Clients" 194회, "Inventory" 126회, "Price
Audit" 3회, "ecountWizardSelectedFile"(single-file 업로드 UI) 4회 — 전부 존재.
"AI Audit"은 프론트엔드 문자열/`ai-audit` API 경로 참조 둘 다 0건 —
**Local/Render 간 차이가 아니라(동일 bundle이므로) 애초에 이 코드베이스에
"AI Audit"이라는 이름의 UI 메뉴 항목 자체가 없음**(백엔드
`/api/ai-audit/*` 라우트는 존재하나 프론트엔드에서 소비하지 않는 것으로
보임 — 별도 확인 필요 사항으로만 기록, 이번 batch의 blocker는 아님).

## K. Core Feature Matrix

| Feature | Local | Render | Match | Notes |
|---|---|---|---|---|
| Status | 200 | 200 | PASS | |
| Today | 196,511,398 | 196,511,398 | PASS | |
| Monthly (2026-08) | 196,511,398 | 196,511,398 | PASS | |
| **Annual (2026-01~06)** | 정상 | **stale (-1.3M~-6.5M/월)** | **FAIL** | 구조적, live-timing 아님 |
| Annual (2026-07) | 273,544,433 | 273,544,433 | PASS | |
| Clients | 97/376 | 97/376 | PASS | |
| APGUJEONG Store | 86/256/156,150,800 | 동일 | PASS | |
| VAIL Store | 19/36/10,063,700 | 동일 | PASS | |
| Inventory | 246 brands, 583 negative | 동일 | PASS | recentSalesQty만 live 차이 |
| Brand Registry | 278/361 | 278/361 | PASS | |
| Price Audit | MATCH 2977 등 | 동일 | PASS | |
| Frontend Bundle | SHA `334e305b...` | 동일 | PASS | byte-identical |
| ECOUNT Upload Contract | 2026-08+ headerless, 2026-07- header 필수 | 코드 배포 확인(Batch 1 시 검증) | PASS | |

## L. Live-Data Timing Notes

Today/Monthly(당월)의 online 금액이 이전 Batch들(28.6M→29.1M→29.1M) 대비
계속 자연 증가한 것은 Cafe24 실시간 주문이 세션 전체에 걸쳐 계속 쌓이는
정상적인 라이브 데이터 변동이며, 이번 Batch 4에서는 Local/Render를 같은
순간 연속 조회해 두 값이 항상 정확히 일치함을 재확인했다(drift 없음,
mismatch 아님). Inventory의 `recentSalesQty`도 동일하게 rolling-window
기반 live 필드로 분리 처리했다. **반면 D절의 Monthly/Annual 아카이브
불일치는 `archiveStatus: saved`(정적 저장)인 과거 확정월에서 발생해 이
카테고리에 해당하지 않는, 진짜 구조적 문제다.**

## M. Remaining Design Debt

- **Brand Registry bootstrap-once**(`ensureBrandRegistryFiles()`): Batch 3.5에서 현재 시점 기준으로 정렬했으나, `brand-master.json`이 다음에 갱신되면 재차 stale해지는 구조적 한계가 여전히 남아 있음(수정하지 않음, 별도 task).
- **Local unrelated changes**: `scripts/diagnose-cafe24-ecount-product-matching.mjs`, `scripts/load-ecount-offline-sales.mjs` — 이번 production migration과 계속 분리 유지 중, 별도 트랙 소관.
- **[신규] 2026-01~06 Monthly/Annual 아카이브 미동기화**: 7월만 과거에 개별 업로드된 이력이 있고, 그 이전 6개월은 Render persistent disk에 최신/정확한 아카이브가 없는 것으로 보임(D절). 원인 조사 및 재동기화가 필요한 신규 blocker — 이번 batch에서 조사/수정하지 않음.
- **"AI Audit" UI 부재**: 백엔드 API(`/api/ai-audit/*`)는 존재하나 프론트엔드에 문자열/경로 참조가 전혀 없음 — Local/Render 동일하게 없는 것이라 migration blocker는 아니지만, 의도된 상태인지 별도 확인 권장.

## N. Production Readiness Verdict

```
RENDER NOT YET READY — BLOCKER REMAINS
```

**Blocker: 2026-01~06 Monthly/Annual 아카이브가 Render에서 stale하여
Local 대비 매월 1.3M~6.5M원 낮게 집계됨(구조적, live-timing 아님).**

그 외 항목(Today/당월 Monthly/Clients/Store Intelligence/Inventory/Brand
Registry/Price Audit/Frontend/ECOUNT Upload Contract)은 전부 PASS —
2026-08 이후 신규 운영 데이터 기준으로는 Render가 이미 Local과 완전히
동일하다. 다만 과거 Annual 조회 시 부정확한 숫자를 보여줄 것이므로, 이
blocker를 해소하기 전까지는 Render를 메인 운영 baseline으로 전면 전환할
수 없다.

## O. Development Report

이 문서 자체가 report입니다:
```
path: docs/reports/local-to-render-batch4-core-cross-validation-2026-08-25.md
```
