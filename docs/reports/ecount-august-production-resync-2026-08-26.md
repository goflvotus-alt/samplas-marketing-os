# ECOUNT August Production Resync — Batch 9 — 2026-08-26

**상태: COMPLETE — CANONICAL DECISION: LOCAL CANONICAL, PRODUCTION HEALTHY**

## Purpose

직전 Inventory Operations Mega Batch의 `npm run verify:production`
실행에서 Today/Monthly/Annual/Clients/ECOUNT current month 항목이
WARN/FAIL로 나온 원인을 정확히 추적한다. 사전 조건: **"Local이 newer라는
이유만으로 자동 overwrite하지 않는다"** — provenance를 먼저 확정하고,
정당한 canonical update로 판정될 때만 Render 2026-08 APGUJEONG/VAIL
snapshot을 재동기화한다.

## Baseline

```
branch: main
HEAD          = 474b410f0afc1e16ecd5c6cf99312d60ff01e492
origin/main   = 474b410f0afc1e16ecd5c6cf99312d60ff01e492 (0/0)
staged        = 없음
tracked modified = 없음
untracked     = 116(Inventory Operations batch 종료 시점과 일치)
```

## Local Snapshot(§2)

| | APGUJEONG | VAIL |
|---|---|---|
| sha256 | edb2bc02...c1 | d66ccb55...40 |
| storeCode | APGUJEONG | VAIL |
| periodStart~End | 2026-08-01 ~ 2026-08-26 | 2026-08-03 ~ 2026-08-26 |
| importedAt | 2026-08-26T09:03:40.035Z | 2026-08-26T09:03:40.035Z |
| sourceFileName | 2026-08.xlsx | 2026-08.xlsx |
| sourceWarehouseCode/Name | 100 / 매장 | 200 / SAMPLAS Veil |
| totalOfflineSales | 190,060,400 | 11,202,500 |
| rows(totalLineCount) | 938 | 99 |

## Render Snapshot(업로드 전, §3)

| | APGUJEONG | VAIL |
|---|---|---|
| periodEnd | 2026-08-25 | 2026-08-25 |
| importedAt | 2026-08-25T05:42:01.963Z | 2026-08-25T05:42:01.963Z |
| totalOfflineSales | 157,300,800 | 10,063,700 |
| rows | 816 | 90 |

combined(ALL, store 파라미터 없이 조회): 906행 / ₩167,364,500 — 과거
여러 Batch(1~4.6, 6, 7)에서 canonical로 재확인해 온 값과 정확히 일치.

## Provenance Trace(§4) — 판정: **A. VALID CANONICAL UPDATE**

Day-by-day `dailySales.totalLineCount`를 Render/Local 전 일자에 대해
직접 diff(READ ONLY, import 재실행 없이):

| 날짜 | Render | Local | diff |
|---|---|---|---|
| 08-01~08-23 (APGUJEONG) | 각 일자 그대로 | 각 일자 그대로 | **0**(전 일자) |
| 08-24 | 23 | 24 | +1 |
| 08-25 | 14(부분 캡처) | 79(완성) | +65 |
| 08-26 | 0(미존재) | 56(신규) | +56 |

VAIL도 동일 패턴(08-03~08-24 전부 diff 0, 08-25 6→13, 08-26 0→2).

**해석**: 23일치 과거 데이터가 단 1행의 오차도 없이 완전히 동일하다는
것은 두 스냅샷이 **같은 원본 데이터**에서 나왔다는 강력한 증거다. 8/25가
Render에서는 "부분"(오후 import 시점까지만 ECOUNT에 입력된 라인), Local
에서는 "완성"으로 나타나는 것은 정확히 "같은 진행 중인 달을 하루 늦게
재수출"하는 패턴과 일치한다 — 이 세션 전체에서 반복적으로 사용된 정상
워크플로우(과거 Batch 1/6/7에서도 "2026-08" 파일이 여러 차례 재업로드됨)
와 동일하다. 데이터가 소급 수정(backdating)되거나 대체된 흔적은 8/24의
+1행(미미, 단일 지연 입력 가능성) 외에는 전혀 없다.

## Source Excel Validation(§5)

```
파일: SALES/SAMPLAS/2026/2026-08.xlsx
mtime: 2026-08-26 18:02(KST) — snapshot importedAt(18:03:40 KST)보다
  정확히 ~100초 앞섬(정상 업로드 흐름과 일치)
시트명: 판매현황내역(공식 우선순위 시트와 일치)
워크시트 XML 직접 검사: "창고명" 컬럼 존재, "매장"/"SAMPLAS Veil" 값
  존재 확인(zipfile 직접 파싱, importer 재실행 없이 구조적 검증만 수행)
```
Importer를 다시 돌리지 않고도 source↔snapshot 일관성이 구조적으로
확인됨.

## Canonical Decision(§6)

```
LOCAL CANONICAL
```
근거: (1) 23일치 완전 일치로 동일 소스 확인, (2) 8/25~26의 증가분이
"부분→완성", "신규 하루 추가"로 완벽히 설명됨, (3) source Excel의 mtime/
구조가 정상 업로드 흐름과 일치, (4) Render-only 데이터가 사라지는
케이스 없음(Render의 모든 값이 Local에 그대로 포함되어 있음 — 손실
없는 superset). Render sync 진행.

## Upload(§10~12)

```
Support check: isAllowedRenderSnapshotPath("ecount-sales/2026-08.APGUJEONG.json") = true
              isAllowedRenderSnapshotPath("ecount-sales/2026-08.VAIL.json") = true
  (기존 RENDER_SNAPSHOT_MONTHLY_PATTERN으로 이미 허용 — 코드 수정 없음)

dry-run: {"dryRun": true, "files": ["ecount-sales/2026-08.APGUJEONG.json", "ecount-sales/2026-08.VAIL.json"]}
  (정확히 2개, 다른 snapshot 없음)

upload: {"ok": true, "overwrite": true, "uploaded": ["ecount-sales/2026-08.APGUJEONG.json", "ecount-sales/2026-08.VAIL.json"]}
```
금지 목록(legacy 병합 `2026-08.json`, 2026-07, 2026-09, Inventory,
Brand Registry, Product Registry, Price Audit, Store Master, Monthly
archives) 전부 미포함 확인.

## ECOUNT Production After(§13)

```
GET /api/ecount-sales/monthly?month=2026-08 (Render, 업로드 후)
storesIncluded: [APGUJEONG, VAIL]
sources: importedAt 2026-08-26T09:03:40.035Z(양 매장) — Local과 완전 동일
APGUJEONG: 938행 / ₩190,060,400 (Local과 완전 일치)
VAIL:       99행 / ₩11,202,500  (Local과 완전 일치)
combined:  1,037행 / ₩201,262,900
```

## Today / Monthly / Clients(§14)

```
/api/sales/total(2026-08-01~26): local=render 완전 일치
  total 232,203,898 / online 30,940,998 / offline byStore
  {APGUJEONG:190,060,400, VAIL:11,202,500}
/api/reports/monthly?month=2026-08: local=render=232,203,898
/api/intelligence/clients: local=render 완전 동일
  (102/416, offlineSalesAmount 200,112,900 포함 전 필드 일치)
```
Cafe24 online 필드도 거의 동시 조회에서 정확히 일치(live timing drift
없음, coincidence가 아니라 매우 짧은 조회 간격 덕분).

## Annual(§15)

```
2026-01~07: local=render, 7/7 그대로 유지(Batch 4.6 정렬 상태 무변화)
2026-08: local=render=232,203,898(업로드 후 갱신분 정확히 반영)
sum(2026-01~08): local=render=2,175,843,709, delta=0
```
구조적 mismatch 0건.

## Inventory Operations Closeout(§16)

```
Render generatedAt(재고 스냅샷): 2026-08-25T10:14:37.733Z(불변, 재고
  자체는 이번 batch에서 손대지 않음)
Render salesDataAsOf: 2026-08-25 → 2026-08-26 (정확히 갱신)
coverage.sellingSkuCount: 407 → 427(추가된 하루치 오프라인 매출 반영,
  자연스러운 증가)
negativeInventory/inventoryValue/slowWatch: 구조 그대로, 재고 자체
  불변이라 전부 안정적으로 유지
```
P0 offline sales reader fix가 실제 프로덕션 재동기화에서도 정상 작동함을
재확인 — warehouse-split 파일 인식/precedence 문제 없음.

## September Future-Proof Check(§17)

```
work/ecount-sales/2026-09.APGUJEONG.json(split-only, VAIL 없음) — 로컬
서버에서 salesDataAsOf: 2026-09-05로 정상 인식(velocity silently zero
회귀 없음). test/inventory-offline-sales-reader.test.mjs 케이스 12
(September split-only)로 회귀 방지 계속 유지.
```
Render에는 업로드하지 않음(9월 데이터는 이번 batch 범위 밖, production
current-month UI를 강제 변경할 필요 없음 — 지시대로 READ ONLY 확인만).

## Full Production Parity(§18)

```
npm run verify:production

STATUS PASS / TODAY PASS / MONTHLY CURRENT PASS / HISTORICAL MONTHLY PASS /
ANNUAL PASS / CLIENTS PASS / ECOUNT CURRENT MONTH PASS / STORE MASTER PASS /
INVENTORY PASS / BRAND REGISTRY PASS / PRODUCT REGISTRY PASS /
PRICE AUDIT PASS / FRONTEND PASS

VERDICT: PRODUCTION BASELINE HEALTHY
```
13/13 PASS — 이전 batch 종료 시점의 WARN/FAIL 전부 해소.

## Test Suite(§19)

```
node --test "test/**/*.test.mjs"
tests 823, pass 821, fail 2(Batch 8 이전부터 존재하던 pre-existing
  실패와 정확히 동일 — 이번 batch는 순수 data sync라 소스 코드 변경
  없음, 신규 실패 0)
```

## Reports(§20~24)

- `docs/reports/inventory-intelligence-v2-preaudit-2026-08-26.md`:
  무수정(이미 커밋됨, 이번 batch에서 손대지 않음).
- `docs/reports/inventory-operations-foundation-mvp-2026-08-26.md`:
  기존 본문 무수정, "Follow-up Resolution — ECOUNT August Production
  Resync (Batch 9)" 섹션만 append.
- 이 문서(신규): `docs/reports/ecount-august-production-resync-2026-08-26.md`.
- 3개 문서 전부 이번 batch의 단일 docs commit에 포함(이미 커밋된
  2개 문서는 diff만 stage, 재작성/중복 커밋 없음).

## Worktree Safety

```
이번 batch에서 code 수정 없음(순수 data sync + docs) — commit 대상은
docs 3개 파일뿐. SALES/, POS-PRICE/, backup 파일 전부 무변경(읽기만
수행). git add -A/. 사용 안 함, 명시적 경로만 staging.
```

## Final Status

```
BATCH 9 ECOUNT PRODUCTION RESYNC COMPLETE — INVENTORY OPERATIONS FULLY CLOSED
```
