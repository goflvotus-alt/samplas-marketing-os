# SAMPLAS Local → Render Migration — Batch 5: Local Dev Hygiene & Operating Baseline — 2026-08-26

**상태: COMPLETE — 파괴적 cleanup 미수행, 신규 blocker 1건 발견**

## Purpose

Batch 4.6로 "RENDER READY AS PRIMARY OPERATING BASELINE" 판정이 끝난 뒤,
Local working tree(2개 tracked modified + 116개 untracked)를 전수 분류하고,
Local↔Render 운영 역할을 문서로 고정한다. **이번 Batch는 삭제를 하지
않는다** — 분류/보고만 하고, 삭제 후보는 목록화만 하여 사용자 승인을
기다린다.

## A. GIT BASELINE

```
branch: main
HEAD          = ec169ab63ddd20cf7fdc5a12b8cf8cef57e70023
origin/main   = ec169ab63ddd20cf7fdc5a12b8cf8cef57e70023  (fetch 후 0/0)
ahead/behind  = 0 / 0
staged        = 없음
tracked modified = 2개 (예상과 일치)
  M scripts/diagnose-cafe24-ecount-product-matching.mjs
  M scripts/load-ecount-offline-sales.mjs
untracked count = 116 (예상과 일치)
```
예상과 완전히 일치 — 진행.

## B. WORKTREE INVENTORY

### 1. Tracked modified — 2개 (§C에서 상세 분석)

### 2. Untracked — 116개 (§D에서 전수 분류)

### 3. Ignored files (`git status --ignored`) — 867개

주요 generated/runtime 디렉토리:
- `work/` — canonical/derived 운영 데이터 전체(.gitignore:9 규칙). 이 중 16개
  파일만 예외적으로 git force-add되어 **tracked**(§G, §K 참조).
- `.code-review-graph/` — 코드 그래프 인덱스 캐시.
- `.env`, `.env.backup-*`, `RENDER_ENV_FROM_EXISTING.private.env` — 시크릿.
- `input/`, `baselines/**/work-samples/` — 로컬 전용 입력/베이스라인.
- `.DS_Store`(전체 트리) — macOS 메타데이터.
- `outputs/samplas-marketing-os.js.broken-20260701` — `*.broken-*` 규칙으로
  ignore(과거 실패 산출물, 삭제 안 함).

이 항목들은 정상적으로 ignore되고 있으며 이번 Batch의 untracked 116건과는
분리된 범주다.

### 4. Reports

| 위치 | 개수 | git 상태 | 성격 |
|---|---|---|---|
| `docs/reports/` | 82 tracked + 8 untracked = 90 | 대부분 tracked, 8개만 미커밋 | SAMPLAS migration/diagnosis 공식 report 저장소 |
| `work/reports/` | 47 | 전부 미추적(gitignore `work/`) | STEP67-era 과거 산출물(2026-08-08~11) |

### 5. Backups — 96개 파일(§D-2 그룹표)

파일명에 `backup`/`bak`/`before` 패턴을 포함한 항목 전부 96개 — `*.backup-*`
regex가 `.gitignore`에 등록되어 있지 않아 매번 untracked로 잡힌다(§I 참조).
가장 최근 것도 2026-08-20이며, 2026-08-21 이후 신규 backup은 0건(최근
SAFE-N/warehouse/migration 작업은 이 패턴을 사용하지 않음).

### 6. Temporary/runtime — repository 내부

```
scripts/.diagnose-price-audit-safe-candidates.tmp.mjs   ← 파일명 자체가 .tmp, dot-prefixed
```
그 외 `.DS_Store`, `*.pid`, `*.log`, cache 디렉토리는 repository 루트/추적
대상 안에는 없음(전부 `.gitignore`로 ignore되어 §B-3에 포함됨). `git status`
untracked 116건 안에는 런타임 log/pid 파일이 존재하지 않는다.

## C. TRACKED MODIFIED ANALYSIS

### 1. `scripts/diagnose-cafe24-ecount-product-matching.mjs`

```diff
- ecountRaw ← readJson(work/ecount-inventory/latest.json) 고정
+ options.ecountProductsOverride 배열이 있으면 그것을 사용, 없으면 기존과 동일
```
- **정체**: `buildCafe24EcountProductMatchingDiagnostic()`에 이미 존재하는
  `cafe24ProductsOverride` 주입 패턴(테스트 커버리지 존재:
  `test/cafe24-full-product-catalog.test.mjs`)을 ECOUNT 쪽에도 대칭적으로
  추가하려는 시도.
- **현재 상태**: `git log`상 `diag(product): compare cafe24 ecount product
  matching` 커밋(153d21b) 이후 만들어진 변경이며, **`ecountProductsOverride`를
  실제로 넘기는 호출자가 코드베이스 어디에도 없다**(`grep` 결과 0건) — 아직
  wiring이 끝나지 않은 미완성 변경.
- **test coverage**: 없음(새 분기 미검증).
- **production migration 관련성**: 없음 — Price Audit/Product Registry 진단
  스크립트 트랙 소관, 이번 Local→Render migration과 무관.
- **판단**: 유효하지만 미완성인 개발 변경. 이번 Batch에서 commit/restore
  하지 않음 — Price Audit/Product Registry 트랙에서 별도 결정 필요(§K
  Development Follow-up).

### 2. `scripts/load-ecount-offline-sales.mjs`

```diff
- detailDatePattern = /^(\d{4})\/(\d{2})\/(\d{2})\s*-\s*(\d+)$/
+ detailDatePattern = /^(?:(\d{4})\/(\d{2})\/(\d{2})|(\d{4})(\d{2})(\d{2}))\s*-\s*(\d+)$/
```
- **정체**: 기존부터 알려진 `YYYYMMDD`(구분자 없는 compact 날짜) 지원 확장
  hunk. `work/*.backup-compact-date-20260819-162227` 백업이 이 변경의 작업
  시점(2026-08-19)을 뒷받침한다.
- **warehouse commit에 포함되지 않은 이유**: 2026-08-19 warehouse-routing
  커밋(54fbee9) 작업 중 이 hunk는 의도적으로 분리되어 남겨졌다(이전 세션
  기록: partial-staging으로 warehouse 관련 hunk만 커밋하고 이 hunk는 제외)
  — warehouse 기능과 무관한 별개의 날짜 포맷 호환성 변경이기 때문.
- **기능적으로 필요한지**: ECOUNT Excel 원본에 compact 날짜 포맷(`YYYYMMDD`)
  행이 실제로 존재하는 경우에만 필요 — 현재 `/` 구분자 포맷만으로 파싱되는
  기존 파일들은 영향 없음(순수 확장, regression 없음).
- **test coverage**: `test/ecount-offline-sales-sheet.test.mjs`(5 tests,
  전부 PASS 확인)는 이 compact-date 분기를 직접 테스트하지 않음 — 기존
  슬래시 포맷 케이스만 커버.
- **판단**: 유효하고 안전한(하위호환) 독립 변경, 다만 무테스트. commit할
  가치는 있으나 이번 batch 범위(문서만 commit) 밖 — Development Follow-up
  으로 기록(§K).

**결론**: 두 파일 모두 수정/restore/commit하지 않음. 그대로 보존.

## D. UNTRACKED CLASSIFICATION (116건 전수)

### CATEGORY A — PROJECT HISTORY / MUST KEEP

| Path | Purpose |
|---|---|
| `docs/reports/BI-CATEGORY-COLOR-SKU-DRILLDOWN.md` | Brand Intelligence 드릴다운 설계 |
| `docs/reports/BI-PRODUCT-CHANNEL-EXACT-MERGE.md` | 채널 merge 로직 리포트 |
| `docs/reports/BI-PRODUCT-NAME-DISPLAY-CLEANUP.md` | 상품명 표기 정리 리포트 |
| `docs/reports/BI-SKU-ORDERS-LIVE-DATA.md` | SKU→주문 라이브 데이터 연결 리포트 |
| `docs/reports/PRODUCT-REGISTRY-REVIEW-DECISION-TABLE.md` | 사람 판단용 REVIEW 판단표(373줄) |
| `docs/reports/SAMPLAS-INTELLIGENCE-DROPBOX-MULTIPC-AUDIT.md` | Dropbox 멀티PC 이식성 감사 |
| `docs/reports/TODAY-PRICE-AUDIT-IMPLEMENTATION.md` | TODAY Price Audit 구현 리포트 |
| `docs/reports/TODAY-UI-REDESIGN-20260819.md` | TODAY UI 재설계 리포트 |
| `POS-PRICE/` (40 files, 자체 `.git` 포함) | **독립 프로젝트** — 자체 GitHub 원격(`samplas-pos-price.git`) 보유한 별도 배포 서비스(POS 가격 스냅샷 API). `work/product-registry.json`+`work/brand-commercial-policy.json`을 소스로 스냅샷 생성. 이 메인 저장소의 일부가 아니라 Dropbox 안에 나란히 존재하는 **다른 repo** — 삭제/merge 대상 아님. |
| `SALES/` (26 files, 39MB xlsx) | ECOUNT 판매현황 원본 엑셀(2025~2026, SAMPLAS 매입/매출/재고 셀스루) — `work/ecount-sales/*.json`의 **1차 원본 소스 데이터**. 코드에서 직접 참조되진 않지만(업로드 UI로 수동 반영) 대체 불가능한 원본 기록. |

모두 삭제 금지. 8개 report는 정책상(§E) `docs/reports/`에 있어야 할 것이
맞게 있으나 커밋만 누락된 상태.

### CATEGORY B — SOURCE / POTENTIAL COMMIT (Price-Audit/Product-Registry 트랙)

| Path | Purpose | Referenced by |
|---|---|---|
| `scripts/apply-price-audit-safe-registry-matches.mjs` | SAFE-N 계열 적용 스크립트 | 없음(단독 실행) |
| `scripts/apply-price-audit-safe24-registry-matches.mjs` | SAFE24 배치 적용 | 없음 |
| `scripts/apply-product-registry-approved-review-batch.mjs` | 승인된 REVIEW 배치 적용 | 없음 |
| `scripts/apply-product-registry-final-batch.mjs` | 최종 배치 적용 | 없음 |
| `scripts/apply-product-registry-safe-gaps.mjs` | SAFE gap 적용 | `audit-product-registry-cafe24-gaps.mjs` 참조 |
| `scripts/audit-extension-brand-policy.mjs` | 콜라보 브랜드 정책 감사(Chrome extension 관련, 세션 초반 다룬 기능) | 없음 |
| `scripts/audit-product-registry-cafe24-gaps.mjs` | Cafe24 gap 감사, 다른 3개 스크립트가 import | `apply-product-registry-safe-gaps.mjs`, `apply-product-registry-final-batch.mjs` |
| `scripts/audit-product-registry-full-catalog.mjs` | 전체 카탈로그 감사 | 없음 |
| `scripts/build-brand-commercial-policy.mjs` | 브랜드 상업 정책 빌더 | 없음 |

전부 `package.json` scripts에 등록되지 않은 수동 CLI 도구, 기존
`scripts/apply-price-audit-safe10-registry-matches.mjs`(이미 git 커밋됨)와
동일한 패턴의 SAFE-N 배치류. **이번 batch(Local→Render migration/hygiene)
소관이 아니라 별도 Price-Audit/Product-Registry 트랙 소관** — commit 여부는
그 트랙에서 결정.

### CATEGORY C — GENERATED DATA / KEEP LOCAL

이번 116건 untracked 목록에는 해당 없음(`work/`는 전부 `.gitignore`로
ignore되어 untracked 목록이 아닌 ignored 목록(867건)에 속함). `SALES/`는
원본 소스 데이터라 CATEGORY A로 분류(위 참조).

### CATEGORY D — BACKUP / RECOVERY (96개, 그룹별)

| Group (동일 base 파일 backup) | 개수 | 기간 |
|---|---|---|
| `intelligence-service.mjs.backup-*` | 17 | 2026-08-15 ~ 08-19 |
| `outputs/samplas-marketing-os.js.backup-*` | 15 | 2026-08-15 ~ 08-20 |
| `outputs/samplas-marketing-os.css.backup-*` | 11 | 2026-08-19 ~ 08-20 |
| `outputs/samplas-marketing-os.html.backup-*` | 8 | 2026-08-14 ~ 08-19 |
| `scripts/audit-extension-brand-policy.mjs.backup-*` | 8 | 2026-08-16 ~ 08-18 |
| `scripts/build-price-audit.mjs.backup-*` | 7 | 2026-08-19 ~ 08-20 |
| `scripts/build-brand-commercial-policy.mjs.backup-*` | 7 | 2026-08-16 |
| `scripts/sync-ecount-inventory.mjs.backup-*` | 6 | 2026-08-19 |
| `server.mjs.backup-*` | 6 | 2026-08-15 ~ 08-18 |
| `test/build-price-audit.test.mjs.backup-*` | 4 | 2026-08-20 |
| `scripts/cafe24-script-client.mjs.backup-*` | 2 | 2026-08-18 |
| `scripts/read-ecount-offline-sales-snapshot.mjs.backup-cross-store-dedupe-20260819-160720` | 1 | 2026-08-19 |
| `test/product-registry-bootstrap.test.mjs.backup-legacy-migration-20260820-144301` | 1 | 2026-08-20 |
| `scripts/load-ecount-offline-sales.mjs.backup-compact-date-20260819-162227` | 1 | 2026-08-19 (§C-2 원본 대응) |
| `scripts/diagnose-cafe24-ecount-product-matching.mjs.backup-before-ecount-override-20260819-141132` | 1 | 2026-08-19 (§C-1 원본 대응) |
| `scripts/bootstrap-product-registry.mjs.backup-legacy-migration-20260820-144301` | 1 | 2026-08-20 |

전부 해당 파일을 편집하기 직전 자동 생성된 안전장치(파일명의 타임스탬프가
그 근거). 전부 2026-08-21 이전 — 이후(SAFE10/SAFE18/SAFE20, warehouse,
migration Batch 1~4.6) 작업은 이 backup 관행을 쓰지 않았다. Retention
policy가 확정되기 전까지 삭제하지 않음.

### CATEGORY E — REGENERABLE TEMP / CLEANUP CANDIDATE

| Path | 근거 |
|---|---|
| `scripts/.diagnose-price-audit-safe-candidates.tmp.mjs` | 파일명 자체가 `.tmp`, dot-prefixed(숨김) — 진단 스크립트의 임시 산출물로 보임. 원본 로직은 `scripts/diagnose-cafe24-ecount-product-matching.mjs` 등 정식 스크립트에 남아있어 재생성 가능. |

### CATEGORY F — UNKNOWN

없음. 116건 전부 A~E 중 하나로 분류 완료.

## E. CLASSIFICATION TABLE (요약, directory/group 단위)

| Path | Category | Tracked? | Purpose | Regenerable? | Keep? | Action |
|---|---|---|---|---|---|---|
| `docs/reports/*.md` (8) | A | No | migration/BI 개발 리포트 | No | Yes | 커밋 필요(follow-up) |
| `POS-PRICE/` (40, 자체 .git) | A | No(별도 repo) | 독립 POS 가격 API 프로젝트 | No | Yes | 그대로 유지, 메인 repo에 merge 안 함 |
| `SALES/` (26, 39MB) | A | No | ECOUNT 원본 엑셀 | No | Yes | 그대로 유지, git 대상 아님(바이너리/용량) |
| `scripts/apply-*.mjs` (5) | B | No | Product Registry SAFE-N 적용 스크립트 | 부분(로직 재작성 가능하나 이력 손실) | 검토 | Price-Audit 트랙에서 커밋 여부 결정 |
| `scripts/audit-*.mjs`, `build-brand-commercial-policy.mjs` (4) | B | No | 감사/정책 빌더 스크립트 | 부분 | 검토 | 상동 |
| `intelligence-service.mjs.backup-*` (17) | D | No | 편집 전 백업 | Yes(git history로 대체 가능) | 보존(정책 확정 전) | 삭제 후보(REVIEW) |
| `outputs/*.backup-*` (34: js15+css11+html8) | D | No | 편집 전 백업 | Yes | 보존 | 삭제 후보(REVIEW) |
| `server.mjs.backup-*` (6) | D | No | 편집 전 백업 | Yes | 보존 | 삭제 후보(REVIEW) |
| `scripts/*.backup-*` (25) | D | No | 편집 전 백업 | Yes | 보존 | 삭제 후보(REVIEW) |
| `test/*.backup-*` (5) | D | No | 편집 전 백업 | Yes | 보존 | 삭제 후보(REVIEW) |
| `scripts/.diagnose-price-audit-safe-candidates.tmp.mjs` (1) | E | No | 임시 진단 산출물 | Yes | No | 삭제 후보(SAFE) |

(전체 116건은 §D에 개별/그룹 단위로 전수 열거되어 있음. 이 표는 Action 결정을 위한 요약.)

## F. REPORT POLICY RECONFIRMATION

### `docs/reports/`
- SAMPLAS development history의 정식 저장소 — generated junk 아님, cleanup
  대상 아님, major task DoD의 일부(사용자 지시로 이미 고정된 정책, `[[feedback_write_report_per_major_task]]`
  메모리와 일치).
- 기존 report 삭제/overwrite 금지 — Batch 4/4.5에서 실제로 이 원칙을
  지켰음(원문 보존, follow-up section만 추가).
- 후속 결과는 새 report 또는 기존 report에 Follow-up section 추가로 기록.
- **발견된 gap**: 정책상 커밋되어야 할 8개 파일(§D CATEGORY A)이 실제로는
  미커밋 상태로 남아있음 — 정책 위반이라기보다 "작성 후 별도 batch에서
  아직 커밋되지 않은" 상태. Development Follow-up으로 기록(§K).

### `work/reports/`
- 47개 파일, 전부 2026-08-08~11(STEP67 시리즈), `work/` 규칙으로 gitignore.
- **성격**: `docs/reports/`가 정식 저장소로 자리잡기 이전 시기의 historical
  output — STEP67 네이밍 컨벤션이 현재의 `docs/reports/` batch 리포트
  컨벤션과 다름(더 이전 시대의 산출물).
- 자동 삭제 금지. `docs/reports/`와의 중복 여부는 파일명이 겹치지 않아
  (STEP67-* vs BI-*/TODAY-*/local-to-render-*) **중복이 아닌 것으로
  판단**되나, 내용 수준의 중복 여부까지는 이번 batch에서 확인하지 않음 —
  별도 migration/정리 대상으로 남김. 중복이라고 해도 이번 batch에서
  삭제하지 않음.

## G. GENERATED DATA POLICY

| File | canonical/derived | gitignored | Render upload 대상 | Regeneration | Authority |
|---|---|---|---|---|---|
| `work/product-registry.json` | canonical(사람 검토 반영) | **아니오(git force-add, tracked)** | 아니오(`workDataUploadPaths`에 없음) | 수동 SAFE-N 배치 적용 | Local(git commit) — **단, Render 전달 경로 없음(§K 신규 발견)** |
| `work/price-audit.json` | derived(build-price-audit.mjs 산출) | 예 | **예**(`workDataUploadPaths`) | `node scripts/build-price-audit.mjs` | Local 생성 → 명시적 upload 필요 |
| `work/store-master.json` | canonical | 아니오(git force-add) | **예**(Batch 2에서 추가) | 수동 편집 | Local(git) + upload 이중 경로 |
| `work/brand-master.json` | canonical | 예 | **예** | 수동 편집 | Local 생성 → upload 필요 |
| `work/intelligence/brand-master-list.json` | derived(`buildIntelligenceBrandRegistry()`) | 예 | **예** | canonical 변경 시 수동 rebuild(bootstrap-once 결함, §K) | Local 생성 → upload 필요 |
| `work/intelligence/brand-aliases.json` | derived | 예 | **예** | 상동 | 상동 |
| `work/ecount-sales/*.json` | derived(엑셀 업로드) | 예 | **예**(월별 regex 패턴) | ECOUNT 업로드 API | Local/Render 각자 업로드(동일 파일을 양쪽에 업로드) |
| `work/ecount-inventory/*.json` | derived(`sync-ecount-inventory.mjs`) | 예 | **예** | `node scripts/sync-ecount-inventory.mjs` | Local 생성 → upload 필요 |
| `work/monthly/*.json` | derived(`buildMonthlyArchive()`) | 예 | **예**(월별 regex) | `buildMonthlyArchive()`+`writeMonthlyArchive()` | Render가 canonical(Batch 4.6 CASE C 결정) |

**핵심 구조**: `work/` 아래 파일은 두 가지 서로 다른 경로 중 하나로만
Render에 도달한다 —
1. **Git 경로**: 파일이 git force-add되어 있으면(`product-registry.json`,
   `store-master.json` 등 16개), 커밋+푸시로 **저장소에는** 반영되지만,
   Render 런타임은 `WORK_DIR=/var/data/samplas-dashboard/work`(영구
   디스크, git 체크아웃과 무관한 별도 마운트)를 읽으므로 **git push만으로는
   Render 실행 데이터가 갱신되지 않는다.**
2. **Upload API 경로**: `POST /api/work-data/upload`(서버 allowlist
   `workDataUploadPaths`)로 명시적으로 업로드해야만 영구 디스크에 반영된다.

`store-master.json`은 Batch 2에서 이 구조를 인지하고 **두 경로 모두**(git
커밋 + 명시적 upload)를 밟았기 때문에 정상 동기화되었다. 반면
`product-registry.json`은 upload allowlist에 없고 명시적 upload도 이번
세션에서 한 번도 수행되지 않았다 — §K에서 실측 확인.

## H. AUTHORITY MATRIX

| Domain | Primary Authority | Local Role | Render Role |
|---|---|---|---|
| Operational Dashboard | Render | Validation | Production |
| Today | Render | Test/compare | Production |
| Monthly (current) | Render | Test/compare | Production |
| Historical Monthly | Render production archive (Batch 4.6 CASE C) | Local regeneration/validation | Canonical operational |
| Annual (aggregate) | Render | Validation | Production |
| Clients | Render | Validation | Production |
| Store Intelligence | Render | Validation | Production |
| Inventory | Render latest uploaded snapshot | Sync/validation | Production |
| Brand Registry (derived) | canonical `brand-master.json` + rebuilt derived, uploaded | Build/validate | Production derived snapshot |
| Price Audit (summary) | Render verified snapshot(`price-audit.json`, uploaded) | Generate/validate | Production |
| **Product Registry (entry-level)** | **Local git HEAD — 아직 Render에 전달 경로 없음(§K 신규 발견)** | 편집/커밋 | **stale, upload 메커니즘 부재** |
| Source Code | Git `main` | Development | Deploy from main(자동) |
| Development Reports | Git `docs/reports/` | Authoring | n/a |

## I. LOCAL / PRODUCTION WORKFLOW

### Development Workflow Policy

1. Git/main baseline 확인(`git fetch`, ahead/behind, staged/untracked 상태)
2. Local에서 diagnosis(read-only 우선, 그래프/코드 조사)
3. 최소 구현(코드 수정은 필요한 파일만, `git add -A` 금지)
4. Local test(`node --test`, 관련 endpoint 재검증)
5. report 작성(`docs/reports/*.md`)
6. commit(명시적 경로만 staging)
7. fetch/push(ahead/behind 재확인 후 push)
8. Render auto-deploy(코드) 또는 snapshot upload(데이터, §G 참조 — 경로가
   다름을 반드시 구분)
9. Production verification(Local↔Render 비교, 같은 순간 조회)
10. report finalization(원본 보존 + follow-up section)
11. production DoD 확정

### Definition of Done

Major task는 다음이 모두 끝나야 DONE:
```
Diagnosis → Implementation → Tests → Commit/Deploy → Production Validation → Report
```
"Commit"과 "Deploy"는 코드에는 동일하지만(git push = 자동 재배포),
**데이터에는 별개 단계**다(§K) — 이 구분을 생략하면 이번 batch에서 실제로
발견된 것과 같은 stale-data gap이 재발한다.

## J. LOCAL SERVER POLICY (조사만, 수정 없음)

```
canonical start:  npm start  →  node server.mjs
intelligence 별도: npm run start:intelligence → node intelligence-service.mjs
port:             8787 (server.mjs:68, env.PORT || 8787)
health endpoint:  GET /api/status (server.mjs:92)
launcher_v2:      현재 저장소/문서 어디에도 존재하지 않음(코드/문서 전수
                  검색 결과 0건) — 과거 세션 기록에 언급되었으나 이번
                  repository 상태에서는 확인 불가. 존재했다면 이미 제거됐거나
                  repo 밖(개인 alias/스크립트)에 있었던 것으로 추정, 이번
                  batch에서 추가 조사하지 않음.
manual fallback:  npm start(=node server.mjs)가 곧 유일한 공식 시작 방법.
stale marker:     work/.samplas-dashboard-started-at (gitignored, 값은
                  Unix epoch 초) — 이 파일을 쓰는 코드가 server.mjs/scripts
                  어디에도 없음(grep 0건) — 출처 불명, repo 외부 프로세스가
                  기록한 것으로 추정. 이번 batch에서 추가 조사/수정하지 않음.
```
Launcher 수정 없음(지시 준수) — 이번 조사는 현재 상태 문서화만.

## K. PRODUCTION POLICY — **신규 발견 포함**

```
Render URL: https://samplas-marketing-os.onrender.com/
역할: primary operational baseline / production validation target
```

### Code Deploy vs Persistent Data Sync — 반드시 구분

- **Code deploy**: `render.yaml`의 `buildCommand: npm install` /
  `startCommand: npm start` — GitHub `main` push 시 Render가 자동으로 새
  코드를 checkout+재시작(코드 변경은 push만으로 충분).
- **Persistent data**: `render.yaml`의 `disk: mountPath: /var/data`,
  `WORK_DIR=/var/data/samplas-dashboard/work` — 이 디렉토리는 **git
  checkout과 완전히 분리된 영구 디스크**다. `server.mjs:65`
  (`workDir = resolve(env.WORK_DIR || join(root,"work"))`)가 확정하듯,
  Render에서는 항상 `/var/data/...`를 읽고 git 저장소 내부의 `work/`
  디렉토리는 런타임에서 전혀 참조되지 않는다.

**따라서 "git push만 했다고 모든 production data snapshot이 자동
업데이트되는 것이 아니다"는 이번 batch에서 명시적으로 실측 확인됨.**

### 실측 — Product Registry Staleness (신규 blocker)

```
확인 대상: work/product-registry.json 의 productCode "P0000LTT"
git 커밋 34cf74d(fix(price-audit): confirm safe18 product matches, 2026-08-21)
에서 status: "unmatched" → "confirmed", verified: false → true 로 변경, 이후
HEAD까지 그대로 유지, origin/main에 이미 push 완료.

GET /api/intelligence/product-registry (같은 순간 조회):
  LOCAL  entries[P0000LTT].status   = "confirmed", verified = true
  RENDER entries[P0000LTT].status   = "unmatched", verified = false
```
**Local과 Render가 다르다.** SAFE18 배치(그리고 그 전후 다른 SAFE-N
배치들)로 git에 커밋된 사람 검토 결과가 **Render 영구 디스크에는 전혀
반영되지 않았다** — `product-registry.json`은 (a) `workDataUploadPaths`
allowlist에 없고, (b) 이번 세션 어떤 batch에서도 명시적 upload가 수행된
적이 없기 때문이다(§G).

**영향 범위**: Price Audit summary 카운트(MATCH/ECOUNT_HIGHER 등, Batch
4/4.6에서 확인한 완전 일치)는 `work/price-audit.json`(별도 파일, upload
allowlist에 있고 실제로 업로드됨)에서 나오므로 이번 발견과 **직접 충돌하지
않는다** — 다만 Product Registry 화면/API가 노출하는 **개별 SKU 매칭
상태/신뢰도**는 Render에서 stale하다. Today/Monthly 매출 계산에는 영향
없음(Decision-001: Identity Resolution과 Revenue Calculation 분리 원칙에
따라 `product-registry.json`은 매출 합산에 직접 개입하지 않음).

**이번 batch에서 조치하지 않음**(read-only/문서 batch, Render upload
금지) — Development Follow-up으로 기록(§K 하단, §N에 해당).

### Snapshot Deployment 요구사항

git-tracked이지만 upload allowlist에 없는 나머지 15개 `work/*.json`
파일(`cafe24-*.json` 진단 6종, `canonical-product-matching-*.json` 3종,
`category-master.json`, `color-master.json`,
`inventory-intelligence-candidates.json`,
`product-registry-review-queue.json`)도 **구조적으로 동일한 위험**을
공유한다 — 최근 재편집 이력(`git log -1`)은 대부분 2026-08-15~19로
product-registry.json보다 오래되어 있어 확인된 영향은 없으나, 향후 이
파일들을 다시 편집한다면 동일한 stale-data 문제가 재발할 수 있다.

## L. .GITIGNORE AUDIT (READ ONLY)

```
.gitignore 현재 내용:
  .env, .env.*, !.env.example, *.private.env, RENDER_ENV_FROM_EXISTING.private.env
  work/
  baselines/**/work-samples/
  *.csv, *.log
  node_modules/, .DS_Store
  *.broken-*
  outputs/samplas-api-env-template.txt
  input/
  .code-review-graph/
```

- `docs/reports/` — **ignore 대상 아님**(정책과 일치, 확인 완료).
- `work/` — 전체 ignore, 필요한 16개 파일만 force-add로 예외 처리 —
  의도된 설계이나 §K에서 확인했듯 이 예외 처리가 "git에는 tracked되지만
  Render 실행 데이터에는 반영 안 됨"이라는 새로운 함정을 만든다(gitignore
  버그는 아니고, 배포 아키텍처와 gitignore 정책 사이의 간극).
- **발견된 gap**: `*.backup-*` / `*bak*` / `*before*` 패턴이 `.gitignore`에
  전혀 없다 — `*.broken-*`만 있고 `*.backup-*`는 없어서, 이번 batch에서
  확인한 96개 backup 파일 전부가 매번 untracked pile에 쌓이는 근본 원인.
  `.tmp.mjs`/dot-prefixed temp 파일에 대한 규칙도 없음.
- 이번 Batch에서 `.gitignore` 수정하지 않음(지시 준수) — 수정 여부는 사용자
  승인 후 별도 반영.

## M. CLEANUP CANDIDATES (목록화만, 삭제 없음)

### SAFE TO DELETE

| Path | Why safe | Regenerable evidence | Recovery impact | Recommended action |
|---|---|---|---|---|
| `scripts/.diagnose-price-audit-safe-candidates.tmp.mjs` | 파일명 자체가 임시산출물(.tmp), 정식 스크립트 아님 | 원본 로직이 `scripts/diagnose-cafe24-ecount-product-matching.mjs`에 존재 | 없음(임시 파일) | 승인 시 삭제 |

### REVIEW BEFORE DELETE

| Path (그룹) | Why maybe safe | Regenerable evidence | Recovery impact | Recommended action |
|---|---|---|---|---|
| 96개 `*.backup-*` 파일 전체(§D CATEGORY D) | 전부 2026-08-21 이전, git history가 각 파일의 변경 이력을 이미 보유(대부분의 base 파일이 git-tracked) | git-tracked 파일(server.mjs, intelligence-service.mjs, outputs/*, test/*)의 backup은 `git log`/`git show`로 완전 복구 가능 | untracked 스크립트(`audit-extension-brand-policy.mjs` 등)의 backup은 git history가 없어 삭제 시 그 시점 스냅샷 유실 | retention policy 확정 후(예: "30일 이상 + base파일 git-tracked" 규칙) 승인 받아 일괄 삭제 |

### KEEP

| Path | 이유 |
|---|---|
| `docs/reports/*` (전체) | 개발 이력, 삭제 금지 정책 |
| `work/reports/*` (47) | STEP67-era 역사적 기록 |
| `POS-PRICE/` | 독립 배포 프로젝트 |
| `SALES/` | 원본 소스 데이터(대체 불가) |
| `scripts/apply-*.mjs`, `scripts/audit-*.mjs`, `scripts/build-brand-commercial-policy.mjs` (9) | Price-Audit/Product-Registry 트랙 소관, 별도 결정 필요 |
| tracked modified 2개 | 유효한 미완성/미검증 개발 변경(§C) |

## N. DEVELOPMENT FOLLOW-UPS (cleanup 아님, 별도 작업 필요)

### 1. Brand Registry auto-rebuild debt
`ensureBrandRegistryFiles()`(bootstrap-once) — `brand-master.json` 갱신 시
파생 파일이 다시 stale해지는 구조적 한계, Batch 3.5/4에서 이미 기록.
미해결.

### 2. `scripts/load-ecount-offline-sales.mjs` compact-date 지원
§C-2 분석 결과: 유효하고 안전하나 무테스트인 독립 변경. 테스트 추가 후
독립 커밋 권장.

### 3. `scripts/diagnose-cafe24-ecount-product-matching.mjs` ecountProductsOverride
§C-1 분석 결과: 호출자가 없는 미완성 wiring. Price-Audit/Product-Registry
트랙에서 실제로 이 기능이 필요한지, 완성할지 폐기할지 결정 필요.

### 4. "AI Audit" UI 부재
Batch 4에서 확인: 백엔드 `/api/ai-audit/*`(`server.mjs:330`
`/api/ai-audit/health` 등)는 존재하나 프론트엔드 문자열/경로 참조 0건
(Local/Render 동일). `docs/samplas-ai-audit-setup.md` 문서는 존재 —
과거 계획에서 존재했던 기능인지 별도 product audit 필요. 이번 batch
에서는 추가 조사하지 않음(범위 밖).

### 5. **[신규] Product Registry Render staleness** (§K)
`work/product-registry.json`의 git 커밋 내역(SAFE10/18/20 등)이 Render
영구 디스크에 전혀 반영되지 않고 있음(실측 확인, P0000LTT 사례). 해결
옵션(우선순위/방법은 사용자 결정 필요, 이번 batch에서 실행하지 않음):
  - (a) `product-registry.json`을 `workDataUploadPaths`에 추가하고 1회
    명시적 upload 수행(store-master.json 패턴과 동일)
  - (b) 또는 이 파일을 Render 배포 파이프라인에서 완전히 별도 취급(현재
    설계 의도가 원래 "git으로만 관리"였는지 재확인 필요)

### 6. 8개 `docs/reports/*.md` 미커밋
§D/§F에서 확인 — 정책상 커밋되어야 하나 아직 안 됨. 다음 batch(또는 사용자
승인 시 이번 batch 범위를 넘겨) 커밋 필요.

### 7. Price-Audit/Product-Registry 트랙 untracked 스크립트 9개(§D CATEGORY B)
해당 트랙 담당자가 커밋 여부 결정.

## O. OPERATING BASELINE DOCUMENT

기존 canonical 문서 조사 결과: `docs/PROJECT_MEMORY.md`(프로젝트 헌법,
Source of Truth 표 포함)와 `docs/DECISIONS.md`(의사결정 로그)가 존재하나,
**둘 다 "코드/데이터 SoT"를 다룰 뿐 "Local↔Render 운영 역할, 배포
아키텍처, deploy vs data-sync 구분"은 다루지 않음** — 중복이 아니므로
새 문서를 작성.

새 파일: `docs/SAMPLAS-OPERATING-BASELINE.md` (living operational
document, 이번 리포트와 별개로 계속 갱신됨). 내용은 §H(Authority Matrix),
§I(Workflow/DoD), §K(Code deploy vs Data sync 구분, 이번에 발견한 Product
Registry staleness 포함), §F(Report 보존 정책), §S(Safety Rules) 요약.

## P. WORKTREE SAFETY (최종)

```
HEAD = origin/main = ec169ab...  (문서 작성 중 변경 없음)
staged = 없음(commit 직전까지)
unrelated 2개 tracked modified: 보존, 수정 없음
untracked 116건: 분류만 수행, 파일 이동/삭제/수정 없음
work/ 데이터: 읽기만 수행(GET 요청, product-registry.json 등 로컬 파일 read)
Render: GET 요청만 수행, upload/mutation 없음
```

## Q. VERDICT

```
BATCH 5 LOCAL DEV HYGIENE COMPLETE — OPERATING BASELINE DOCUMENTED
```

116건 전수 분류 완료(A/B/D/E, F 없음), 파괴적 cleanup 0건 수행, 삭제
후보는 SAFE/REVIEW/KEEP 3그룹으로만 정리(승인 대기). 이 과정에서 **Batch
4.6의 "RENDER READY" 판정과 별개로, Product Registry 개별 항목이 Render에
동기화되지 않는 신규 gap을 발견**했다 — Today/Monthly 매출 총계에는 영향
없으나 Price Audit/Product Registry 화면의 개별 SKU 상태 정확도에는 영향.
수정은 이번 batch 범위 밖(문서/분류만), Development Follow-up(§N-5)으로
넘김.

## Final Recommendation

### SAFE CLEANUP (승인 시 삭제 가능)
- `scripts/.diagnose-price-audit-safe-candidates.tmp.mjs`

### DEVELOPMENT FOLLOW-UP (기능/코드 작업 필요)
- Product Registry → Render 동기화 경로 신설(§N-5, 최우선)
- `docs/reports/*.md` 8건 커밋
- `load-ecount-offline-sales.mjs` compact-date 테스트 추가 후 커밋
- `diagnose-cafe24-ecount-product-matching.mjs`의 `ecountProductsOverride` wiring 완성 또는 폐기 결정
- Brand Registry bootstrap-once 구조 개선
- "AI Audit" 기능 존재 여부 product audit
- Price-Audit/Product-Registry 트랙 untracked 스크립트 9건 커밋 여부 결정
- 96개 backup 파일 retention policy 수립 후 일괄 정리

### PRESERVE (cleanup 대상으로 절대 취급 금지)
- `docs/reports/*`, `work/reports/*`
- `POS-PRICE/`, `SALES/`
- tracked modified 2개
- Price-Audit/Product-Registry 트랙 스크립트 9개(CATEGORY B)
