# SAMPLAS Local → Render Migration — Batch 4.6: Local Historical Archive Reconciliation — 2026-08-25

**상태: COMPLETE — RENDER READY AS PRIMARY OPERATING BASELINE**

## 1. Purpose

Batch 4.5에서 확정된 CASE C(Render의 2026-01~06 Monthly 아카이브 값이
canonical production truth, Local이 stale)를 사용자가 승인함에 따라,
**Production(Render)을 수정하지 않고** Local의 `work/monthly/2026-01~06.json`
6개 파일만 공식 `buildMonthlyArchive()` 경로로 재생성하여 Render/실제값에
맞춘다. Render data mutation은 금지(사용자 명시 지시).

## 2. Canonical Decision (사용자 승인)

```
Render의 2026-01~06 Monthly 아카이브 값 = canonical production truth
Local work/monthly/2026-01~06.json = stale (재분류 대상)
```
Batch 4의 최초 mismatch 판정("Render stale")은 **재분류**되었을 뿐 삭제되지
않았다 — Batch 4 보고서는 원문 그대로 보존됨(§8 참조).

## 3. Baseline (A)

```
HEAD = origin/main = ba10669dd163c1e5196cd909c86279b3c0965a69 (fetch 후 0/0)
staged: 없음
unrelated unstaged 2개(diagnose-cafe24-ecount-product-matching.mjs,
  load-ecount-offline-sales.mjs): 보존, 변경 없음
work/monthly/*.json: git check-ignore 확인 — .gitignore:9 `work/` 규칙에 걸리는
  미추적 데이터 파일(git ls-files 결과 0개)
```

## 4. Backup (B)

재생성 전 기존 6개 Local 아카이브 파일 백업 생성:
```
work/monthly/2026-01.json.backup-2026-08-25T11-10-29-380Z
work/monthly/2026-02.json.backup-2026-08-25T11-10-29-380Z
work/monthly/2026-03.json.backup-2026-08-25T11-10-29-380Z
work/monthly/2026-04.json.backup-2026-08-25T11-10-29-380Z
work/monthly/2026-05.json.backup-2026-08-25T11-10-29-380Z
work/monthly/2026-06.json.backup-2026-08-25T11-10-29-380Z
```

## 5. Official Rebuild Contract (C)

- `buildMonthlyArchive(month)` — `server.mjs`, exported, 라이브 Cafe24 +
  ECOUNT 소스에서 순수 재계산(파일 쓰기 없음)
- `writeMonthlyArchive(month, {...archive, archiveStatus:"saved"})` —
  atomic write(temp+rename), 공식 `POST /api/reports/monthly/archive`
  라우트가 내부적으로 호출하는 것과 동일한 경로
- 새 스크립트 작성 없이 두 exported 함수를 직접 호출하는 방식으로 수행

## 6. Rebuild Execution (D) — 2026-01~06만, 07/08 제외

```
[2026-01] OK total=250102958
[2026-02] OK total=186329089
[2026-03] OK total=330054363
[2026-04] OK total=354304011
[2026-05] OK total=344037071
[2026-06] OK total=205267886
```

| month | before(Local, stale) | after(Local, 재생성) | Render(canonical) | generatedAt |
|---|---|---|---|---|
| 2026-01 | 251,557,086 | 250,102,958 | 250,102,958 | 2026-08-25T11:10:50.922Z |
| 2026-02 | 188,254,020 | 186,329,089 | 186,329,089 | 2026-08-25T11:11:09.371Z |
| 2026-03 | 335,103,568 | 330,054,363 | 330,054,363 | 2026-08-25T11:12:13.433Z |
| 2026-04 | 355,645,683 | 354,304,011 | 354,304,011 | 2026-08-25T11:12:31.879Z |
| 2026-05 | 350,503,662 | 344,037,071 | 344,037,071 | 2026-08-25T11:12:33.320Z |
| 2026-06 | 209,187,510 | 205,267,886 | 205,267,886 | 2026-08-25T11:13:10.054Z |

6/6 성공, 재생성 후 값이 Render 값과 정확히 일치. `2026-07.json`,
`2026-08.json`은 이번 작업에서 건드리지 않음(2026-07은 이미 일치, 2026-08은
당월 live 데이터).

## 7. Local ↔ Render Monthly Validation (E) — 2026-01~07 전월 재비교

| Month | Local Total | Render Total | Delta | Online Delta | Offline Match |
|---|---|---|---|---|---|
| 2026-01 | 250,102,958 | 250,102,958 | 0 | 0 | True |
| 2026-02 | 186,329,089 | 186,329,089 | 0 | 0 | True |
| 2026-03 | 330,054,363 | 330,054,363 | 0 | 0 | True |
| 2026-04 | 354,304,011 | 354,304,011 | 0 | 0 | True |
| 2026-05 | 344,037,071 | 344,037,071 | 0 | 0 | True |
| 2026-06 | 205,267,886 | 205,267,886 | 0 | 0 | True |
| 2026-07 | 273,544,433 | 273,544,433 | 0 | 0 | True |

**7/7 완전 일치.** 목표(2026-01~06: delta=0 / 2026-07: 기존 일치 유지) 달성.

## 8. Annual Revalidation (F)

전용 `/annual` API 라우트는 존재하지 않음(Batch 4에서도 동일하게 확인) —
Annual은 프론트엔드가 월별 `/api/reports/monthly` 호출을 집계하는 구조이므로,
2026-01~07 합계로 aggregate 정합성을 검증:
```
LOCAL  annual(2026-01~07) sum = 1,943,639,811
RENDER annual(2026-01~07) sum = 1,943,639,811
delta = 0
```
**완전 일치.**

## 9. Current-Month Regression — 2026-08 (G)

```
/api/sales/total?since=2026-08-01&until=2026-08-25
  LOCAL  total=196,511,398 online=29,146,898 offline=167,364,500 byStore={APGUJEONG:157,300,800, VAIL:10,063,700}
  RENDER 동일 (완전 일치, 같은 순간 조회)

/api/reports/monthly?month=2026-08
  LOCAL total=196,511,398 / RENDER total=196,511,398 (일치)

/api/ecount-sales/monthly?month=2026-08
  LOCAL/RENDER sources 완전 동일 (APGUJEONG 매장/100, VAIL SAMPLAS Veil/200,
  importedAt 2026-08-25T05:42:01.963Z)

/api/intelligence/clients
  LOCAL/RENDER: totalClients=97, orderCount=376, totalSalesAmount=195,361,398 (완전 일치)
```
**완전 일치, 회귀 없음.**

## 10. Other Core Regression (H)

```
/api/status                              LOCAL 200 / RENDER 200
/api/intelligence/store?store=APGUJEONG  sales/clients 완전 일치
  (periodSales 157,300,800, orderCount 256, quantity 548)
/api/intelligence/store?store=VAIL       sales/clients 완전 일치
  (periodSales 10,063,700, orderCount 36, quantity 53)
/api/inventory/overview                  summary 완전 일치(totalKnownStock 2936,
  negativeReviewSkuCount 583 등), brandRollup count 246=246
/api/intelligence/brands                 count 278=278, aliasCount 361=361
/api/intelligence/price-audit            generatedAt 2026-08-25T02:40:11.541Z 동일,
  summary MATCH 2977/ECOUNT_HIGHER 75/ECOUNT_LOWER 43/MATCH_REQUIRED 169/
  REVIEW_REQUIRED 332 완전 일치
```
Batch 2/3/3.5/4 baseline 전부 그대로 유지, 회귀 없음.

## 11. Final Core Feature Matrix (I)

| Feature | Local | Render | Match |
|---|---|---|---|
| Status | 200 | 200 | PASS |
| Today | 196,511,398 | 196,511,398 | PASS |
| Monthly (2026-08) | 196,511,398 | 196,511,398 | PASS |
| **Monthly/Annual (2026-01~06)** | 재생성 완료 | canonical | **PASS (Batch 4의 FAIL 해소)** |
| Monthly/Annual (2026-07) | 273,544,433 | 273,544,433 | PASS |
| Annual aggregate (01~07) | 1,943,639,811 | 1,943,639,811 | PASS |
| Clients | 97/376 | 97/376 | PASS |
| APGUJEONG Store | 86/256/156,150,800 | 동일 | PASS |
| VAIL Store | 19/36/10,063,700 | 동일 | PASS |
| Inventory | 246 brands, 583 negative | 동일 | PASS |
| Brand Registry | 278/361 | 278/361 | PASS |
| Price Audit | MATCH 2977 등 | 동일 | PASS |
| Frontend Bundle | SHA `334e305b...` | 동일(Batch 4 확인) | PASS |
| ECOUNT Upload Contract | 2026-08+ headerless, 2026-07- header 필수 | 코드 배포 확인(Batch 1) | PASS |

**전 항목 PASS.**

## 12. Production Readiness Decision (J)

```
BATCH 4.6 COMPLETE — RENDER READY AS PRIMARY OPERATING BASELINE
```
Batch 4의 유일한 blocker(2026-01~06 Monthly/Annual 아카이브 불일치)는
Render mutation 없이, Local 아카이브를 공식 경로로 재생성하는 것만으로
해소되었다. Cafe24 live/rolling 지표(예: 당월 online 금액, Inventory
`recentSalesQty`)의 정상적인 timing drift는 이번에도 별도 항목으로
분리했으며(§9, §10 — 실측 시 완전 일치로 확인됨), readiness 판정의
blocker로 취급하지 않는다.

## 13. Batch 4 Report History Preservation (K)

`docs/reports/local-to-render-batch4-core-cross-validation-2026-08-25.md`의
최초 `RENDER NOT YET READY — BLOCKER REMAINS` 판정은 **삭제/수정하지
않고 원문 그대로 보존**했다(diff 없음, 파일 미변경 확인). 이 문서는 "당시
실제 관측 결과"의 역사적 기록으로 유지되며, 최종 readiness 판정은 본
Batch 4.6 문서(§12)가 갱신본으로서 대체한다.

## 14. Batch 4.5 Report Finalization (L)

`docs/reports/local-to-render-batch4-5-historical-archive-alignment-2026-08-25.md`에
기존 진단 내용(A~T절)을 전혀 삭제/수정하지 않고, 새 절 **"U. Follow-up
Resolution"**만 추가하여 CASE C 승인 및 후속 조치(본 Batch 4.6)를 참조하도록
연결했다.

## 15. Render Data Mutation Check (P)

이번 batch에서 수행한 것:
- Local 파일 읽기(백업, `buildMonthlyArchive()` 재계산)
- Local 파일 쓰기(`writeMonthlyArchive()`, atomic, 6개 `work/monthly/*.json`만)
- Render/Local 양쪽에 대해 GET 요청만(비교 목적)

이번 batch에서 **수행하지 않은 것**(명시적 금지 확인):
- Render 스냅샷 업로드 없음(`upload-work-snapshots-to-render.mjs` 미실행)
- Render 과거 아카이브 덮어쓰기 없음
- Render 배포/재시작 없음
- Source code 수정 없음(exported 함수 2개만 직접 호출, `server.mjs`/`intelligence-service.mjs` 등 미변경)

## 16. Remaining Design Debt (Q) — readiness blocker 아님

- **Brand Registry bootstrap-once**(`ensureBrandRegistryFiles()`): Batch 3.5에서
  현재 시점 기준으로 정렬했으나, `brand-master.json` 갱신 시 재차 stale해지는
  구조적 한계 존재. 별도 개발 task, readiness blocker 아님.
- **"AI Audit" UI 부재**: 백엔드 `/api/ai-audit/*` 라우트는 존재하나 프론트엔드
  참조 없음(Local/Render 동일). Migration 차이가 아니므로 readiness blocker
  아님.
- **Local unrelated 파일 2개**(`scripts/diagnose-cafe24-ecount-product-matching.mjs`,
  `scripts/load-ecount-offline-sales.mjs`): Price Audit/Product Registry 별도
  트랙 소관, 이번 migration과 계속 분리 유지, readiness blocker 아님.

## 17. Worktree Safety Final Check (R)

```
HEAD = origin/main (커밋 전 fetch 기준 0/0)
staged: 없음
unrelated unstaged 2개: 보존, 변경 없음
work/monthly/*.json: .gitignore 규칙 확인, 미추적 데이터 파일(정책 일치)
tracked code 변경: 없음
```

## 18. Report Commit Scope (N)

3개 report 전부 `git ls-files` 결과 미추적(신규):
```
docs/reports/local-to-render-batch4-core-cross-validation-2026-08-25.md          (미추적, 신규 스테이징)
docs/reports/local-to-render-batch4-5-historical-archive-alignment-2026-08-25.md (미추적, 신규 스테이징 — U절 추가분 포함)
docs/reports/local-to-render-batch4-6-local-archive-reconciliation-2026-08-25.md (신규 작성, 신규 스테이징)
```
세 파일 모두 이번이 최초 커밋이므로 "이미 tracked → 변경분만 stage"
분기는 해당 없음 — 3개 파일 전체를 명시적 경로로 add.

## 19. Final Status

```
BATCH 4.6 COMPLETE — RENDER READY AS PRIMARY OPERATING BASELINE
```
