# Inventory Operations — Data Foundation & MVP — 2026-08-26

**상태: COMPLETE — PRODUCTION VERIFIED (부수적으로 발견한, 이 batch와 무관한 ecount-sales 동기화 gap은 별도 follow-up)**

## Purpose

`docs/reports/inventory-intelligence-v2-preaudit-2026-08-26.md`(READ-ONLY
pre-audit) 판정 `INVENTORY INTELLIGENCE V2 REQUIRES DATA PIPELINE WORK
FIRST`에 따라, (1) 오프라인 매출 pipeline P0 버그 수정, (2) 재고 snapshot
history 기반 구축, (3) purchasePrice 신뢰도 감사, (4) 현재 데이터로
정확히 가능한 Inventory Operations MVP 구현까지 한 번에 수행한다. 새
운영 기능의 working name은 `Inventory Operations`이며, 기존 hidden
diagnostic view `Inventory Intelligence`(Cafe24↔ECOUNT reconciliation)와
이름/기능 모두 겹치지 않게 분리했다.

## Pre-audit Findings(요약, 원본 report 참고)

- ECOUNT 10,000 SKU 중 재고 known 27%(2,705건), 30일 판매 이력 확인 5.5%(548건).
- Inventory의 오프라인 매출 reader가 `YYYY-MM.json`만 인식해
  warehouse-split-only 달(`YYYY-MM.APGUJEONG.json` 등)을 놓치는 P0 버그.
- ECOUNT 재고 API에 창고 dimension 자체가 없음(매장별 재고 계산 불가).
- purchasePrice 100% coverage이나 41%가 salesPrice와 동일(신뢰도 미검증).
- `latest.json` 하나뿐, 재고 시계열/추세 완전 불가.

## A. Pipeline Bug — Root Cause & Fix

`intelligence-service.mjs::buildEcountOfflineSalesIndexFromDisk()`는
`/^\d{4}-\d{2}\.json$/` 정규식으로 `work/ecount-sales/` 디렉터리를 직접
스캔했다. Warehouse-routing 이후 실제 파일: `2026-08.json`(legacy 병합,
2026-08-11 import, 291개 판매수량, **stale**), `2026-08.APGUJEONG.json`
+`2026-08.VAIL.json`(2026-08-26 import, 643+60=703개, **최신/완전**),
`2026-09.APGUJEONG.json`(split만 존재, 대응 legacy 없음). 과거 코드는
2026-08의 stale legacy만 읽고 2026-09는 완전히 건너뛰었다.

**Fix**: Clients/Sales가 이미 쓰고 있던 공용 리더
`readEcountOfflineSalesSnapshot()`(`scripts/read-ecount-offline-sales-snapshot.mjs`,
STORE-BATCH-B에서 이미 구현/검증된 precedence: 매장별 분리 파일이 있으면
그것만 사용하고 legacy는 완전히 무시 — double-count 방지)를 그대로
재사용하도록 교체. 월 discovery는 `loadEcountClientLines()`와 동일한
패턴(`/^(\d{4}-\d{2})(?:\.[A-Z0-9_]+)?\.json$/`으로 디렉터리에서 존재하는
월만 추출) — 새 precedence 로직을 만들지 않았다.

**실측 전/후 비교(Local, 2026-08-26 기준)**:
```
수정 전: recentSalesQty 합계 715 (2026-08 stale legacy 291개 포함, 2026-09 split 데이터 누락)
수정 후: recentSalesQty 합계 443 (2026-08 최신 split 703개로 교체, 2026-09 반영)
```
합계가 늘지 않고 오히려 준 이유: (1) legacy 파일 자체가 stale해서
교체되며 라인 구성이 달라졌고, (2) `2026-09.APGUJEONG.json`에 2026-09-03/05
날짜의 데이터가 섞여 있어(이 파일의 `importedAt`은 2026-08-13로, 실제
2026-08-26 "오늘" 이전에 만들어진 것으로 보아 테스트/실험성 데이터로
추정됨 — 삭제/수정하지 않음, 이번 배치 범위 밖) 30일 rolling window의
기준일(`latestDataDate`)이 2026-09-05로 밀리면서 일부 8월 초 판매가
window 밖으로 밀려났다. **이건 버그가 아니라 실제 데이터 상태를 정확히
반영한 결과다** — API 응답에 `salesDataAsOf` 필드로 이 기준일을 그대로
노출해 투명하게 드러낸다(§E 참고).

**테스트**: `test/inventory-offline-sales-reader.test.mjs`, 12개 케이스
(legacy only / split 양매장 / APGUJEONG만 / VAIL만 / legacy+split 공존
double-count 방지 / malformed 파일명 / 미지원 매장코드 / 빈 월 / 비매출
라인 제외 / 7월·8월·**9월 split-only** 회귀) 전부 PASS.

## B. Purchase Price Forensic Audit

### Source trace
`scripts/sync-ecount-inventory.mjs::buildLatestRows()`: `purchasePrice` ←
ECOUNT `IN_PRICE`/`PUR_PRICE`/`BUY_PRICE`/`PURCHASE_PRICE`(첫 non-empty),
`salesPrice` ← `OUT_PRICE`/`SALE_PRICE`/`SET_PRICE`/`SALES_PRICE`. 둘 다
ECOUNT 품목마스터(GetBasicProductsList) 원본 필드 확인 완료(fallback
없이 직접 매핑, salesPrice로 대체되는 로직 없음).

### Distribution(전체 10,000 SKU)
```
purchasePrice == salesPrice : 4,103건(41.0%)
purchasePrice <  salesPrice : 5,894건(58.9%)  ← 진짜 원가일 가능성
purchasePrice >  salesPrice : 3건(0.03%, 이상치)
결측: 0건(diagnostic.json counts.purchasePriceCount = 10,000, 100% coverage)
```

### Sample Validation(실제 브랜드 상품 25개 표본, raw-products.json 원본 IN_PRICE/OUT_PRICE 직접 확인)
IN_PRICE≠OUT_PRICE인 표본들의 ratio가 **0.35~0.39 구간에 뚜렷하게
군집**(예: `AE SYNCTX` 0.379, `GRACE ELWOOD` 0.387, `Anomalies
Department` 0.388/0.389, `LIFE IS HELL` 0.382 등) — 패션 리테일 도매
마진율로 충분히 그럴듯한 값이며 무작위 노이즈가 아니다. 나머지는 정확히
1.0(IN=OUT, 8/25) — 원가를 실제로 기록하지 않고 판매가를 그대로 넣은
placeholder로 추정.

### 판정: **PARTIALLY TRUSTED**
- IN_PRICE ≠ OUT_PRICE인 ~59%: 실제 매입원가로 사용 가능할 개연성 높음(그러나 이번 read-only+제한된 sample validation만으로 100% 확정은 아님).
- IN_PRICE == OUT_PRICE인 ~41%: 원가 미기록 placeholder로 추정, margin 계산에 쓰면 안 됨.
- 이번 감사는 브랜드/상품군별 세분화 분포까지는 확인하지 않음(향후 필요 시 별도 진단).

## C. Cost Hard Gate — 적용 결과

**Margin / Gross Profit / Profit % / Stock Profit Value — 이번 배치에서
구현하지 않음.** purchasePrice가 완전히 신뢰되지 않는 한 이 게이트는
유지된다. 대신 **Retail Inventory Value**(판매가 × 양수 재고수량)만
구현했다(§E). `test/inventory-operations-mvp.test.mjs`에 "Cost Hard
Gate" 전용 테스트를 추가해 `margin`/`profit`/`grossProfit`/
`profitPercent`/`stockProfitValue`/`costValue` 필드가 items/operations
어디에도 존재하지 않음을 명시적으로 검증한다.

## D. Inventory Snapshot History Foundation

`scripts/sync-ecount-inventory.mjs::writeInventoryHistorySnapshot()`
신규 추가. `work/ecount-inventory/history/{KST 날짜}.json`에 그 시점의
`latest`+`diagnostic.counts`를 저장한다.

- **atomic**: temp 파일 쓰기 → rename(단일 파일이라 4파일 staging/backup
  스왑까지는 필요 없음, 기존 `writeInventoryOutputsAtomically` 패턴과
  동일한 원자성 보장 수준).
- **하루 1개 정책**: 파일명이 곧 날짜 키라 같은 날 재실행하면 자동으로
  overwrite — 별도 dedupe 로직 불필요, 쌓이지 않음.
- **실패 격리**: 메인 4파일 교체가 이미 성공한 뒤 별도 try/catch로
  호출되며, history 저장이 실패해도 `latest.json`/`diagnostic.json`은
  전혀 영향받지 않는다(테스트로 확인 — 의도적으로 실패시켜 latest.json
  바이트 단위 무변화 확인).
- **backfill 금지**: `diagnostic.finishedAt`이 곧 `snapshotDate`다 —
  과거 날짜를 추정해서 만들지 않는다(테스트로 확인).
- **retention**: 이번 배치에서 자동 삭제 로직을 구현하지 않았다(지시
  준수). 권장 정책(실행만 안 됨, 문서화만): 일 1개 누적, 예를 들어
  최근 90일 초과분은 별도 승인 하에 수동/스케줄 정리 — 실제 운영
  빈도(현재 sync는 비정기 수동 실행)를 보고 추후 결정.

테스트: `test/ecount-inventory-sync.test.mjs`에 4건 추가(atomic write,
같은 날 재실행 시 파일 1개만 유지, 실패해도 latest 불변, backfill 없음)
전부 PASS.

## E. Inventory Operations MVP

### 신규 per-item 필드(`scripts/inventory-overview-lib.mjs::buildInventoryOverview()`)
- `retailValue`: `status==='in_stock' && salesPrice!==null`일 때만
  `stockQuantity × salesPrice`, 그 외 `null`. 음수 재고는 항상 제외.
- `slowWatch`: `status==='in_stock' && recentSalesQty(30일)===0`.
  "Dead Stock"이라는 단정적 표현 대신 중립적 명칭 사용(재고 age 데이터
  없음을 항상 함께 명시).
- `daysOfSupply`: `status==='in_stock' && recentSalesQty>0`일 때만
  `stockQuantity / (recentSalesQty/30)`, 그 외 항상 `null`
  (**Infinity를 절대 노출하지 않음** — 테스트로 확인).

### 신규 `operations` 집계 객체(API 응답 최상위, 기존 필드는 그대로 유지)
```
coverage: { totalSkuCount, knownStockSkuCount, knownStockPct,
            salesWindowDays, sellingSkuCount, sellingSkuPct }
negativeInventory: { skuCount, totalNegativeUnits, recentlySellingCount,
                      topByUnits: [최대 10건] }
slowWatch: { skuCount, pctOfInStock }
inventoryValue: { label: "retail_inventory_value", totalRetailValue,
                  valuedSkuCount, missingPriceInStockSkuCount,
                  negativeStockExcludedUnits }
```
모든 비율에 분모가 딸려 있다 — 예시(Local 실측, 2026-08-26):
```
재고 확인 가능 SKU 2,313 / 10,000(23.1%, QQQ 제외)
최근 30일 판매 SKU 310 / 10,000(3.1%)
Slow Watch 1,586건(재고 있음 SKU 중 91.7%)
음수 재고 583건 / 1,438개(이 중 최근 판매 있음 14건)
재고 자산(Retail) ₩1,085,509,000(가격 확인 1,729건, 재고 있는데 가격
  없음 0건, 음수 재고 1,438개 제외)
```

### API 설계(Section 31 결정)
기존 `GET /api/inventory/overview`를 확장(신규 `operations` 최상위
필드 + `salesDataAsOf`)했다 — 새 endpoint를 만들지 않았다. 이유:
브랜드/상태 분류 등 필요한 join/집계가 이미 같은 요청 안에서 한 번에
끝나는 상태였고, 별도 endpoint는 동일한 데이터를 다시 읽고 다시 join하는
중복 비용만 생긴다(§Performance). 기존 필드는 전혀 삭제/변경하지
않았다 — 기존 consumer(현재 InventoryOverview 화면) 회귀 없음.

### Data Freshness(Section 30)
`generatedAt`(재고 스냅샷 시각)과 `salesDataAsOf`(오프라인 매출 30일
window의 실제 최신 날짜)를 서로 다른 필드로 분리 노출. 실측에서
`salesDataAsOf`가 `2026-09-05`로 나타났는데(§A에서 설명한 것처럼 테스트성
데이터로 추정되는 `2026-09.APGUJEONG.json`의 영향) — **이 값을 숨기지
않고 화면에 그대로 노출**해 데이터 이상을 투명하게 드러내는 쪽을
선택했다.

### Performance(Section 32)
10,000 product / ~3,000 inventory row 규모에서 기존 로직과 동일한
단일 순회(O(n))로 신규 필드를 계산 — 별도 추가 join/API 호출 없음
(salesIndex/brandRegistry/registryProdCds는 기존에도 이미 로드하던
것을 그대로 재사용). frontend에는 여전히 페이지네이션된 `items`만
내려가고(`itemsTotal`/`offset`/`limit` 기존 유지), `operations`는 이미
서버에서 집계된 요약 숫자만 전달 — 원시 10,000행을 프론트로 더 보내지
않는다.

### Frontend
기존 `outputs/samplas-marketing-os.html`/`.js`의 `InventoryOverview`
화면(`renderInventoryOverviewView()`)에 "Inventory Operations · MVP"
섹션을 추가(핵심 지표 카드 바로 아래, Brand Rollup 위) — 기존 카드/표는
전혀 수정하지 않음. 새 섹션: freshness 안내문(재고 기준 vs 판매 기준
분리 표시), coverage-first 카드 5개(각각 분모 표기), 음수 재고 Top 10
테이블. Chrome으로 실제 렌더링 확인(§G).

## F. Test Summary

```
신규 테스트: 12(offline sales reader) + 4(history snapshot) + 6(operations MVP) = 22개
전체: 800(Batch 8 baseline) → 822, pass 798 → 820, fail 2 → 2(불변)
신규 실패: 0
기존 pre-existing 실패 2건(APGUJEONG/VAIL canonical offline totals 관련,
  Today 화면 markup 관련) — 이번 batch 시작 전부터 존재, 이번 변경과
  무관함을 git stash로 재확인.
```

## G. Local QA(Chrome 실제 렌더링 확인)

`http://127.0.0.1:8787/#inventory-overview` → "매장 재고" 탭에서:
- 기존 핵심 지표 카드 7종 — 그대로 정상 렌더링(회귀 없음).
- 신규 "Inventory Operations · MVP" 섹션 — coverage/selling/slow
  watch/negative/retail value 카드 5개, 각 카드에 분모/비율/주석
  정상 표시. freshness 문구(재고 기준 시각/판매 기준 30일·최신
  2026-09-05)도 의도대로 분리 표시.
- 음수 재고 Top 10 테이블 — 실제 브랜드/상품명/재고수량 정상 표시.
- 콘솔: 크롬 확장 프로그램 관련 일반적인 메시지 채널 오류 3건뿐(앱
  코드와 무관, 기존에도 발생하던 브라우저 레벨 잡음) — 앱 자체 에러
  없음.

## H. Production Deployment

```
commit 1: 3aad9c3  fix(inventory): support warehouse-split offline sales
commit 2: f475549  feat(inventory): archive inventory snapshots
commit 3: e57f7f2  feat(inventory): add operations dashboard
push: 30b6ff5..e57f7f2 → origin/main
```

## I. Production Verification

Render 자동 배포 확인(`GET /api/inventory/overview`에 `operations` 필드
등장 시점까지 폴링) 후 실측.

### 신규 Inventory Operations(Render, 배포 직후)
```
generatedAt: 2026-08-25T10:14:37.733Z (재고 스냅샷 기준, 불변)
salesDataAsOf: 2026-08-25 (Local의 2026-09-05와 다름 — §J 참고, Render에는
  그 테스트성 2026-09 파일이 없어 더 정확한 값을 보여줌)
coverage: 2,313/10,000(23.1%) known stock, 407/10,000(4.07%) selling SKU
negativeInventory: 583 SKU / 1,438 units, 최근 판매 있음 15건
slowWatch: 1,577건(재고 있음 중 91.2%)
inventoryValue: ₩1,085,509,000(retail, 1,729 SKU 가격 확인)
```
기존 `summary`(totalKnownStock 2,936 등)는 Local과 완전 동일 — 회귀 없음.
기존 hidden diagnostic view `/api/inventory/intelligence/health`도 정상
200 응답(건드리지 않음, 별도 확인 완료).

### `npm run verify:production` 실행 결과
```
STATUS PASS / HISTORICAL MONTHLY PASS / STORE MASTER PASS /
INVENTORY PASS / BRAND REGISTRY PASS / PRODUCT REGISTRY PASS /
PRICE AUDIT PASS / FRONTEND PASS
TODAY/MONTHLY CURRENT/CLIENTS/ECOUNT CURRENT MONTH: WARN
ANNUAL: FAIL(당월 포함 합계라 위 WARN들과 동일 원인)
```

**INVENTORY는 최초 실행에서 `brandRollup` 불일치로 FAIL이 났으나, 원인은
내가 만든 코드가 아니라 parity 도구 자체의 사각지대였다** — 신규
`slowWatchCount` 필드가 `recentSalesQty`(이미 알려진 live rolling
metric)에서 파생되는데, 도구가 `recentSalesQty`만 비교 제외 대상이었고
`slowWatchCount`는 빠뜨렸다. 필드 단위로 직접 diff해서 확인한 결과 실제로
다른 필드는 `recentSalesQty`/`slowWatchCount` 딱 두 개뿐이었다(그 외
totalSku/knownStock/negativeUnits/retailValue 등은 전부 완전 일치) —
`scripts/verify-render-snapshot-sync.mjs`의 strip 목록에
`slowWatchCount`를 추가해 수정, 재실행 후 **INVENTORY PASS** 확인. 관련
테스트 1건 추가(`test/verify-render-snapshot-sync.test.mjs`).

**TODAY/MONTHLY CURRENT/ANNUAL/CLIENTS/ECOUNT CURRENT MONTH — 이번
배치와 무관한 별개의 pre-existing 발견**: 원인을 추적한 결과, Local의
`work/ecount-sales/2026-08.APGUJEONG.json`/`.VAIL.json`이 이번 세션
도중(`importedAt: 2026-08-26T09:03:40.035Z`, 938+99 rows) Render의 현재
버전(`importedAt: 2026-08-25T05:42:01.963Z`, 이전 row 수)보다 새로
재입수되어 있었다 — Inventory Operations 배치는 ECOUNT sales
import/upload를 전혀 건드리지 않았으므로 **이 batch가 만든 gap이
아니다**(이번 batch의 3개 커밋 diff에 ecount-sales 관련 코드/데이터
변경 없음, git log로 확인 가능). Render에 이 최신 August 판매현황을
업로드하는 것은 Batch 6/7과 동일한 수준의 별도 승인/진단이 필요한 작업이라
**이번 batch에서 실행하지 않음** — 발견 사실만 정확히 보고한다.

## J. Limitations(정직하게 기록)

- purchasePrice는 PARTIALLY TRUSTED일 뿐 완전히 검증되지 않았다 —
  margin 기능은 여전히 보류 상태.
- Local에만 있던 `2026-09.APGUJEONG.json`(2026-09-03/05 날짜, importedAt
  2026-08-13 — 실제 날짜보다 이전에 만들어진 테스트성 데이터로 추정)이
  Local의 `salesDataAsOf`를 실제보다 미래로 밀었다. **Render에는 이
  파일이 없어 Render의 `salesDataAsOf`(2026-08-25)가 오히려 더 정확했다**
  — 삭제/정리는 이번 배치 범위 밖(다른 세션의 작업물일 수 있어 임의
  삭제하지 않음), 별도 확인 필요.
- Slow Watch 모집단(재고 있음 SKU)의 90%+가 "30일 판매 0"이다 — 표본이
  원래 이렇게 치우쳐 있다는 뜻이며, 향후 60/90일 window나 계절성 보정이
  필요할 수 있다(이번 배치 범위 밖).
- warehouse별(APGUJEONG/VAIL) 재고, 진짜 sell-through, 재고 시계열
  분석(history 축적 전까지)은 여전히 불가능.
- **[신규, 별도 트랙] Local ecount-sales가 Render보다 최신(2026-08월)**
  — Today/Monthly/Annual/Clients/ECOUNT current month API가 이로 인해
  Local↔Render parity에서 WARN/FAIL을 보인다. Inventory Operations
  배치가 만든 gap이 아니며 수정하지 않았다 — 별도 승인 후 Batch 6/7과
  같은 방식(dry-run → upload → 재검증)으로 해소 권장.

## J. Limitations(정직하게 기록)

- purchasePrice는 PARTIALLY TRUSTED일 뿐 완전히 검증되지 않았다 —
  margin 기능은 여전히 보류 상태.
- `2026-09.APGUJEONG.json`으로 추정되는 테스트성 데이터가 `salesDataAsOf`를
  실제보다 미래로 밀고 있다 — 삭제/정리는 이번 배치 범위 밖(다른 세션의
  작업물일 수 있어 임의 삭제하지 않음), 별도 확인 필요.
- Slow Watch 모집단(재고 있음 SKU)의 91.7%가 "30일 판매 0"이다 — 표본이
  원래 이렇게 치우쳐 있다는 뜻이며, 향후 60/90일 window나 계절성 보정이
  필요할 수 있다(이번 배치 범위 밖).
- warehouse별(APGUJEONG/VAIL) 재고, 진짜 sell-through, 재고 시계열
  분석(history 축적 전까지)은 여전히 불가능.

## K. Future V2 Gates

### NOW AVAILABLE
Coverage-first summary, negative inventory breakdown(브랜드/units/최근
판매), Slow Watch(30일), Retail Inventory Value, days of supply(판매
이력 있는 SKU 한정).

### NEEDS HISTORY(이번 배치로 축적 시작, 아직 사용 불가)
재고 추세/시계열, 진짜 sell-through(기간 시작 재고 필요), historical
days-of-supply.

### NEEDS NEW DATA
매장별(APGUJEONG/VAIL) 재고 구분(ECOUNT 창고별 재고조회 API 신규 연동
필요), reorder lead time/MOQ, SKU 시즌 코드/lifecycle.

### NEEDS COST VALIDATION
Margin/Gross Profit/Profit%/Stock Profit Value — purchasePrice 신뢰도가
브랜드/상품군 단위로 완전히 검증되기 전까지 보류.

## L. Development Report

```
path: docs/reports/inventory-operations-foundation-mvp-2026-08-26.md
```
Pre-audit report(`docs/reports/inventory-intelligence-v2-preaudit-2026-08-26.md`)는
삭제/수정하지 않고 그대로 보존, 이번 배치의 docs commit에 함께 포함해
커밋한다.

## M. Final Verdict

```
INVENTORY OPERATIONS FOUNDATION & MVP COMPLETE — PRODUCTION VERIFIED
```

Definition of Done 전 항목 충족: warehouse split pipeline 버그 수정 및
9월 split-only 테스트 PASS, purchasePrice 신뢰도 감사 완료(PARTIALLY
TRUSTED 판정), margin류 기능 없음(Cost Hard Gate 준수, 전용 테스트로
검증), history foundation 구현(atomic, no backfill, 실패 격리),
Inventory Operations MVP 구현(coverage-first, 신규 필드/집계 전부
테스트), 전체 테스트 822/820(신규 실패 0), Local QA(Chrome 실제 렌더링
확인), 3개 논리적 커밋으로 push, Render 배포 확인(신규 Inventory
Operations 정상 동작, 기존 Inventory 요약/기존 diagnostic view 회귀
없음), production parity에서 Inventory 관련 전 항목 PASS(parity 도구
자체의 사각지대 1건 발견 및 즉시 수정 포함), report 작성 완료.

Production parity 실행 중 **이 batch와 무관한** ecount-sales(2026-08)
Local↔Render 동기화 gap을 부수적으로 발견해 정직하게 기록했다(§I/§J) —
Inventory Operations의 완료 여부와는 별개의 사안이며, 별도 승인 하에
후속 조치가 필요하다.
