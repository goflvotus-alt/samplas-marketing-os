# SAMPLAS Local → Render Migration — Batch 1: Production ECOUNT Offline Data Alignment — 2026-08-25

## 1. Purpose

`local-to-render-migration-audit-2026-08-25.md`에서 확인된 P0 gap을 해소한다:
Render production이 2026-08 ECOUNT offline 매출을 2026-08-05 기준 legacy
단일파일(135행, 25,971,600원)로만 서빙하고 있었고, Local에서 검증된 warehouse
분리 최신 스냅샷(APGUJEONG/VAIL, 906행, 167,364,500원)이 아직 반영되지 않은
상태였다. 이번 Batch는 이 두 스냅샷 파일을 Render persistent disk에
업로드하는 것만을 목적으로 한다. **소스 코드 수정 없음.**

## 2. Before

### Local source (업로드 직전 재확인)

- `work/ecount-sales/2026-08.APGUJEONG.json`: `storeCode: APGUJEONG`, rows 816, `totalOfflineSales: 157,300,800`, `importedAt: 2026-08-25T05:42:01.963Z`, `periodStart: 2026-08-01`, `periodEnd: 2026-08-25`
- `work/ecount-sales/2026-08.VAIL.json`: `storeCode: VAIL`, rows 90, `totalOfflineSales: 10,063,700`, `importedAt: 2026-08-25T05:42:01.963Z`, `periodStart: 2026-08-03`, `periodEnd: 2026-08-25`
- combined: rows 906, offline 167,364,500

### Production (업로드 직전 재조회, 이전 audit 수치를 재사용하지 않고 다시 실측)

```
GET /api/ecount-sales/monthly?month=2026-08
{"source": "ecount_sales_status_excel", "storesIncluded": [], "storesMissing": ["APGUJEONG","VAIL"],
 "totalOfflineSales": 25971600, "totalLineCount": 135,
 "importedAt": "2026-08-05T04:35:15.726Z", "periodStart": "2026-08-01", "periodEnd": "2026-08-05"}

GET /api/sales/total?since=2026-08-01&until=2026-08-25
totalSales.amount: 55,336,298 (online 29,364,698 + offline 25,971,600)
byStore: {APGUJEONG: 0, VAIL: 0}

GET /api/reports/monthly?month=2026-08
total: 55,336,298

GET /api/intelligence/clients?since=2026-08-01&until=2026-08-25
totalClients: 32, totalSalesAmount: 55,336,298, orderCount: 124
```

(참고: 이전 audit 시점 대비 online 매출이 28,638,298 → 29,364,698로 자연
증가함 — Cafe24 실시간 주문이 계속 쌓이는 라이브 데이터이므로, 이번 Batch는
과거 audit 숫자를 억지로 재현하지 않고 업로드 직전 재조회한 실측값을
baseline으로 사용했다.)

## 3. Upload Target Confirmation

수정 없이 코드만 재확인:
- `scripts/upload-work-snapshots-to-render.mjs`의 `monthlyPathPattern`: `/^(?:ecount-sales|monthly)\/\d{4}-(?:0[1-9]|1[0-2])(?:\.(?:APGUJEONG|VAIL))?\.json$/` → `ecount-sales/2026-08.APGUJEONG.json`, `ecount-sales/2026-08.VAIL.json` 둘 다 매치 확인
- `server.mjs`의 `isAllowedWorkDataUploadPath()`도 두 경로 모두 `true` 반환 확인

## 4. Dry Run

```
node scripts/upload-work-snapshots-to-render.mjs --dry-run ecount-sales/2026-08.APGUJEONG.json ecount-sales/2026-08.VAIL.json

{
  "dryRun": true,
  "files": [
    "ecount-sales/2026-08.APGUJEONG.json",
    "ecount-sales/2026-08.VAIL.json"
  ]
}
```

대상 정확히 2개, 다른 snapshot 없음, 실제 업로드 없음 — PASS.

## 5. Upload

```
node scripts/upload-work-snapshots-to-render.mjs --overwrite ecount-sales/2026-08.APGUJEONG.json ecount-sales/2026-08.VAIL.json

{
  "ok": true,
  "overwrite": true,
  "uploaded": [
    "ecount-sales/2026-08.APGUJEONG.json",
    "ecount-sales/2026-08.VAIL.json"
  ]
}
```

업로드 대상은 이 두 파일뿐이었다 — `2026-08.json`(legacy), 2026-07, price-audit,
product-registry, inventory, monthly/annual, backup 등 다른 어떤 파일도
업로드하지 않았다.

## 6. After — Production ECOUNT Validation

```
GET /api/ecount-sales/monthly?month=2026-08
{"source": "ecount_sales_status_excel_store_separated",
 "storesIncluded": ["APGUJEONG","VAIL"], "storesMissing": [],
 "totalOfflineSales": 167364500, "totalLineCount": 906,
 "importedAt": "2026-08-25T05:42:01.963Z",
 "periodStart": "2026-08-01", "periodEnd": "2026-08-25"}

GET /api/ecount-sales/monthly?month=2026-08&store=APGUJEONG → rows 816, offline 157,300,800
GET /api/ecount-sales/monthly?month=2026-08&store=VAIL      → rows 90,  offline 10,063,700
```

Local source(2절)와 완전히 일치 — 업로드 성공.

## 7. Local ↔ Render Cross-Check (업로드 직후, 동시 재조회)

### Today (`/api/sales/total?since=2026-08-01&until=2026-08-25`)

| | LOCAL | RENDER |
|---|---|---|
| online | 29,364,698 | 29,364,698 |
| offline | 167,364,500 | 167,364,500 |
| byStore.APGUJEONG | 157,300,800 | 157,300,800 |
| byStore.VAIL | 10,063,700 | 10,063,700 |
| total | **196,729,198** | **196,729,198** |
| storesIncluded | [APGUJEONG, VAIL] | [APGUJEONG, VAIL] |
| coverage.complete | true | true |

**완전 일치.** (online이 audit 당시 참조값 196,002,798의 근거였던 28,638,298에서
29,364,698로 자연 증가했으므로 total도 196,729,198로 자연스럽게 갱신됨 — 두
환경 모두 같은 시점에 같은 값을 반환하는지가 검증 기준이며, 과거 숫자에
강제로 맞추지 않았음.)

### Monthly (`/api/reports/monthly?month=2026-08`)

LOCAL total: 196,729,198 / RENDER total: 196,729,198 — **완전 일치**

## 8. Clients Impact

```
GET /api/intelligence/clients?since=2026-08-01&until=2026-08-25 (동시 조회)

LOCAL:  totalClients 97, totalSalesAmount 195,579,198, offlineSalesAmount 166,214,500, orderCount 377
RENDER: totalClients 97, totalSalesAmount 195,579,198, offlineSalesAmount 166,214,500, orderCount 377
```

**완전 일치.** Batch 1 이전(audit 시점) Render는 totalClients 31~32,
orderCount 122~124였던 것과 비교하면, offline source alignment로 격차가
완전히 해소되었다.

## 9. Remaining Gaps (이번 Batch에서 손대지 않음)

Batch 1은 ECOUNT offline 데이터만 다루므로 아래 두 gap은 여전히 남아 있음(재확인 완료, 원인 조사/수정은 별도 Batch):

- **Store Intelligence (APGUJEONG/VAIL):** `GET /api/intelligence/store?store=APGUJEONG` → 여전히 `HTTP 400 "Unknown store: APGUJEONG"`. 분류: **Store Master** (`store-master.json`이 업로드 allowlist 자체에 없어 persistent disk에 반영된 적 없음 — `local-to-render-migration-audit-2026-08-25.md` BATCH 2 대상)
- **Inventory:** RENDER `generatedAt: 2026-07-18T09:45:57.629Z` vs LOCAL `generatedAt: 2026-08-19T04:51:39.074Z` — 여전히 1개월+ stale. 분류: **snapshot generatedAt (정기 업로드 누락)** — BATCH 3 대상

Price Audit(BATCH 대상 아님, 이미 별도 세션에서 정렬 완료)은 계속 일치 상태 유지 중.

## 10. Final Status

```
BATCH 1 PRODUCTION ECOUNT ALIGNMENT COMPLETE
```

Today/Monthly/Clients의 2026-08 오프라인 매출·매장분류 gap은 완전히 해소됨.
다음 작업은 `local-to-render-migration-audit-2026-08-25.md`의 BATCH 2(Store
Master Deployment, P0) 및 BATCH 3(Inventory Snapshot Refresh, P1).
