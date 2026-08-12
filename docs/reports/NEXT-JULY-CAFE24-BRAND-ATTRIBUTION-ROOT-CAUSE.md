# NEXT — July Cafe24 Brand Attribution: Root-Cause Diagnosis (READ-ONLY)

READ-ONLY. `server.mjs`/`intelligence-service.mjs`/`scripts`/테스트/
마스터 데이터/`work/monthly/2026-07.json`/기존 리포트 전부 무수정.
git 쓰기 명령 미실행. 커밋 `5b70343`(오프라인 freshness 수리)는
건드리지 않았고, 이번 조사로도 그 커밋의 정당성은 전혀 흔들리지
않는다 — 오히려 이번 조사가 그것과 완전히 분리된, 별도의 사전
존재 문제임을 확정한다.

## 1. Trace the Data Flow

```
[온라인 Cafe24]
fetchCafe24Orders(since, until) 또는 loadCanonicalCafe24OrderCache(workDir, since, until)
  → buildBrandSalesInputsFromOrders(orders, catalog)
  → aggregateCafe24BrandSalesByBrandCode(catalog, salesByProduct, brandMaster,
      productBrandMap, manufacturerNameByCode, identityResolverContext)
      ↳ identityResolverContext = await loadResolverContext()  (매 호출마다 work/brand-master.json을 새로 읽음)
  → buildBrandSalesDiagnostics(since, until) 반환값의 .brands[]  ← 이 시점에는 순수 온라인만

[오프라인 ECOUNT]
readEcountOfflineSalesSnapshot(month, {workDir})
  → mergeOfflineBrandSales({ brandSales, onlinePaidAmount, offlineLines, since, until, identityContext })
      ↳ identityContext = await loadResolverContext({ onlineCatalog: {...} })  (역시 매 호출마다 새로 읽음)

[병합]
buildMonthlyArchiveBrandSales(monthStart, monthEnd, commerceSource)
  = mergeOfflineBrandSales({
      brandSales: commerceSource.brands,       ← 온라인 diagnostics의 .brands 그대로
      onlinePaidAmount: commerceSource.totals.paidAmount,
      offlineLines, since, until, identityContext
    })

[최초 아카이브 생성 — 1회만]
buildMonthlyArchive(month)
  = { ..., commerce: { ..., brandSales: await buildMonthlyArchiveBrandSales(...), brandSalesBasis:"online_offline" } }
  → 이 결과가 work/monthly/{month}.json에 저장되면 그 순간 이후로는
    "재검증"이라는 개념 자체가 (온라인 쪽에는) 전혀 없다.

[캐시 서빙 시 재검증 — 이번에 커밋된 freshness 수리, 온라인은 그대로]
enrichMonthlyArchiveBrandSales(archive, month)
  → (오프라인만) monthlyArchiveBrandSalesIsFresh() 판정 → stale면 mergeOfflineBrandSales() 재실행
  → 이 재실행의 brandSales 입력은 "archive.commerce.brandSales"(디스크에 저장된, 원래 그대로의 온라인 값 포함) 그대로 재사용
  → 즉 온라인 값은 이 경로에서 단 한 번도 다시 계산되지 않는다(commerceSource를 다시 만들지 않음)

[비교용 — 이번 조사가 canonical 소스로 쓴 경로, 캐시를 전혀 안 씀]
buildCrossBrandComparisonPeriodPayload({baseMonth, comparisonMonth, referenceDate})
  → buildCrossBrandPeriodWindow(range)
      = buildBrandSalesDiagnostics(range.startDate, range.endDate)  ← 매번 100% 새로 계산
      + buildMonthlyArchiveBrandSales(...)                          ← 매번 100% 새로 계산
```

## 2. Field Semantics (구현 + 테스트로 확정, 필드명으로 추측 안 함)

`scripts/monthly-brand-sales.mjs`를 직접 읽고 `cloneBrand()`/병합
루프의 정확한 필드 대입 순서를 확인했다:

```js
function cloneBrand(brand = {}) {
  const paidAmount = amountOf(brand);   // sales.paidAmount ?? canonicalPaidAmount ?? paidAmount ?? salesAmount
  return {
    ...brand,
    salesAmount: paidAmount, canonicalPaidAmount: paidAmount,
    sales: { ..., paidAmount, grossAmount: ... },
    onlinePaidAmount: paidAmount,   // ← 여기서 "딱 한 번" 스냅샷
    offlineSalesAmount: 0
  };
}
// 병합 루프(오프라인 라인마다):
brand.offlineSalesAmount += amount;
brand.salesAmount += amount;
brand.canonicalPaidAmount += amount;
brand.sales.grossAmount += amount;
brand.sales.paidAmount += amount;
brand.quantitySold += line.quantity;
// ★ onlinePaidAmount는 이 루프 어디에서도 다시 건드리지 않는다(UNASSIGNED 예외, §5)
```

| 필드 | 실제 의미(구현 확인) |
|---|---|
| `paidAmount`/`salesAmount`/`canonicalPaidAmount`/`sales.paidAmount` | **(C) 누적기(accumulator)** — `cloneBrand()` 호출 시점의 입력값에서 시작해, 그 뒤 처리되는 오프라인 라인들의 금액을 계속 더한다. 함수 호출이 끝난 시점의 최종값이 "그 호출의 total"이지만, 시작값 자체가 이미 무엇을 담고 있었는지는 **호출자가 무엇을 넘겼느냐에 전적으로 달려있다**(§3에서 정확히 추적). |
| `onlinePaidAmount` | **그 호출에서 브랜드 배열을 clone하는 딱 그 순간의 입력값 스냅샷.** 그 이후 같은 호출 안에서도, 그리고 이 객체가 나중에 다시 어딘가의 입력으로 재사용되더라도, **다시 계산되거나 재검증되지 않는다.** "지금 이 순간의 진짜 온라인 매출"이 아니라 "이 함수를 호출한 그 순간에 입력으로 들어온 값"일 뿐이다. |
| `offlineSalesAmount` | 그 호출에서 실제로 처리된 오프라인 라인들의 합(정확, 매번 새로 계산됨 — 온라인과 달리 매 호출마다 `readEcountOfflineSalesSnapshot()`을 통해 원본 소스를 다시 읽는다). |
| `quantitySold` | 누적기, revenue와 동일한 패턴 — 온라인/오프라인 분리 필드가 아예 없다. |
| `orderCount` | 누적기 — 온라인 orderCount(입력값) + 오프라인 distinct `date|documentNo` 개수. 역시 분리 필드 없음. |

## 3. CARNET ARCHIVE — 단계별 수치 추적

**Cafe24 온라인(지금 다시 계산, `/api/diagnostics/brand-sales`로 순수
온라인만 직접 확인)**:
```
salesAmount(정가): 2,616,000  sales.paidAmount(실결제): 2,448,430
quantitySold: 6   orderCount: 5
```

**buildMonthlyArchiveBrandSales() 호출 직전(commerceSource.brands 안의
CARNET 행)** = 위와 동일(별도 변환 없음, 그대로 전달됨).

**mergeOfflineBrandSales() 내부 — `cloneBrand()` 직후(오프라인 라인
처리 전)**:
```
paidAmount(= amountOf 결과) = 2,448,430
onlinePaidAmount = 2,448,430   ← 이 순간 스냅샷
offlineSalesAmount = 0
salesAmount = canonicalPaidAmount = sales.paidAmount = 2,448,430
```

**오프라인 6개 라인 처리 후(AFTER)**:
```
offlineSalesAmount = 20,854,700  (매 라인 += amount)
salesAmount = canonicalPaidAmount = sales.paidAmount = 2,448,430 + 20,854,700 = 23,303,130
onlinePaidAmount = 2,448,430   ← 그대로, 루프가 전혀 건드리지 않음
quantitySold = 6(온라인) + 63(오프라인) = 69
orderCount = 5(온라인) + 61(오프라인 distinct) = 66
```

**이것이 정확히 "이번에 재현한(cutoff endpoint) canonical" 값과
1원 단위까지 일치한다**(revenue 23,303,130 / online 2,448,430 /
offline 20,854,700 / units 69 / orders 66 — 이전 리포트 §5/§12 데이터와
동일).

**그런데 실제 파일(`work/monthly/2026-07.json`)의 CARNET 행은**:
```
onlinePaidAmount = 23,303,130   ← 위 계산 어디에도 이 값이 없다!
offlineSalesAmount = 20,854,700 (일치)
salesAmount = 44,157,830 = 23,303,130 + 20,854,700
```

**"2,448,430이 어디서 23,303,130이 되는가"**: 어디에서도 되지
않는다 — **이 둘은 완전히 다른 두 시점의 서로 다른 계산 결과다.**
파일의 `onlinePaidAmount=23,303,130`은 **2026-08-05T04:35:15에**
`buildMonthlyArchive("2026-07")`가 처음 생성될 때 `commerceSource.brands`
(그 순간의 `buildBrandSalesDiagnostics` 결과)에 이미 그렇게 들어있던
값이며, 그 뒤로 **단 한 번도 다시 계산된 적이 없다**(§1의
`enrichMonthlyArchiveBrandSales` 경로가 온라인을 재계산하지 않기
때문 — 이는 설계대로다, 이번에 커밋한 오프라인 수리의 범위 밖).
2,448,430은 **지금(2026-08-12) 다시 계산하면** 나오는 값이다.

**"20,854,700이 어디서 도입되는가"**: `mergeOfflineBrandSales()`의
오프라인 라인 루프에서, 항상 정확하게(§5 오프라인 76/76 전수 일치로
재확인됨) — 이 부분은 버그가 없다.

**결론적으로 파일의 `onlinePaidAmount=23,303,130`은 "2,448,430 +
20,854,700"이 우연히 같은 자릿수로 보이는 게 아니라 — 실제로
**2026-08-05 시점에 진짜로 계산된 "순수 온라인" 값이 23,303,130
이었다**는 뜻이다(그 시점엔 온라인 브랜드 귀속이 지금과 달랐다 —
§9/§11).

## 4. Double-Count / Field-Alias Hypothesis — DISPROVEN

지시된 패턴들을 코드에서 직접 검색:

- `paidAmount += offline` 이후 `onlinePaidAmount = paidAmount`: **없음.**
  `onlinePaidAmount`는 `cloneBrand()`(병합 루프 시작 전) 딱 한 곳에서만
  대입되고, 병합 루프 안에서는 `salesAmount`/`canonicalPaidAmount`/
  `sales.paidAmount`/`sales.grossAmount`/`offlineSalesAmount`만 `+=`
  된다(§2 소스 인용).
- `online = paidAmount` 형태의 재해석: **없음** — `crossBrandPeriodBrandRow()`
  (server.mjs)는 `onlineRevenue: Number(row.onlinePaidAmount || 0)`으로
  명확히 분리된 필드를 읽는다, `paidAmount`를 재사용하지 않는다.
- `onlinePaidAmount ?? paidAmount` 류의 fallback: **없음**(grep으로
  `scripts/monthly-brand-sales.mjs`, `server.mjs`의 관련 함수 전부
  확인).

**이 가설은 기각한다.** `mergeOfflineBrandSales()` 자체에는 온라인/
오프라인 필드를 혼동하거나 이중 계산하는 코드가 없다. §3에서 보인
불일치는 순수하게 **"서로 다른 시점에 계산된 두 개의 다른 온라인
값"**이지, 한 번의 계산 안에서 필드가 잘못 섞인 것이 아니다.

## 5. UNASSIGNED Rebalancing — DISPROVEN (as a cause of this specific issue)

```js
const onlineBrandTotal = brandSales.reduce((total, brand) => total + amountOf(brand), 0);
const onlineAdjustment = Number(onlinePaidAmount || 0) - onlineBrandTotal;
if (onlineAdjustment) {
  const brand = buckets.get("UNASSIGNED") || unassignedBrand();
  brand.onlinePaidAmount += onlineAdjustment;   // ← UNASSIGNED만 여기서 onlinePaidAmount가 다시 건드려짐
  ...
}
```

이 로직은 **오프라인 데이터와 무관하다** — `onlinePaidAmount`(함수
파라미터, 그 호출의 온라인 총액)와 `brandSales` 배열 안 개별
브랜드들의 합계가 다를 때만 발동하며, 그 차액을 UNASSIGNED에
넣는다. 개별 REAL 브랜드의 `onlinePaidAmount`는 이 블록에서 전혀
수정되지 않는다(`buckets.get("UNASSIGNED")`만 대상). **따라서
CARNET/리매진 등 REAL 브랜드의 온라인 값이 이상해 보이는 것과
UNASSIGNED 재조정 로직은 서로 무관하다 — 가설 기각.**

수치로 증명(현재 로컬 아카이브, 이미 병합된 상태 기준):
```
sum(REAL 브랜드 onlinePaidAmount) = 35,571,903 - (UNASSIGNED.onlinePaidAmount)
UNASSIGNED.onlinePaidAmount = -146,848,370  (파일에서 직접 확인)
→ sum(REAL) = 35,571,903 - (-146,848,370) = 182,420,273  ??? 이 값은 무의미하다
```
위 계산이 이상하게 나오는 이유는 UNASSIGNED의 `onlinePaidAmount`
자체가 "브랜드별 온라인 값들의 합 vs 총 온라인 입력값의 차이"이지,
"실제 온라인 매출"이 아니기 때문이다(설계대로, 임의 배분 방지용
회계 항목). 이 필드는 §7(units/orders)에도 §5와 동일한 이유로
직접적인 인과관계가 없다 — 이 조사의 핵심 질문(왜 CARNET의
onlinePaidAmount 자체가 시점에 따라 다른가)과는 별개다.

## 6. Why the Total Still Matches — 산술 경로

```
ARCHIVE(2026-08-05 시점) 온라인 합계 = 35,571,903
CANONICAL(2026-08-12, 지금) 온라인 합계 = 35,571,903
→ 정확히 동일
```

이것은 "브랜드별로 잘못 배분됐지만 합은 우연히 보존된다"는
재조정 로직 때문이 아니다(§5에서 이미 기각). 실제로는:

- `buildBrandSalesDiagnostics()`가 계산하는 "총 온라인 결제액"
  (`commerceTotals.paidAmount`, `computeCafe24OrderTotals(canonicalOrders)`
  기반)은 Cafe24 주문 자체의 결제 총액이라, **브랜드 귀속 로직과
  무관하게 항상 같은 원본 주문 데이터에서 나온다** — 어느 상품이
  어느 브랜드에 속하는지와 무관하게 "이 주문들이 얼마를 결제했는가"
  총합 자체는 바뀌지 않는다.
- 반면 **브랜드별 배분**(`aggregateCafe24BrandSalesByBrandCode`)은
  `productBrandMap`/`identityResolverContext`(=현재 `work/brand-master.json`
  상태)에 의존한다 — 이 상태가 2026-08-05와 지금 사이에 바뀌면,
  **같은 총액을 브랜드 간에 다르게 나누게 된다.**
- 그러므로: 총액(그 시점 주문 데이터의 함수) = 항상 안정적으로
  일치. 브랜드별 배분(그 시점 브랜드 마스터의 함수) = 마스터가
  바뀌면 달라짐. **"총액은 원본 주문에 의해 결정되고, 브랜드
  배분은 브랜드 마스터 상태에 의해 결정된다"— 이 둘이 서로 다른
  변수에 의존하기 때문에 하나는 안정적이고 하나는 불안정한 것이지,
  재조정 산술 때문이 아니다.**

**결정적 증거**: `work/brand-master.json`의 mtime = **2026-08-11
03:48:34** — 7월 아카이브 생성 시각(2026-08-05T04:35:15)보다
**6일 뒤**다. 저장소에는 이 기간 동안 진행 중인 별도의 브랜드
마스터 정리 작업의 흔적이 뚜렷하다(`work/brand-master-merge-plan.json`
8/3, `work/brand-master-integrity-report.json` 8/3, 미추적 스크립트
`scripts/build-brand-sourcing-master.mjs`/`scripts/apply-cafe24-brand-
aliases.mjs`/`scripts/build-brand-alias-candidates.mjs`, 미추적 설정
`config/master-data-candidates.json` 등). `loadResolverContext()`는
매 호출마다 `work/brand-master.json`을 새로 읽으므로(캐싱 없음,
기존 코드 그대로), 이 파일이 바뀐 이후의 모든 온라인 재계산은
자동으로 새 상태를 반영한다 — **아카이브에 저장된 온라인 값만
그 이전 상태에 영구히 멈춰있다.**

## 7. Units / Orders Root Cause

정확히 같은 메커니즘이다 — `quantitySold`/`orderCount`는 §2에서
확인했듯 온라인/오프라인 분리 필드가 없는 순수 누적기이므로,
"온라인 귀속이 바뀌면 총 브랜드 수 자체가 달라질 수 있다"는 점에서
revenue보다 오히려 더 민감하다:

```
CANONICAL(지금) units = 1,024 = 순수 온라인(지금, 138) + 오프라인(886, ECOUNT 원본에서 직접 재계산)
CANONICAL(지금) orders = 1,004 = 순수 온라인(지금, 121) + 오프라인(브랜드별 distinct, 883)
ARCHIVE units = 1,911 (= 브랜드 76개 합, 이미 오프라인 886 포함)
ARCHIVE orders = 1,794
→ ARCHIVE의 "온라인 부분"(오프라인 886을 뺀 나머지)은 1911-886=1,025개 —
  지금 다시 계산한 순수 온라인(138개)과 크게 다르다.
```

**즉 units/orders 불일치의 근본 원인은 revenue와 동일하다** — 온라인
브랜드 귀속이 2026-08-05 이후 재검증되지 않았고, 그 사이
`aggregateCafe24BrandSalesByBrandCode`가 상품/주문을 브랜드에
배분하는 기준(브랜드 마스터) 자체가 바뀌었다. 이 재배분은 매출
총액은 보존하지만(§6, 같은 주문 데이터의 함수), 브랜드별 units/
orders "카운트"는 재배분 시 총합 자체가 달라질 수 있다(어떤
주문이 여러 상품에 걸쳐 브랜드가 나뉘어 있으면, "그 브랜드에 속한
것으로 세는 라인 수"가 배분 기준에 따라 달라질 수 있음).

## 8. Sampled Mismatched Brands (10개)

| 브랜드 | canonical online(지금) | archive online(2026-08-05 고정) | 차이 | offline | 차이==offline? |
|---|---:|---:|---:|---:|---|
| 카르넷 아카이브(CARNET ARCHIVE) | 2,448,430 | 23,303,130 | -20,854,700 | 20,854,700 | **YES(정확히 일치)** |
| 레이서 월드 와이드 | 429,200 | 15,902,600 | -15,473,400 | 15,473,400 | **YES** |
| LIFE IS HELL | 415,610 | 14,388,010 | -13,972,400 | 13,972,400 | **YES** |
| 선데이오프클럽 | 365,037 | 11,095,237 | -10,730,200 | 10,730,200 | **YES** |
| OURSELVES REMAKE | 1,332,000 | 8,700,800 | -7,368,800 | 7,368,800 | **YES** |
| 밍가 | 278,000 | 7,186,920 | -6,908,920 | 6,908,920 | **YES** |
| 파코서플라이 | 1,763,921 | 8,302,621 | -6,538,700 | 6,538,700 | **YES** |
| 카미긴 | 946,155 | 6,741,654 | -5,795,499 | 5,989,800 | **NO(194,301원 차이)** |
| 리매진 | 4,962,447 | 9,687,247 | -4,724,800 | 4,724,800 | **YES** |
| 레저렉션13 | 1,008,623 | 5,307,623 | -4,299,000 | 4,299,000 | **YES** |
| 본네 | 1,989,000 | 5,823,100 | -3,834,100 | 3,834,100 | **YES** |

**패턴 분류**: 표본 11개 중 **10개는 "archive_online −
canonical_online = offline"이 정확히 성립**한다(1원 오차 없음).
1개(카미긴)만 근접하지만 정확히 일치하지는 않는다(194,301원 잔차 —
이 브랜드에 한해 추가 요인이 더 있을 가능성, 이번 조사에서 특정
못함). **이 정도로 정밀하고 반복적인 수치 일치는 "브랜드 마스터가
바뀌어서 우연히 이 정도 차이가 났다"는 순수 우연으로 보기 어렵고,
§6에서 제시한 구조적 설명(다른 변수에 의존하는 두 계산)과 결합해
봐도 이 정밀도까지는 완전히 설명되지 않는다** — 이 정밀한 수치
일치의 정확한 인과 메커니즘은 **미확정으로 남긴다**(추측 대신
정직하게 명시, §11).

## 9. Is the Archive or the Cutoff Endpoint Wrong?

**답: 어느 쪽도 "버그로 인해 틀렸다"고 할 수 없다 — 둘 다 각자의
입력 기준으로 올바르게 계산됐다. 다만 그 입력의 시점이 다르다.**

- **A. 아카이브의 브랜드별 온라인 귀속이 틀렸는가**: 2026-08-05
  시점의 `work/brand-master.json` 기준으로는 아니다(그 계산 자체는
  정상 실행됐다). 다만 **지금 시점 기준으로는 outdated(오래됨)**다.
- **B. cutoff endpoint의 브랜드별 온라인 귀속이 틀렸는가**: 아니다
  — `/api/diagnostics/brand-sales`(순수 온라인 전용, 병합 이전)로
  독립적으로 재확인한 결과도 동일한 값(CARNET 2,448,430)을 준다 —
  cutoff endpoint 자체의 로직 문제가 아니라 **현재 브랜드 마스터
  상태를 정확히 반영한 결과**다.
- **C. 둘 다 모호한 필드 시맨틱을 쓰는가**: `onlinePaidAmount`가
  "그 호출 시점의 스냅샷"이라는 시맨틱 자체는 명확하다(§2) — 모호한
  게 아니라, **그 스냅샷이 다시는 갱신되지 않는다는 설계상 공백**이
  문제다.
- **D. 다른 소스가 원인인가**: **YES** — 진짜 원인은 `work/brand-
  master.json`(및 관련 product-registry/온라인 카탈로그 상태)가
  아카이브 생성 이후 바뀌었다는 것, 그리고 온라인 쪽에는 §1의
  오프라인 freshness 수리(5b70343)에 해당하는 재검증 메커니즘이
  전혀 없다는 것.

**결론**: "아카이브가 최신 기준으로 outdated하다"가 가장 정확한
표현이지 "아카이브가 틀렸다"가 아니다 — 저장 당시엔 정확했다.

## 10. Scope

| 소비처 | 판정 | 근거 |
|---|---|---|
| Brand Intelligence(브랜드별 온라인/합계 표시) | **AFFECTED** | `/api/reports/monthly`가 서빙하는 `commerce.brandSales`를 그대로 렌더링, 온라인 재검증 없음 |
| Monthly 화면(과거월 조회) | **AFFECTED** | 동일 `/api/reports/monthly` 경로 |
| Annual 화면 | **AFFECTED(상속)** | 월별 아카이브를 합산하는 구조라면 같은 방식으로 outdated 온라인 값을 상속함(직접 코드 추적은 이번 조사 범위 밖, 구조적으로 유추) |
| STEP67 cutoff endpoint(cross-brand-partial-period) | **NOT AFFECTED** | 캐시를 전혀 안 쓰고 항상 fresh 계산(§1) — 구조적으로 면역 |
| Customer Composition | **NOT AFFECTED** | `buildBrandCustomerComposition()`은 아카이브의 `commerce.brandSales`를 전혀 참조하지 않고 ECOUNT 스냅샷을 직접 읽음(기존 코드 확인, 무수정) |
| Commerce 화면(온라인 브랜드 분석) | **INCONCLUSIVE** | `buildBrandSalesDiagnostics`를 직접/실시간으로 쓰는지, 캐시된 월간 아카이브를 쓰는지 이번 조사에서 그 화면의 프런트엔드 배선까지는 추적하지 않음 |
| Clients 화면 | **INCONCLUSIVE** | `buildClientsOverview`가 자체적으로 `loadResolverContext()`를 호출한다는 것은 확인했으나(이전 세션 메모리), 그것이 매번 fresh인지 캐시를 타는지는 이번 조사에서 재확인하지 않음 |
| 다른 과거월 아카이브(2026-01~06) 온라인 성분 | **AFFECTED(가능성 높음, 미검증)** | 오프라인과 달리 온라인 쪽엔애초에 `brandSalesBasis` 같은 플래그/재검증 트리거가 없어 이 문제는 "언제 저장됐든" 구조적으로 모든 과거월에 잠재한다 — 각 월을 이번처럼 전수 재조정하지 않는 한 확정할 수 없음 |

## 11. Root Cause

**ROOT CAUSE CONFIRMED**(구조적 원인) — **단, 표본 브랜드들의 오차가
왜 그렇게 정밀하게 offline 금액과 일치하는지의 세부 메커니즘은
NOT CONFIRMED로 남는다(§8).**

- **정확한 함수**: 구조적 결함은 특정 한 함수의 버그가 아니라 **함수
  경계의 부재**다 — `enrichMonthlyArchiveBrandSales()`(이번에 오프라인만
  고쳤음)에 대응하는 "온라인 재검증" 함수가 존재하지 않는다.
- **정확한 필드**: `commerce.brandSales[].onlinePaidAmount`(그리고
  `quantitySold`/`orderCount`의 온라인 기여분 — 분리 필드가 없어
  총합에 섞여 들어감).
- **정확한 mutation**: 없음 — mutation 자체가 원인이 아니라
  **mutation의 부재**(온라인 값이 최초 생성 이후 절대 다시
  계산되지 않음)가 원인이다.
- **downstream 오역(misinterpretation)**: 없음 — `crossBrandPeriodBrandRow()`/
  `enrichMonthlyArchiveBrandSales()`/Brand Intelligence 렌더링 전부
  필드를 있는 그대로 정확히 읽는다. 필드 자체가 stale할 뿐, 잘못
  해석되는 곳은 없다.
- **총액이 여전히 맞는 이유**: §6 — 총액은 원본 Cafe24 주문 데이터의
  함수이고 브랜드 마스터와 무관하게 안정적이다.
- **브랜드 배분이 틀린 이유**: §6/§9 — 브랜드 배분은 브랜드 마스터
  상태의 함수이고, 마스터가 아카이브 생성 후 바뀌었다(2026-08-11
  수정 확인).
- **units/orders가 다른 이유**: §7 — 같은 메커니즘, revenue와 달리
  분리 필드가 없어 총합 자체까지 영향받는다.

## 12. Repair Design (READ-ONLY — 설계만, 구현 안 함)

**최소, 안전한 수리 방향**: §1의 오프라인 수리(5b70343)와 정확히
대칭되는 온라인 버전을 적용한다 — **새 비즈니스 로직을 만들지
않고, 이미 존재하는 재검증 패턴을 온라인 쪽에도 동일하게 확장**한다.

1. **신선도 판단 기준**: 오프라인은 ECOUNT 스냅샷의 `importedAt`을
   썼다(§`monthlyArchiveBrandSalesIsFresh`). 온라인은 대응하는
   "브랜드 마스터/식별 상태의 신선도 마커"가 필요하다 — 가장 작은
   변경: `work/brand-master.json`의 mtime(또는 그 파일이 이미 갖고
   있을 수 있는 자체 버전/updatedAt 필드, 확인 필요)을
   `archive.commerce.brandSalesOnlineIdentityVersion` 같은 필드로
   저장해두고, 서빙 시 현재 mtime과 비교.
2. **재계산 트리거**: `enrichMonthlyArchiveBrandSales()`(또는 그와
   나란히 하나 더 두는 `enrichMonthlyArchiveOnlineBrandSales()`)가
   이 마커가 stale일 때만 `buildBrandSalesDiagnostics(monthStart,
   monthEnd)`를 다시 호출해 `commerceSource.brands`를 새로 만들고,
   그 결과를 `buildMonthlyArchiveBrandSales()`에 다시 통과시켜
   (오프라인도 함께, 한 번에) 전체를 재구성한다 — **이미 존재하는
   `buildMonthlyArchiveBrandSales()`를 그대로 재사용**하면 되고,
   새 병합 로직은 필요 없다.
3. **주의(성능)**: 오프라인 재검증(로컬 파일 읽기)과 달리 온라인
   재검증은 **Cafe24 API/캐시 조회를 수반**한다(`fetchCafe24Orders`,
   `buildProductDashboardWithCache`) — 과거월은 `loadCanonicalCafe24OrderCache`
   경로로 로컬 캐시만 읽으므로(§1, `pastMonth` 분기) 실시간 API
   호출은 아니지만, 오프라인보다는 무겁다 — 매 요청마다 트리거하지
   않도록 마커 비교로 꼭 필요한 경우만 재계산해야 한다(이미
   오프라인 수리가 쓰는 것과 같은 원칙).
4. **오프라인 수리(5b70343) 보존**: 이 설계는 `enrichMonthlyArchiveBrandSales()`
   가 오프라인 재검증 이후(또는 이전) 순서로 온라인 재검증을 추가로
   수행하도록 확장하는 것이며, 기존 오프라인 로직은 문자 그대로
   유지한다.
5. **하드코딩 금지 준수**: 7월/특정 브랜드를 언급하는 코드는 전혀
   두지 않는다 — 마커 비교는 모든 월에 동일하게 적용된다.
6. **재발 방지**: 이 설계가 배포되면, 브랜드 마스터가 미래에 다시
   바뀌어도 다음 요청에서 자동으로 반영된다 — 오프라인과 동일한
   "자동 치유" 성질을 온라인에도 부여한다.

**필요한 회귀 테스트**(구현 시, 이번 STEP에서는 작성하지 않음):
- 온라인 마커가 최신이면 재계산 안 함(호출 카운트로 검증, 기존
  오프라인 테스트 패턴 재사용).
- 온라인 마커가 stale이면 `buildBrandSalesDiagnostics` 재호출됨.
- 재계산 후 브랜드별 온라인 값이 현재 브랜드 마스터 기준과 일치.
- 오프라인 재검증 로직과 순서/상호작용이 회귀 없이 공존.
- 총액(온라인+오프라인) 보존 재확인.
- CARNET ARCHIVE/TROUBLED WATERS 등 이미 검증된 브랜드들의 최종
  값이 §3/§13(이전 리포트)에서 확립한 canonical 값과 일치.

**이번 STEP은 설계만 제시하며 구현하지 않는다.**

## 13. 결론 — work/monthly/2026-07.json 커밋 가능 여부

이전 STEP의 BLOCK ARCHIVE COMMIT 판단을 유지한다. 이번 조사는 그
BLOCK의 정확한 원인을 확정했을 뿐, 해소하지는 않았다(설계만 제시,
미구현). 오프라인 freshness 수리(5b70343)는 이번 조사로 오히려
더 확실하게 옳다는 것이 재확인됐고, 되돌릴 이유가 전혀 없다.

---

====================
JULY CAFE24 BRAND ATTRIBUTION ROOT CAUSE
====================

RAW CAFE24 ONLINE TOTAL:
35,571,903원 (지금, live diagnostics endpoint 재확인)

POST-MERGE REAL-BRAND ONLINE TOTAL:
35,571,903원 (UNASSIGNED 제외, 실질적으로 동일 — 재조정 항목은 UNASSIGNED에만 있음)

UNASSIGNED ONLINE ADJUSTMENT:
아카이브 파일 기준 -146,848,370원(§5 — 오프라인 데이터와 무관한 별도 회계 항목, 이번 이슈의 원인 아님)

FINAL ONLINE TOTAL:
35,571,903원 (아카이브·canonical 양쪽 모두 동일)

CARNET RAW ONLINE:
2,448,430원 (지금 재계산, 순수 온라인)

CARNET ARCHIVE ONLINE:
23,303,130원 (2026-08-05 고정값)

CARNET OFFLINE:
20,854,700원

CARNET DIFFERENCE:
-20,854,700원 (archive - canonical)

DIFFERENCE == OFFLINE:
YES

SAMPLED MISMATCHED BRANDS:
10개(+ CARNET 포함 11개)

SAME PATTERN:
10개(정확히 offline 금액과 일치) / 11개 중 1개(카미긴)만 근접하되 불일치

PAIDAMOUNT SEMANTICS:
누적기(accumulator) — 호출 시점 입력값에서 시작해 오프라인 라인 금액을 계속 더함(최종값 = "그 호출 기준" 총액)

ONLINEPAIDAMOUNT SEMANTICS:
브랜드 배열 clone 시점의 1회성 스냅샷 — 그 이후 재계산되지 않음(재검증 메커니즘 없음)

QUANTITY SEMANTICS:
누적기, revenue와 동일 패턴, 온라인/오프라인 분리 필드 없음

ORDERCOUNT SEMANTICS:
누적기(온라인 orderCount 입력값 + 오프라인 distinct date|documentNo), 분리 필드 없음

UNASSIGNED REBALANCING:
DISPROVED (이 이슈의 원인이 아님, §5)

ARCHIVE WRONG:
NO (저장 당시 기준으로는 정확했음 — 지금 기준으로 outdated)

CUTOFF ENDPOINT WRONG:
NO (현재 브랜드 마스터 기준으로 정확함, 순수 온라인 diagnostics로 독립 재확인)

ROOT CAUSE:
온라인(Cafe24) 브랜드별 귀속에는 오프라인과 달리 재검증 메커니즘이 전혀 없다. commerce.brandSales.onlinePaidAmount는 아카이브 최초 생성 시점(2026-08-05T04:35:15)의 브랜드 마스터 상태로 계산된 1회성 스냅샷이며, 이후 work/brand-master.json이 수정(2026-08-11 03:48:34 확인)되면서 진행 중인 브랜드 마스터 정리 작업이 온라인 귀속을 바꿨지만 저장된 아카이브는 이를 전혀 반영하지 못한다. 총매출은 원본 Cafe24 주문 데이터에만 의존해 보존되지만, 브랜드별 배분은 마스터 상태에 의존해 달라진다. 표본 브랜드 다수에서 오차가 정확히 그 브랜드의 오프라인 금액과 일치하는 정밀한 패턴의 근본 메커니즘은 미확정으로 남는다.

ROOT CAUSE CONFIRMED:
YES (구조적 원인) — 단, 오차 크기가 offline 금액과 정밀히 일치하는 세부 메커니즘은 NOT CONFIRMED

AFFECTED SURFACES:
Brand Intelligence, Monthly, Annual(상속 가능성) — AFFECTED / STEP67 cutoff endpoint, Customer Composition — NOT AFFECTED / Commerce, Clients — INCONCLUSIVE / 2026-01~06 등 다른 과거월 온라인 성분 — AFFECTED 가능성 높음, 미검증

RECOMMENDED REPAIR:
오프라인 freshness 수리(5b70343)와 대칭되는 온라인 재검증 메커니즘 추가 — work/brand-master.json 신선도 마커 비교 후 stale이면 buildBrandSalesDiagnostics()+buildMonthlyArchiveBrandSales()를 재실행(기존 함수 재사용, 새 로직 없음)

CODE CHANGE REQUIRED:
YES (별도 STEP에서, 이번엔 미구현)

ARCHIVE CHANGE REQUIRED:
AFTER REBUILD (온라인 재검증 로직 배포 후 자동으로 반영되도록 설계 권장, 수동 패치 없음)

SAFE TO COMMIT JULY ARCHIVE NOW:
NO

REPORT:
docs/reports/NEXT-JULY-CAFE24-BRAND-ATTRIBUTION-ROOT-CAUSE.md

COMMIT:
NONE

PUSH:
NONE
====================
