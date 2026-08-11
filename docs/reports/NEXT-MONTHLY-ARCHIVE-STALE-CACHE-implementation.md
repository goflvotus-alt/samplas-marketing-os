# NEXT — Monthly Archive Freshness Validation: Implementation

승인된 진단: `docs/reports/NEXT-MONTHLY-ARCHIVE-STALE-CACHE-plan.md` (GO 승인).
이 STEP은 그 진단이 권장한 **Option C**(검증/무효화 메타데이터 추가)를
그대로 구현한다 — 새 판매 계산기를 만들지 않고, 기존 canonical
`mergeOfflineBrandSales()`를 언제 다시 호출할지만 고친다.

## 1. Root Cause

`enrichMonthlyArchiveBrandSales()`가 `commerce.brandSalesBasis ===
"online_offline"`을 "병합을 이미 했다"는 일회성 완료 표시로만 쓰고,
그 병합 결과가 지금도 최신인지 절대 재확인하지 않았다. 이 플래그는
2026-07 아카이브를 저장할 때 처음 도입됐고, 바로 그 빌드에서 오프라인
identity resolution이 일부 실패해 TROUBLED WATERS 행이 누락된 채
영구 고정됐다(plan §7).

## 2. Freshness Rule

`server.mjs`에 순수 함수 `monthlyArchiveBrandSalesIsFresh(archiveImportedAt,
sourceImportedAt)`를 추가했다 — ECOUNT 오프라인 스냅샷 자체의
`importedAt`(이미 스냅샷 JSON에 존재하는 결정론적 필드, 새로 만들지
않음)을 병합 시점에 `archive.commerce.brandSalesSourceImportedAt`으로
함께 저장해두고, 다음 요청마다 현재 스냅샷의 `importedAt`과 비교한다.

```
archiveImportedAt >= sourceImportedAt  → fresh(재사용)
archiveImportedAt <  sourceImportedAt  → stale(재병합)
archiveImportedAt 없음(구버전 아카이브) → stale(1회 재병합)
sourceImportedAt 없음(오프라인 스냅샷 자체가 없는 달) → fresh(비교 대상 없음)
```

임의 TTL이나 현재 시각 기준 무효화는 전혀 쓰지 않았다 — 요구사항대로
소스 자체의 신선도 메타데이터만 비교한다.

## 3. Implementation

**`server.mjs`** (`enrichMonthlyArchiveBrandSales()` 직전에 추가, 함수
자체도 수정):

- `monthlyArchiveBrandSalesIsFresh()` 신규 순수 함수(위 §2).
- `enrichMonthlyArchiveBrandSales(archive, month)`: 기존에는
  `brandSalesBasis` 플래그만 보고 즉시 반환하던 단락 조건을, 플래그 +
  `monthlyArchiveBrandSalesIsFresh()` 판정 둘 다 통과해야 반환하도록
  변경. 재병합 시에는 기존과 완전히 동일하게
  `mergeOfflineBrandSales()`(수정 없음)를 그대로 호출하고, 결과에
  `brandSalesSourceImportedAt: sourceImportedAt`을 추가로 기록한다.
  스냅샷은 이제 신선도 판정을 위해 항상 먼저 읽지만(이미 로컬 파일
  읽기뿐이라 저렴함, plan §6에서 확인됨), 실제 병합 재계산
  (`loadResolverContext`/`mergeOfflineBrandSales` 호출)은 여전히
  stale할 때만 일어난다.
- `GET /api/reports/monthly` 라우트: `enriched !== cached`(재병합이
  실제로 일어나 새 객체가 만들어졌을 때만 참) 조건으로
  `writeMonthlyArchive()`를 호출해 교정된 아카이브를 디스크에
  영속화한다. 이미 최신이면(참조 동일) 아무것도 쓰지 않아 매 요청마다
  불필요한 디스크 쓰기가 발생하지 않는다.

변경되지 않은 것(architecture rule 준수 확인):
`mergeOfflineBrandSales()`, `loadResolverContext()`, `resolveIdentity()`,
`buildBrandSalesDiagnostics()`, `buildMonthlyArchiveBrandSales()`,
`/api/reports/monthly-comparison-cutoff`(STEP67 cutoff endpoint) — 전부
원본 그대로. 새 판매 계산 로직도, TROUBLED WATERS/2026-07 하드코딩도
전혀 없다.

## 4. July Before / After

| | Before | After |
|---|---|---|
| `commerce.brandSalesBasis` | `"online_offline"`(고정됨) | `"online_offline"` |
| `commerce.brandSalesSourceImportedAt` | 없음(필드 자체가 없음 — stale 판정의 근거) | `2026-08-05T04:35:11.454Z`(현재 스냅샷과 일치) |
| TROUBLED WATERS 행 | **없음** | 있음 |
| CARNET ARCHIVE `salesAmount` | **23,303,130원**(온라인만) | **44,157,830원**(온라인+오프라인) |

서버를 재기동해 새 로직을 로드한 뒤 `GET /api/reports/monthly?month=2026-07`
을 한 번 호출하는 것만으로 — 별도 스크립트나 수동 개입 없이 —
`work/monthly/2026-07.json`이 자동으로 재병합·재저장됐다(§3의 일반
로직 자체가 원인).

## 5. TROUBLED WATERS Verification

**중요한 수정 사항**: 이번 작업 지시서와 이전 진단 모두 Units를 7로
언급했으나(사전 pre-commit 진단에서 유래한 값), 이번 구현에서도
**production `mergeOfflineBrandSales()`를 직접 재실행**하고 **실제
서버 응답**과 **Chrome UI 렌더링** 3곳 모두에서 독립적으로 재확인한
결과, 정확한 canonical 값은 **Units 6개**다(원본 ECOUNT 라인 6건,
전부 `quantity: 1`). Orders/AOV는 원래 지시서와 정확히 일치한다.

| Metric | 검증된 정확한 값 |
|---|---:|
| Revenue | 2,414,200원 |
| Units | **6개**(지시서의 7개가 아님 — §5 근거) |
| Orders | 6건 |
| AOV | 402,367원 |
| Online | 0원 |
| Offline | 2,414,200원 |

실측 확인 경로 3가지 모두 정확히 일치:
1. `GET /api/reports/monthly?month=2026-07` 실서버 응답(수정 코드 적용 후)
2. `node --test test/monthly-archive-freshness.test.mjs`의 시나리오 6-11/12
3. Chrome QA — Period Performance 표에 `2,414,200원 / 6개 / 6건 / 402,367원`로 렌더링, "데이터 연결 대기" 완전히 사라짐

## 6. CARNET ARCHIVE Regression

Phase 2 지시서는 "CARNET ARCHIVE July가 변하지 않아야 한다"를
가정했으나, 실측 결과 **이 가정 자체가 틀렸다는 것을 이번 구현이
발견했다**: 재병합 전 CARNET ARCHIVE의 저장된 `salesAmount`는
23,303,130원(온라인 매출만)이었고, 재병합 후에는 44,157,830원(온라인
23,303,130원 + 오프라인 20,854,700원)이 됐다. 이는 **회귀가 아니라
동일한 근본 버그의 또 다른 증상 교정**이다 — 근거:

- `mergeOfflineBrandSales()`는 매달 온라인 baseline 위에 오프라인을
  "추가"하는 방식으로 동작한다(대체가 아님). 이는 이미 자동으로
  재병합되던 2026-06 아카이브에서 실측으로 확인했다 — CARNET ARCHIVE
  6월 값이 온라인 4,060,000원 + 오프라인 20,315,900원 =
  24,375,900원으로, 항상 온라인+오프라인 결합값이 저장/서빙된다.
- 즉 정지된 2026-07 아카이브만 예외적으로 CARNET의 오프라인 부분이
  누락된 채 저장돼 있었다 — TROUBLED WATERS가 "행 전체 누락"으로
  나타난 것과 같은 identity-resolution 실패가, 이미 온라인에 존재하는
  CARNET에서는 "오프라인분 누락"이라는 덜 눈에 띄는 형태로 함께
  발생했던 것으로 보인다.
- 이 발견은 승인된 진단(plan §14 Risks)이 미리 경고했던 항목("같은
  종류의 identity resolution 실패가 다른 브랜드에서도 있었을 가능성을
  배제할 수 없다")이 실제로 맞았음을 확인시켜준다.
- 온라인 baseline(23,303,130원)은 재병합 전후로 정확히 동일하게
  유지됐다 — 이중 계산이나 유실 없음, `mergeOfflineBrandSales()`가
  기존 online 데이터를 건드리지 않고 오프라인만 더한다는 계약을
  그대로 지킨다.

**결론**: CARNET ARCHIVE의 숫자 변경은 버그가 아니라, 같은 freshness
수리가 부수적으로 함께 교정한 정확한 값이다. "회귀"의 의미를 "더
정확해짐"이 아니라 "깨짐"으로 해석하면, CARNET ARCHIVE는 회귀하지
않았다 — 온라인 baseline이 보존됐고, 오프라인 병합 로직 자체는
전혀 변경되지 않았다.

## 7. Targeted Tests

`test/monthly-archive-freshness.test.mjs`(신규, 9개 test 블록, §Phase 3의
15개 시나리오 전부 커버):

```
✔ 1. archive newer than or equal to the source snapshot's import time is fresh
✔ 2. archive older than the source snapshot, or missing its marker entirely, is stale
✔ 3. stale archive calls mergeOfflineBrandSales; fresh archive returns the same reference untouched
✔ 4. GET /api/reports/monthly persists the archive only when enrichMonthlyArchiveBrandSales rebuilt it
✔ 5. missing canonical brand row (offline-only brand) is restored by the rebuild
✔ 6-11. Revenue/Units/Orders/AOV/Online/Offline are all preserved correctly for the restored brand
✔ 12. TROUBLED WATERS-shaped July regression: exact canonical figures reproduced by the real merge function
✔ 13. CARNET-shaped regression: an existing online brand keeps its online baseline and gets offline correctly added on top
✔ 14/15. buildCrossBrandComparisonPeriodPayload()/the cutoff endpoint never call the monthly archive cache
9 pass, 0 fail
```

`enrichMonthlyArchiveBrandSales()`/`monthlyArchiveBrandSalesIsFresh()`는
`server.mjs` 비공개 함수라, 이 저장소가 이미 쓰는 sourceOf() + Function()
추출 패턴(`test/cross-brand-period-cutoff.test.mjs`와 동일)으로
격리해서 실제 소스 텍스트를 그대로 실행했다 — 재구현이 아니라 원본
코드 자체를 테스트한다. 시나리오 5-13은 실제 production
`mergeOfflineBrandSales()`를 그대로 재사용(모킹하지 않음)하고,
`test/monthly-brand-sales.test.mjs`와 동일한 synthetic identityContext
레시피로 fixture를 구성했다.

## 8. Full Regression

```
node --test 'test/**/*.test.mjs'
tests 330
pass 330
fail 0
```

기존 321개(직전 커밋 `da1bc09` 기준) + 신규 9개 = 330개, 전부 통과.
기존 테스트는 하나도 약화하지 않았다.

## 9. STEP67 Regression

- **current-month same-elapsed-day cutoff**: `GET
  /api/reports/monthly-comparison-cutoff?base=2026-08&compare=2026-07`
  실측 재확인 — `cutoffNormalized: true, elapsedDay: 12,
  base.endDate: "2026-08-12", comparison.endDate: "2026-07-12"`,
  정상. 이 endpoint는 `work/monthly/*.json`을 전혀 읽거나 쓰지
  않으므로(§7 시나리오 14/15, 소스 코드 자체로 확인) 구조적으로
  이번 변경과 무관하다.
- **completed-month comparison / Revenue / Units / Orders / AOV /
  Channel Mix**: Chrome QA로 CARNET ARCHIVE vs TROUBLED WATERS,
  2026-07 vs 2026-06 전 지표 확인(§10).
- **Customer Composition**: `buildBrandCustomerComposition()`은
  애초에 `work/monthly/*.json` 캐시를 전혀 쓰지 않고 매번
  `readEcountOfflineSalesSnapshot()`을 직접 읽는다(server.mjs 구조
  확인, 무수정) — 이번 변경과 무관.
- **Category Intelligence / Sell-through**: 이번 변경이 건드린
  코드 경로(`enrichMonthlyArchiveBrandSales`, 그 호출부)와 완전히
  분리된 기능이며, 전체 회귀(§8)에도 관련 테스트가 포함돼 통과.

## 10. Chrome QA

로컬 서버(`node server.mjs`, 포트 8787, 수정된 코드로 재기동) +
실제 Chrome 브라우저로 확인.

1. Brand Intelligence → CARNET ARCHIVE 선택 → 월 2026-07 → 비교 모드
   ON(자동으로 이전 달 2026-06 비교 대상 설정됨) → 비교 브랜드
   TROUBLED WATERS 선택.
2. Period Performance 표(매출/판매수량/주문수/객단가) 실측:

   | | CARNET ARCHIVE 2026-07 | TROUBLED WATERS 2026-07 |
   |---|---:|---:|
   | 매출 | 44,157,830원 | **2,414,200원** |
   | 판매수량 | 132개 | **6개** |
   | 주문수 | 127건 | **6건** |
   | 객단가 | 347,699원 | **402,367원** |

   "데이터 연결 대기"는 CARNET ARCHIVE의 무관한 메타데이터 배지
   (지역/운영 방식/카테고리/업데이트)에만 남아있고, TROUBLED WATERS
   판매 지표 어디에도 나타나지 않음을 `document.body.innerText`
   직접 조회로 확인.
3. CARNET ARCHIVE 값은 §6에서 설명한 대로 44,157,830원으로
   나타나며, 이는 온라인 baseline(23,303,130원) 보존 + 오프라인
   정확히 추가(20,854,700원)로 확인됨(Channel Mix 섹션에 그대로
   표시).
4. 기준 월을 2026-08로 되돌려 STEP67 partial-period 모드 재확인 —
   "현재 기간 2026년 8월 · 8/1~8/12" / "비교 대상 2026년 7월 · 동일
   경과일 기준 7/1~7/12"가 그대로 정상 표시됨.

## 11. Files Modified

| 파일 | 변경 내용 |
|---|---|
| `server.mjs` | `monthlyArchiveBrandSalesIsFresh()` 신규 함수, `enrichMonthlyArchiveBrandSales()` 재설계(§3), `/api/reports/monthly` 라우트에 조건부 영속화 추가 |
| `test/monthly-archive-freshness.test.mjs` | 신규, 15개 시나리오 커버(§7) |
| `work/monthly/2026-07.json` | 새 로직이 실제 요청 처리 중 자동으로 재병합·재저장(수동 편집 없음, gitignored라 커밋 대상 아님) |
| `docs/reports/NEXT-MONTHLY-ARCHIVE-STALE-CACHE-implementation.md` | 본 보고서 |

Category Intelligence/Sell-through/Customer Composition/master data/
STEP67 cross-brand-partial-period 코드(`da1bc09`)는 무수정.

## 12. Risks

- 이번 수리는 **디스크에 이미 저장된 다른 달**(2026-01~06)을 건드리지
  않는다 — 그 달들은 여전히 `brandSalesBasis` 필드가 없어 매 요청마다
  재병합되는 기존 동작을 그대로 유지한다(의도적, plan §9). 이 새 로직
  배포 이후 그 달들이 다시 저장되는 시점부터는 새 신선도 마커가
  함께 기록되므로 앞으로는 안전하다.
- CARNET ARCHIVE의 표시 매출이 사용자가 지금까지 봐온 값(23.3M)에서
  44.1M으로 바뀐다 — 이것은 버그 수정의 정상적인 결과이지만,
  운영자가 갑작스러운 숫자 변화를 "새 버그"로 오인하지 않도록
  안내가 필요할 수 있다(§6 근거를 그대로 공유 가능).
- `brandSalesSourceImportedAt` 필드가 없는 다른 과거 오프라인 병합
  결과가 서버 재기동 후 첫 요청 시 한 번씩 재계산된다 — 로컬 파일
  읽기 + 인메모리 병합만 필요해 비용은 낮지만(plan §6 확인), 완전한
  0-cost는 아니다.

## 13. Commit Recommendation

**YES.** 구조적 결함이 재발 방지 방식으로 수리됐고(파괴적 변경 없음),
canonical sales 시맨틱은 전혀 바뀌지 않았으며, 전체 회귀(330/330)와
Chrome QA가 모두 통과했다. 단, 이번 STEP의 명시적 지시("Do not commit.
Do not push.")에 따라 실제 커밋은 수행하지 않았다 — 사용자가 별도로
커밋을 요청하면 그때 진행.

---

====================
MONTHLY ARCHIVE FRESHNESS IMPLEMENTATION
====================

IMPLEMENTATION:
PASS

FRESH ARCHIVE REUSE:
PASS

STALE DETECTION:
PASS

CANONICAL REBUILD:
PASS

JULY REPAIR:
PASS

TROUBLED WATERS JULY:
Revenue: 2,414,200원
Units: 6개 (지시서에 언급된 7개가 아님 — 3중 재검증으로 확정, §5)
Orders: 6건
AOV: 402,367원
Online: 0원
Offline: 2,414,200원

CARNET ARCHIVE REGRESSION:
PASS (온라인 baseline 23,303,130원 보존 + 오프라인 20,854,700원 정확히 추가 = 44,157,830원 — §6에서 회귀가 아니라 동일 버그의 교정임을 확인)

STEP67 REGRESSION:
PASS

CUSTOMER COMPOSITION:
PASS

CATEGORY INTELLIGENCE:
UNCHANGED

SELL-THROUGH:
UNCHANGED

TARGETED TESTS:
[9/9]

FULL REGRESSION:
[330/330]

CHROME QA:
PASS

FILES MODIFIED:
server.mjs, test/monthly-archive-freshness.test.mjs, work/monthly/2026-07.json, docs/reports/NEXT-MONTHLY-ARCHIVE-STALE-CACHE-implementation.md

UNRELATED PRE-EXISTING FILES:
PRESERVED

COMMIT RECOMMENDATION:
YES

COMMIT:
NONE

PUSH:
NONE
====================
