# SAMPLAS Platform Hardening & Automation — Mega Batch — 2026-08-26

**상태: PARTIAL COMPLETE — 코드/자동화 목표 전부 완료, Render 데이터 gap 1건 발견(수정은 별도 승인 대기)**

## Purpose

Batch 4.6/5/6로 Local→Render migration이 끝난 뒤 남은 technical debt를
정리하고, 반복적인 production validation/persistent-data 배포를
자동화하는 대규모 hardening batch. 7개 목표: (1) 기존 tracked modified
2개 처리, (2) Brand Registry bootstrap-once 근본 수정, (3) persistent data
배포 구조 정리, (4) Local↔Render parity checker 자동화, (5) production
smoke-test 자동화, (6) AI Audit 존재 여부 전체 감사, (7) 운영 문서 완성.

## Baseline

```
branch: main
HEAD = origin/main = 0a7846062eb76ecd75a576ddcfd3314ce79f02df (0/0)
staged: 없음
tracked modified 2개(예상과 일치): scripts/diagnose-cafe24-ecount-product-matching.mjs, scripts/load-ecount-offline-sales.mjs
untracked: 116(Batch 5 분류와 일치)
```

## Architecture Audit

Read-only 조사로 확정한 데이터 흐름 구분:

| 범주 | 예시 | 비고 |
|---|---|---|
| Git-tracked source | `server.mjs`, `intelligence-service.mjs`, `scripts/*.mjs` | 코드, push만으로 Render에 배포됨(자동) |
| Git-tracked generated artifact | `work/product-registry.json`, `work/store-master.json` 등 16개 | force-add된 데이터 — **git push로 Render에 반영되지 않음**(WORK_DIR이 별도 영구 디스크) |
| gitignored generated artifact | `work/price-audit.json`, `work/intelligence/brand-*.json`, `work/ecount-*/*.json` | Local 전용, Upload API로만 Render에 반영 |
| Render persistent snapshot | `/var/data/samplas-dashboard/work/*` | git 체크아웃과 완전히 분리, `WORK_DIR` env로 지정 |
| Live API data | Cafe24 온라인 주문, Instagram 등 | 매 요청 실시간 조회 |
| Derived cache | `work/intelligence/brand-master-list.json`/`brand-aliases.json` | canonical `brand-master.json`으로부터 파생, 이번 Batch에서 auto-rebuild로 전환 |
| canonical source | `work/brand-master.json`, `work/product-registry.json`, `work/store-master.json` | 사람이 직접 편집하는 진실의 원천 |

핵심 구조적 사실(Batch 6에서 이미 확인, 이번에도 재확인): **git push는
코드만 배포한다. `work/` 데이터는 (a) git-tracked이지만 Render 실행
데이터에 자동 반영 안 됨, 또는 (b) Upload API로 명시적 업로드해야만
반영된다 — 이 둘 중 하나다.** 이 batch에서 이 구조가 Brand Registry에도
동일하게 적용된다는 것이 다시 한번 실증됨(아래 Brand Registry Hardening
참조).

## C. Tracked Modified Files — 처리 완료

### 1. `scripts/diagnose-cafe24-ecount-product-matching.mjs`
**판정: KEEP AND COMPLETE.** `ecountProductsOverride` 옵션은 기존
`cafe24ProductsOverride`(이미 테스트/실사용 중)와 대칭인 안전한 추가
주입점 — 기본 동작(옵션 없으면 `work/ecount-inventory/latest.json` 읽기)
완전히 그대로 유지. 테스트 커버리지 추가(`test/cafe24-full-product-catalog.test.mjs`)
후 커밋(`7932b9c`).

### 2. `scripts/load-ecount-offline-sales.mjs`
**판정: KEEP AND COMPLETE.** compact `YYYYMMDD` 날짜 지원 확장 검증:
- 실제 필요성: 2026-08-19 작업 이력(backup 파일 타임스탬프)이 뒷받침.
- 기존 포맷(`YYYY/MM/DD`) 회귀 없음 — 테스트로 확인.
- Malformed date(`2026-08-13 -2`, 대시 구분): 조용히 skip, 크래시/오파싱
  없음 — 테스트로 확인.
- 연/월 경계(`20261231 -5` → `2026-12-31`): 자릿수 bleed 없음 — 테스트로
  확인.
- Warehouse routing과 무관, 회귀 없음.
테스트 4건 추가(`test/ecount-offline-sales-sheet.test.mjs`) 후 커밋(`57f4069`).

두 파일 모두 처리 완료 — worktree에 unrelated modified 없음.

## D. ECOUNT Result

```
commit 57f4069: fix(ecount): support compact detail dates
- detailDatePattern: 슬래시(YYYY/MM/DD)와 compact(YYYYMMDD) 둘 다 허용
- 신규 테스트 3건: compact 포맷 인식, 연말 경계, malformed 포맷 reject
```

## E. Brand Registry Hardening

### 설계
`ensureBrandRegistryFiles()`의 bootstrap-once(`if (!existsSync(...))`)를
canonical `work/brand-master.json`의 **mtime+size(빠른 1차 필터) + content
hash(정확한 2차 확인)** 기반 auto-rebuild로 교체(OPTION A/C 결합 — 매
요청마다 전체 파일을 재해시하는 비용 없이, stat 1회로 대부분의 요청을
빠르게 통과시키고 실제 변경 시에만 hash까지 계산). 선택 근거: OPTION B(순수
mtime)는 checkout/재배포로 mtime만 바뀌고 내용은 그대로인 경우를 구분 못해
불필요한 rebuild를 유발할 위험이 있고, 순수 content hash를 매 요청마다
계산하면(brand-master.json이 수백 KB) 요청마다 불필요한 CPU 비용이 든다 —
두 접근을 결합해 각각의 약점을 상쇄했다.

- **canonical 불변 → rebuild 없음**: stat 1회로 확인, 파일 재작성 없음(바이트 단위 무변화 테스트로 확인).
- **canonical 변경 → 자동 rebuild**: hash mismatch 감지 시 두 파생 파일을
  temp+rename으로 원자적으로 재생성, `brand-registry-build-meta.json`
  (새 sidecar, sourceHash/generatedAt/counts 기록)로 다음 확인을 빠르게 함.
- **canonical 깨짐(active key conflict/malformed JSON) → 기존 valid derived 보존**:
  read 자체는 실패하지 않고 마지막 유효 상태를 그대로 서빙, 콘솔에 경고만 남김.
- **동시 요청 dedupe**: in-flight promise 공유로 여러 요청이 동시에 rebuild를 중복 실행하지 않음.
- **alias collision 정책**: `buildIntelligenceBrandRegistry()` 자체는 무수정 — active key conflict 시 여전히 throw.
- **`B0000000` placeholder**: 기존 스킵 로직 무수정.

### 테스트(7개 요구사항 전부 커버, `test/brand-registry-auto-rebuild.test.mjs`)
1. derived missing → build ✅
2. derived current → no rebuild(파일 바이트 무변화) ✅
3. canonical changed → rebuild ✅
4. aliases updated ✅
5. collision behavior unchanged(순수 builder 직접 호출 시 여전히 throw) ✅
6. broken canonical(collision + malformed JSON 둘 다) → 기존 valid derived 보존 ✅
7. no half-written pair(brandId 참조 무결성) ✅

commit `2c9fee2`.

### **배포 후 발견된 실제 데이터 gap(중요 — 코드 버그 아님)**
이 fix를 Render에 배포한 직후 `npm run verify:production`으로 확인한
결과, Render의 Brand Registry가 **278/361 → 277/293으로 오히려
후퇴**했다. 원인 조사(§Production Verification 상세) 결과: 이 fix
자체의 버그가 아니라, **`work/brand-master.json`(canonical)이 이 세션
전체에서 단 한 번도 Render에 업로드된 적이 없었다**는 사실이 이번에
처음 드러난 것이다. 과거에는 Local에서 만든 파생 파일만 직접 Render에
업로드해 왔고(Batch 3.5 패턴), bootstrap-once 설계가 Render의 stale한
자체 canonical을 다시 들여다보지 않았기 때문에 이 gap이 가려져 있었다.
이번 fix가 "canonical이 바뀌면 다시 본다"를 올바르게 수행하자, Render가
자신의(스테일한) canonical을 기준으로 재계산해 가려져 있던 차이가
표면화됐다. 실측 diff: Local에만 있는 브랜드 1개(`B0000COL`
"MEANTIME X SUNDAYOFFCLUB", 세션 초반 Local에만 수동 추가), 그리고 기존
공통 브랜드들의 alias 차이 67건(누적 편집 이력). **원인은 명확하고
canonical(Local)도 명확하지만, 이번 batch의 명시적 규칙("persistent
snapshots를 자동 overwrite하지 마세요, 발견 시 report 후 별도 sync
판단")에 따라 자동으로 업로드하지 않았다** — 상세 진단과 권장 해결
절차는 아래 Production Verification 및
`docs/SAMPLAS-OPERATING-BASELINE.md` §5/§9에 기록.

## F. Persistent Snapshot Architecture — Manifest 통합

`server.mjs`(`workDataUploadPaths`)와
`scripts/upload-work-snapshots-to-render.mjs`(`explicitPaths`)가 동일한
allowlist를 각자 하드코딩해 온 구조 — Batch 6에서 `product-registry.json`이
두 곳 모두에서 누락된 채 방치됐던 것과 같은 drift가 구조적으로 가능했다.
새 공유 모듈 `scripts/render-snapshot-manifest.mjs`(`RENDER_SNAPSHOT_EXPLICIT_PATHS`,
`RENDER_SNAPSHOT_MONTHLY_PATTERN`, `isAllowedRenderSnapshotPath()`)를
양쪽이 공통으로 import하도록 리팩터링 — 억지로 새 추상화(예: 별도
manifest 파일 포맷, config loader 등)를 만들지 않고, 기존 상수/정규식을
그대로 한 파일로 옮긴 최소 변경. 허용 경로/월별 정규식 동작은 기존과
완전히 동일(회귀 없음, 신규 테스트 4건으로 확인). commit `3b0e431`.

## G. Parity / Smoke Tooling

`scripts/verify-render-snapshot-sync.mjs`(신규) + `npm run
verify:production`:
- READ ONLY 기본 — GET만 수행, 어떤 것도 업로드/덮어쓰기/재시작하지 않음.
- 13개 도메인: Status, Today, Monthly(current/historical), Annual,
  Clients, ECOUNT current month, Store Master, Inventory, Brand
  Registry, Product Registry, Price Audit, Frontend bundle hash.
- Strict 비교(정적/과거 확정 데이터): Historical Monthly, Annual(합계),
  Brand/Product Registry, Price Audit, Store Master, Frontend.
- Live-aware 비교(당월/rolling 데이터, 1회 재시도 후에도 다르면 FAIL이
  아니라 WARN): Today, Monthly current, Clients, ECOUNT current month.
- `--only <key1,key2>`로 선택 검사, `--json`으로 machine-readable 출력.
- 핵심 비교 로직은 `checkXxx(local, render)` 형태로 export되어 있어
  fixture/mock(`global.fetch` stub)만으로 네트워크 없이 단위 테스트 가능
  (`test/verify-render-snapshot-sync.test.mjs`, 8건).
commit `6f2b9cf`.

## H. AI Audit Forensic Result

**Classification B — backend-only by design, 회귀 아님.** 별도 report
`docs/reports/ai-audit-feature-forensic-2026-08-26.md`에 전체 근거(빌드
이력, git 히스토리 `-S` 검색, 실제 라우트 동작, `docs/samplas-ai-audit-setup.md`
의 ChatGPT Custom GPT Action 아키텍처)를 기록. 조치 불필요 — 새로
만들지도, 복구하지도 않음.

## I. Test Results

```
node --test "test/**/*.test.mjs"
tests 799, pass 797, fail 2 (Batch 7 시작 전부터 존재하던 pre-existing 실패,
  이번 batch의 변경과 무관 — "APGUJEONG and VAIL canonical offline totals
  remain unchanged", "18. existing Today (Overview) view markup preserved".
  git stash로 이번 batch의 신규 테스트만 제외하고 재실행해도 동일하게
  실패함을 확인해 pre-existing임을 검증함)
```
이번 batch에서 추가된 테스트: 3(ECOUNT compact-date) + 1(ecountProductsOverride)
+ 6(Brand Registry auto-rebuild) + 4(manifest consistency) + 8(parity
checker core logic) = 22개, 전부 PASS. 실패 테스트를 숨기거나 skip 처리한
바 없음.

## J. Code Quality Self-Review

- **중복 로직**: `checkHistoricalMonthly`/`checkAnnual`의 월 순회 로직이
  유사하나(3줄 수준), 각각 다른 집계 목적(개별 비교 vs 합계)이라 억지로
  공통 함수로 묶지 않음(ponytail 원칙 — 조기 추상화 금지).
- **hardcoded paths**: 새 코드에 로컬 절대경로(`/Users/binggu/...`) 없음(grep으로 확인).
- **broad permissions**: 새 upload allowlist 변경 없음(manifest 통합은 기존 목록 그대로 이동만).
- **async race**: Brand Registry rebuild는 in-flight promise dedupe로 처리.
- **partial writes**: Brand Registry 두 파생 파일 모두 temp+rename 후 마지막에만 교체(no half-written pair, 테스트로 검증).
- **stale cache**: Brand Registry의 `brandRegistryStatCache`는 프로세스 재시작마다 초기화되고, canonical 변경 감지 시 즉시 갱신 — 무기한 stale 위험 없음.
- **production mutation risk**: 새로 만든 두 스크립트(parity checker, manifest) 모두 GET 전용/상수 정의만, 어느 것도 자동으로 upload를 트리거하지 않음.
- **credential exposure**: 새 코드 어디에도 토큰/시크릿을 로그에 출력하지 않음 — parity checker는 인증이 필요 없는 공개 GET 엔드포인트만 호출.

## K. Commits

```
57f4069 fix(ecount): support compact detail dates
7932b9c test(diagnose): wire ecountProductsOverride injection point
2c9fee2 fix(brand-registry): rebuild derived data when source changes
3b0e431 refactor(render-data): unify upload allowlist into a shared manifest
6f2b9cf feat(ops): add production parity verification
```
각 커밋 정확한 scope만 stage(unrelated 2개 파일 미포함), cached diff
확인 후 커밋 — 5개 모두 독립적으로 되돌릴 수 있는 단위.

## L. Render Deployment

```
git fetch origin → 0 ahead/5 behind 확인 전 → push → HEAD = origin/main = 6f2b9cf
```
Render 자동 재배포 확인 — 배포 직후 여러 항목이 일시적으로 실패했으나
(cold start/재시작 구간, 아래 Production Verification 참조) 수 분 후
재검증하니 대부분 자연 해소됨.

## M. Production Verification

`npm run verify:production` 실행 이력:

1차(배포 직후, ~1분 이내): STATUS/TODAY/MONTHLY/HISTORICAL/ANNUAL/CLIENTS/
ECOUNT 등 7개 PASS, STORE MASTER/INVENTORY/BRAND REGISTRY/PRODUCT
REGISTRY/PRICE AUDIT/FRONTEND 6개 FAIL(Render 재시작 직후 transient로
추정).

2차(수 분 후 재실행): STORE MASTER/PRODUCT REGISTRY/PRICE AUDIT/FRONTEND
4개는 즉시 PASS로 회복(1차의 FAIL이 배포 직후 일시적 상태였음을 증명).
**INVENTORY/BRAND REGISTRY 2개만 지속적으로 FAIL** — 재검증해도 사라지지
않는 실제 데이터 gap:

```
[FAIL] BRAND REGISTRY: local(278/361) render(277/293)
[FAIL] INVENTORY: summary=true coverage=true brandRollup=false
```
INVENTORY의 실패는 BRAND REGISTRY 문제의 하위 증상이다 — Inventory의
`brandRollup`이 Brand Registry 해석 결과를 사용하므로, Render의 Brand
Registry가 1개 브랜드(`B0000COL`) 부족하면 그 브랜드가 걸린 재고 항목의
rollup 버킷도 Local과 달라진다. **근본 원인은 하나(Brand Registry gap)이지
두 개의 별개 문제가 아니다.**

근본 원인은 §E에 기록한 대로 `work/brand-master.json`이 Render에 한 번도
업로드되지 않은 것 — 이 batch의 규칙(자동 overwrite 금지)에 따라 실제
업로드는 수행하지 않았다. 나머지 11개 도메인(Status/Today/Monthly
current·historical/Annual/Clients/ECOUNT current month/Store
Master/Product Registry/Price Audit/Frontend)은 전부 PASS.

## N. Docs / Reports

- `docs/SAMPLAS-OPERATING-BASELINE.md` 갱신(기존 내용 삭제 없음): §5에
  "Brand Registry 파생 파일 auto-rebuild" 서브섹션 추가(이번에 발견한
  gap과 recovery 절차 포함), 신규 "§9. Production Verification &
  Recovery" 섹션 추가(검증 명령, 배포 후 회귀 대응 순서, 현재 알려진
  미해결 항목).
- 신규 report 2건: 이 문서, `docs/reports/ai-audit-feature-forensic-2026-08-26.md`.

## O. Worktree Safety

```
HEAD = origin/main = 6f2b9cf(코드 커밋까지), 문서 커밋은 이후 별도 진행
staged: 문서 커밋 전 기준 없음
unrelated tracked modified: 0개(둘 다 이번 batch에서 정식 처리 완료)
untracked: 116개 원본 전부 보존(diff로 확인, 신규 report 2건만 추가)
POS-PRICE/, SALES/, backups 등 전부 무변경
no cleanup 수행
```

## P. Remaining Tech Debt / Follow-ups

1. **[긴급, 승인 대기] Render Brand Registry canonical 미동기화**:
   `node scripts/upload-work-snapshots-to-render.mjs --overwrite
   brand-master.json` 실행 필요 → Render의 auto-rebuild가 즉시 반응해
   파생 파일 재생성 → `npm run verify:production --only
   brand-registry,inventory`로 재검증. **이번 batch에서 실행하지
   않음(자동 overwrite 금지 규칙) — 사용자 승인 후 별도 진행.**
2. Price-Audit/Product-Registry 트랙 untracked 스크립트 9개(Batch 5에서
   식별) — 여전히 커밋 여부 미결정, 별도 트랙 소관.
3. 8개 `docs/reports/*.md` 미커밋(Batch 5에서 식별) — 여전히 미해결.
4. 96개 backup 파일 retention policy — 여전히 미해결(Batch 5에서 SAFE/REVIEW/KEEP 분류만 완료).

## Q. Verdict

```
BATCH 7 PARTIAL COMPLETE — FOLLOW-UP ITEMS IDENTIFIED
```

7개 목표 중 6개(tracked modified 처리, Brand Registry 근본 수정,
persistent snapshot 구조 정리, parity checker, production smoke command,
AI Audit forensic, 운영 문서)는 코드/자동화 수준에서 완전히 완료되고
테스트로 검증됨. 다만 그 결과로 새로 발견된 Render Brand Registry
canonical 미동기화 gap이 아직 실제 데이터 수준에서 해소되지 않은 채
남아있어(자동 overwrite 금지 규칙에 따라 의도적으로 보류), "전 항목
PASS"를 뜻하는 완전한 COMPLETE 대신 PARTIAL COMPLETE로 판정한다. 이
gap의 해결 방법은 정확히 파악되어 있고(§P-1), 사용자 승인만 있으면
즉시 실행 가능한 상태다.

---

## Follow-up Resolution — Canonical Brand Master Sync (2026-08-26, 후속)

사용자가 위 PARTIAL COMPLETE 판정과 §P-1 진단을 승인함에 따라 후속 조치를
수행했다. **위 본문(Purpose~Q. Verdict)은 당시 실제 관측 결과이므로
수정하지 않고 그대로 보존**한다.

### Discovered Gap(재확인)

```
LOCAL  canonical work/brand-master.json: sha256 d8cc6bd1ceff395e864bea5cb61015b504b5df56d3d055b4a7fee8981d9a28ff
       brand count 295, name_aliases raw entries 68, B0000COL(MEANTIME X SUNDAYOFFCLUB) 존재
RENDER (업로드 전) /api/intelligence/brands: count 277, aliasCount 293
RENDER (업로드 전) /api/inventory/overview: brandRollup count 252
LOCAL  /api/intelligence/brands: count 278, aliasCount 361
```
예상된 divergence(278/361 vs 277/293)와 정확히 일치 — 새로운 원인 없음.

### Canonical Upload

```
node scripts/upload-work-snapshots-to-render.mjs --dry-run brand-master.json
  → {"dryRun": true, "files": ["brand-master.json"]}   (정확히 1개, 다른 snapshot 없음)

node scripts/upload-work-snapshots-to-render.mjs --overwrite brand-master.json
  → {"ok": true, "overwrite": true, "uploaded": ["brand-master.json"]}
```
`brand-master.json` 단 하나만 업로드 — derived registry/inventory/product-registry/
price-audit/sales/store-master/monthly archive 어느 것도 업로드하지 않음.

### Auto-Rebuild Production Verification(이번 검증의 핵심)

canonical 업로드 **직후, 파생 파일을 수동으로 건드리지 않은 채** 바로
`GET /api/intelligence/brands`를 호출:

```
RENDER (canonical 업로드 후, 최초 조회): count 278, aliasCount 361
```
Batch 7에서 구현한 hash-gated auto-rebuild(`ensureBrandRegistryFresh()`)가
**production에서 실제로 작동함을 확인** — canonical stat 변경 감지 →
content hash mismatch 확인 → 두 파생 파일 자동 재생성, 사람이 파생
파일을 수동으로 다시 만들어 업로드하지 않았다.

전체 브랜드 목록 단위로 재확인(단순 count 일치가 아니라 실제 내용 일치):
```
LOCAL id-set == RENDER id-set: True (both 278)
only in local: {} / only in render: {}
B0000COL(MEANTIME X SUNDAYOFFCLUB) RENDER 브랜드 목록에 존재: True
```

### Inventory Downstream Recovery

```
RENDER /api/inventory/overview brandRollup count: 252(업로드 전) → 246(업로드 후)
```
Local 기준값(246)과 일치 — Brand Registry gap의 하위 증상이었던 Inventory
rollup 분산도 canonical sync 하나로 함께 해소됨(별도 조치 불필요, §M 진단과
일치).

### Brand Registry / Inventory Parity

```
node scripts/verify-render-snapshot-sync.mjs --only brand-registry,inventory
[PASS] INVENTORY: summary/coverage/brandRollup(ex. recentSalesQty) match, count=246
[PASS] BRAND REGISTRY: local(278/361) render(278/361)
```

### Full Production Smoke(13/13)

```
node scripts/verify-render-snapshot-sync.mjs

STATUS PASS / TODAY PASS / MONTHLY CURRENT PASS / HISTORICAL MONTHLY PASS /
ANNUAL PASS / CLIENTS PASS / ECOUNT CURRENT MONTH PASS / STORE MASTER PASS /
INVENTORY PASS / BRAND REGISTRY PASS / PRODUCT REGISTRY PASS /
PRICE AUDIT PASS / FRONTEND PASS

VERDICT: PRODUCTION BASELINE HEALTHY
```
Price Audit(generatedAt/summary 불변), Product Registry(entries=3596 exact
match), Frontend(sha256 불변) 등 다른 어떤 도메인도 회귀 없음 — 이번
batch에서 `brand-master.json` 외 어떤 snapshot도 업로드하지 않았으므로
당연한 결과.

### Final Verdict

```
BATCH 7 PLATFORM HARDENING COMPLETE — PRODUCTION AUTOMATION READY
```
