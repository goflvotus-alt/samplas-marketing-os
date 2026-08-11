# STEP67 Pre-Commit — TROUBLED WATERS July Full-Period Diagnosis (READ-ONLY)

진단 전용. 코드/HTML/CSS/JS/server/테스트/마스터 데이터 전부 미수정.
git 쓰기 명령 전부 미실행. commit/push 없음. 조사는 이미 로컬에서
실행 중이던 서버(`http://localhost:8787`, 이번 세션이 새로 띄우지
않음)에 대한 읽기 전용 GET 요청과, 기존 파일 직접 읽기 및 프로덕션
resolver 함수의 순수 재실행(파일 쓰기 없음)만으로 수행했다.

## 핵심 결론(미리 요약)

**이 문제는 STEP67(P1/P2)의 회귀가 아니다.** `docs/reports/
NEXT-CROSS-BRAND-PARTIAL-PERIOD-diagnosis.md` §3이 STEP67 P1 구현
착수 **이전에** 이미 발견·문서화한 것과 **정확히 같은 pre-existing
stale-cache 버그**가, 이번에는 다른 화면 조합(현재=2026-07 완결월,
비교=2026-06)에서 다시 드러난 것이다. TROUBLED WATERS의 2026-07
**원본 데이터는 실제로 존재**하며(오프라인 6건, 2,414,200원/6개/6건/
AOV 402,367원 — 이번 진단에서 직접 재계산으로 확정), STEP67이 새로
만든 cutoff endpoint는 이 원본을 정확히 찾아낸다. 문제는 STEP67이
전혀 건드리지 않은 `/api/reports/monthly`의 "saved" 캐시 경로
(`work/monthly/2026-07.json`, 2026-08-05에 저장된 뒤 한 번도
재검증되지 않음)에 있다 — 완결 월(2026-07을 "현재 기간"으로 선택한
경우)은 cutoff 모드가 아예 발동하지 않고 이 오래된 캐시를 그대로
쓰기 때문이다.

## A. Cutoff Endpoint는 찾는데 완결기간 비교는 왜 "데이터 연결 대기"인가

**정확한 코드 경로 추적**:

```
사용자가 실제로 밟은 화면 조합: 현재 기간=2026-07(완결월), 비교=2026-06, Brand B=TROUBLED WATERS

outputs/samplas-marketing-os.js: refreshEntityCompareTargetPeriodData()
  currentKey = "2026-07"
  currentTrendRow = entityTrendMonths.find(row => row.key === "2026-07")
  useCutoff = entityIsLiveMonthRow(currentTrendRow)
            = (currentTrendRow.archiveStatus === "live")
            = FALSE  ← 2026-07은 오늘(2026-08-11) 기준 실제 당월이 아니므로 "live"가 아니다
  → useCutoff가 false이므로 기존(P1/P2 이전부터 있던) 분기를 그대로 탄다:
      getEntityCompareMonthlyArchive("2026-07")  // 새 cutoff endpoint 아님, 옛 /api/reports/monthly
      getEntityCompareMonthlyArchive("2026-06")
```

`useCutoff`가 false로 결정되는 것 자체는 **의도된 정상 동작**이다
— 요구사항 D("완결 월 비교는 전체월 vs 전체월을 그대로 쓴다")와
STEP67-cross-brand-partial-period-p1/p2 보고서가 명시한 설계 그대로다.
문제는 이 분기가 타는 `getEntityCompareMonthlyArchive("2026-07")`가
결국 호출하는 서버 endpoint `/api/reports/monthly?month=2026-07`
쪽이다:

```
server.mjs: GET /api/reports/monthly?month=2026-07
  month !== currentMonth() (2026-07 ≠ 2026-08)
  → cached = readMonthlyArchive("2026-07")   // work/monthly/2026-07.json 그대로 읽음
  → enrichMonthlyArchiveBrandSales(cached, "2026-07")
       if (archive.commerce.brandSalesBasis === "online_offline") return archive;  // ★ 단락
  → { ...enriched, archiveStatus: "saved" }
```

**직접 재확인(이번 진단, 서버에 실제 GET 요청)**:

```
GET /api/reports/monthly?month=2026-07  (완결기간 비교가 실제로 쓰는 경로)
  → archiveStatus: "saved"
  → TROUBLED WATERS(B00000WW) present: false   ← 여기서 "데이터 연결 대기"가 나온다

GET /api/reports/monthly-comparison-cutoff?base=2026-07&compare=2026-06  (STEP67 P1 신규 endpoint)
  → cutoff.cutoffNormalized: false (2026-07이 실제 당월이 아니므로 정상적으로 전체월 처리)
  → base(2026-07) range: 2026-07-01~2026-07-31 (전체월 그대로)
  → base TROUBLED WATERS: { revenue: 2414200, quantitySold: 6, orderCount: 6, aov: 402367 }
  → comparison(2026-06) TROUBLED WATERS: { revenue: 3872000, quantitySold: 11, orderCount: 14, aov: 276571 }
```

두 endpoint가 **같은 2026-07 "전체월"을 요청받았는데도 다른 답**을
주는 이유는 정확히 하나다 — cutoff endpoint는 `work/monthly/*.json`
캐시를 **전혀 읽지 않고 매번 원본(Cafe24 + ECOUNT)을 새로 집계**하지만
(STEP67-cross-brand-partial-period-p1.md §11에서 이미 구조 테스트로
증명됨: `readMonthlyArchive`/`writeMonthlyArchive` 미참조), 기존
`/api/reports/monthly`는 "saved" 캐시가 있으면 `brandSalesBasis ===
"online_offline"` 플래그만 보고 **재검증 없이 그대로 반환**하기
때문이다. `work/monthly/2026-07.json`은 2026-08-05에 저장된 뒤
지금까지 단 한 번도 다시 만들어지지 않았다(파일의 `generatedAt`
필드로 확인) — 그 시점에 TROUBLED WATERS 오프라인 매출이 병합에서
누락됐고, 이후 원본 ECOUNT 데이터가 무엇을 담고 있든 이 캐시는
영원히 그 누락 상태로 고정된다.

## B. 분류

**STALE / ARCHIVE / CACHE BEHAVIOR — 새 버그 아님, STEP67 착수 이전에
이미 발견·문서화된 것과 동일한 근본 원인.**

- ❌ "expected existing behavior"(정상 설계)는 아니다 — 실제 매출
  데이터가 존재하는데 "데이터 연결 대기"로 보이는 것은 버그다.
- ✅ **stale cache behavior** — `docs/reports/NEXT-CROSS-BRAND-PARTIAL-
  PERIOD-diagnosis.md` §3("TROUBLED WATERS 2026-07 데이터 연결 대기
  정확한 원인")이 **이미 이 정확한 파일, 이 정확한 코드 경로**
  (`enrichMonthlyArchiveBrandSales`의 `brandSalesBasis` 단락 로직)를
  근본 원인으로 지목했다. 이번 진단은 그 결론을 다른 화면 경로
  (완결기간 vs 완결기간 비교)에서 다시 확인한 것뿐이다.
- ❌ frontend state behavior 아님 — `useCutoff` 판정과 fetch 분기
  로직은 정확히 설계대로 동작한다(§A에서 코드로 확인). 프론트엔드는
  서버가 준 데이터를 정직하게 "데이터 연결 대기"로 보여줄 뿐이다.
- ❌ missing monthly brand aggregate 아님 — 집계 자체는 만들 수
  있고(원본 라인 6건이 실제로 존재), 문제는 그 집계 결과가 **캐시
  파일에 반영되지 않았다**는 것이다.
- ❌ **STEP67이 만든 회귀가 아니다** — STEP67(P1/P2)은
  `enrichMonthlyArchiveBrandSales`/`readMonthlyArchive`/
  `writeMonthlyArchive`/`work/monthly/*.json` 어느 것도 읽거나
  수정한 적이 없다(P1 보고서 §2 Files Modified, P2 보고서 §2 Files
  Modified 둘 다 재확인 가능 — `server.mjs`에 추가된 것은 완전히
  새로운 함수 3개와 라우트 1개뿐, 기존 `/api/reports/monthly` 핸들러
  블록은 한 줄도 수정되지 않았다). 오히려 STEP67의 신규 cutoff
  endpoint는 이 stale-cache 문제를 **우회**하기 때문에, 그 경로를
  통해 처음으로 TROUBLED WATERS의 실제 7월 매출이 화면에 나타날 수
  있게 됐다 — 이 진단에서 사용자가 "cutoff는 되는데 완결기간은 안 된다"
  는 **불일치**를 발견한 것 자체가, STEP67이 문제를 만든 게 아니라
  기존에 숨어있던 문제를 부분적으로 드러냈다는 증거다.

## C. TROUBLED WATERS 2026-07 Canonical 원본 값 검증

**코드 수정 없이 도출 가능 — 이미 존재하는 canonical 집계 경로
(STEP67 cutoff endpoint)를 그대로 호출해 확인했다.**

```
Brand: TROUBLED WATERS (B00000WW)
Period: 2026-07 전체월 (2026-07-01 ~ 2026-07-31)
Revenue: 2,414,200원
Units: 6개
Orders: 6건
AOV: 402,367원 (round(2,414,200 / 6))
Online: 0원 / Offline: 2,414,200원(전액 오프라인)
```

**교차 검증(3가지 독립 방법, 전부 동일한 값으로 일치)**:
1. `GET /api/reports/monthly-comparison-cutoff?base=2026-07&compare=2026-06`
   (STEP67 P1 신규 endpoint, 실제 서버 호출) → 위 값 그대로.
2. `scripts/monthly-brand-sales.mjs`의 실제 프로덕션 함수
   `mergeOfflineBrandSales()`를 현재 `work/ecount-sales/2026-07.json`
   스냅샷으로 직접 재실행(이전 진단에서 이미 검증, 이번에도 서버
   응답과 완전히 일치) → 동일 값.
3. 원본 ECOUNT 라인 6건을 직접 열람(날짜 07-01×2/07-07×1/07-12×2/
   07-13×1, `brandGroup:"TRO"`, `productName`이 전부 "TROUBLED
   WATERS / ..."로 시작, 금액 전부 양수/유한) → 합산하면 정확히
   2,414,200원.

**추가 확인(이번 진단에서 새로 수행)**: 2026-06 캐시(`work/monthly/
2026-06.json`, `generatedAt: 2026-07-16`)는 TROUBLED WATERS를 정확히
포함하고 있고(3,872,000원/11개/14건), 원본 ECOUNT 6월 스냅샷을
독립적으로 재계산해도 정확히 같은 값이 나온다 — **6월 캐시는
stale하지 않다.** 이는 이 버그가 "TROUBLED WATERS 데이터 파이프라인
전체의 구조적 결함"이 아니라 **2026-07 캐시 파일 하나가 우연히(또는
그 시점의 일시적 원인으로) 병합 누락된 채 고정된 것**임을 보여준다
— 정확한 원인(2026-08-05 빌드 당시 왜 이 6건이 누락됐는지)은
`work/`가 git 이력에 없어 재구성할 수 없지만, "지금 다시 계산하면
찾아진다"는 사실은 확정적이다.

## D. GO / NO-GO 판단

**SAFE TO COMMIT.**

근거:
1. **STEP67의 신규 코드(resolver, cutoff endpoint, client 배선)는
   정확하다** — 이번 진단이 다시 한번 실측으로 증명했다(§C의 3가지
   독립 교차검증). STEP67-cross-brand-partial-period-p1/p2가 이미
   307→321개 테스트로 검증했고, 이번 진단에서 발견한 것도 "STEP67
   코드가 틀렸다"가 아니라 "STEP67이 건드리지 않은 다른 코드에 이미
   있던 버그가 이번에 더 잘 보이게 됐다"는 것이다.
2. **STEP67을 커밋하지 않아도 이 문제는 사라지지 않는다** — 문제의
   근원(`enrichMonthlyArchiveBrandSales`의 캐시 단락 로직,
   `work/monthly/2026-07.json`의 stale 상태)은 STEP67 이전부터
   존재했고 STEP67과 독립적이다. 커밋을 보류해도 완결기간
   TROUBLED WATERS 7월 비교는 여전히 "데이터 연결 대기"로 보인다.
3. **이미 두 차례(직전 진단 §3, STEP67-cross-brand-partial-period-p1.md
   §13)에 걸쳐 "별도 STEP으로 분리 권장"이라고 명시적으로 기록된
   사항**이다 — 이번이 그 판단을 재확인한 세 번째 사례일 뿐, 새로
   발견된 리스크가 아니다.
4. 이번 진단에서 CARNET ARCHIVE는 7월/6월 모두 정상, TROUBLED
   WATERS는 6월 정상/7월만 stale임을 확인했다 — 영향 범위가
   좁고(한 브랜드, 한 달) 정확히 식별돼 있어, 사용자가 이 사실을
   알고 진행할 수 있는 상태다.

**단, 강력히 권고**: STEP67을 커밋한 뒤(또는 별도로), `work/monthly/
2026-07.json`을 최신 원본 기준으로 재빌드하거나
`enrichMonthlyArchiveBrandSales()`의 캐시 재검증 로직을 보강하는
**별도 STEP을 가능한 한 빨리 진행**할 것을 권한다 — 지금 사용자가
"TROUBLED WATERS 2026-07 완결기간 비교"를 실제로 쓰면 여전히 잘못된
"데이터 연결 대기"를 보게 된다. 이는 STEP67의 책임 범위가 아니지만
사용자 경험에는 실재하는 문제다.

---

ROOT CAUSE:
`work/monthly/2026-07.json`(2026-08-05에 저장된 뒤 재검증된 적 없는
캐시)에 TROUBLED WATERS의 오프라인 매출 병합이 누락돼 있고,
`enrichMonthlyArchiveBrandSales()`가 `brandSalesBasis ===
"online_offline"` 플래그만 보고 무조건 이 캐시를 그대로 반환하기
때문이다(`docs/reports/NEXT-CROSS-BRAND-PARTIAL-PERIOD-diagnosis.md`
§3이 이미 발견한 것과 동일한 근본 원인). STEP67의 새 cutoff
endpoint는 이 캐시를 전혀 읽지 않고 항상 원본을 새로 집계하므로
같은 브랜드/같은 달에 대해 서로 다른 답을 준다.

STEP67 REGRESSION:
NO

TROUBLED WATERS JULY CANONICAL DATA EXISTS:
YES — revenue 2,414,200원 / units 6개 / orders 6건 / AOV 402,367원
(3가지 독립 방법으로 교차 검증됨, §C)

SAFE TO COMMIT:
YES

IMPORTANT:
이번 진단은 READ-ONLY로만 수행했다. 코드/테스트/마스터 데이터 전부
미수정. commit하지 않았다. push하지 않았다. 발견된 stale-cache
문제(TROUBLED WATERS 2026-07)는 STEP67 범위 밖의 별도 STEP으로
분리해 진행할 것을 권고한다.
