# STEP67 — Customer Composition Current-Month Retry Fix

`docs/reports/NEXT-CROSS-BRAND-PARTIAL-PERIOD-diagnosis.md`의
RECOMMENDED FIX SCOPE (a)만 구현했다. day-cutoff/Partial-Period 구현,
monthly archive 캐시 구조, comparison fact 구조, Revenue/Units/Orders/
AOV 계산 로직, Channel Dominance, Category Intelligence, HTML/CSS,
server.mjs, master data는 전혀 건드리지 않았다. commit/push 없음.

## ROOT CAUSE

`NEXT-CROSS-BRAND-PARTIAL-PERIOD-diagnosis.md` §4가 확인한 그대로다.
Customer Composition을 가져오는 두 호출부
(`refreshEntityCustomerComposition`, `refreshEntityCompareCustomerComposition`,
`outputs/samplas-marketing-os.js`)가 `getJson(url, 10000)` — **고정
10초, 재시도 없음**으로 `/api/brand-intelligence/:code/customer-
composition` endpoint를 호출하고 있었다. 이 endpoint는 진행 중인
현재 월처럼 실시간 Cafe24/ECOUNT 집계가 필요한 조합에서 계산이 오래
걸릴 수 있는데, STEP67-10G-1이 `/api/reports/monthly`에만 적용한
8초 실패 시 30초 1회 재시도 패턴(`getEntityCompareMonthlyArchive`)이
이 endpoint에는 전혀 적용되지 않아 첫 시도가 10초를 넘기면(진단
보고서가 이미 지적한 cold-start 가설) 재시도 없이 바로 "데이터 연결
실패"로 확정됐다. 서버 로직 자체는 정상이며(진단 보고서에서 직접
확인, 재요청 시 1.9~2.8초로 성공), 문제는 순수하게 client-side
timeout 정책의 공백이었다.

## IMPLEMENTATION

**수정 파일**: `outputs/samplas-marketing-os.js` 1개(+ 신규 테스트
파일 1개). server.mjs/HTML/CSS/master data 무수정.

1. **먼저 STEP67-10G-1 패턴을 정확히 확인**: `getEntityCompareMonthlyArchive()`
   (`outputs/samplas-marketing-os.js:13416` 부근) — `getSharedJson(url,
   8000)`으로 첫 요청, `error === "응답 지연"`일 때만 같은 URL을
   `getSharedJson(url, 30000)`으로 정확히 1회 재요청.
2. **신규 헬퍼 `getEntityCompositionJson(url)`을 `entityCompositionDataset()`
   바로 아래에 추가**(같은 파일, Customer Composition 상태 관리
   코드와 같은 블록):
   ```js
   const ENTITY_COMPOSITION_TIMEOUT_MS = 8000;
   const ENTITY_COMPOSITION_RETRY_TIMEOUT_MS = 30000;

   async function getEntityCompositionJson(url) {
     const first = await getJson(url, ENTITY_COMPOSITION_TIMEOUT_MS);
     if (first?.error !== "응답 지연") return first;
     return getJson(url, ENTITY_COMPOSITION_RETRY_TIMEOUT_MS);
   }
   ```
   `getEntityCompareMonthlyArchive`와 동일한 구조(같은 임계값, 같은
   에러 문자열 판정, 같은 "지연일 때만 재시도")를 그대로 재사용했다.
   다른 점은 반환 타입뿐이다 — `getEntityCompareMonthlyArchive`는
   Period Performance 표가 timeout/error/success 3가지 상태를
   구분해야 해서 `{archive, status}` 객체를 반환하지만, Customer
   Composition의 유일한 소비자(`entityCompositionDataset`)는
   `data.error`만 boolean으로 확인하므로 원본 `getJson` 응답 그대로
   반환하는 더 단순한 형태를 택했다 — **기존 호출부 코드를 최소
   변경**하기 위한 의도적 선택(요구사항 "최소한의 retry 동작").
3. **두 호출부 수정**(로직 변경 없음, 호출 대상 함수만 교체):
   - `refreshEntityCompareCustomerComposition`(:12830):
     `getJson(...,10000)` → `getEntityCompositionJson(...)`.
   - `refreshEntityCustomerComposition`(:13215):
     `getJson(...,10000)` → `getEntityCompositionJson(...)`.
   - 두 곳 모두 `await` 직후의 기존 `if (seq !== ...Seq) return;`
     stale-guard 줄은 **손대지 않았다** — 같은 위치에 그대로 있다
     (테스트로 재확인, §Tests 참고).
4. `node --check outputs/samplas-marketing-os.js` PASS(구문 오류 없음).

## RETRY POLICY

```
1차 시도: 8초(ENTITY_COMPOSITION_TIMEOUT_MS)
재시도 조건: 1차 응답이 정확히 { error: "응답 지연" }(AbortError로 인한
             timeout)일 때만 — 다른 종류의 에러(API 오류 500 등)는
             재시도하지 않고 즉시 그대로 반환한다.
재시도 횟수: 정확히 1회, 30초(ENTITY_COMPOSITION_RETRY_TIMEOUT_MS).
             2차도 timeout이면 그 결과를 그대로 반환한다 — 3차 시도
             없음(무한 반복 금지, 요구사항 3 충족).
Stale-response 방지: 재시도 로직 자체는 호출부의 async/await 경계
             안에서만 일어난다 — 호출부(refreshEntityCustomerComposition/
             refreshEntityCompareCustomerComposition)의 기존
             `const seq = ++entityCompositionSeq`(또는
             `entityCompareCompositionSeq`) 캡처와 `await` 완료 직후의
             `if (seq !== ...Seq) return;` 검사는 전혀 수정하지
             않았다. 재시도가 30초까지 늘어나는 동안 사용자가 브랜드/
             기간을 바꿔 더 최신 seq가 발급되면, 이 오래된 재시도가
             나중에 resolve되더라도 seq 불일치로 그 결과는 화면에
             반영되지 않고 버려진다(요구사항 5 충족) — 이 보장은
             기존 코드가 이미 갖고 있던 것이며, 이번 수정은 그 보장을
             깨지 않았을 뿐 새로 만들지 않았다.
```

## TESTS

신규 `test/entity-composition-retry.test.mjs`(6개 시나리오, 전부
PASS) — `test/brand-comparison-yoy-timeout.test.mjs`가 확립한 소스
추출(`sourceOf`) + `Function()` 실행 패턴을 그대로 재사용:

1. 첫 응답이 성공이면 재시도가 전혀 일어나지 않는다(호출 1회).
2. 첫 응답이 `"응답 지연"`이면 정확히 30초로 1회만 재시도하고
   성공값을 반환한다.
3. 2차도 `"응답 지연"`이면 그 결과를 그대로 반환한다(3차 없음, 무한
   반복 금지 확인).
4. timeout이 아닌 진짜 에러("API 오류 500")는 재시도 없이 즉시
   반환된다.
5. 두 호출부 모두 `await getEntityCompositionJson(...)` 바로 다음
   줄에 기존 seq stale-guard가 그대로 있는지 구조적으로 확인(재시도
   로직이 그 검사를 우회/이동시키지 않았음을 검증).
6. 두 호출부 모두 새 헬퍼를 쓰고 있고, 옛 고정 10초 `getJson` 패턴이
   더 이상 남아있지 않은지 확인.

```
node --test test/entity-composition-retry.test.mjs
  6/6 PASS

node --test test/entity-composition-retry.test.mjs \
  test/brand-comparison-yoy-timeout.test.mjs \
  test/brand-comparison-summary.test.mjs \
  test/brand-intelligence-partial-period.test.mjs \
  test/brand-intelligence-live-data.test.mjs \
  test/brand-intelligence-ui-restoration.test.mjs
  50/50 PASS
```

(`test/brand-comparison-yoy-timeout.test.mjs` = PERIOD_CHANGE
stale-response 방지 정책의 원본 테스트, `test/brand-comparison-
summary.test.mjs`/`test/brand-intelligence-partial-period.test.mjs`
= Comparison Mode/Partial-Period 관련 테스트, `test/brand-
intelligence-live-data.test.mjs`/`test/brand-intelligence-ui-
restoration.test.mjs` = Customer Composition 관련 구조 assertion을
포함한 기존 회귀 가드 — 전부 이번 수정으로 깨지지 않았다.)

## REGRESSION

```
node --test test/*.mjs (전체)
296/296 PASS, 0 fail(기존 290개 + 신규 6개)
```

PASS

## 확인한 8가지 구현 원칙

1. STEP67-10G-1 패턴을 먼저 찾아 정확히 이해 — §Implementation 1.
2. Customer Composition endpoint에 동일한 최소 재시도 동작 적용 —
   §Implementation 2-3.
3. 재시도는 정확히 1회, 무한 반복 없음 — §RETRY POLICY, 테스트
   시나리오 3으로 확인.
4. PERIOD_CHANGE stale-response 방지 정책 유지 — `getEntityCompareMonthlyArchive`/
   `refreshEntityCompareTargetPeriodData`(STEP67-10G-1이 만든 코드)를
   전혀 건드리지 않았다. `test/brand-comparison-yoy-timeout.test.mjs`
   재실행으로 재확인.
5. 브랜드/기간 변경 시 이전 요청의 retry 결과가 새 화면에 주입되지
   않음 — §RETRY POLICY의 stale-response 방지 항목, 테스트 시나리오
   5로 확인.
6. 기존 정상 완결기간(6월 등) Customer Composition을 깨뜨리지 않음 —
   재시도는 첫 시도가 timeout일 때만 발동하므로, 이미 빠르게 응답하는
   완결 월은 기존과 동일하게 8초 이내 1회 요청으로 끝난다(회귀 없음,
   시나리오 1로 확인).
7. Comparison Mode OFF/ON 기존 동작 유지 — `refreshEntityCustomerComposition`/
   `refreshEntityCompareCustomerComposition`의 mode 분기 로직(예:
   `!entityCompareState.enabled`, `entityCompareCompositionState.b.key
   === key && ["ready","empty"].includes(...)` 캐시 재사용 조건)은
   단 한 줄도 수정하지 않았다 — fetch 호출 대상 함수 이름만 바뀌었다.
8. Category Intelligence BLOCKED 상태 무영향 — 이번 STEP은 Category
   Intelligence 코드를 전혀 읽거나 수정하지 않았다.

## Known Limitations

- 진단 보고서(§4)가 이미 명시한 대로, cold-start(첫 요청이 실제로
  10초를 넘기는 상황)를 이번 세션에서 인위적으로 재현하지는
  못했다(서버 캐시를 지워야 하는데 이는 READ-ONLY/최소-변경 범위를
  벗어난다) — 따라서 이 수정이 사용자가 실제로 겪은 정확한 그
  타이밍 상황을 해결하는지는 Chrome QA로 최종 확인이 필요하다.
- 재시도가 발동하는 경우 최대 대기 시간이 8초에서 최대 38초
  (8+30)로 늘어난다 — STEP67-10G-1이 Period Performance에 이미
  적용한 것과 동일한 트레이드오프이며, 새로 도입한 리스크가 아니다.
- 진단 보고서 §3(월간 아카이브 캐시 staleness)과 §1(day-cutoff
  미구현)은 이번 STEP 범위에 명시적으로 포함되지 않았으므로 그대로
  남아 있다 — 별도 STEP 필요.

## CHROME QA

NOT YET — 사용자가 직접 수행. 확인 시나리오: CARNET ARCHIVE/TROUBLED
WATERS, 2026-08(진행 중) Compare Mode에서 양쪽 Customer Composition이
더 이상 "데이터 연결 실패"로 표시되지 않는지, 2026-06 등 기존
완결기간 비교는 계속 정상 표시되는지.

---

ROOT CAUSE:
Customer Composition endpoint(`/api/brand-intelligence/:code/customer-composition`) 호출이 고정 10초·재시도 없음이었고, 진행 중인 현재 월처럼 실시간 계산이 오래 걸리는 조합에서 이 타임아웃을 넘기면 즉시 "데이터 연결 실패"로 확정됐다. STEP67-10G-1이 `/api/reports/monthly`에만 적용했던 8초+30초 1회 재시도 패턴이 이 endpoint에는 적용되지 않았던 것이 원인.

IMPLEMENTATION:
`outputs/samplas-marketing-os.js`에 `getEntityCompositionJson(url)` 헬퍼를 신규 추가(`getEntityCompareMonthlyArchive`와 동일한 8초/30초 재시도 구조 재사용)하고, `refreshEntityCustomerComposition`/`refreshEntityCompareCustomerComposition` 두 호출부의 `getJson(url, 10000)`을 이 헬퍼 호출로 교체했다. 그 외 로직(seq stale-guard, mode 분기, 렌더 흐름)은 전혀 수정하지 않았다.

RETRY POLICY:
8초 실패 시 30초로 정확히 1회만 재시도, `"응답 지연"`(timeout)일 때만 재시도하고 다른 에러는 즉시 반환. 2차도 timeout이면 그대로 반환(3차 없음). Stale-response 방지는 기존 seq 가드(`entityCompositionSeq`/`entityCompareCompositionSeq`)가 재시도 여부와 무관하게 `await` 완료 후 그대로 작동해 보장한다(무수정).

TESTS:
신규 `test/entity-composition-retry.test.mjs` 6/6 PASS. Customer Composition/Comparison Mode/PERIOD_CHANGE stale-response 관련 기존 테스트 포함 50/50 PASS.

REGRESSION:
PASS (296/296 전체 스위트, 0 fail — 기존 290개 + 신규 6개)

CHROME QA:
NOT YET

COMMIT:
NOT CREATED

PUSH:
NOT PERFORMED

IMPORTANT:
이번 단계에서는 commit 하지 않았다. push 하지 않았다. Chrome QA는 사용자가 직접 한다.
