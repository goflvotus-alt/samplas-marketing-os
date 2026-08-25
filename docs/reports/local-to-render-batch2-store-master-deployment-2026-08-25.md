# SAMPLAS Local → Render Migration — Batch 2: Store Master Deployment — 2026-08-25

**상태: COMPLETE — PRODUCTION VERIFIED**

## 1. Purpose

Render production의 `GET /api/intelligence/store?store=APGUJEONG` /
`?store=VAIL`이 `HTTP 400 "Unknown store: ..."`를 반환한다(Local에서는 정상
200). `local-to-render-migration-audit-2026-08-25.md`에서 확인된 원인: local
`work/store-master.json`은 존재하지만, Render persistent disk
(`WORK_DIR=/var/data/samplas-dashboard/work`)에는 반영된 적이 없고, 그 이유는
기존 snapshot upload allowlist(`scripts/upload-work-snapshots-to-render.mjs`,
`server.mjs`)에 `store-master.json`이 애초에 등록돼 있지 않았기 때문이다.

## 2. Original 400 Error (baseline)

```
GET https://samplas-marketing-os.onrender.com/api/intelligence/store?store=APGUJEONG&since=2026-08-01&until=2026-08-25
-> HTTP 400 {"ok": false, "error": "Unknown store: APGUJEONG"}

GET .../api/intelligence/store?store=VAIL&...
-> HTTP 400 {"ok": false, "error": "Unknown store: VAIL"}
```

## 3. Root Cause (source 확인)

- `server.mjs:1562` `const storeMasterFile = () => join(workDir, "store-master.json");`
- `server.mjs:1566-1568` `loadStoreMaster()`가 이 경로를 읽어 매장 목록을 구성하고, `buildStoreIntelligencePayload()`가 `storeCodeValue`와 일치하는 항목이 없으면 `Unknown store: {storeCodeValue}`를 던짐(`error.status = 400`).
- `workDir`는 `env.WORK_DIR`(Render에서는 persistent disk 경로)이지 git 체크아웃 폴더가 아니므로, git에 커밋되어 있어도 자동 반영되지 않고 반드시 `/api/work-data/upload`를 통해 업로드해야 함.
- `store-master.json`은 그 업로드 경로의 allowlist(client `explicitPaths`, server `workDataUploadPaths`) 어디에도 없었음(확인 완료).

## 4. Local Source (확인 완료)

`work/store-master.json` (957 bytes, mtime 8/13):
```json
{
  "version": "v1",
  "stores": [
    {"storeCode": "APGUJEONG", "displayName": "압구정 매장", "type": "physical",
     "source": {"system": "ECOUNT", "warehouseCode": "100", "warehouseName": "매장"}},
    {"storeCode": "VAIL", "displayName": "SAMPLAS VAIL", "type": "physical",
     "source": {"system": "ECOUNT", "warehouseCode": "200", "warehouseName": "SAMPLAS Veil"}}
  ]
}
```
(display에서 VAIL은 API 레이어에서 "SAMPLAS VEIL"로 override됨 — `server.mjs`
`storeCode === "VAIL" ? "SAMPLAS VEIL" : displayName` 패턴, 파일 자체를 수정할
필요 없음.)

## 5. Minimal Code Change

정확히 2개 tracked 파일, 각 1줄 추가만:

### `scripts/upload-work-snapshots-to-render.mjs`
```diff
   "brand-master.json",
   "price-audit.json",
   "today-product-sync-issues.json",
+  "store-master.json",
   "ecount-inventory/latest.json",
```

### `server.mjs`
```diff
   "brand-master.json",
   "price-audit.json",
   "today-product-sync-issues.json",
+  "store-master.json",
   "intelligence/brand-master-list.json",
```

다른 파일(frontend, ECOUNT importer, Price Audit, Inventory, Clients,
Monthly/Annual, Store Intelligence 계산 로직) 수정 없음. 두 파일 모두 이번
변경 전에는 HEAD 대비 unrelated diff가 전혀 없는 clean 상태였음을 확인
(`git diff HEAD --stat` 빈 결과) — partial staging 불필요.

## 6. Static / Dry-Run Validation

```
node --check scripts/upload-work-snapshots-to-render.mjs  -> OK
node --check server.mjs                                    -> OK
```

Allowlist 함수 직접 호출로 회귀/보안 검사(8케이스): `brand-master.json`,
`price-audit.json`, `store-master.json`, `ecount-sales/2026-08.APGUJEONG.json`
→ 허용, `random-file.json`, `../../etc/passwd`, `store-master.json.bak`,
`nested/store-master.json` → 거부. 전부 예상대로 — wildcard/path traversal이
열리지 않았음을 확인.

```
node scripts/upload-work-snapshots-to-render.mjs --dry-run store-master.json
{"dryRun": true, "files": ["store-master.json"]}
```

정확히 1개 대상, 실제 네트워크 호출 없음(dry-run은 fetch 이전에 return).

## 7. Code Commit / Push

```
commit:  2ca38018819a79ddfb95164c0e6b3941aed5a841
message: fix(render-data): allow store master snapshot upload
files:   scripts/upload-work-snapshots-to-render.mjs, server.mjs (각 1줄 추가, 총 2 insertions)
push:    188dc19..2ca3801  main -> main (fetch로 origin/main 사전 확인 후 진행, 1 ahead / 0 behind)
```

## 8. Render Deployment Confirmation

별도 version/commit endpoint가 없어, 실제 업로드 요청 자체를 안전한 배포
프로브로 사용했다 — 구 코드였다면 `"허용되지 않은 work 데이터 경로입니다"`로
무해하게 거부되고 아무것도 업로드되지 않는 구조이므로, 실패해도 위험이 없다.

```
node scripts/upload-work-snapshots-to-render.mjs --overwrite store-master.json
{"ok": true, "overwrite": true, "uploaded": ["store-master.json"]}
```

**성공** — 이는 새 allowlist(`store-master.json` 포함)가 이미 production에
배포되어 실행 중임을 그 자체로 증명한다(push 후 약 60초 대기 뒤 1회 시도로
성공).

## 9. Store Master Upload

업로드 대상은 `store-master.json` 하나뿐이었다. ECOUNT sales, price-audit,
inventory, registry, monthly/annual, backup 등 다른 어떤 파일도 업로드하지
않았다.

## 10. APGUJEONG Production Validation

```
GET https://samplas-marketing-os.onrender.com/api/intelligence/store?store=APGUJEONG&since=2026-08-01&until=2026-08-25
-> HTTP 200 (기존 "Unknown store" 오류 완전히 사라짐)
```

같은 시점 LOCAL과 동시 조회 비교(clients.summary):

| | LOCAL | RENDER |
|---|---|---|
| totalClients | 86 | 86 |
| orderCount | 256 | 256 |
| totalSalesAmount | 156,150,800 | 156,150,800 |
| offlineSalesAmount | 156,150,800 | 156,150,800 |
| coverage.importedAt | 2026-08-25T05:42:01.963Z | 2026-08-25T05:42:01.963Z |

**완전 일치.** (매장 데이터는 ECOUNT offline 전용, live Cafe24 online
컴포넌트가 없어 시점 차이로 인한 자연 변동 없음.)

## 11. VAIL Production Validation

```
GET https://samplas-marketing-os.onrender.com/api/intelligence/store?store=VAIL&since=2026-08-01&until=2026-08-25
-> HTTP 200
```

| | LOCAL | RENDER |
|---|---|---|
| totalClients | 19 | 19 |
| orderCount | 36 | 36 |
| totalSalesAmount | 10,063,700 | 10,063,700 |
| offlineSalesAmount | 10,063,700 | 10,063,700 |
| coverage.importedAt | 2026-08-25T05:42:01.963Z | 2026-08-25T05:42:01.963Z |

**완전 일치.**

## 12. Regression

Batch 2 배포/업로드 이후 재확인:

- `GET /api/status` → 200
- `GET /api/sales/total?since=2026-08-01&until=2026-08-25` → total `196,729,198`, `byStore: {APGUJEONG: 157,300,800, VAIL: 10,063,700}` — **Batch 1에서 맞춘 값 그대로 유지**
- `GET /api/intelligence/clients` → totalClients 97, orderCount 377 — **Batch 1과 동일, 회귀 없음**
- `GET /api/intelligence/price-audit` → `generatedAt: 2026-08-25T02:40:11.541Z`, `MATCH 2977 / ECOUNT_HIGHER 75 / ...` — **변화 없음**

## 13. Remaining Gap

`local-to-render-migration-audit-2026-08-25.md`에서 확인된 나머지 gap:

- **Inventory:** RENDER `generatedAt: 2026-07-18T09:45:57.629Z`가 여전히 LOCAL(`2026-08-19`) 대비 1개월+ stale — 이번 Batch 대상 아님, BATCH 3(P1)에서 처리 예정.

## 14. Final Status

```
COMPLETE — PRODUCTION VERIFIED
```
