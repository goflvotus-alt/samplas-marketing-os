# SAMPLAS Local → Render Migration — Batch 3: Inventory Snapshot Refresh — 2026-08-25

**상태: COMPLETE — PRODUCTION VERIFIED**

## 1. Purpose

Render production의 `/api/inventory/overview`가 `generatedAt:
2026-07-18T09:45:57.629Z`로 Local(`2026-08-19`) 대비 1개월+ stale했다. 이번
Batch는 (1) Local snapshot 자체가 이미 6일 전(2026-08-19) 데이터라 그대로
올리기보다 공식 경로로 재수집하는 것이 맞는지 판단하고, (2) 필요하면
재수집한 뒤, (3) 그 결과를 Render에 업로드해 정렬하는 것을 목적으로 한다.
코드 수정 없음.

## 2. Inventory Source Map

- `GET /api/inventory/overview` → `server.mjs:730` → `handleIntelligenceRequest()` → `intelligence-service.mjs:464` `handleInventoryOverviewGet()`
- 핵심 입력 데이터: `ecountInventoryLatestFile = work/ecount-inventory/latest.json` (품목 배열, `Array.isArray` 필수)
- 응답의 `generatedAt` 필드는 `latest.json`이 아니라 별도 파일 `work/ecount-inventory/diagnostic.json`의 `finishedAt`에서 나온다(`diagnostic?.finishedAt ?? null`) — **canonical set은 latest.json 하나가 아니라 latest.json + diagnostic.json 두 파일**임을 source 추적으로 확인.
- `buildInventoryOverview()`(`scripts/inventory-overview-lib.mjs`)가 `ecountRows`(latest.json) + `brandRegistry`(`work/intelligence/brand-master-list.json` + `brand-aliases.json`) + `salesIndex`(ECOUNT offline sales 스냅샷, Batch 1에서 정렬됨) + `registryProdCds`(`work/product-registry.json`)를 조합해 `summary`/`brandRollup`을 계산.

## 3. Local Before

```
GET http://127.0.0.1:8787/api/inventory/overview
generatedAt: 2026-08-19T04:51:39.074Z
summary: totalKnownStock 2852, inStockSkuCount 1708, negativeReviewSkuCount 587,
         totalSkuCount 10000, adminCodeSkuCount 138, qqqSkuCount 477
brandRollup count: 253
source file: work/ecount-inventory/latest.json (mtime 8/19 13:51), diagnostic.json 동일 시각
```

## 4. Production Before

```
GET https://samplas-marketing-os.onrender.com/api/inventory/overview
generatedAt: 2026-07-18T09:45:57.629Z
summary: totalKnownStock 2870, inStockSkuCount 1734, negativeReviewSkuCount 588,
         totalSkuCount 10000, adminCodeSkuCount 140, qqqSkuCount 430
brandRollup count: 254
```

## 5. Freshness Decision

Local snapshot(2026-08-19)도 audit 시점(2026-08-25) 기준 이미 6일 전 데이터였다.
재고는 변동성이 높은 데이터이므로, 그대로 Render에 올리기보다 공식 재수집
경로가 안전하게 존재하는지 먼저 확인했고, 존재함을 확인해 **재수집을
우선**했다(아래 6절).

## 6. Official Refresh Path

- **command:** `node scripts/sync-ecount-inventory.mjs` (인자 없음 = production 모드, 기존과 동일)
- **동작:** ECOUNT Open API — Zone 조회 → Login → 품목조회(`GetBasicProductsList`) → 재고조회(`GetListInventoryBalanceStatus`) — 전부 조회성 API, ECOUNT 측에 쓰기 작업 없음
- **출력:** `work/ecount-inventory/{raw-products.json, raw-inventory.json, latest.json, diagnostic.json}` 4개 파일
- **안전성(코드 확인):** `writeInventoryOutputsAtomically()`가 임시 staging 디렉터리에 먼저 쓴 뒤, 기존 파일을 `.backup-{token}/`으로 rename하고, 신규 파일을 최종 경로로 rename — 중간 실패 시 backup에서 원상복구하는 rollback 로직 존재. 필요 환경변수(`ECOUNT_COM_CODE`, `ECOUNT_USER_ID`, `ECOUNT_API_CERT_KEY`) 3개 모두 `.env`에 존재 확인 후 실행.

## 7. Refresh Result

```
node scripts/sync-ecount-inventory.mjs
exit code: 0
{
  "mode": "production", "productsOnly": false,
  "createdFiles": ["work/ecount-inventory/raw-products.json", "raw-inventory.json", "latest.json", "diagnostic.json"],
  "productCount": 10000, "inventoryCount": 3382, "purchasePriceCount": 10000
}
```

`diagnostic.json`: `startedAt: 2026-08-25T10:14:34.490Z`, `finishedAt:
2026-08-25T10:14:37.733Z`, `baseDate: 20260825`, 모든 step(zone/login/products/inventory) `ok: true`, `errors: []`.

## 8. Local After Refresh

```
generatedAt: 2026-08-19T04:51:39.074Z → 2026-08-25T10:14:37.733Z
totalKnownStock: 2852 → 2936
inStockSkuCount: 1708 → 1729
negativeReviewSkuCount: 587 → 583
brandRollup count: 253 → 252
```
(inventoryCount가 3353→3382로 증가한 것과 일관 — 실제 재고 변동을 그대로
반영한 결과이며 숫자를 강제로 맞추지 않았다.)

## 9. Upload Dry Run

canonical set이 `latest.json` 하나가 아니라 `latest.json` + `diagnostic.json`
두 파일임을 2절에서 확인했으므로, 대상을 2개로 잡았다:

```
node scripts/upload-work-snapshots-to-render.mjs --dry-run ecount-inventory/latest.json ecount-inventory/diagnostic.json
{"dryRun": true, "files": ["ecount-inventory/diagnostic.json", "ecount-inventory/latest.json"]}
```
정확히 2개, 다른 snapshot 없음.

## 10. Upload

```
node scripts/upload-work-snapshots-to-render.mjs --overwrite ecount-inventory/latest.json ecount-inventory/diagnostic.json
{"ok": true, "overwrite": true, "uploaded": ["ecount-inventory/diagnostic.json", "ecount-inventory/latest.json"]}
```
ECOUNT sales, store-master, price-audit, registry, monthly/annual, backup,
raw-products/raw-inventory(비-allowlist 파일) 등 다른 어떤 파일도 업로드하지
않았다.

## 11. Production After

```
GET https://samplas-marketing-os.onrender.com/api/inventory/overview (LOCAL과 동시 조회)
generatedAt: 2026-08-25T10:14:37.733Z  (LOCAL과 완전 일치)
summary: LOCAL과 완전 일치 (전체 필드 비교 결과 동일)
coverage: LOCAL과 완전 일치
brandRollup count: 252 = 252
```

## 12. Local ↔ Render Comparison

| | LOCAL | RENDER |
|---|---|---|
| generatedAt | 2026-08-25T10:14:37.733Z | 2026-08-25T10:14:37.733Z |
| summary (전체 필드) | 동일 | 동일 |
| coverage | 동일 | 동일 |
| brandRollup count | 252 | 252 |

**요청된 핵심 지표(generatedAt/summary/coverage/개수)는 전부 완전 일치.**

다만 `brandRollup` 배열의 **개별 항목 내용**을 set 단위로 비교한 결과, 약
23개 브랜드에서 차이가 발견됨 — LOCAL은 `raw:604service`, `raw:carnet
archive`, `raw:bonnae`, `raw:xlim`, `raw:surgery`, `raw:avavav` 등을 미해결
(`raw:` prefix, 원문 그대로) 상태로 표시하는 반면, RENDER는 동일 브랜드들을
`B0000XXX` 형태의 canonical 브랜드 코드로 이미 해결(resolve)해서 표시함(예:
CARNET ARCHIVE = `B00000KU`). 이는 이번 Batch가 건드리지 않은
`work/intelligence/brand-master-list.json` / `brand-aliases.json`(브랜드
해석에 쓰이는 소스)이 LOCAL과 RENDER 사이에 서로 다른 버전으로 존재하기
때문으로 추정되며, Inventory refresh나 이번 업로드로 인한 회귀가 아니라
**기존부터 있던, 이번에 처음 발견된 별개의 gap**이다(13절 기록, 이번
Batch에서 수정하지 않음).

## 13. Regression

```
GET /api/status                                    -> 200
GET /api/sales/total?since=2026-08-01&until=2026-08-25 -> total 196,511,398, byStore {APGUJEONG: 157,300,800, VAIL: 10,063,700}
GET /api/intelligence/clients                       -> totalClients 97, orderCount 376
GET /api/intelligence/price-audit                   -> generatedAt 2026-08-25T02:40:11.541Z, MATCH 2977 등 변화 없음
GET /api/intelligence/store?store=APGUJEONG         -> 200
GET /api/intelligence/store?store=VAIL              -> 200
```

Batch 1(ECOUNT offline `byStore` 값)과 Batch 2(Store Intelligence 200 응답)의
결과가 그대로 유지됨을 확인. total/orderCount의 소폭 차이(196,729,198 →
196,511,398, orderCount 377 → 376)는 Cafe24 실시간 온라인 주문이 계속
갱신되는 라이브 데이터의 자연스러운 변동이며 회귀가 아니다(byStore 오프라인
값은 정확히 동일하게 유지됨).

## 14. Remaining Gap

- **[신규 발견] Brand Master/Aliases 동기화 gap:** `work/intelligence/brand-master-list.json`, `work/intelligence/brand-aliases.json`이 Local과 Render 사이에 실제로 다른 버전으로 존재하는 것으로 보임(Inventory `brandRollup`의 브랜드 해석 결과 불일치로 간접 확인). 이번 Batch 범위 밖 — 별도 조사/Batch 필요.
- BATCH 4(Core Dashboard Cross-Validation), BATCH 5(Local-Only Cleanup)는 `local-to-render-migration-audit-2026-08-25.md` 계획대로 계속 진행 예정.

## 15. Final Status

```
COMPLETE — PRODUCTION VERIFIED
```
