# SAMPLAS Intelligence — Local to Render Migration Audit — 2026-08-25

## 1. Purpose

이번 주 목표는 Local(`http://127.0.0.1:8787`)에 구현된 기능을 Render production
(`https://samplas-marketing-os.onrender.com/`)으로 정렬(align)하고, 다음 주부터
Render 앱을 메인 운영 기준(main operating baseline)으로 전환하는 것이다. 이후
Local은 개발/검증 전용 환경으로 사용한다.

이 문서는 그 정렬 작업을 시작하기 위해 수행한 **읽기 전용(READ ONLY) 전수
inventory**의 결과다. 코드 수정, git add/commit/push, deploy, snapshot upload,
data mutation은 이 audit 중 전혀 수행하지 않았다.

- Production / Main: `https://samplas-marketing-os.onrender.com/`
- Local development: `http://127.0.0.1:8787`

## 2. Git / Local Baseline (audit 시점)

```
branch:        main
HEAD:          54fbee9a114a666c5390befdbda5e88908c9c19f
origin/main:   54fbee9a114a666c5390befdbda5e88908c9c19f
ahead/behind:  0 / 0
staged:        없음
```

remaining tracked modifications (unrelated, warehouse/SAFE10 배치에서 의도적으로
분리해 보존한 변경):

- `scripts/diagnose-cafe24-ecount-product-matching.mjs` — Price Audit/Product
  Registry 매칭 트랙의 변경, 이번 warehouse/migration 작업과 무관
- `scripts/load-ecount-offline-sales.mjs` — `detailDatePattern`의 `YYYYMMDD`
  compact-date 지원 확장 hunk만 unstaged로 남아 있음 (warehouse 관련 hunk는
  이미 commit `54fbee9`에 포함됨)

untracked: 116건 (backup 파일, `docs/reports/*.md` 초안, `POS-PRICE/`, `SALES/`,
Price Audit/Product Registry 트랙의 작업 스크립트 등 — 전부 보존, 삭제하지 않음)

local 8787 process: PID `94208`, cwd = 프로젝트 루트, 시작 시각
`2026-08-25 14:03:24 KST` (server.mjs 최신 코드 로드 후 기동), `/api/status` →
`200 OK`.

## 3. Deployment Audit — Code Sync Confirmed

Render가 서빙하는 `https://samplas-marketing-os.onrender.com/outputs/samplas-marketing-os.js`를
직접 fetch해서 로컬 `git show HEAD:outputs/samplas-marketing-os.js`와 SHA256을
비교했다.

```
render SHA256: 334e305b1d0241993f53e386e7dca3aa46e1cb793e4b8bcda04d918ff4fc291a
local  SHA256: 334e305b1d0241993f53e386e7dca3aa46e1cb793e4b8bcda04d918ff4fc291a
```

**Byte-identical.** 즉 warehouse frontend 코드(single-file 업로드 UI 포함)까지
이미 Render에 배포되어 있다. `server.mjs`는 정적 파일이 아니라 직접 diff는
불가능하지만, 단일 Render 서비스(`render.yaml`에 서비스 1개, `startCommand: npm
start` → `node server.mjs`)로 frontend와 함께 배포되는 구조이고, 아래 5절의 API
실측으로 최신 `server.mjs` 코드가 실행 중임을 간접 확인했다.

**결론: production과 local 사이의 UI/동작 차이는 코드 배포 문제가 아니라
데이터(snapshot) 미반영 문제다.**

## 4. Local vs Render Matrix

| 기능 | LOCAL | RENDER | 차이 |
|---|---|---|---|
| Today/Monthly/Annual/Clients/Inventory/Price Audit 등 네비게이션 | YES | YES | 없음(코드 동일) |
| Today 총매출 | 196,002,798 | **54,609,898** | 오프라인 매출 반영 안 됨 |
| Monthly (2026-08 archive) | 196,002,798 | **54,609,898** | Today와 동일 원인 전파 |
| Annual/2026-07 이하 월 | 일치 | 일치 | 확인된 범위에서 문제 없음 |
| Clients | totalClients 96 / orderCount 375 | totalClients **31** / orderCount **122** | 오프라인 고객 데이터 누락 |
| Inventory | generatedAt 2026-08-19 계열 | generatedAt **2026-07-18 계열** | 1개월+ stale |
| Price Audit | MATCH 2977 등 | **완전 일치** | 없음(정상) |
| APGUJEONG Store Intelligence | 정상(200) | **HTTP 400 "Unknown store: APGUJEONG"** | store-master 데이터 미배포 |
| VAIL Store Intelligence | 정상(200) | **HTTP 400 "Unknown store: VAIL"** | 동일 원인 |
| warehouse single-file 업로드 UI | YES | YES | 없음(코드 배포 완료, 3절 참조) |

## 5. API Gap — 실측값

### `/api/sales/total?since=2026-08-01&until=2026-08-25`
- Local: `totalSales.amount = 196,002,798` (online 28,638,298 + offline 167,364,500), `byStore: {APGUJEONG: 157,300,800, VAIL: 10,063,700}`
- Render: `totalSales.amount = 54,609,898` (online 28,638,298 + offline 25,971,600), `byStore: {APGUJEONG: 0, VAIL: 0}`

### `/api/ecount-sales/monthly?month=2026-08`
- Local: `source: "ecount_sales_status_excel_store_separated"`, `storesIncluded: ["APGUJEONG","VAIL"]`, `totalLineCount: 906`, `totalOfflineSales: 167,364,500`, `importedAt: 2026-08-25T05:42:01.963Z`, `periodEnd: 2026-08-25`
- Render: `source: "ecount_sales_status_excel"`(legacy), `storesIncluded: []`, `storesMissing: ["APGUJEONG","VAIL"]`, `totalLineCount: 135`, `totalOfflineSales: 25,971,600`, `importedAt: 2026-08-05T04:35:15.726Z`, `periodEnd: 2026-08-05`

### `/api/ecount-sales/monthly?month=2026-07` (비교 통제군)
- Local과 Render 완전 일치: `totalLineCount: 1343`, `totalOfflineSales: 237,972,530`, 동일 `importedAt`. **지난 달(마감된 월)은 문제 없음** — 이번 달(진행 중, warehouse 라우팅 신규 적용 월)만 gap이 존재.

### `/api/intelligence/clients?since=2026-08-01&until=2026-08-25`
- Local: `totalClients: 96`, `orderCount: 375`, `offlineSalesAmount: 166,214,500`
- Render: `totalClients: 31`, `orderCount: 122`, `offlineSalesAmount: 25,971,600`

### `/api/inventory/overview`
- Local: `generatedAt: 2026-08-19T04:51:39.074Z`
- Render: `generatedAt: 2026-07-18T09:45:57.629Z`

### `/api/intelligence/price-audit`
- Local과 Render 완전 일치: `generatedAt: 2026-08-25T02:40:11.541Z`, `MATCH: 2977`, `ECOUNT_HIGHER: 75`, `ECOUNT_LOWER: 43`, `MATCH_REQUIRED: 169`, `REVIEW_REQUIRED: 332`. (2026-08-25에 `upload-work-snapshots-to-render.mjs --overwrite price-audit.json`으로 이미 업로드 완료된 상태 — 상세는 `price-audit-safe10-final-validation-2026-08-25.md` 참조)

## 6. Root Cause Classification

| 차이 | 분류 | 근거 |
|---|---|---|
| Today/Monthly/Clients 2026-08 오프라인 매출·매장분류 오류 | **DATA SNAPSHOT NOT UPLOADED** | `work/ecount-sales/2026-08.{APGUJEONG,VAIL}.json`이 Render persistent disk(`WORK_DIR=/var/data/samplas-dashboard/work`)에 한 번도 업로드된 적 없음 |
| APGUJEONG/VAIL Store Intelligence 400 에러 | **DATA SNAPSHOT NOT UPLOADED + 업로드 경로 코드 자체 부재** | `store-master.json`이 `scripts/upload-work-snapshots-to-render.mjs`의 `explicitPaths`와 `server.mjs`의 `workDataUploadPaths` 어느 쪽에도 등록돼 있지 않음 — 코드를 먼저 고쳐야 업로드가 가능한 상태 |
| Inventory 1개월+ stale | **DATA SNAPSHOT NOT UPLOADED (정기 갱신 누락)** | `ecount-inventory/latest.json`은 allowlist엔 있으나 2026-07-18 이후 재업로드가 없었음 |
| Price Audit | 해당 없음(정상) | 2026-08-25 세션에서 공식 경로(`build-price-audit.mjs`)로 재생성 후 업로드 완료 |
| Warehouse frontend/backend 코드 | 해당 없음(정상) | 3절에서 byte-identical 확인 |

## 7. Migration Batches (이번 주 실행 계획, 아직 미실행)

### BATCH 1 — Production Data Alignment (ECOUNT Offline)
- **목적:** Today/Monthly/Clients의 196M vs 54.6M 매출 오류, 매장 미분류 해소
- **작업:** `work/ecount-sales/2026-08.APGUJEONG.json`, `2026-08.VAIL.json`을 `scripts/upload-work-snapshots-to-render.mjs --overwrite`로 업로드
- **위험:** 낮음 (read 경로만 영향, dry-run 가능, 코드 변경 불필요)
- **검증 기준:** `/api/sales/total` amount가 local과 일치, `byStore`가 정상 분류됨
- **deploy/upload:** upload 필요, code deploy 불필요

### BATCH 2 — Store Master Deployment
- **목적:** APGUJEONG/VAIL Store Intelligence 400 에러 해소
- **작업:** `upload-work-snapshots-to-render.mjs`의 `explicitPaths`와 `server.mjs`의 `workDataUploadPaths`에 `"store-master.json"` 추가(코드 변경, 별도 승인 필요) 후 업로드
- **위험:** 중간(코드 수정 및 server.mjs 재배포 수반)
- **검증 기준:** `/api/intelligence/store?store=APGUJEONG` / `?store=VAIL`이 200 반환
- **deploy/upload:** code deploy + data upload 둘 다 필요

### BATCH 3 — Inventory Snapshot Refresh
- **목적:** Inventory 1개월+ stale 데이터 갱신
- **작업:** `ecount-inventory/latest.json` 재수집 후 업로드
- **위험:** 낮음
- **검증 기준:** `/api/inventory/overview`의 `generatedAt`이 local과 근접하게 최신화
- **deploy/upload:** upload만 필요

### BATCH 4 — Core Dashboard Cross-Validation
- **목적:** Batch 1~3 반영 후 Today/Monthly/Annual/Clients 숫자 전수 재검증
- **작업:** 이번 audit에서 사용한 것과 동일한 local vs render GET 비교를 재실행해 전 지표 일치 확인
- **위험:** 없음(검증 전용)
- **검증 기준:** 4절 매트릭스의 모든 "DIFFERENT" 항목이 "일치"로 전환
- **deploy/upload:** 불필요

### BATCH 5 — Local-Only Cleanup & Operating Baseline
- **목적:** 2절에서 확인한 unstaged/untracked 변경을 정리해 "다음 주 Render 메인 전환" 기준 확정
- **작업:** `load-ecount-offline-sales.mjs`의 compact-date hunk 별도 commit, Price Audit/Registry 트랙 untracked 스크립트 소유권 확인 후 개별 처리(파일별 승인 필요)
- **위험:** 낮음(커밋 정리 작업)
- **검증 기준:** `git status`에 backup/report/POS-PRICE/SALES 외 실질 코드 변경이 남지 않음
- **deploy/upload:** commit만, deploy 불필요

## 8. Priority

```
P0: BATCH 1 (ECOUNT 2026-08 데이터) — 현재 production 총매출이 약 141M원 축소 표시 중, 즉시 시급
P0: BATCH 2 (Store Master)         — Store Intelligence 화면 완전 다운 상태
P1: BATCH 3 (Inventory 갱신)        — 부정확하지만 매출 지표만큼 긴급하지 않음
P1: BATCH 4 (교차검증)              — Batch 1/2 완료 직후 필수
P2: BATCH 5 (cleanup)              — 다음 주 메인 전환 전 마무리
```

## 9. Final State

```
LOCAL → RENDER MIGRATION MAP READY
```

**중요:** 이 상태는 "migration이 완료됨"이 아니라 **"migration plan이 확정되고
근거가 실측 완료된 상태"**를 의미한다. Batch 1~5 중 실제로 실행된 것은 없다
(Price Audit snapshot 업로드는 이 audit 이전, 별도 세션에서 이미 완료된 것으로
6절/5절에 그 결과만 반영했다). Batch 1(P0)부터 순서대로 실행 승인이 필요하다.
