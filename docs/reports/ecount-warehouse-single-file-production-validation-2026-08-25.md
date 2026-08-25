# ECOUNT Warehouse Single-File Routing — Implementation & Validation — 2026-08-25

## 1. Background

**기존 방식(STORE-BATCH-B, `docs/reports/STORE-BATCH-B-store-separated-monthly-sales.md`
참조):** ECOUNT 판매현황을 매장(창고)별로 각각 조회/다운로드해 두 개의 별도
XLSX 파일을 업로드해야 했다. 업로드 시 `X-Ecount-Store-Code` 헤더로 어느
매장인지 명시해야 했고("업로드 슬롯이 store identity를 부여한다" — Excel
내용에서 매장명을 추측하지 않는다는 원칙), Monthly Sales 업로드 UI도
APGUJEONG/VAIL 두 슬롯으로 분리되어 있었다.

**신규 방식(이번 구현):** ECOUNT XLSX 하나만 업로드하면, 그 안의 `창고명`
컬럼 값을 기준으로 서버가 자동으로 매장을 분리한다. `X-Ecount-Store-Code`
헤더가 더 이상 필요 없다.

**전환 시작 월:** `2026-08` (그 이전 달은 기존 매장별 개별 업로드 방식 그대로
유지).

## 2. Routing Contract

- `창고명 = "매장"` → internal storeCode `APGUJEONG`
- `창고명 = "SAMPLAS Veil"` → internal storeCode `VAIL` (display 시 `VEIL`로 표기: `server.mjs`의 `storeDisplayName: item.storeCode === "VAIL" ? "SAMPLAS VEIL" : ...`)

Legacy 호환:
- `2026-07` 이하 월 업로드 → 여전히 `X-Ecount-Store-Code` 헤더 필수(없으면 400)
- `2026-08` 이상 월 업로드 → 헤더 없이 창고명 기준 자동 라우팅(`warehouseRouted = uploadMonth >= "2026-08"`)

## 3. Implementation

- **commit:** `54fbee9a114a666c5390befdbda5e88908c9c19f`
- **message:** `feat(ecount-warehouse): route monthly sales upload by warehouse name`
- **포함된 8개 tracked 파일:**
  1. `outputs/samplas-marketing-os.js` — Monthly Sales 업로드 위저드를 2-슬롯(매장별) → 단일 파일 업로드 UI로 전면 개편(`ecountWizardSelectedFile`, `postEcountOfflineFile`에서 store-code 헤더 제거, 응답의 `result.stores[]`로 매장별 결과 표시)
  2. `scripts/import-ecount-offline-sales.mjs` — `ECOUNT_WAREHOUSE_STORES`/`WAREHOUSE_ROUTING_START_MONTH` 정의, `buildWarehouseRoutedSnapshots`(창고명→매장 분리, 미매핑 시 hard-throw), `writeJsonSetAtomic`(2-store 원자적 쓰기+롤백)
  3. `scripts/load-ecount-offline-sales.mjs` — `창고명` 컬럼 인식 + `warehouseName`/`sourceRowNumber` 필드 추출 (partial commit — 무관한 `detailDatePattern` compact-date 확장 hunk는 이번 commit에서 제외되어 여전히 unstaged 상태로 working tree에 남아 있음)
  4. `scripts/refresh-monthly-sales.mjs` — `refreshStatusForFile`가 2026-08+월엔 `KNOWN_STORE_CODES`(APGUJEONG/VAIL) 양쪽 스냅샷을 모두 확인해 FRESH/STALE 판정
  5. `scripts/upload-work-snapshots-to-render.mjs` — Render 업로드 allowlist 정규식이 `{month}.APGUJEONG.json`/`{month}.VAIL.json` 파일명을 지원하도록 확장
  6. `server.mjs` — `/api/ecount-sales/import`의 `uploadMonth`/`warehouseRouted` 분기, 조건부 storeCode 필수화, `stores[]` 응답 집계; `monthlyWorkDataPathPattern`/`uploadWorkDataFiles`의 capture-group 기반 month 추출(위 5번과 동일한 목적의 서버측 allowlist)
  7. `test/ecount-offline-sales-sheet.test.mjs` — 창고명 컬럼 fixture 지원 + 파싱 회귀 테스트
  8. `test/store-dimension.test.mjs` — warehouse 분리 정확성, 미매핑 hard-fail, 2-store atomic rollback 회귀 테스트 3건

## 4. Safety Guarantees

- **empty/unknown warehouse hard fail:** `buildWarehouseRoutedSnapshots`가 매핑에 없는 `창고명`(빈 값 포함)을 만나면 즉시 `Error: Unknown ECOUNT warehouse at row {sourceRowNumber}: {warehouseName} · {date} · {productName}`을 던진다 — 조용히 유실/오분류되는 행이 생길 수 없다.
- **row context:** 에러 메시지에 실제 XLSX 행 번호(`sourceRowNumber`)가 포함되어 원본 파일에서 바로 확인 가능.
- **two-store atomic write:** `writeJsonSetAtomic`이 APGUJEONG/VAIL 두 스냅샷 파일을 임시 파일에 먼저 쓴 뒤 두 파일 모두 rename하며, 두 번째 커밋이 실패하면 첫 번째로 이미 커밋된 파일도 원래 내용으로 복원(rollback)한다. `test/store-dimension.test.mjs`의 "two-store atomic write restores the first target when the second commit fails" 테스트로 검증됨.
- **cross-store dedupe 보존:** 기존 STORE-BATCH-B에서 확립된 "APGUJEONG 재업로드가 VAIL 파일을 건드리지 않는다"는 원칙은 이번 구현에서도 유지(store-dimension.test.mjs의 기존 관련 테스트가 그대로 통과).
- **legacy behavior 보존:** 2026-07 이하 월은 기존 store-header 필수 흐름이 100% 그대로 유지됨(5절 참조).

## 5. Tests

```
node --test test/ecount-offline-sales-sheet.test.mjs test/store-dimension.test.mjs
tests 23
pass 23
fail 0
duration ~3.0–3.5s
```

warehouse 전용 신규 테스트:
- "reads warehouse name from detail rows and ignores blank-warehouse summary rows"
- "warehouse routing partitions one loaded workbook into APGUJEONG/VAIL and preserves ALL total"
- "warehouse routing hard-fails empty and unknown warehouses with row context"
- "two-store atomic write restores the first target when the second commit fails"

기존 store-dimension 회귀 테스트(레거시 storeCode 필터링, dedupe, cross-store
무침범 등) 19건도 전부 그대로 pass — warehouse 변경이 기존 동작을 깨지 않음을
재확인.

## 6. Actual Local Upload Validation

실제 로컬 서버(127.0.0.1:8787)에 실제 `SALES/SAMPLAS/2026/2026-08.xlsx` 파일을
아래 계약으로 업로드해 end-to-end 검증했다:

```
POST /api/ecount-sales/import
X-Ecount-File-Name: 2026-08.xlsx (URL-encoded)
X-Ecount-Store-Code: (없음)
body: 원본 xlsx 바이트

응답: HTTP 200, snapshotStatus: "PASS"
```

| store | rows | offline sales |
|---|---|---|
| APGUJEONG | 816 | 157,300,800원 |
| VAIL | 90 | 10,063,700원 |
| **combined** | **906** | **167,364,500원** |

API 응답의 `totalOfflineSales`(167,364,500)/`totalLineCount`(906)와 정확히
일치. `Unknown ECOUNT warehouse` 계열 에러는 발생하지 않음(모든 행의 창고명이
정확히 두 매핑 중 하나와 일치).

## 7. Canonical Snapshot Files

```
work/ecount-sales/2026-08.APGUJEONG.json
work/ecount-sales/2026-08.VAIL.json
```

(레거시 단일 파일 `work/ecount-sales/2026-08.json`은 그대로 남아 있으나
`readEcountOfflineSalesSnapshot()`이 매장별 분리 파일 존재 시 이를 우선하므로
이중집계되지 않는다.)

## 8. Legacy Contract Validation (2026-07)

안전한 request-validation 방식으로 확인(실제 legacy 데이터는 건드리지 않음):

- **2026-07 + store header 없음:** `HTTP 400 "매장 코드가 필요합니다 (X-Ecount-Store-Code 헤더)."` — 파일 바디를 읽기도 전에 즉시 차단
- **2026-07 + `X-Ecount-Store-Code: APGUJEONG`(유효 헤더) + 더미 바이트:** 헤더 검증은 통과하고, 이후 xlsx 파싱 단계에서 실패(`not a zipfile` — 의도적으로 보낸 깨진 바이트이므로 예상된 실패). 즉 "매장 코드 필요" 오류가 아닌 다른 단계에서 실패 = 헤더 게이트가 정상 통과됐음을 증명.
- 기존 `work/ecount-sales/2026-07.json`(mtime 8/5) 파일은 위 검증 과정에서 전혀 변경되지 않음.

## 9. Git

```
commit:  54fbee9a114a666c5390befdbda5e88908c9c19f
push:    완료 (65d6fff..54fbee9  main -> main)
당시 HEAD = origin/main = 54fbee9a114a666c5390befdbda5e88908c9c19f, ahead/behind 0/0
```

## 10. Production Status — **중요**

`local-to-render-migration-audit-2026-08-25.md`에서 확인한 대로:

- warehouse **코드(frontend + backend)는 Render production에 이미 배포됨**(frontend JS SHA256 byte-identical 확인).
- 그러나 production의 persistent disk(`WORK_DIR=/var/data/samplas-dashboard/work`)에는 **2026-08 APGUJEONG/VAIL 최신 스냅샷이 아직 업로드되지 않았음**. Render의 `/api/ecount-sales/monthly?month=2026-08`은 여전히 `2026-08-05` 기준 legacy 단일 파일(135행, 25,971,600원)을 서빙 중이며, `storesIncluded: []`로 매장 미분류 상태다.

**따라서 기능 구현 자체는 COMPLETE이지만, production data migration은
FOLLOW-UP REQUIRED 상태다.** 다음 작업은
`local-to-render-migration-audit-2026-08-25.md`의 BATCH 1(P0)로,
`work/ecount-sales/2026-08.APGUJEONG.json`/`2026-08.VAIL.json`을
`scripts/upload-work-snapshots-to-render.mjs --overwrite`로 업로드하는 것이다.

## 11. Final Status

```
IMPLEMENTATION: COMPLETE
PRODUCTION DATA MIGRATION: FOLLOW-UP REQUIRED (BATCH 1, P0)
```
