# SAMPLAS Local → Render Migration — Batch 4.5: Historical Monthly / Annual Archive Alignment — 2026-08-25

**상태: HARD STOP — CASE C (Render가 canonical) — production mutation 금지, 보고 후 중단**

## A. Baseline

```
HEAD = origin/main = ba10669dd163c1e5196cd909c86279b3c0965a69 (0/0)
staged: 없음
unrelated unstaged 2개(diagnose-cafe24-ecount-product-matching.mjs, load-ecount-offline-sales.mjs): 보존
untracked: 117 (Batch 4 report 포함, 그대로 보존)
```
`docs/reports/local-to-render-batch4-core-cross-validation-2026-08-25.md`는
수정하지 않았다 — blocker를 발견한 그 시점의 기록 그대로 보존.

## B. Monthly Diff Matrix (재실측, 과거 Batch 4 수치 재사용 안 함)

| Month | Local total | Render total | Delta | Local online | Render online | Local offline | Render offline | Archive Status |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 2026-01 | 251,557,086 | 250,102,958 | +1,454,128 | 42,514,986 | 41,060,858 | 209,042,100 | 209,042,100 | saved/saved |
| 2026-02 | 188,254,020 | 186,329,089 | +1,924,931 | 37,998,020 | 36,073,089 | 150,256,000 | 150,256,000 | saved/saved |
| 2026-03 | 335,103,568 | 330,054,363 | +5,049,205 | 64,996,758 | 59,947,553 | 270,106,810 | 270,106,810 | saved/saved |
| 2026-04 | 355,645,683 | 354,304,011 | +1,341,672 | 60,443,033 | 59,101,361 | 295,202,650 | 295,202,650 | saved/saved |
| 2026-05 | 350,503,662 | 344,037,071 | +6,466,591 | 35,975,012 | 29,508,421 | 314,528,650 | 314,528,650 | saved/saved |
| 2026-06 | 209,187,510 | 205,267,886 | +3,919,624 | 32,454,810 | 28,535,186 | 176,732,700 | 176,732,700 | saved/saved |
| 2026-07 | 273,544,433 | 273,544,433 | 0 | 35,571,903 | (동일) | 237,972,530 | (동일) | saved/saved |

**패턴이 매우 명확함: offline 금액은 6/6개월 전부 완전 동일. 차이는 100%
online(Cafe24) 금액에서만 발생.** delta 크기가 매월 제각각인 것도
online 주문 데이터의 실제 정정/취소 내역과 정합적이다(단순 배율/버그
패턴 아님).

## C. Source Trace

- `GET /api/reports/monthly?month=X` (`server.mjs`) — `month === currentMonth()`이면 실시간 `buildMonthlyArchive()`, **과거월이면 저장된 archive**를 우선 사용
- `monthlyArchivePath(month) = join(workDir, "monthly", "{month}.json")` — canonical 경로 확정(`server.mjs:4681-4683`)
- `readMonthlyArchive(month)`(`server.mjs:4686-4694`)가 이 파일을 그대로 읽어 반환(`archiveStatus: "saved"`)
- `writeMonthlyArchive(month, archive)`(`server.mjs:4720-4726`)가 atomic write(`writeJsonAtomic`)로 이 파일을 갱신 — 이 함수를 호출하는 경로는 `/api/reports/monthly/archive`(수동 트리거) 또는 `refreshMonthlySales()`의 파생 로직뿐, **자동으로 정기 재계산되지 않는다**
- 즉 2026-01~06의 Local `totalSales`는 `work/monthly/{month}.json`이라는 **정적 캐시 파일**에서 그대로 온 것이며, 그 파일이 마지막으로 쓰인 시점 이후의 Cafe24 온라인 주문 변경(취소/정정 등)은 전혀 반영되지 않는다.

## D. Local Archives

| month | path | size | mtime(파일) | generatedAt(내용) | hash |
|---|---|---|---|---|---|
| 2026-01 | work/monthly/2026-01.json | 112,522B | 2026-08-12 00:25 | 2026-07-16T15:39:23.000Z | `e33985ce...` |
| 2026-02 | 〃 | 105,301B | 2026-08-12 00:25 | 2026-07-16T15:39:23.043Z | `bec8f6e8...` |
| 2026-03 | 〃 | 134,751B | 2026-08-12 00:25 | 2026-07-16T15:39:23.089Z | `df435170...` |
| 2026-04 | 〃 | 142,490B | 2026-08-12 00:25 | 2026-07-16T15:39:23.140Z | `f3d9b4d9...` |
| 2026-05 | 〃 | 120,583B | 2026-08-12 00:25 | 2026-07-16T15:39:23.177Z | `e4b6390b...` |
| 2026-06 | 〃 | 124,488B | 2026-08-12 00:20 | 2026-07-16T15:39:23.226Z | `bd303f82...` |
| 2026-07 | 〃 | 315,907B | 2026-08-12 01:56 | **2026-08-11T16:56:16.580Z** | `9cd0bda5...` |

**핵심 관찰:** 01~06월은 전부 내용상 `generatedAt`이 2026-07-16 15:39:23대(수백ms 간격, 한 번의 일괄 배치 생성)이고, 파일 mtime은 2026-08-12 00:20~00:25(git 재구성/체크아웃성 이벤트로 추정 — 내용은 그대로 두고 파일만 재기록됨). **7월만 완전히 별도로, 훨씬 나중인 8/11 16:56에 독자적으로 재생성됨.**

## E. Render Archives (기존 공식 read API로 확인)

| month | Render total | Render generatedAt |
|---|---:|---|
| 2026-01 | 250,102,958 | **2026-07-29T10:32:13.111Z** |
| 2026-02 | 186,329,089 | 2026-07-29T10:32:21.407Z |
| 2026-03 | 330,054,363 | 2026-07-29T10:32:25.386Z |
| 2026-04 | 354,304,011 | 2026-07-29T10:32:29.851Z |
| 2026-05 | 344,037,071 | 2026-07-29T10:32:33.807Z |
| 2026-06 | 205,267,886 | 2026-07-29T10:32:37.216Z |
| 2026-07 | 273,544,433 | (Local과 동일, 8/11 재생성분이 이미 업로드됨) |

Render의 01~06월 `generatedAt`은 전부 **2026-07-29T10:32:xx**(월별로 4~8초
간격, 하나의 연속 배치 실행) — **Local의 7/16 배치보다 13일 늦게, 별도로
한 번 더 갱신된 기록**이다.

## F. Root Cause

**확정: "Render is canonical" — Local 쪽이 stale.**

증거(G절 참조)로 이미 확정됐지만 다시 요약: Render의 01~06월 archive는
Local보다 나중(7/29)에 생성됐고, 그 값이 **오늘(8/25) 시점 live 소스로
재계산한 값과 정확히 일치**한다. 반대로 Local의 archive는 그보다 이전(7/16)
스냅샷에 머물러 있어, 그 사이(7/16~7/29 사이 어느 시점)에 실제로 발생한
Cafe24 온라인 주문 정정(취소/환불 등으로 추정)을 반영하지 못하고 있다.
offline(ECOUNT)은 6/6개월 완전 동일 — 문제는 순전히 Cafe24 온라인 소스
쪽에서, 그것도 오직 Local 파일이 최신화되지 않은 데서 발생한다.

## G. Canonical Truth Validation (실측, 추정 아님)

`buildMonthlyArchive(month)`(`server.mjs`, export된 공식 함수, 저장 파일과
무관하게 immutable 소스로부터 **즉시 재계산**)를 직접 두 차례 호출해 검증:

```
buildMonthlyArchive("2026-01") 실시간 재계산 결과:
  total: 250,102,958 | online: 41,060,858 | offline: 209,042,100

buildMonthlyArchive("2026-05") 실시간 재계산 결과:
  total: 344,037,071 | online: 29,508,421 | offline: 314,528,650
```

**두 달 모두 RENDER의 저장값과 100% 일치, LOCAL의 저장값과는 불일치.**
(2026-01: fresh=Render=250,102,958 ≠ Local=251,557,086 /
2026-05: fresh=Render=344,037,071 ≠ Local=350,503,662)

판정:
```
2026-01: RENDER CORRECT
2026-02: RENDER CORRECT  (offline 동일 + online 패턴 완전 동일 구조 → 동일 결론으로 확장, 개별 rebuild는 미실행)
2026-03: RENDER CORRECT  (동일 근거)
2026-04: RENDER CORRECT  (동일 근거)
2026-05: RENDER CORRECT  (직접 rebuild로 실측 확인)
2026-06: RENDER CORRECT  (동일 근거)
```
2월~4월, 6월은 개별로 `buildMonthlyArchive()`를 재실행하지는 않았으나(라이브
Cafe24 API 호출 비용/시간 고려), offline 완전 동일 + online 패턴(Render가
항상 더 낮고, generatedAt이 항상 동일한 7/29 배치)이 1월·5월 실측 결과와
완전히 동일한 구조이므로 같은 결론으로 합리적 확장 판단. **`Local이 더
크다 = Local이 맞다`라고 가정하지 않았음** — 오히려 정반대로 확인됨.

## H. 2026-07 Control Month

7월은 Local이 8/11 16:56에 **한 번 더** 별도로 재생성되었고(01~06의 7/29
배치보다도 나중), 그 재생성 결과가 그대로 Render에 업로드되어 지금
Local=Render로 일치한다(과거
`docs/reports/NEXT-JULY-RENDER-PERSISTENT-ARCHIVE-DEPLOYMENT.md`,
`NEXT-JULY-MONTHLY-ARCHIVE-CLEAN-REBUILD-PLAN.md` 등 기존 리포트와 정합).
즉 **"올바른 절차"는 이미 7월에 한 번 시연됨**: (1) Local에서 공식 빌더로
재생성 → (2) 검증 → (3) Render에 업로드. 01~06월은 이 절차의 **1단계(Local
재생성)가 애초에 빠진 상태**이고, Render 쪽만 어떤 경로로(7/29, 이번 조사
범위 밖) 이미 올바른 값으로 갱신되어 있었던 것으로 보인다.

## I. Fix Decision

```
CASE C — Render is canonical
```
지시된 원칙 그대로: **production mutation 금지, migration은 Local을
production 기준에 맞추는 별도 작업으로 처리, 이번 Batch는 여기서 중단.**

## J. Backup / Safety

해당 없음 — Render에 어떤 쓰기도 시도하지 않았으므로 rollback 확보가
필요한 mutation 자체가 없었음.

## K. Dry Run

**미실행.** CASE C 확정 직후 업로드 방향성 자체가 (local→render가 아니라
render→local 참고, 또는 별도 local 재생성) 이므로, 이번 batch가 준비했던
"01~06월 upload dry-run"은 수행하지 않음(수행 시 이미 올바른 Render 데이터를
Local의 stale 값으로 덮어쓰는 실질적 회귀가 되므로 명백히 금지 대상).

## L. Alignment

**미실행.** Production에 대한 어떤 쓰기도 수행하지 않았음.

## M. Monthly After

해당 없음(변경 없음). 현재 상태가 이미 그대로 "Render 정답, Local 참고용
stale 캐시"로 유지됨.

## N. Annual After

해당 없음(변경 없음).

## O. Regression

Production을 전혀 건드리지 않았으므로 회귀 위험 자체가 없음 — 별도 재확인
생략(직전 Batch 4에서 이미 8개 핵심 endpoint 전수 PASS 확인됨, 변경 사항
없으므로 재확인 불필요).

## P. Readiness

**중요한 재해석:** Batch 4에서 "blocker"로 분류했던 01~06월 불일치는, 이번
조사로 **Render 쪽 데이터가 실제로는 이미 올바르고(live 재계산과 일치),
문제가 있는 쪽은 Local의 오래된 캐시 파일**임이 확인됐다. 즉 이 사실
자체만 놓고 보면 **Render의 production 데이터 정확성에는 결함이 없다** —
다만 이건 이번 batch의 범위(CASE C에서는 판정을 내리지 말고 보고 후
중단하라는 명시적 지시)를 넘어서는 자체 판단이므로, **최종 readiness
verdict는 사용자 확인 후 결정하도록 보류**한다.

## Q. Development Reports

```
docs/reports/local-to-render-batch4-core-cross-validation-2026-08-25.md  — 그대로 보존(수정 없음)
docs/reports/local-to-render-batch4-5-historical-archive-alignment-2026-08-25.md  — 이 문서
```

## R. Report Commit / Push

**아직 수행하지 않음** — CASE C(hard stop) 상황이라 사용자 확인 후 다음
지시를 기다린다.

## S. Worktree Safety

```
HEAD = origin/main = ba10669dd163c1e5196cd909c86279b3c0965a69 (변경 없음)
staged: 없음
unrelated unstaged 2개: 그대로
기존 untracked 보존
source code 수정 없음(읽기 전용 buildMonthlyArchive() 호출 2회만 수행, 파일 쓰기 없음)
```

## T. Verdict

```
BATCH 4.5 BLOCKED — HISTORICAL ARCHIVE SOURCE REQUIRES FOLLOW-UP
```

정확히는 "막혀서 진행 불가"가 아니라 **"CASE C 확정 → 지시된 hard-stop
조건에 따라 production mutation 없이 의도적으로 중단"**이다. 다음 결정이
필요하다:
1. Render(현재 01~06월 값)가 정답이라는 이번 결론을 승인하는지
2. 승인 시, Local의 `work/monthly/2026-01~06.json` 6개 파일을 공식
   `buildMonthlyArchive()`로 재생성해서 Local 자체를 Render/실제값에
   맞출지(별도 Batch로 진행 여부)
3. 그 경우 Batch 4의 "RENDER NOT YET READY" 판정을 재검토할지

## U. Follow-up Resolution (Batch 4.6, 후속 추가 — 위 진단 내용은 그대로 보존)

사용자가 위 CASE C 결론(Render가 canonical)을 승인함. 후속 조치는
**Batch 4.6**(`docs/reports/local-to-render-batch4-6-local-archive-reconciliation-2026-08-25.md`)에서
수행:
- 위 J항목 2번대로 Local `work/monthly/2026-01~06.json` 6개 파일을 공식
  `buildMonthlyArchive()` + `writeMonthlyArchive()` 경로로 재생성 —
  Render를 그대로 두고 Local만 맞춤(Render data mutation 없음, T항목 검토
  대상이었던 그대로).
- 재생성 후 Local↔Render 2026-01~07 전월 재비교 결과 전부 일치(delta=0).
- Batch 4의 "RENDER NOT YET READY" 최초 판정은 삭제/수정하지 않고
  그대로 보존(K항목 지시 이행) — Batch 4.6에서 별도로 최종 재판정.
