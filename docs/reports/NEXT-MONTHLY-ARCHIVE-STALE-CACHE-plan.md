# NEXT — Monthly Archive Stale Cache: Root Cause & Repair Plan (READ-ONLY)

진단/설계 전용. 코드/HTML/CSS/JS/server/테스트/마스터 데이터/아카이브
파일 전부 미수정. git 쓰기 명령 전부 미실행. commit/push 없음. 조사는
이미 로컬에서 실행 중이던 서버에 대한 읽기 전용 GET 요청과, 기존
파일 직접 읽기, 프로덕션 resolver 함수의 순수 재실행(파일 쓰기 없음)
만으로 수행했다.

## 1. Executive Summary

원인은 단순한 "캐시가 오래됐다"가 아니라 **두 가지가 겹친 정확한
메커니즘**이다: (1) `enrichMonthlyArchiveBrandSales()`가
`commerce.brandSalesBasis === "online_offline"` 플래그를 한 번 보면
**그 이후 영원히 재검증하지 않고** 캐시를 그대로 반환하고, (2) 이
플래그 자체가 **2026-07 아카이브에서 처음 도입**됐다 — 그 이전
달(2026-01~06)의 캐시 파일은 이 플래그가 아예 없는 상태로 저장돼
있어서, 매 요청마다 **의도치 않게(우연히) 항상 새로 재병합**된다.
그 결과 **현재 시점에는 2026-07 단 하나만 실제로 stale하다** — 다른
달은 "재검증 로직이 있어서"가 아니라 "애초에 그 플래그가 없어서
매번 다시 계산되기 때문에" 우연히 안전하다. 이 우연한 안전은 미래에
그 달들이 다시 저장되는 순간 사라진다 — 즉 **이것은 July 하나의
문제가 아니라, "온라인+오프라인 병합 아카이브가 한 번 플래그를
얻으면 다시는 재검증되지 않는다"는 구조적 결함**이며, 다음에
플래그를 얻는 달이 무엇이든 같은 방식으로 영구히 얼어붙을 수 있다.
TROUBLED WATERS의 2026-07 canonical 원본 값은 **Revenue 2,414,200원 /
Units 6개 / Orders 6건 / AOV 402,367원**이다(3중 교차검증, §5 —
사용자가 제시한 Units 7개는 이번 재검증 결과와 다르며, 정확한 값은
6개임을 명시한다).

## 2. Git Safety State

```
pwd:      /Users/binggu/Documents/Codex/2026-06-28/samplas-os-https-www-instagram-com
branch:   main
HEAD:     da1bc09 fix(brand-intelligence): normalize cross-brand partial-period comparison
staged:   (없음)
```

`git status --short`: 이전 STEP67 cross-brand-partial-period 커밋
이후와 완전히 동일한 pre-existing modified/untracked 파일 세트가
그대로 남아 있다(`work/monthly/2026-07.json` 포함, 무수정). 이번
진단에서 어떤 파일도 쓰지 않았다.

## 3. Monthly Archive Lifecycle

```
GET /api/reports/monthly?month=YYYY-MM  (server.mjs:386 부근)
  1. ensurePreviousMonthlyArchiveSaved()  ← 매 요청마다 호출
       previousMonth = previousMonthKey(currentMonth())
       existing = readMonthlyArchive(previousMonth)
       if (existing) return;                          ★ 이미 파일이 있으면 아무것도 안 함(재검증 없음)
       archive = buildMonthlyArchive(previousMonth)     ← 처음 한 번만 실행
       writeMonthlyArchive(previousMonth, {...archive, archiveStatus:"saved"})

  2. month === currentMonth() (당월)
       → buildMonthlyArchive(month)  (항상 실시간, 캐시 없음, archiveStatus:"live")

  3. month !== currentMonth() (과거월)
       cached = readMonthlyArchive(month)               ← work/monthly/{month}.json 그대로 읽음
       if (cached && !staleEmptyCache) {
         enriched = enrichMonthlyArchiveBrandSales(cached, month)
           if (archive.commerce.brandSalesBasis === "online_offline") return archive;  ★★★ 핵심 단락
           // 여기까지 오면(플래그가 없으면) ECOUNT 스냅샷을 다시 읽어 mergeOfflineBrandSales()를
           // 새로 실행한다 — Cafe24 재조회 없음(archive.commerce.brandSales의 온라인 부분은
           // 그대로 신뢰), ECOUNT 로컬 파일 읽기 + 인메모리 병합만 다시 함(저렴함).
         return { ...enriched, archiveStatus: "saved" }   ← 이 결과는 파일에 다시 쓰지 않는다(§7)
       }
       else buildMonthlyArchive(month) (draft)

buildMonthlyArchive(month)(server.mjs:3831)
  → buildBrandSalesDiagnostics(monthStart, monthEnd)     (온라인, Cafe24 실시간 조회)
  → buildMonthlyArchiveBrandSales(monthStart, monthEnd, commerceSource)
       → mergeOfflineBrandSales({..., since, until, identityContext})
       → commerce.brandSalesBasis = "online_offline"      ← 이 플래그가 여기서 처음 찍힌다
```

**"revalidation"이라는 개념 자체가 코드 어디에도 없다** — 아카이브를
다시 만드는 유일한 트리거는 `readMonthlyArchive(month)`가 `null`을
반환하는 경우(파일이 아예 없음)뿐이다. 원본 데이터(ECOUNT 스냅샷,
브랜드 마스터, identity resolver 로직)가 그 사이에 바뀌었는지는 전혀
확인하지 않는다.

## 4. July Forensics

```
work/monthly/2026-07.json
  generatedAt:      2026-08-05T04:35:15.709Z
  archiveStatus:     "saved"
  dataVersion:       1  (스키마 버전일 뿐, 로직/데이터 버전 아님)
  commerce.brandSalesBasis: "online_offline"  ← 단락 플래그, 이 값이 있으면 절대 재계산 안 함
  brandSales:        48건 — CARNET ARCHIVE(B00000KU) 있음, TROUBLED WATERS(B00000WW) 없음
  식별자/버전 마커:    없음(어떤 브랜드 마스터 버전/resolver 버전으로 만들어졌는지 기록 안 됨)
  소스 신선도 마커:    없음(원본 ECOUNT 스냅샷의 importedAt과 비교할 방법이 아카이브 자체엔 없음)

work/ecount-sales/2026-07.json (원본 오프라인 스냅샷)
  importedAt: 2026-08-05T04:35:11.454Z   ← 아카이브 generatedAt보다 정확히 4초 빠름
  periodStart/End: 2026-07-01 ~ 2026-07-31
```

**중요한 새 발견**: ECOUNT 스냅샷의 `importedAt`(04:35:11)과 아카이브의
`generatedAt`(04:35:15)이 **4초 차이**다 — 즉 이 둘은 **같은 자동화
파이프라인의 한 번의 실행**(ECOUNT 스냅샷 임포트 → 곧바로 월간
아카이브 빌드+저장)에서 나왔다. TROUBLED WATERS의 오프라인 라인
6건은 **그 스냅샷에 이미 들어있었다**(이번 진단에서 원본을 그대로
재확인, §5) — 즉 "나중에 스냅샷이 업데이트됐는데 아카이브가 그걸
놓쳤다"는 시나리오는 **아니다.** 원본 데이터는 빌드 시점에 이미
정확했다. 문제는 그 순간의 **identity resolver 컨텍스트**
(`loadResolverContext({onlineCatalog: {...}})`)가 "TROUBLED WATERS /
..." 형태의 productName을 canonical brand_code `B00000WW`로 잇지
못했다는 것으로 좁혀진다 — `work/`가 git 이력에 없어(`.gitignore`)
그 정확히 왜(브랜드 마스터의 그 시점 상태, 혹은 그 빌드 실행에서의
일시적 문제)는 지금 재구성할 수 없다. **그러나 이 STEP의 핵심
질문(왜 시스템이 stale함을 스스로 알 수 없었는가)에는 확실하게 답할
수 있다 — §7 Root Cause.**

## 5. Canonical July Verification

**3가지 독립 방법으로 교차검증, 전부 일치**:

1. **STEP67 cutoff endpoint 실시간 호출**(캐시 전혀 사용 안 함):
   `GET /api/reports/monthly-comparison-cutoff?base=2026-07&compare=2026-06`
   → `cutoff.base.isPartial: false`(2026-07은 이제 완결월, day-cutoff
   적용 안 됨, 전체월 그대로) → TROUBLED WATERS:
   `{revenue: 2414200, quantitySold: 6, orderCount: 6, aov: 402367,
   onlineRevenue: 0, offlineRevenue: 2414200}`
2. **원본 ECOUNT 라인 직접 재집계**(6건 전부 나열, 날짜/금액/수량 확인):
   07-01×2(358,000+382,400) / 07-07×1(334,600) / 07-12×2(798,400+230,400) /
   07-13×1(310,400) = 합계 **2,414,200원, 수량 6개, distinct 전표 6건**,
   AOV = round(2,414,200/6) = **402,367원**.
3. 이전 진단(`NEXT-CROSS-BRAND-PARTIAL-PERIOD-diagnosis.md`,
   `STEP67-pre-commit-troubled-waters-july-diagnosis.md`)에서 프로덕션
   함수 `mergeOfflineBrandSales()`를 동일 스냅샷으로 재실행한 결과와
   완전히 동일.

| Brand | Metric | Value |
|---|---|---:|
| TROUBLED WATERS | Revenue | 2,414,200원 |
| TROUBLED WATERS | Units | **6개**(사용자가 제시한 7개와 다름 — 이번 3중 재검증이 확정한 정확한 값) |
| TROUBLED WATERS | Orders | 6건 |
| TROUBLED WATERS | AOV | 402,367원 |
| TROUBLED WATERS | Online | 0원 |
| TROUBLED WATERS | Offline | 2,414,200원 |
| CARNET ARCHIVE | Revenue | 23,303,130원(무변경, 이미 정상) |

**Units 수치 정정 근거**: 원본 6건 라인 전부 `quantity: 1`이다(위
나열 참고) — 합산하면 정확히 6이지 7이 아니다. 사용자가 제시한 7은
이번 진단이 재확인한 canonical 값과 일치하지 않으므로, 이후 Chrome
QA 계획(§12)과 최종 요약에서는 **6개**를 정확한 기대값으로 쓴다.

## 6. Other Months Audit

`work/monthly/*.json` 7개 파일 전체를 직접 읽고, 대표로 두 달
(2026-03, 2026-06 — 둘 다 원본 파일에 TROUBLED WATERS 없음)을 실제
서버에 다시 요청해 대조했다.

| 파일 | generatedAt | brandSalesBasis(파일) | 파일 안에 TROUBLED WATERS 있음? | 실제 서버가 지금 주는 값(재확인) |
|---|---|---|---|---|
| 2026-01.json | 2026-07-16 | **undefined** | Y | (플래그 없음 → 항상 재병합, 안전) |
| 2026-02.json | 2026-07-16 | **undefined** | Y | (플래그 없음 → 항상 재병합, 안전) |
| 2026-03.json | 2026-07-16 | **undefined** | **N(파일 자체엔 없음)** | **실제 서버 응답엔 있음**(재확인: quantitySold 7/orderCount 10/revenue 2,428,400) — 매 요청마다 재병합돼서 나타남 |
| 2026-04.json | 2026-07-16 | **undefined** | Y | (플래그 없음 → 항상 재병합, 안전) |
| 2026-05.json | 2026-07-16 | **undefined** | Y | (플래그 없음 → 항상 재병합, 안전) |
| 2026-06.json | 2026-07-16 | **undefined** | **N(파일 자체엔 없음)** | **실제 서버 응답엔 있음**(재확인: quantitySold 11/orderCount 14/revenue 3,872,000) — 매 요청마다 재병합돼서 나타남 |
| 2026-07.json | 2026-08-05 | **"online_offline"** | **N** | **N(영구 고정, 서버도 계속 없다고 응답)** — 유일하게 실제로 stale |

**결론**: 현재 시점에 **실제로(사용자가 보는 화면 기준) stale한 달은
2026-07 하나뿐이다.** 2026-01~06은 파일 자체에는 `brandSalesBasis`가
없어(2026-08-05 이전, "온라인+오프라인 병합" 기능 도입 이전에
저장된 구버전 캐시) 매 요청마다 `enrichMonthlyArchiveBrandSales()`가
무조건 다시 병합하기 때문에 **우연히 항상 최신 상태로 서빙된다** —
설계된 안전장치가 아니라 "그 플래그가 아직 없어서 단락 조건에 걸리지
않는" 부작용이다. **이 우연한 안전은 영구적이지 않다** — 그 달들 중
하나라도 다시 저장되는 시점(예: `POST /api/reports/monthly/archive`
수동 호출, 또는 향후 배치 재빌드)에 `brandSalesBasis: "online_offline"`
플래그가 붙는 순간 2026-07과 똑같이 영구 고정될 수 있다. **심각도**:
현재는 영향받는 브랜드/달의 조합이 1개(TROUBLED WATERS × 2026-07)로
좁지만, 구조적 결함 자체는 시스템 전체(모든 달, 모든 브랜드)에 잠재한다.

## 7. Root Cause

**정확한 이유(카테고리 다중 해당)**:

1. **archive considered immutable after first save**(핵심) —
   `enrichMonthlyArchiveBrandSales()`의 `brandSalesBasis ===
   "online_offline"` 체크는 "이미 온라인+오프라인 병합을 거쳤다"는
   **일회성 완료 표시**로 설계됐다 — "그 병합 결과가 지금도 정확한가"
   를 묻는 게 아니라 "병합을 이미 했는가"만 묻는다. 병합을 한 번
   했다는 사실과 병합 결과가 정확하다는 사실은 다른 것인데, 코드는
   이 둘을 구분하지 않는다.
2. **no source freshness marker** — 아카이브 어디에도 "이 병합이
   ECOUNT 스냅샷의 어느 버전/importedAt을 기준으로 계산됐는지"가
   기록되지 않는다. 스냅샷이 나중에 갱신돼도(이번 케이스는 아니지만,
   원리적으로) 아카이브는 그것을 알 방법이 없다.
3. **no identity/master revision marker** — 아카이브 어디에도 "이
   병합이 어느 시점의 `work/brand-master.json`/resolver 로직으로
   계산됐는지"가 기록되지 않는다. brand-master.json에 새 브랜드/별칭이
   추가되거나 resolver 로직이 개선돼도, 이미 저장된 아카이브는 그
   개선의 혜택을 받을 방법이 없다.
4. **no cache versioning**(넓은 의미) — `dataVersion: 1` 필드가
   있지만 이는 **아카이브 스키마 구조**의 버전일 뿐, "이 브랜드 병합
   로직/데이터가 몇 번째 버전으로 계산됐는가"를 나타내지 않는다.
5. **cache hit bypasses revalidation** — 위 4가지가 합쳐진 결과.
   `readMonthlyArchive()`가 파일을 찾으면 그 이후 경로 전체
   (`enrichMonthlyArchiveBrandSales`)는 "파일이 존재한다"는 사실
   하나에만 반응하고, 그 내용이 최신인지는 절대 묻지 않는다.

**왜 정확히 2026-07만 영향받았는가**: `brandSalesBasis` 플래그
자체가 (STEP67-3 "오프라인 매출 자동 갱신 워크플로", 2026-08-05
근처 도입) **2026-07 아카이브를 저장할 때 처음 찍혔기 때문**이다.
그 이전(2026-01~06)은 이 플래그 도입 전에 이미 저장돼 있어서
우연히 단락 조건을 피해간다(§6). 즉 "왜 하필 7월이냐"에 대한 답은
"결함 있는 로직이 도입된 후 처음으로 영구 고정된 달이 7월이었기
때문"이다 — 7월 자체에 특별한 문제가 있었던 게 아니라, **순번상
가장 먼저 그 결함에 걸렸을 뿐**이다.

**"canonical logic changed after archive creation"인가**: 부분적으로
그렇다고 볼 수 있다 — `mergeOfflineBrandSales`/resolver 자체의
판정 로직이 그 사이 개선됐을 가능성을 완전히 배제할 수 없지만
(`work/`에 git 이력이 없어 확정 불가), 원본 스냅샷과 아카이브
generatedAt이 4초 차이(§4)라는 사실은 "그 사이 로직이 크게
바뀌었다"보다는 "그 특정 빌드 실행에서 identity resolution이 한 번
실패했다"에 더 무게를 둔다. 어느 쪽이든 **결론(§7의 구조적 결함)은
바뀌지 않는다** — 정확한 원인이 무엇이었든, 시스템은 그것을 감지할
방법이 처음부터 없었다.

## 8. Repair Options

| 옵션 | 장점 | 리스크 | 변경 범위 | 성능 영향 | 회귀 위험 | 재발 위험 |
|---|---|---|---|---|---|---|
| **A. 2026-07만 1회성 재빌드** | 가장 빠르고 단순, 즉시 증상 해결 | 구조적 결함은 그대로 남음 — 다음에 다른 달이 저장되면 같은 문제 재발 가능 | `work/monthly/2026-07.json` 파일 1개 재작성(코드 변경 없음) | 없음(1회성 작업) | 낮음(파일 하나만 교체) | **높음**(근본 원인 미해결) |
| **B. 영향받은 모든 아카이브 재빌드** | 전체 일관성 확보 | §6에서 확인했듯 **현재 실제로 stale한 달은 7월 하나뿐** — 다른 달을 "재빌드"하면 오히려 그 달들에 `brandSalesBasis` 플래그가 새로 찍혀 **지금까지 우연히 안전했던 것이 이 작업 자체로 인해 미래에 얼어붙는 신규 리스크**가 생긴다 | 파일 6~7개(신중한 판단 필요) | 낮음(1회성) | 중간(각 달 재계산 정확성 검증 필요) | 근본 원인 미해결 시 여전히 높음 |
| **C. 아카이브 검증/무효화 메타데이터 추가** | 근본 원인을 실제로 없앤다 — 미래의 모든 달에 자동 적용 | 새 로직 추가(테스트 필요), `brandSalesBasis`를 boolean에서 검증 가능한 마커로 바꾸는 마이그레이션 필요 | `server.mjs`(`enrichMonthlyArchiveBrandSales` 재설계), 저장된 아카이브 스키마에 필드 추가 | 낮음(ECOUNT 스냅샷 mtime/importedAt 비교는 가벼운 로컬 파일 stat, Cafe24 재조회 없음) | 낮음~중간(기존 저장 파일과의 하위 호환 고려 필요) | **낮음**(구조적으로 재발 방지) |
| **D. 완결월도 캐시 없이 매번 canonical 재계산** | 가장 단순한 정합성 보장(캐시 자체를 신뢰 안 함) | 매 요청마다 ECOUNT 스냅샷 재읽기 필요(가벼움) + **온라인(Cafe24) 부분까지 캐시 없이 매번 재조회하면 무거워짐** — `buildMonthlyArchive` 전체를 다시 타면 Meta Ads/Instagram까지 재계산돼 STEP67 cutoff endpoint가 애써 피한 무거운 경로를 완결월에도 강제하게 됨 | `/api/reports/monthly` 핸들러 전체 재설계 | **높음**(Cafe24/Meta/Instagram API 재호출 필요 시) | 높음(가장 자주 쓰이는 endpoint의 캐싱 전략 전체 변경) | 낮음(캐시 자체가 없으므로) |
| **E. 기타(최소 아키텍처)** | — | — | — | — | — | — |

## 9. Recommended Repair

**주 처방: OPTION C(검증/무효화 메타데이터 추가) + 그 위에서 파생되는
2026-07 1회성 재빌드.**

이유:
- 옵션 A/B만으로는 §7이 확정한 구조적 결함(단락 로직 자체)이 그대로
  남아, 다음에 어느 달이든 다시 저장되는 순간 같은 문제가 재발한다
  (재발 위험 "높음"). §6이 이미 "2026-01~06이 우연히 안전한 이유"를
  명확히 했으므로, **B(전체 재빌드)를 지금 실행하면 오히려 그 우연한
  안전을 깨고 새로운 잠재적 stale 달을 만들 수 있다** — 신중하게
  피해야 한다.
- 옵션 D는 "완결월"이라는 개념 자체와 배치되고(과거는 원래 안정적인
  값이어야 함), 성능·범위가 지나치게 크다(요구사항이 명시한 "이
  작업은 stale materialization/캐시 동작만 고치며 sales 자체를
  재정의하지 않는다"는 원칙과도 거리가 멀어진다).
- **옵션 C가 유일하게 "재발 위험 낮음"** 등급이면서 변경 범위·성능
  영향이 감당 가능한 수준이다.

**구체적 설계(다음 구현 STEP에서 상세화, 이번엔 방향만 제시)**:
```
enrichMonthlyArchiveBrandSales(archive, month)를:
  offlineSnapshotStat = ECOUNT 스냅샷 파일의 mtime 또는 snapshot.importedAt
  archiveMergedAt = archive.commerce.brandSalesMergedAt  (신규 필드, 병합이 실행된 시각)
  if (archive.commerce.brandSalesBasis === "online_offline"
      && archiveMergedAt && offlineSnapshotStat
      && archiveMergedAt >= offlineSnapshotStat) {
    return archive;  // 진짜로 최신일 때만 단락
  }
  // 그 외에는 재병합(§6에서 이미 확인했듯 저렴함 — 로컬 파일 읽기 + 인메모리 병합뿐)
  ... 재병합 후 brandSalesMergedAt = 지금 시각으로 갱신 ...
```
이렇게 하면 (a) ECOUNT 스냅샷이 나중에 갱신되는 정상적인 경우를
자동으로 감지하고, (b) 이미 최신인 경우(스냅샷이 그대로인데 매번
재계산할 필요 없는 대다수 경우)는 여전히 저렴하게 단락하며, (c)
Cafe24/Meta/Instagram 재조회는 전혀 필요 없다(온라인 부분은 계속
신뢰).

**1회성 재빌드가 별도로 필요한가**: **YES, 여전히 필요하다.**
옵션 C를 적용해도 **이미 저장된 2026-07.json 파일 자체는 여전히
`brandSalesMergedAt` 필드가 없거나(구버전 스키마) 잘못된 상태로
남아있다** — 아키텍처를 고친다고 기존에 이미 얼어붙은 파일이
저절로 녹지는 않는다. 따라서: (1) 옵션 C를 구현한 뒤, (2) 그
새 검증 로직이 2026-07을 "재검증 필요" 상태로 정확히 판정하는지
확인하고, (3) 그 판정에 따라 자연스럽게(또는 필요시 명시적으로
1회) 재병합되도록 한다 — **별도의 수동 "재빌드 스크립트"를 새로
작성하기보다, 옵션 C 자체가 다음 요청에서 자동으로 2026-07을
바로잡게 설계하는 것을 권장**한다(그것이 "재발 방지"와 "1회성 수정"
을 하나의 메커니즘으로 합치는 가장 작은 변경 범위).

## 10. Canonical Semantics Safety

이번 계획은 **오직 "언제 병합 결과를 캐시에서 재사용할지"만
다룬다** — 병합 자체가 무엇을 계산하는지는 전혀 바꾸지 않는다.
명시적으로 무변경 확인:

- Cafe24 + ECOUNT 통합 방식(`mergeOfflineBrandSales`의 온라인/오프라인
  합산 로직) — 무변경.
- 배송비 제외, 포인트 결제 매출 포함 정책 — `buildBrandSalesDiagnostics`/
  `allocateCanonicalPaidSalesForOrder` 등 관련 함수 어느 것도 이번
  계획의 변경 대상이 아님.
- 취소/환불 처리 — `isCafe24CanceledItem` 등 무변경.
- 브랜드 canonicalization — `resolveIdentity`/`loadResolverContext`
  무변경(단, **호출 시점**만 "필요할 때 다시" 호출되도록 바뀔 뿐,
  판정 로직 자체는 그대로).
- 고객/오프라인 제외 정책, QQQ 시맨틱, CO 운영 메타데이터 — 전부
  이번 계획이 건드리는 코드 경로 밖.

**이 작업은 "언제 다시 계산할지"를 고치는 것이지 "어떻게 계산할지"를
바꾸는 게 아니다** — 옵션 C가 재병합을 트리거해도, 그 재병합은
기존 `mergeOfflineBrandSales()`를 토씨 하나 바꾸지 않고 그대로
재사용한다(이미 §9에서 명시).

## 11. Test Plan

| # | 시나리오 | 설계 방향 |
|---|---|---|
| 1 | canonical 브랜드 행이 없는 아카이브 | 합성 fixture(온라인 브랜드 목록에 특정 브랜드 없음) → 병합 후 그 브랜드가 나타나는지 |
| 2 | stale 아카이브 감지 | `brandSalesMergedAt < snapshot 기준시각`인 합성 아카이브 → 재검증 로직이 "재병합 필요"로 판정하는지 |
| 3 | stale 아카이브 재병합 또는 우회 | 위 상황에서 실제로 새 `mergeOfflineBrandSales()` 호출이 일어나는지(mock으로 호출 횟수 확인) |
| 4 | 최신 아카이브 재사용 | `brandSalesMergedAt >= snapshot 기준시각`인 합성 아카이브 → 재병합 호출이 **일어나지 않는지**(성능 회귀 방지) |
| 5-9 | Revenue/Units/Orders/AOV/Online/Offline 보존 | 재병합 전후로 이미 정확했던 값(예: CARNET ARCHIVE)이 바뀌지 않는지 |
| 10 | TROUBLED WATERS 2026-07 회귀 | 수정 후 `/api/reports/monthly?month=2026-07`가 revenue 2,414,200/units 6/orders 6/aov 402,367를 반환하는지 |
| 11 | CARNET ARCHIVE 회귀 | 같은 요청에서 CARNET ARCHIVE 값이 기존과 동일(23,303,130원 등)한지 |
| 12 | 완결월 Brand Intelligence 비교 | Period Performance 표에서 TROUBLED WATERS 2026-07이 더 이상 "데이터 연결 대기"가 아닌지(구조/fixture 테스트) |
| 13 | 진행 중 월 cutoff endpoint 무영향 | `getEntityCompareMonthlyArchiveCutoff`/`buildCrossBrandComparisonPeriodPayload` 경로는 이번 수정과 무관하게 그대로 동작하는지(이미 캐시를 안 쓰므로 회귀 없음을 재확인) |
| 14 | Customer Composition 무영향 | `buildBrandCustomerComposition()`은 애초에 캐시를 쓰지 않고 매번 ECOUNT 스냅샷을 직접 읽으므로(server.mjs:4061) 이번 변경과 무관 — 구조 확인만 |
| 15 | 전체 회귀 | `node --test test/*.mjs` 기존 기준선(321/321, `da1bc09` 커밋 시점) 유지 |

## 12. Chrome QA Plan

구현 완료 후(이번 STEP 범위 아님):

```
Brand Intelligence → Compare Mode ON
Brand A: CARNET ARCHIVE, Base: 2026-07
Brand B: TROUBLED WATERS, Compare: 2026-06

기대값(TROUBLED WATERS 2026-07, §5에서 확정한 정확한 canonical 값):
  Revenue: 2,414,200원
  Units:   6개   ← 사용자가 제시한 7개가 아니라 6개가 정확한 값(§5 근거)
  Orders:  6건
  AOV:     402,367원

확인 사항:
1. "데이터 연결 대기"가 더 이상 나타나지 않고 위 값이 표시되는지
2. CARNET ARCHIVE 값(2026-07/2026-06 둘 다)이 기존과 동일하게 유지되는지
3. 진행 중인 현재월(2026-08) 비교(STEP67 cross-brand-partial-period
   cutoff 기능)가 이번 수정과 무관하게 정상 동작하는지(회귀 없음)
4. Customer Composition/Category Intelligence/Sell-through 무영향
```

## 13. Change Surface

| 파일 | 왜 | 예상 범위 |
|---|---|---|
| `server.mjs` | `enrichMonthlyArchiveBrandSales()`에 신선도 비교 로직 추가, 아카이브 스키마에 `brandSalesMergedAt`(또는 동등한 마커) 필드 추가 | 함수 1개 재설계(§9), 기존 `mergeOfflineBrandSales`/`buildBrandSalesDiagnostics`/`buildMonthlyArchive` 등은 무수정 |
| `work/monthly/2026-07.json` | 새 로직이 자연스럽게 재병합하도록 두거나(권장, §9), 필요시 이 파일만 명시적으로 갱신 | 데이터 파일 1개, 스키마 자체는 무변경(필드 추가만) |
| `test/*.mjs`(신규 또는 확장) | §11의 15개 시나리오 | 신규 테스트 파일 또는 `test/monthly-brand-sales.test.mjs` 확장 |

Category Intelligence/Sell-through/Customer Composition/master data/
STEP67 cross-brand-partial-period 코드(이미 커밋된 `da1bc09`)는
변경 대상이 아니다.

## 14. Risks

- **옵션 C의 신선도 비교 기준을 잘못 정하면**(예: 파일 mtime이
  플랫폼/배포 환경에 따라 신뢰할 수 없는 경우) 오탐(불필요한 재병합)
  또는 미탐(여전히 stale로 남음)이 생길 수 있다 — ECOUNT 스냅샷 자체의
  `importedAt`(JSON 필드, 이미 존재 확인됨, §4)을 파일 mtime보다
  우선 신뢰하는 것을 권장.
- **2026-01~06을 "우연히 안전하다"는 이유로 그대로 두는 결정**은
  이번 계획에서 의도적이지만(§9), 그 달들이 훗날 다시 저장될 계기
  (예: 수동 재검증 스크립트, 배치 작업)가 생기면 새 검증 로직이
  아직 배포되지 않은 상태에서 저장될 경우 여전히 위험할 수 있다 —
  구현 순서상 **옵션 C를 먼저 배포한 뒤** 어떤 수동 재저장 작업도
  진행해야 한다.
- 정확한 originating cause(왜 2026-08-05 그 순간 resolver가 실패했는지)
  를 재구성하지 못했으므로, 같은 종류의 identity resolution 실패가
  **다른 브랜드에서도 과거에 있었을 가능성**을 완전히 배제할 수
  없다 — §6의 감사는 "브랜드 존재 여부"만 확인했고, 존재하는 브랜드의
  금액이 부분적으로만 틀렸을 가능성까지는 검증하지 않았다(더 깊은
  전수 금액 검증은 이번 진단 범위 밖).

## 15. GO / NO-GO

**GO(설계 단계 통과, 구현 STEP 착수 가능)** — 근본 원인이 정확히
특정됐고(§7), 영향 범위가 정밀하게 확인됐으며(§6, 현재는 TROUBLED
WATERS × 2026-07 하나), 권장 수리(옵션 C + 자연 재병합)가 canonical
sales 시맨틱을 전혀 바꾸지 않으면서 재발을 구조적으로 막는다(§9,
§10). 실제 코드 변경은 별도의 구현 STEP에서 진행할 것을 권장한다
(이번은 설계까지만).

---

====================
MONTHLY ARCHIVE STALE CACHE PLAN
====================

ROOT CAUSE:
`enrichMonthlyArchiveBrandSales()`가 `commerce.brandSalesBasis === "online_offline"` 플래그를 "병합을 이미 완료했다"는 일회성 표시로만 쓰고 "그 병합 결과가 지금도 최신인가"는 절대 재확인하지 않는다. 이 플래그는 2026-08-05, 2026-07 아카이브를 저장할 때 처음 도입됐고, 바로 그 빌드 실행에서 TROUBLED WATERS의 오프라인 매출 6건(원본 스냅샷엔 이미 존재)이 identity resolution 단계에서 병합에 실패한 채 영구 고정됐다. 그 이전 달(2026-01~06)은 이 플래그가 도입되기 전에 저장돼 있어 우연히 매 요청마다 재병합되므로 안전하다.

JULY STALE:
YES

TROUBLED WATERS JULY CANONICAL:
Revenue: 2,414,200원
Units: 6개
Orders: 6건
AOV: 402,367원
Online: 0원
Offline: 2,414,200원

OTHER MONTHS AFFECTED:
NONE(현재 시점 기준, 2026-01~06은 플래그 부재로 매 요청마다 재병합돼 실제로는 stale하지 않음 — 단, 구조적 결함 자체는 시스템 전체에 잠재하며 그 달들이 재저장되면 같은 방식으로 stale해질 수 있음, §6/§14)

SYSTEMIC ISSUE:
YES(캐시 무효화 메커니즘 자체의 구조적 결함 — 재발 가능)

RECOMMENDED REPAIR:
OPTION C(아카이브 검증/무효화 메타데이터 추가 — ECOUNT 스냅샷 importedAt과 비교해 실제로 최신일 때만 캐시 재사용) + 그 로직이 2026-07을 자연스럽게 재병합하도록 하는 것을 1회성 조치로 겸함

ONE-TIME JULY REBUILD REQUIRED:
YES(구조 수정과 함께, 별도 스크립트보다는 신선도 로직 자체가 다음 요청에서 자동 반영하도록 설계 권장)

CODE CHANGE REQUIRED:
YES(server.mjs의 enrichMonthlyArchiveBrandSales() 재설계, 신규 테스트 추가 — 이번 STEP에서는 미수행, 별도 구현 STEP 필요)

EXPECTED FILES:
server.mjs, work/monthly/2026-07.json(데이터, 필드 추가 또는 자연 재병합), test/*.mjs(신규 또는 확장)

CANONICAL SALES SEMANTICS CHANGE:
NO

CHROME QA REQUIRED:
YES

GO / NO-GO:
GO(설계 승인 가능, 구현은 별도 STEP)

COMMIT:
NONE

PUSH:
NONE
====================
