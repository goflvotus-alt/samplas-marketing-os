# Meta 주간 발행본 및 환불 비교 — 로컬 구현 결과

작성일: 2026-10-20 KST. 기반: Live `7f2c6538a4dbc2282aa8bb142dab10e7367db50c`. 브랜치: `codex/meta-issued-adjustments`.

## 현재 구조 이해·수정 범위

Meta 주간 생성기는 기존 server scheduler에서 화요일10시 KST에 호출되며, 기존 Admin Orders/Analytics adapter와 pluggable saveReport를 사용한다. 종전에는 전주를 현재 상태로 재조회해 비교했다. 별도의 검수 발행 ledger가 없어 발행 시점 값을 구별할 수 없었다.

이번 변경은 생성기 및 Meta 표시·발행 근거에만 한정했다. server.mjs, canonical 주문금액/취소·환불 판정, Meta attributed 수치 계산, Instagram 및 Naver 생성·저장 흐름은 변경하지 않았다. 기존 작업본을 건드리지 않고 새 로컬 clone의 깨끗한 Live 커밋에서 작업했다. 기존 Evidence Phase1/1.2 미배포 브랜치를 기반으로 삼지 않았다.

## 변경 파일·실제 수정

- scripts/meta-issued-report.mjs (신규): AUTO_PASS_V1 검수, 주문별 발행 ledger, 환불 대조, 해시 검증, 영구 디스크 확인, 기간 단위 배타 lock 및 immutable 저장.
- scripts/meta-ads-weekly-report.mjs: 기존 scheduler 호출 형태를 자동 발행 경로로 연결. 검증된 전주 발행본 사용, 재조회 순매출 별도 보존, 상세 시트 추가, 조건 미달 발행 차단.
- scripts/weekly-onepage-report.mjs: Meta REPORT의 기존 비교값에 발행 당시 수치를 사용. 기존 판단 행에 발행 매출·후속 환불 조정·현재 기준 순매출을 표시. 1페이지 print area, 행·열 배치·높이 및 Instagram/Naver 분기 유지.
- scripts/weekly-report-manual.mjs: Meta PREVIEW를 명시적으로 표시하여 화요일10시 실행해도 발행 ledger 등록을 차단.
- test/meta-issued-report.test.mjs: 27개 회귀 테스트.
- 이 결과 문서.

REPORT의 기존 22·23행 전주 열은 검수 발행값을 사용하고, 기존28행에 발행 당시 매출 / 후속 환불 조정 / 현재 기준 순매출을 구분해 표시한다. REFUND_ADJUSTMENTS에 주문번호·주문일·취소/환불일·환불금액·발행 기준일·현재 상태·전후 금액·검증 결과를 기록한다. ISSUED_COMPARISON에 비교 기준 시각과 요약도 보존한다.

## 자동 PASS를 발행 승인으로 인정하는 정책

명칭: META_AUTO_PASS_V1. 기존 화요일10:00~10:59 KST 생성 시도만 자동 발행 대상이다. 실제 시작 시각과 검수/발행 기준 시각을 기록하며10:00으로 임의 보정하지 않는다. referenceDateKey+strict onePage를 전달하는 기존 scheduler 호출은 자동 검수를 거친다. PREVIEW는 명시적으로 제외하고, 기존 일반 library/CLI 호출은 draft로 남는다. 자동 모드가 허용 시간·기간 밖이면 unreviewed final 저장으로 우회하지 않고 AUTO_PUBLICATION_WINDOW_CLOSED로 실패한다.

PASS의 필수 조건:

1. 당주·전주 campaign/adset/ad 모두 명시적 COMPLETE 근거, 사용 가능한 필수 수치, 실패·PARTIAL·미검증 coverage 표시 없음. 완전성 정보가 없으면 추정 PASS하지 않는다.
2. 당주·전주 Admin/Analytics provenance와 bounded coverage 정상. inflow5개 모두 정상이며 실제 건수가500 미만. Analytics100 미만, Admin500 미만. 소스 실패·누락·상충 snapshot은 차단.
3. 발행할 Meta 실제 주문의 결제 완료·명시적 금액·주문일 및 canonical 금액 일치. 이 gate는 발행 승인 여부만 결정하며 기존 canonical 금액을 다시 계산하거나 바꾸지 않는다.
4. 전주 현재 재조회가 정상. 발행본이 있다면 주문별 차이가 모두 확인된 후속 취소·반품·환불로 설명되어야 한다. UNKNOWN_ADJUSTMENT는 실패.
5. Render 실행이면 실제 /var/data 별도 디스크 마운트 아래 저장 경로여야 한다. 경로 문자열이나 .env 선언만으로 승인하지 않는다.
6. 동일 기간 배타 lock을 소유한 실행만 검수된 byte buffer를 기존 saveReport에 전달할 수 있다. 업로드 실패, 기존 unverified final 존재 응답, PREVIEW 경로 응답은 발행 ledger 확정으로 이어지지 않는다.

PASS 후 정상 저장/전달까지 성공한 경우만 issued/<기간>/으로 atomic rename되어 확정 발행본이 된다. .pending-*는 조회 대상이 아니다. 파일 이름이나 업로드 성공·파일 크기만으로 과거 Excel을 소급 등록하지 않는다.

## 발행본 저장 경로·검증 기준

기존 resolveMetaWeeklyReportOutputDir를 재사용한다.

- 기본: ${WORK_DIR}/reports/meta-ads-weekly/issued/<since>_<until>/
- META_ADS_WEEKLY_REPORT_DIR가 있으면 그 폴더 아래 issued/ 사용.
- 파일: report.xlsx, manifest.json. 기존 발행본은 덮어쓰지 않는다.
- manifest: policy/schema, 기간, generatedAt, issuedAt, reviewedAt, 검수 결과·오류, 실제 주문 수·금액, 주문별 금액·상품 코드/수량/금액, SHA-256.
- report.xlsx에는 같은 비개인정보 ledger를 veryHidden ISSUE_EVIDENCE에 보존한다. 재조회 때 SHA-256, policy와 PASS, 기간·시간, 합계·주문 중복, manifest와 workbook ledger 일치를 검증한다.
- 검증된 전주 발행본이 없으면 발행 금액과 조정은 UNAVAILABLE(null)이며 현재 재조회 순매출은 독립적으로 표시한다. 0으로 대체하지 않는다. 기존 issued artifact가 손상되거나 변조된 경우에는 조용히 무시하지 않고 명시적으로 실패한다.

운영 설정에서 예상되는 실제 경로:
`/var/data/samplas-dashboard/work/reports/meta-ads-weekly/issued/<since>_<until>/`

이 작업에서는 위 운영 경로를 생성하지 않았다. 로컬 테스트의 발행본은 App/_temp/meta-issued-tests/runtime/ 아래에서 생성·검증했다. 과거 Excel을 운영/로컬 실발행 ledger로 소급 등록하지 않았다.

## 영속성 확인 결과

Render read-only service 조회:
- service srv-d930l06h2hms73d203n0, plan starter
- disk dsk-d98f0cmq1p3s738ba3kg, mountPath /var/data, 1GB

운영 Shell에서 읽기 전용 확인:
- WORK_DIR=/var/data/samplas-dashboard/work
- realpath(WORK_DIR) 동일
- META_ADS_WEEKLY_REPORT_DIR 미설정
- /proc/self/mountinfo: `14311 14272 259:11 /data /var/data rw,relatime - ext4 /dev/nvme7n1 rw`

Render 제어면의 disk 부착과 실제 별도 ext4 마운트를 교차 확인했다. 디스크 미연결/미확인 상태는 아니다. 운영 쓰기·재배포·재시작을 하지 않아 새 issued 경로에 대한 운영 write/read-back 및 재시작 후 보존 실험은 수행하지 않았다. 런타임 코드도 마운트가 확인되지 않으면 자동 발행을 차단한다.

## 환불 인정 기준

발행 당시 주문과 현재 같은 주문을 대조한다. 재조회에서 주문이 사라졌거나 유입만 바뀐 경우, 설명되지 않는 증가, 상쇄되는 다른 주문 변경, 상충 snapshot은 UNKNOWN_ADJUSTMENT다.

전액 취소·반품은 현재 canonical0, 실제 취소·반품 상태, 발행 이후/조회 이전 완료 일시가 모두 있을 때만 기존 발행 금액의 감소를 인정한다. 부분 환불은 동일 주문의 후속 refund_date 및 actual_refund_amount가 있는 refund resource, 또는 발행 ledger의 동일 상품·수량 및 확정 반품 항목으로 감소액을 대조한다. 중복 이벤트/품주코드는 한 번만 집계한다. 할인·배송·포인트 때문에 상품금액만으로 환불액을 확정할 수 없으면 UNKNOWN으로 남긴다. 금액 차이만 보고 환불이라고 붙이지 않는다.

별도 Refunds API 호출은 추가하지 않았다. 기존 입력에 반환된 원본만 사용한다. 실환불금액이 필요한 복잡한 부분 환불인데 현재 adapter가 그 원본을 제공하지 않으면 자동 발행을 차단한다.

Cafe24 공식 필드 참고: [Refunds properties](https://developers.cafe24.com/docs/en/api/admin/?version=2025-12-01#refunds), [Retrieve a refund](https://apidocs.cafe24.com/en/docs/2026-06-01/admin/get-refunds-by-refund-code). order_id/refund_code/refund_date/actual_refund_amount를 기준으로 하며, 단순 접수일을 완료일로 사용하지 않는다.

## 요청 시나리오 재현·검증 결과

로컬의 통제된 API fixture와 실제 canonical/생성기/Excel 저장·재열기를 사용했다. 과거 Production을 수정하거나 발행본을 소급 생성한 것이 아니다.

| 시점/지표 | 결과 |
|---|---:|
| 10/11 결제 주문20261011-0000055 | 198,000원 |
| 10/13 화요일10시 PASS 발행 ledger | 1건 / 198,000원 |
| 10/19 전액 반품·환불 fixture | 현재 canonical0원 |
| 10/20 보고서의 전주 발행 금액 | 198,000원 유지 |
| 후속 환불 조정 | −198,000원 |
| 현재 기준 순매출 | 0원 |
| 전주 발행 manifest bytes | 재조회 전후 동일 |
| Meta 귀속 매출 fixture | 1,720,000원 유지·실제 매출과 별도 |

27개 신규 테스트는 전액·부분 환불, 여러 상품 중 일부 반품, 중복 주문·환불 이벤트, 발행본 없음, 검수 실패/해시 변조 제외, 이전 재조회 실패/PARTIAL, 결제 근거 부족, 할인 부분반품 근거 부족, 서로 상쇄되는 UNKNOWN, 미검수 기존 파일 소급 등록 차단, 저장 실패/재시도, 동시 발행, 시간대 밖 발행 차단, Render 디스크 미확인 차단을 포함한다. 대표 회귀를 먼저 실패시킨 뒤 구현하여 통과시켰다.

최종 검증:
- 신규 테스트27 PASS /0 FAIL.
- Meta·Instagram·Naver·공통 주간·Dropbox 관련200 PASS /0 FAIL.
- 전체 baseline: 1666 tests =1601 PASS /63 FAIL /2 SKIP.
- 전체 변경본: 1693 tests =1628 PASS /63 FAIL /2 SKIP.
- 전체 실패 이름 집합을 비교하여 신규 실패0, 기존 실패63개 동일 확인. 전체 suite가 green이라고 주장하지 않는다. sandbox 로컬 포트 제한·누락 로컬 fixture 및 기존 실패를 범위 밖 변경으로 고치지 않았다.
- npm run check, 변경 모듈 node --check, git diff --check 통과.
- canonical/server/Instagram/Naver 구현 변경 없음.

## 배포 차단 사항·남은 이슈

1. **배포 미승인:** 이 작업은 로컬 구현·테스트·커밋까지다. GitHub push, Production 배포, 운영 데이터·설정·Dropbox 쓰기 없음.
2. **Live adapter의 coverage 전달 누락:** server.mjs의 buildMetaAdsSummaryForWeeklyReport는 rows/totals만 반환하여 원본 완전성 정보를 잃는다. 새 정책은 이를 COMPLETE로 꾸미지 않으므로 현 Live adapter 입력으로는 AUTO_REVIEW_FAILED가 된다. 배포 전 실제 근거를 보존·검증해 전달하는 연동이 별도 승인 범위에서 필요하다. 상수 COMPLETE를 붙이는 것으로 해결하면 안 된다. server.mjs 수정 금지 범위를 지켰다.
3. 과거 발행 ledger를 소급 등록하지 않았으므로 초기 전주 발행값은 UNAVAILABLE가 정상이다. 기존10월13일 Excel의198,000원을 자동 복구하지 않는다.
4. 프로세스 중단으로 .lock/.pending이 남으면 자동 확정하지 않는다. 운영자가 전달 파일과 hash를 확인하여 복구 여부를 판단해야 한다. 업로드된 파일의 존재·크기만으로 재등록하지 않는다.
5. 실제 Render 런타임의 새 코드·자동 clock trigger·새 폴더 write/read-back 검증은 미배포로 미실시. 영구 디스크 마운트 자체는 확인됐다.

## 전체 suite의 기존 실패 목록 (양쪽 동일63개)

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
