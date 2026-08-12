# NEXT — July Historical Online Snapshot Forensics (READ-ONLY)

READ-ONLY. 소스/테스트/아카이브/마스터 데이터/캐시/설정/기존 리포트
전부 무수정. git 쓰기 명령 미실행. 아카이브 재빌드 없음.

## 결론을 먼저 말한다 (Executive Summary)

**직전 리포트("brand-master drift가 원인")는 틀렸다. 정정한다.**

**SECOND MERGE(이중 병합) 가설이 코드와 숫자 양쪽에서 확정적으로
증명됐다.** 원인은 브랜드 마스터가 바뀐 것이 아니라, **이번에
커밋한 오프라인 freshness 수리(`5b70343`) 자체의 경계 조건 결함**
이다: `buildMonthlyArchive()`가 최초로 아카이브를 만들 때 이미
`mergeOfflineBrandSales()`를 정상적으로 한 번 성공시켜 오프라인을
포함한 결과를 만들어내는데, 그 시점에는 `brandSalesSourceImportedAt`
(내가 새로 추가한 신선도 마커)이 **함께 기록되지 않는다.** 그 결과
그 아카이브가 이후 `/api/reports/monthly`로 서빙될 때
`enrichMonthlyArchiveBrandSales()`는 "마커가 없다 = stale"로 오판해
**이미 온라인+오프라인이 합쳐진 값을 "순수 온라인"으로 착각하고
오프라인을 또 한 번 더한다.** 이것이 7월 브랜드 34개의 `salesAmount`
/`onlinePaidAmount`/`quantitySold`/`orderCount`를 정확히 오프라인
금액만큼 부풀렸고(11개 표본 중 10개 완전 일치), 그 왜곡을 상쇄하려는
기존 UNASSIGNED 재조정 로직이 거대한 음수값(-146,848,370)으로
나타난 것까지 전부 설명한다(§8).

**`5b70343`은 오프라인 신선도 개념 자체는 옳지만, 구현에 실제
버그가 있었다.** 로컬 미커밋 상태인 `work/monthly/2026-07.json`은
이 이중 계산으로 오염돼 있다 — 이전 STEP들의 BLOCK ARCHIVE COMMIT
판단은 옳았고, 이번 조사로 그 이유가 훨씬 더 정확하고 심각하게
확정됐다.

## 1. Find the Exact Origin of the Archive Snapshot

```
work/monthly/2026-07.json (현재 로컬):
  generatedAt: 2026-08-05T04:35:15.709Z   ← 단 한 번도 바뀐 적 없음(아래 증명)
```

`generatedAt`은 `buildMonthlyArchive()`가 `new Date().toISOString()`으로
매번 새로 찍는 필드이고(server.mjs), `enrichMonthlyArchiveBrandSales()`
는 `{...archive, commerce:{...}}` 형태로 archive 최상위 필드를 그대로
보존한다(`commerce` 서브객체만 교체) — 즉 **이 값이 여전히
2026-08-05T04:35:15.709Z라는 것 자체가 `buildMonthlyArchive("2026-07")`
가 그 이후 단 한 번도 다시 호출되지 않았다는 증거**다. 이 파일에
일어난 일은 정확히 두 단계뿐이다:

```
1. 2026-08-05T04:35:15.709Z — buildMonthlyArchive("2026-07") 최초 실행
   (ensurePreviousMonthlyArchiveSaved() 또는 /api/reports/monthly/archive를 통해)
   → writeMonthlyArchive("2026-07", {...archive, archiveStatus:"saved"})

2. 이번 세션(STEP "MONTHLY ARCHIVE FRESHNESS FIX" 구현 중) —
   GET /api/reports/monthly?month=2026-07 요청 1회
   → enrichMonthlyArchiveBrandSales(cached, "2026-07") 실행
   → (§3에서 증명) 잘못 stale로 판정 → mergeOfflineBrandSales() 재실행
   → writeMonthlyArchive("2026-07", {...enriched, archiveStatus:"saved"})
   (generatedAt은 그대로 보존됨, brandSales만 교체됨)
```

## 2. Historical Code at Snapshot Time

`git log --oneline -- server.mjs`:
```
5b70343 fix(monthly): refresh stale brand-sales archives   ← 이번에 내가 커밋
da1bc09 fix(brand-intelligence): normalize cross-brand partial-period comparison
79c4302 feat(monthly): automate offline sales refresh workflow  (2026-08-05 13:53, 아카이브 생성 직후)
4f6f827 feat(work-data): support master data uploads
```

`5b70343` 바로 이전(`da1bc09` 시점)의 `enrichMonthlyArchiveBrandSales()`
전문을 `git show da1bc09:server.mjs`로 직접 확인:

```js
async function enrichMonthlyArchiveBrandSales(archive, month) {
  if (archive?.commerce?.brandSalesBasis === "online_offline") return archive;
  ...
}
```

**이 OLD 코드는 플래그가 있으면 무조건 즉시 반환한다 — 어떤 재계산도
하지 않는다.** `buildMonthlyArchive()`는 병합 성공 여부와 무관하게
`brandSalesBasis: "online_offline"`을 항상 설정하므로, 2026-08-05
최초 생성 이후 이 OLD 코드가 실행될 때마다 **완전한 no-op**이었다
— 즉 **`5b70343` 이전에는 이 아카이브의 brandSales가 단 한 번도
다시 계산되지 않았다.** 재병합이 일어날 수 있었던 것은 오직
`5b70343`이 배포된 이후, 내가 도입한 새 신선도 판정 로직이 처음
실행됐을 때뿐이다. `buildMonthlyArchiveBrandSales()`/
`mergeOfflineBrandSales()`/`cloneBrand()`/`buildBrandSalesDiagnostics()`
자체는 이번 커밋에서 전혀 수정하지 않았다(diff 확인, 이전 리포트에서
이미 검증) — 로직은 항상 동일했고, **호출 여부와 호출 시점의
freshness 판정만 바뀌었다.**

## 3. "Second Merge" Hypothesis — CONFIRMED

`cloneBrand()`(scripts/monthly-brand-sales.mjs) 정확한 동작:

```js
function amountOf(brand = {}) {
  // 우선순위: sales.paidAmount → canonicalPaidAmount → paidAmount → salesAmount
}
function cloneBrand(brand = {}) {
  const paidAmount = amountOf(brand);
  return { ...brand, salesAmount: paidAmount, canonicalPaidAmount: paidAmount,
    sales: {..., paidAmount, grossAmount: ...},
    onlinePaidAmount: paidAmount,   // ★ 입력값을 그대로 "온라인"이라고 스냅샷
    offlineSalesAmount: 0 };        // ★ 오프라인은 항상 0으로 리셋(중요, §6)
}
```

`mergeOfflineBrandSales()`는 **자신에게 무엇이 입력되는지 전혀
모른다** — "순수 온라인"이든 "이미 온라인+오프라인이 합쳐진 총액"이든
구분할 방법이 없다. 함수는 그저 입력을 `paidAmount`/`onlinePaidAmount`로
스냅샷하고, 그 위에 오프라인 라인 금액을 더한다. **이것이 함수
자체의 버그가 아니라 "이 함수를 두 번째로 호출할 때 첫 번째 결과를
입력으로 넣으면 무조건 이중 계산된다"는 구조적 위험**이다 —
호출자가 "이 입력이 이미 병합된 결과인지" 알려줄 방법이 없다.

**CARNET ARCHIVE로 증명**:

```
[1차 병합 — 2026-08-05T04:35:15, buildMonthlyArchive() 내부]
  cloneBrand 입력(순수 Cafe24 온라인, buildBrandSalesDiagnostics 결과):
    paidAmount = 2,448,430
  → onlinePaidAmount = 2,448,430, offlineSalesAmount = 0(리셋)
  오프라인 6라인 처리 후:
    offlineSalesAmount = 20,854,700
    salesAmount = canonicalPaidAmount = sales.paidAmount = 2,448,430 + 20,854,700 = 23,303,130
    quantitySold = 6 + 63 = 69,  orderCount = 5 + 61 = 66
  → 이 결과가 work/monthly/2026-07.json에 저장됨(brandSalesBasis="online_offline",
    brandSalesSourceImportedAt 없음 — 이 필드 자체가 존재하지 않던 시절의 코드)

[2차 병합 — 이번 세션, enrichMonthlyArchiveBrandSales() 재실행]
  freshness 판정: brandSalesBasis==="online_offline"(true) &&
    monthlyArchiveBrandSalesIsFresh(archiveImportedAt=null, sourceImportedAt=있음)
    → archiveImportedAt이 falsy → false(STALE로 오판) → 재병합 강행
  cloneBrand 입력(1차 병합 결과 그 자체, archive.commerce.brandSales):
    amountOf(brand) = sales.paidAmount = 23,303,130   ← 이미 온라인+오프라인 합계!
  → onlinePaidAmount = 23,303,130(★ 오염 시작), offlineSalesAmount = 0(다시 리셋)
  오프라인 6라인을 "다시" 처리(같은 6개 라인, 같은 identityContext):
    offlineSalesAmount = 20,854,700(정상 — 리셋 후 1회만 더해짐, 오프라인 필드 자체는 안전, §6)
    salesAmount = canonicalPaidAmount = sales.paidAmount = 23,303,130 + 20,854,700 = 44,157,830
    quantitySold = 69 + 63 = 132,  orderCount = 66 + 61 = 127
```

**현재 파일의 실제 값과 완전히 일치**(revenue 44,157,830 / online
23,303,130 / offline 20,854,700 / units 132 / orders 127) — 1원, 1개
오차 없이 정확히 재현된다.

**units/orders도 동일 메커니즘으로 이중 반영됨을 확인**: §7.

## 4. Numeric Reproduction (요약, §3과 동일 데이터)

| 단계 | onlinePaidAmount | offlineSalesAmount | salesAmount(total) | quantitySold | orderCount |
|---|---:|---:|---:|---:|---:|
| RAW(순수 온라인) | 2,448,430 | — | 2,448,430 | 6 | 5 |
| 1차 병합 후 | 2,448,430 | 20,854,700 | 23,303,130 | 69 | 66 |
| 2차 병합 후(현재 파일) | **23,303,130** | 20,854,700 | **44,157,830** | **132** | **127** |

## 5. Repeat Across 11 Sample Brands

`raw_online`(지금 `/api/diagnostics/brand-sales`로 직접 재확인,
`sales.paidAmount`) / `offline`(현재 ECOUNT 기준 재계산) /
`firstMergeTotal = raw_online + offline` / 아카이브 실측값 비교:

| 브랜드 | raw online | offline | 1차 병합 합계 | archive online | archive total | onlineMatch | totalMatch(=raw+2×offline) |
|---|---:|---:|---:|---:|---:|---|---|
| 카르넷 아카이브 | 2,448,430 | 20,854,700 | 23,303,130 | 23,303,130 | 44,157,830 | ✓ | ✓ |
| 레이서 월드 와이드 | 429,200 | 15,473,400 | 15,902,600 | 15,902,600 | 31,376,000 | ✓ | ✓ |
| LIFE IS HELL | 415,610 | 13,972,400 | 14,388,010 | 14,388,010 | 28,360,410 | ✓ | ✓ |
| 선데이오프클럽 | 365,037 | 10,730,200 | 11,095,237 | 11,095,237 | 21,825,437 | ✓ | ✓ |
| OURSELVES REMAKE | 1,332,000 | 7,368,800 | 8,700,800 | 8,700,800 | 16,069,600 | ✓ | ✓ |
| 밍가 | 278,000 | 6,908,920 | 7,186,920 | 7,186,920 | 14,095,840 | ✓ | ✓ |
| 파코서플라이 | 1,763,921 | 6,538,700 | 8,302,621 | 8,302,621 | 14,841,321 | ✓ | ✓ |
| 카미긴 | 946,155 | 5,989,800 | 6,935,955 | 6,741,654 | 12,731,454 | ✗(194,301 차이) | ✗ |
| 리매진 | 4,962,447 | 4,724,800 | 9,687,247 | 9,687,247 | 14,412,047 | ✓ | ✓ |
| 레저렉션13 | 1,008,623 | 4,299,000 | 5,307,623 | 5,307,623 | 9,606,623 | ✓ | ✓ |
| 본네 | 1,989,000 | 3,834,100 | 5,823,100 | 5,823,100 | 9,657,200 | ✓ | ✓ |

**정확 일치: 11개 중 10개(91%).** 이 정도의 정밀도(1원 단위 완전
일치, 10개 서로 다른 브랜드에 걸쳐)는 "브랜드 마스터가 바뀌어서
우연히 비슷해졌다"는 설명으로는 설명 불가능하다 — SECOND MERGE
산술과 완전히 일치한다.

**카미긴(KAMIGIN, B0000BCQ) 예외**: 차이 194,301원(archive online이
1차 병합 예상치보다 작음). 원인을 특정하지 못했다 — raw online의
quantitySold/orderCount(3/3)가 다른 표본보다 작아 소수 라인의
개별 식별 결과에 민감했을 가능성, 혹은 이 브랜드의 오프라인 라인
중 일부가 내(2차 병합 시점)와 원 1차 병합 시점 사이에 identity
resolution 결과가 실제로 달라졌을 가능성(즉 이 브랜드 하나에
한해서는 §7 이전 리포트의 "브랜드 마스터 드리프트"가 부차적으로
겹쳤을 가능성)이 있으나, 확정하지 못했다 — **단일 예외로 남긴다.**

## 6. Historical Freshness Path

- **아카이브가 언제 오프라인 병합됨으로 처음 표시됐는가**:
  2026-08-05T04:35:15.709Z, `buildMonthlyArchive()`의 최초(그리고
  이번 세션 전까지 유일한) 실행에서. 이 1차 병합은 **성공적으로
  오프라인을 더했다**(§3) — 이는 원래(가장 첫 번째) 진단 리포트가
  "오프라인 병합이 CARNET에 대해 실패했다"고 결론 내린 것과 다르다
  — **정정**: CARNET을 포함한 34개 "기존 온라인 브랜드"는 1차
  병합이 **성공**했다. 실패한 것은 TROUBLED WATERS를 포함한 28개
  **온라인 카탈로그에 아예 없던(오프라인 전용) 브랜드들의 identity
  resolution**이었다(별개의, 더 좁은 범위의 문제 — §7의 이전 원인
  진단은 "브랜드 66개 전부가 실패"라고 과도하게 일반화한 것으로
  드러났다. 정확히는 **온라인 카탈로그에 없던 신규 브랜드 28개의
  귀속만** 실패했다).
- **이후 어떤 load/enrichment가 그것을 순수 온라인 입력으로
  오인했는가**: `5b70343`의 `enrichMonthlyArchiveBrandSales()`,
  이번 세션에서 **딱 한 번** 실행됐을 때(§1/§3).
- **stale이던 7월 아카이브가 반복적으로 병합됐는가**: 아니다 —
  정확히 **두 번**(1차: 원본 생성, 2차: 이번 수리) 병합됐다. 세
  번째 병합은 없었다(내 반복 GET 호출들은 §route 코드의
  `if (enriched !== cached)` 조건 때문에, 2차 병합 이후로는
  `brandSalesSourceImportedAt`이 정상적으로 채워져 fresh로
  판정되고 더 이상 재병합되지 않는다 — 이 부분 자체는 의도대로
  작동한다).
- **`5b70343`이 책임 있는가**: **YES, 명확히.** §2에서 증명했듯
  이 커밋 이전에는 재병합 자체가 구조적으로 불가능했다(구코드의
  단순 단락 조건). 재병합을 가능하게 만든 것도, 그 재병합이 "이미
  성공한 병합 결과"를 잘못 재사용하게 만든 경계 조건 결함도, 전부
  이 커밋에서 도입됐다.

## 7. Units / Orders — Second Merge 확인

§3/§4에서 CARNET 기준 직접 재현: 1차 병합 후 69/66, 2차 병합 후
132/127 — 아카이브 실측과 정확히 일치.

**revenue보다 units/orders가 이중 계산에 더 취약하다** — `onlinePaidAmount`
는 최소한 "온라인 스냅샷"이라는 필드 하나로라도 분리 시도를 하지만
(비록 그 스냅샷의 신선도가 틀렸을 뿐), `quantitySold`/`orderCount`는
애초에 그런 분리 필드 자체가 없다(§2 필드 시맨틱, 이전 리포트에서
이미 확인) — 그냥 순수 누적기라 재병합될 때마다 무조건 오프라인
분량만큼 매번 다시 더해진다.

**전체 합계 수준(1,911 vs 1,024 등)도 같은 메커니즘으로 완전히
설명된다** — 34개 "기존 온라인" 브랜드의 오프라인 units/orders가
전부 중복 반영됐고, 그 중복분의 합이 정확히 (1,911-1,024=887 ≈
34개 브랜드의 오프라인 units 합, 근사치, §5 표본과 일관됨)이다.

## 8. UNASSIGNED — 재평가, 정확한 수치로 증명

```js
const onlineBrandTotal = brandSales.reduce((total, brand) => total + amountOf(brand), 0);
const onlineAdjustment = Number(onlinePaidAmount || 0) - onlineBrandTotal;
if (onlineAdjustment) { buckets.get("UNASSIGNED").onlinePaidAmount += onlineAdjustment; ... }
```

2차 병합 시점에 `amountOf(brand)`가 34개 "기존 온라인" 브랜드에
대해서는 **이미 오프라인이 섞인 값**(1차 병합 결과)을 반환하므로,
`onlineBrandTotal`(모든 브랜드의 amountOf 합)은 **진짜 순수 온라인
총합보다 정확히 "34개 브랜드의 오프라인 합계"만큼 부풀려진다.** 반면
`onlinePaidAmount` 함수 파라미터(내 수리 코드가 넘기는
`archive.commerce.paidAmount`)는 아카이브 최상위의 진짜 온라인
그랜드토탈(35,571,903, 이 필드는 내 수리가 건드리지 않음 — 항상
정확)이다. 그러므로:

```
onlineAdjustment = 35,571,903 − (35,571,903 + Σoffline_34개_브랜드)
                 = −Σoffline_34개_브랜드
```

**실측**: 34개 "mixed" 브랜드의 offline 합계 = **145,232,770원**.
그 음수값(-145,232,770)을 UNASSIGNED.onlinePaidAmount에 더한 것과,
실제 파일의 UNASSIGNED.onlinePaidAmount(**-146,848,370**)를 비교하면
**차이는 -1,615,600원(약 1.1%)** — 이는 §5의 카미긴 예외(194,301원)
및 소수 미세 케이스로 대부분 설명 가능한 잔차 범위다.

**결론**: UNASSIGNED의 거대한 음수값은 **별개의 이상 현상이 아니라
SECOND MERGE 버그가 만든 이중 계산분을, 기존에 이미 있던(그리고
정상적으로 설계된) "온라인 미배분액 재조정" 로직이 상쇄하려다
생긴 직접적 결과물**이다 — 이 재조정 로직 자체는 버그가 아니다
(revenue preservation을 지키려는 정상 설계), 다만 그것이 상쇄하고
있는 대상(2차 병합의 이중 계산)이 버그였을 뿐이다. 이것이 바로
"브랜드별로는 틀렸는데 총액은 정확히 맞는" 현상(직전 리포트 §6)의
**진짜, 완전한 산술적 이유**다 — 마스터 드리프트 때문이 아니다.

## 9. Root Cause Decision

**A. SECOND MERGE CONFIRMED.**

숫자 증거(§3~§5, §8): 11개 표본 중 10개 완전 일치(1원 단위), 원
메커니즘 CARNET에서 단계별로 완전 재현, UNASSIGNED 음수값의 99%가
동일 메커니즘으로 설명됨. 코드 증거(§2, §6): `5b70343` 이전에는
재병합 자체가 불가능했고(구코드 무조건 단락), `5b70343`이 재병합을
가능하게 만들면서 "이미 병합된 결과를 순수 온라인으로 오인"하는
경로를 열었다. 브랜드 마스터 mtime(2026-08-11) 상관관계는 **원인이
아니라 우연(correlation, not causation)**이었다 — 실제로 raw
online(지금)과 1차 병합에 쓰인 raw online을 역산한 값이 CARNET을
포함한 10개 브랜드에서 정확히 같았다(offline을 뺀 값이 지금 raw와
일치) — 즉 **온라인 원본 자체는 드리프트하지 않았다.**

## 10. Repair Design (READ-ONLY — 설계만)

**§9가 확정한 이상, 온라인 freshness를 지금 그대로("§ 이전 리포트가
제안한 대로 온라인에도 신선도 마커를 추가") 구현하는 것은
위험하다** — 그 설계 자체는 여전히 유효한 장기 방향이지만, **먼저
이번에 발견된 이중 계산 결함부터 닫아야 한다.** 순서를 바꾸면
안 된다.

**가장 작고 안전한 수리 경계**:

1. **최우선, 최소 변경**: `buildMonthlyArchive()`(정확히는 그
   `commerce` 객체 생성부, server.mjs 3856-3865줄)가 `brandSalesBasis:
   "online_offline"`을 설정하는 바로 그 자리에서 **`brandSalesSourceImportedAt`
   도 함께 설정**하도록 한다 — 그 시점에 사용한 ECOUNT 스냅샷의
   `importedAt`을 그대로 기록하면 된다(`buildMonthlyArchiveBrandSales`
   내부에서 이미 `readEcountOfflineSalesSnapshot`을 호출하므로,
   그 결과의 `importedAt`을 상위로 리턴/전달하기만 하면 됨 — 새
   I/O 없음). 이렇게 하면 **최초 생성된 아카이브도 즉시 "신선함"으로
   올바르게 표시**되어, 다음 서빙 시 `enrichMonthlyArchiveBrandSales`
   가 불필요하게(그리고 위험하게) 재병합하지 않는다. 이것만으로
   앞으로의 모든 신규 월은 이 버그를 다시 겪지 않는다.
2. **멱등성(idempotency) 관점의 대안(더 무거움, 이번엔 권장하지
   않음)**: `mergeOfflineBrandSales()`가 입력이 "이미 병합된
   결과"인지 스스로 판별하게 만드는 것 — 예컨대 `brandSalesBasis`
   같은 플래그를 브랜드 배열 자체에도 심어 재귀 호출을 막는 방식.
   이는 더 넓은 변경 범위(함수 시그니처/계약 자체를 바꿈)라 "가장
   작은 안전한 경계"라는 요구사항에 맞지 않는다 — **1번 방법이
   근본적으로 우월**하다: 문제의 진짜 원인(마커 부재)을 정확히
   메운다.
3. **오염된 로컬 파일 처리**: `work/monthly/2026-07.json`(및 혹시
   같은 방식으로 오염됐을 수 있는 다른 로컬 상태)은 위 1번 수리
   배포 후 **자동으로는 복구되지 않는다**(이미 오염된 데이터가
   디스크에 있고, 새 마커가 붙어있지 않다는 점에서 여전히
   "stale"로 판정되어 또 재병합될 것이기 때문 — 이번엔 다행히
   그 결과가 3차 병합이 되어 더 악화될 것이다). **1번 수리를
   배포한 뒤, 오염된 아카이브를 `buildMonthlyArchive()`로 처음부터
   다시 만들어(재병합이 아니라 clean rebuild) 저장해야 한다** —
   이것이 "July만의 1회성 하드코딩"이 아니라, **1번 수리가 배포된
   상태에서 정상적으로 다시 생성하는 일반적인 절차**이므로
   지시사항의 "no manual July-only patch" 원칙에 부합한다.
4. **오프라인 신선도 개념 자체는 보존**: `monthlyArchiveBrandSalesIsFresh()`
   함수와 그 판정 로직 자체(§`5b70343`)는 옳다 — 유일한 결함은
   "언제 마커를 기록하는가"의 누락이었다.
5. **필요한 회귀 테스트**(설계만, 미구현):
   - `buildMonthlyArchive()`가 생성한 아카이브는 즉시
     `brandSalesSourceImportedAt`을 갖는다.
   - 그렇게 생성된 아카이브를 곧바로 `enrichMonthlyArchiveBrandSales()`
     에 통과시키면 재병합되지 않는다(참조 동일성 유지) — **이것이
     이번에 놓친 정확한 시나리오이며, 반드시 새로 추가해야 한다.**
   - 이미 오염된(온라인 필드에 오프라인이 섞인) 픽스처를 만들어,
     수리 이후에는 그런 입력이 재병합 대상이 되지 않는지(혹은
     명시적 rebuild 경로를 타는지) 확인.
   - 기존 `test/monthly-archive-freshness.test.mjs`의 시나리오
     1-15는 모두 이 수리 이후에도 그대로 통과해야 한다(회귀 방지).

**이번 STEP은 설계만 제시하며 구현하지 않는다.**

---

====================
JULY HISTORICAL ONLINE SNAPSHOT FORENSICS
====================

CARNET RAW ONLINE:
2,448,430원

CARNET OFFLINE:
20,854,700원

CARNET FIRST MERGE TOTAL:
23,303,130원

CARNET ARCHIVE ONLINE:
23,303,130원

CARNET ARCHIVE OFFLINE:
20,854,700원

CARNET ARCHIVE TOTAL:
44,157,830원

SECOND MERGE NUMERIC MATCH:
YES

SECOND MERGE CODE PATH:
CONFIRMED

SAMPLE BRANDS TESTED:
11

SECOND MERGE EXACT MATCHES:
10

KAMIGIN EXCEPTION EXPLAINED:
NO (차이 194,301원, 정확한 원인 미확정 — 단일 예외로 기록)

UNITS SECOND-MERGE MATCH:
YES (CARNET 69→132, 1차/2차 병합 단계별 재현으로 확인)

ORDERS SECOND-MERGE MATCH:
YES (CARNET 66→127, 동일)

UNASSIGNED ROLE:
2차 병합의 이중 계산분을 상쇄하려는 기존 "온라인 미배분 재조정" 로직의 정상 동작 결과 — 34개 mixed 브랜드의 offline 합계(145,232,770원)의 음수가 UNASSIGNED.onlinePaidAmount(-146,848,370원)의 99%를 설명함(잔차 -1,615,600원, 카미긴 등 소수 예외로 대부분 설명 가능)

BRAND MASTER DRIFT:
DISPROVED (직전 리포트의 결론을 정정한다 — mtime 상관관계는 우연이었다; raw online은 build 시점과 지금 사이 드리프트하지 않았음이 10/11 브랜드에서 역산 확인됨)

5b70343 RESPONSIBLE:
YES (재병합을 가능하게 한 것도, 이미 성공한 병합 결과를 순수 온라인으로 오인하게 만든 경계 조건 결함도 전부 이 커밋에서 도입됨 — 단, 이전 커밋들은 재병합 자체가 불가능한 구조였음을 코드로 확인)

ROOT CAUSE DECISION:
A. SECOND MERGE CONFIRMED — enrichMonthlyArchiveBrandSales()가 이미 오프라인이 성공적으로 병합된 archive.commerce.brandSales를 "순수 온라인" 입력으로 재사용해 mergeOfflineBrandSales()를 재호출했고, cloneBrand()가 그 이미-합산된 총액을 onlinePaidAmount로 스냅샷한 뒤 오프라인 라인을 다시 더해 이중 계산됨. buildMonthlyArchive()가 최초 생성 시 새 신선도 마커(brandSalesSourceImportedAt)를 기록하지 않아 발생한 5b70343의 경계 조건 결함.

SAFE REPAIR BOUNDARY:
buildMonthlyArchive()의 commerce 객체 생성부에서 brandSalesSourceImportedAt을 함께 기록(새 I/O 없이 이미 호출 중인 ECOUNT 스냅샷의 importedAt 재사용) — mergeOfflineBrandSales()/cloneBrand()의 누적기 시맨틱 자체는 변경하지 않음

ONLINE FRESHNESS IMPLEMENTATION SAFE NOW:
NO (이 second-merge 결함을 먼저 닫지 않으면 온라인 freshness를 추가하는 것도 같은 방식으로 위험함)

SAFE TO COMMIT JULY ARCHIVE:
NO

REPORT:
docs/reports/NEXT-JULY-HISTORICAL-ONLINE-SNAPSHOT-FORENSICS.md

COMMIT:
NONE

PUSH:
NONE
====================
