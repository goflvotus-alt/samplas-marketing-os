# Meta 주간 리포트 완전성 전달 검증 — 2026-10-20

기준: `793bbf4`, 브랜치 `codex/meta-issued-adjustments`. 로컬 수정·테스트·커밋만 수행. push, 배포, 운영 데이터 변경 없음.

## 1. 확정 누락 원인

- `server.mjs/buildMetaAdsSummary`: 원본 Insights 응답의 paging 및 필수 필드 존재 여부가 집계/캐시에 남지 않았다. 기존 지표 계산은 필드 누락을 0으로 표현하므로 집계값만으로 완전성을 증명할 수 없다.
- `buildMetaAdsSummaryForWeeklyReport`: rows/totals만 반환하여 source, 기간, 캐시 상태 및 완전성 근거를 제거했다.
- `cafe24GetOrders` → `fetchCafe24WeeklyTrackingOrders` → `fetchCafe24ActualOrdersForWeeklyReport`: 페이지 종료 증거가 보존되지 않았고, 최종 단계는 건수 <500만으로 complete를 추정했다.
- `fetchCafe24AnalyticsOrderDetails`: HTTP 성공/응답 자체만 전달했다. 조회 한도, 다음 페이지, 행 식별·금액·유입 필드 검증 결과가 없었다.
- 결합/검수 단계는 위 정보가 없어 자동 발행을 차단했다. 이번 수정은 원본 증거 전달을 추가하며 canonical 매출, 환불 제외, paid 유입 분류 및 Meta 지표 계산을 바꾸지 않는다.

## 2. 변경 파일

- `server.mjs`: 위 수집 함수와 주간 어댑터의 메타데이터 전달만 추가.
- `scripts/weekly-data-completeness.mjs`: 순수 완전성 판정 함수.
- `scripts/meta-issued-report.mjs`: current/previous 모든 소스의 명시적 COMPLETE 요구, 검수 결과에 상태 기록.
- `test/meta-weekly-completeness.test.mjs`: 실제 함수 추출 기반 수집→어댑터→생성→불변 발행본 통합 검증.
- `test/meta-issued-report.test.mjs`, `test/meta-inflow-weekly-orders.test.mjs`, `test/weekly-report-phase2.test.mjs`: 명시적 coverage 계약과 VM 의존성 갱신. 기존 단언 유지.
- 이 문서. 최종 커밋 해시는 완료 응답에 기록한다.

## 3. 완전성 판정 기준

| 소스 | COMPLETE 근거 | 차단 조건 |
|---|---|---|
| Meta Insights | 요청 기간/level 일치, data 배열, 100건 미만, next 없음, 모든 raw 행 spend/impressions/clicks 및 actions/action_values 명시 | next/100건은 PARTIAL; 필수 지표 누락·legacy/stale/fallback 캐시는 UNKNOWN; 요청 실패는 UNAVAILABLE |
| Cafe24 Orders | strict reader의 실제 마지막 짧은 페이지, 상한 미달, 주문 ID/기간 유효, item fetch 성공 | 상한/미종료·상품 조회 실패는 PARTIAL; 식별·기간 불명 UNKNOWN; 오류 UNAVAILABLE |
| Cafe24 Analytics | orderdetails 배열, 100건 미만, next 없음, reported total과 모순 없음, 유효 ID/기간/금액, ad/medium/campaign/content/keyword 문자열 명시 | 한도/추가 페이지 PARTIAL; 유입 필드 포함 필수 값 누락 UNKNOWN; 응답/인증 실패 UNAVAILABLE |
| 결합/검수 | 2개 기간 × Meta 3개 level, Orders와 Analytics 모두 COMPLETE + 기존 결제/환불/검수 조건 | UNAVAILABLE > PARTIAL > UNKNOWN > COMPLETE 우선순위. UNKNOWN_ADJUSTMENT 차단 |

명시적 빈 배열/빈 유입 문자열은 실제 응답으로 구분한다. 생략된 필드를 빈값이나 0으로 채워 COMPLETE로 만들지 않는다. 기존 화요일 10시 KST 자동 생성→자동 검수 PASS 승인(`META_AUTO_PASS_V1`) 흐름을 유지한다. PREVIEW/실패/미검수/과거 Excel 소급 등록은 없다.

## 4. 테스트 결과

- 새 Analytics 누락 회귀: 수정 전 2개 실패 확인, 수정 후 통과. 별도 read-only 리뷰에서 문제 해결 확인, 추가 중요 지적 없음.
- 관련 회귀 215/215 PASS: Meta, Instagram, Naver, 스케줄러, Dropbox 전달, 발행/환불/불변 저장 포함.
- 전체 동일 조건 비교: 기준 1,693개 / PASS 1,628 / FAIL 63 / SKIP 2; 변경 후 1,708개 / PASS 1,643 / FAIL 63 / SKIP 2. 실패명 집합 일치, 신규 실패 0. 테스트는 각 별도 소스 사본에서 실행했다.
- `npm run check`, `git diff --check` 통과.
- 완전한 fixture는 실제 수집 함수→주간 어댑터→자동 검수 PASS→manifest 등록까지 통과. PARTIAL, raw 금액 누락, Analytics 유입 누락은 등록 차단.
- 10/11 주문 `20261011-0000055` 198,000원 → 10/19 전액 환불: 전주 발행값 198,000원 보존, 현재 순매출 0원, 환불 조정 −198,000원 확인. 부분 환불/일부 상품 반품/중복 주문·환불/발행본 중복/발행본 없음/재조회 실패/UNKNOWN_ADJUSTMENT/Render 미검증 경로 차단도 기존 회귀 통과.
- REPORT 1페이지 및 Meta 플랫폼 귀속 1,720,000원과 실제 매출 분리 유지. Instagram/Naver 소스·템플릿 변경 없음.

## 5. 실제 데이터 기준 자동 발행 가능 여부

**현재는 불가(완전성 검증 미충족).** 2026-10-20 Render Shell에서 캐시/마운트 읽기 및 원본 GET만 수행했다. 토큰/고객정보/원본 주문을 문서나 로그에 저장하지 않았다.

Meta 원본은 두 기간의 campaign/adset/ad 모두 HTTP 200, next 없음. 하지만 action_values가 아래처럼 생략됐다. 생략을 0으로 해석한다는 검증 근거가 없어 새 판정은 UNKNOWN이며 강제 PASS하지 않는다.

| 기간 | campaign: 반환/금액필드 누락 | adset | ad |
|---|---:|---:|---:|
| 10/06–12 | 6/2 | 9/5 | 17/11 |
| 10/13–19 | 4/1 | 7/4 | 9/5 |

6개 기존 Meta 캐시 모두 coverage 없음 → UNKNOWN. 수집 코드 배포만으로 과거 캐시에 COMPLETE를 소급 부여하지 않는다.

Cafe24 저장 토큰으로 직접 Admin Orders 및 Analytics GET는 HTTP 401이었다. 정상 서버 경로는 토큰 갱신 및 저장을 수행할 수 있으므로 운영 데이터 변경 금지에 따라 호출하지 않았다. 이는 서버의 정상 갱신 경로까지 실패한다는 의미가 아니다. 현재 source 완전성은 이 읽기 전용 검사로 확인 불가하다. 기존 캐시의 0건 값도 완전성 증거로 사용하지 않았다.

## 6. Render 영속성 및 남은 배포 차단

읽기 전용으로 WORK_DIR 실경로 `/var/data/samplas-dashboard/work` 확인. `/proc/self/mountinfo`에서 `/var/data`가 ext4 장치 마운트임을 확인했다. 기본 발행본 경로는 `/var/data/samplas-dashboard/work/reports/meta-ads-weekly/issued/<since>_<until>/`이며 workbook/manifest/hash/주문별 금액/발행·검수 시각/검수 결과를 불변 보존한다. 기존 저장 검증 코드를 유지했고, 디스크 없는 Render에서는 발행 차단 테스트가 통과했다. 재시작 전후 쓰기 시험은 운영 변경이므로 수행하지 않았다.

남은 차단 사항:

1. 실제 Meta action_values 생략 의미에 대한 공식/계정 원본 근거 또는 별도 검증이 필요하다. 임의 0 채움은 하지 않았다.
2. Cafe24 정상 인증 갱신이 허용된 운영 절차에서 두 기간 Orders/Analytics를 다시 조회하여 COMPLETE 증거를 확인해야 한다. 이번 진단에서는 갱신하지 않았다.
3. 변경 후 신규 수집 결과로 end-to-end 검수 및 실제 화요일 실행 결과를 확인해야 한다. 로컬 fixture PASS는 실제 데이터 PASS의 대체가 아니다.
4. push/Production 배포는 미승인이다. 디스크 경로 존재/마운트는 확인되어 경로 미확인 차단은 해소됐지만 재시작 내구성 실증은 미수행이다.

## 부록: 기준과 동일한 전체 테스트 실패명

환경의 포트 바인딩 제한/fixture 미포함 및 기존 기능 실패가 포함된다. 이번 변경의 신규 실패가 아님을 실패명 집합 비교로 구분했다.

- 1. default store = ALL preserves the legacy-fallback result (no per-store files yet)
- 10. ALL offlineSales.byStore sums to offlineSalesAmount when both stores complete
- 11. partial upload (APGUJEONG only) surfaces storesIncluded/storesMissing so VAIL is distinguishable from a real zero
- 11/12. byStore is present and consistent regardless of storeCode filter (usable as canonical ALL share denominator)
- 13. ALL: total = online + offline invariant unchanged from pre-STORE-BATCH-C behavior
- 13/14/15. legacy null-store is neither APGUJEONG nor VAIL; missing store is not a fabricated zero
- 14. store=ALL result is byte-identical whether requested explicitly or omitted
- 2. ALL total = APGUJEONG offline + VAIL offline (exact regression)
- 20/21. Brand APGUJEONG/VAIL offline revenue is correct and store-isolated
- 3/4. storeCode=APGUJEONG / VAIL route to the exact matching filter (not ALL)
- 5/6. APGUJEONG filter excludes VAIL's offline lines and vice versa
- 7/8. online total is identical across ALL/APGUJEONG/VAIL (never store-attributed)
- 7/8/9. APGUJEONG revenue excludes VAIL, VAIL excludes APGUJEONG, both exclude online
- 9/10. a legacy (pre-store-separation) month returns 0 for both APGUJEONG and VAIL filters, never guessed
- APGUJEONG and VAIL canonical offline totals remain unchanged
- APGUJEONG and VAIL category accounting reconciles to each canonical store total
- ASSETS: session folder by number, categories, specs, carousel order, editing leftovers skipped; 002 empty; 003 no folder
- ASSETS: thumbnails and temporary links only for paths inside that session's folder; no auth, no data
- Cafe24 proxy Basic auth is the internal credential; it never authorizes an operator session and the legacy token is ignored
- ChatGPT parity: published schemas accept every argument the operations take, and the SDK client runs the full TODO/NOTES cycle
- ChatGPT schedules the event and runs the TODO list through updateSessionProject; the web app reads the same tasks
- Clients 'this month' ends at the ECOUNT as-of date; explicit ranges keep partial-coverage nulls
- HTTP: anonymous reads are refused; Basic, operator session and /healthz work; wrong credentials do not
- MCP initialize, exactly 10 read-only tools with samplas.read security, tool execution
- MCP_AUTH_MODE=none: no token needed; no OAuth config or metadata; tools stay read-only
- REST: a write that does not read back as written is not reported as success
- REST: create, read, cue sheet, operation update with 409, read-back and approver role
- REST: only the session credentials open the routes; operators come from Render's own list
- STEP63-2B: BON CO productName → BONNAE, Brand Master 1차 조회로 성공
- STEP63-2B: SUN CO productName → SUNDAY OFF CLUB(선데이오프클럽), 온라인 카탈로그 2차 조회
- STEP63-2B: onlineCatalog를 넘기지 않으면 STEP63-2와 동일하게 동작(하위 호환)
- auth domains are separate: Basic for internal routes, AI_AUDIT_SECRET for AI audit, no cross-acceptance
- auth: every invalid credential gets 401 + WWW-Authenticate; valid read token works
- authenticated HTTP bulk refresh onboards NEW only; reassignment needs explicit review; GET/dry-run are pure
- buildCafe24EcountProductMatchingDiagnostic: 237개 전체 Cafe24 상품이 display/selling과 무관하게 결과에 반영된다
- dev-noauth rejects browser Origin (DNS rebinding guard)
- every Production resolver consumer receives canonical runtime workDir
- excluded product codes (payment/operational lines) never appear in the Category Review audit
- final-test flow in miniature: read cue sheet, edit one MC note, read back, web sees it, stale version gets 409
- gate decision: public allowlist, AI audit prefix, loopback needs a loopback socket, rollback switch
- getJson passes query params, maps statuses and never forwards HTML
- invalid or empty MCP_AUTH_MODE fails closed even with OAuth configured
- loadResolverContext(): work/brand-master.json을 읽기만 하고 수정하지 않는다
- misconfiguration fails closed; dev-noauth only off Render and on loopback
- operator session and ECOUNT import use the dedicated credential over real HTTP
- participants API: off until every guard is set; then sync, ops with version check, server-side capacity; 001/002 never publish a form link
- private asset and participant MCP reads reuse the operator service without writes
- protected resource metadata advertises only samplas.read
- real Brand Master is parseable and auditable without fixed issue counts
- real CARNET August offline lines are canonical-resolved once on the server
- real HTTP read/refresh contract: auth, pure GET, missing canonical and grandfathered flags
- real external MCP SDK initialize/list/get/write over HTTP; auth denies, GET 405
- request guards: body size, method, other paths
- review artifact loads and reflects the fully-classified post-rules-update set (0 remaining)
- route: closed month with null archive total returns canonical known amounts and partial metadata; complete month unchanged
- route: past-month Monthly shows the canonical view while the saved archive file stays byte-identical
- saved historical close returns an explicit HTTP conflict before parsing or writing snapshots
- server.mjs: the session routes ignore the generic /api credentials and loopback access
- store TOP brands reuse canonical identity and never cross store boundaries
- timeout and concurrency: upstream hang is UPSTREAM_UNAVAILABLE; at most 2 concurrent
- timetable additions preserve existing tool read/write annotations; the MCP secret is separate from the web secret
- wire format: initialize, id preservation, notifications, unknown method, malformed JSON-RPC
- writes are off by default; test-only opens test sessions only
