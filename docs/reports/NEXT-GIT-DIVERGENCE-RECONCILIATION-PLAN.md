# NEXT — Git Divergence Reconciliation Plan (READ-ONLY DESIGN)

READ-ONLY 설계 전용. `git fetch`(원격 추적 브랜치 갱신만) 외 어떤
git 쓰기 명령도 실행하지 않았다. add/commit/push/merge/rebase/
reset/checkout/switch/stash/clean/cherry-pick/브랜치/태그/worktree
생성 전부 미실행. 소스/테스트/기존 리포트/마스터 데이터/`work/`
전부 무수정.

## 1. Executive Summary

로컬(`d08ffcf`)과 origin/main(`7a8b89a`)은 공통 조상
`6bc06ae`에서 갈라졌다 — origin에만 있는 커밋 6개, 로컬에만 있는
커밋 18개. 그중 3쌍(`84791b8`↔`8600572`, `79c4302`↔`cde20eb`,
`4f6f827`↔`b12b4a4`)은 **패치 내용이 완전히 동일**(`git cherry`
확인)해 실질 충돌 위험이 없다. 진짜 위험은 **작업트리가
더럽다(dirty)는 사실 자체**다 — 현재 수정된 9개 추적 파일 중
5개(`.gitignore`, `intelligence-service.mjs`,
`scripts/build-brand-master-merge-plan.mjs`,
`scripts/build-brand-sourcing-review-table.mjs`,
`scripts/validate-brand-sourcing-decisions.mjs`)가 **origin에서도
바뀐 바로 그 파일들**이라, 커밋 없이 바로 병합을 시도하면 git이
"로컬 변경사항이 병합으로 덮어써질 것"이라며 **거부할 가능성이
매우 높다.**

**권장 전략: 격리된 임시 worktree에서 MERGE(rebase 아님) 수행.**
이유는 §7에서 상세히 설명한다 — 핵심은 이번 세션에서 이미 작성한
10개 이상의 리포트가 정확한 커밋 SHA(`5b70343`, `9459323`,
`d08ffcf`, `da1bc09` 등)를 그대로 인용하고 있어, rebase로 그 SHA들이
바뀌면 그 인용이 전부 깨진다.

## 2. Current Confirmed State

```
LOCAL HEAD:  d08ffcf chore(data): stop tracking monthly runtime archive
ORIGIN MAIN: 7a8b89a Merge pull request #2 from goflvotus-alt/codex/step50-master-data
MERGE-BASE:  6bc06aea106b220c3e6a9fe86e2aa90dc364332b
AHEAD/BEHIND: 18 / 6
git status --short: 62개 항목(9개 M, 49개 ??, staged 없음) — 직전 감사와 완전히 동일
```

## 3. File-Level Overlap Analysis (Conflict Forecast)

**origin-only 6개 커밋이 건드린 파일**(합집합, 22개):
```
.gitignore, intelligence-service.mjs, server.mjs,
scripts/{audit-brand-master-integrity,brand-engine,build-brand-master-merge-plan,
build-brand-sourcing-candidates,build-brand-sourcing-decision-workbook,
build-brand-sourcing-review-table,build-brand-universe-candidates,
promote-brand-universe,refresh-monthly-sales,upload-work-snapshots-to-render,
validate-brand-sourcing-decisions}.mjs,
test/{brand-engine,brand-master-integrity-audit,brand-master-merge-plan-status,
brand-universe-generator,csv-formula-injection,intelligence-brand-registry,
refresh-monthly-sales,work-data-upload-paths}.test.mjs
```

**로컬 18개 커밋이 건드린 파일과의 교집합(19개)** — 이 중 실제
커밋 내용(HEAD vs origin/main, 두 브랜치의 최종 상태)까지 비교한
결과:

| 파일 | HEAD vs origin/main | 원인 |
|---|---|---|
| server.mjs | **DIFFERS(891줄)** | 로컬이 압도적으로 많이 더함(STEP67/freshness 등) — origin이 건드린 부분(work-data upload 관련)은 로컬에도 동일하게 이미 존재(§4) → **겹치는 부분은 충돌 없음으로 예측**, 나머지는 origin이 손대지 않은 영역이라 자동 병합됨 |
| intelligence-service.mjs | **DIFFERS(72줄, 커밋 기준)** | origin의 `8600572`와 로컬의 `84791b8`은 동일 기반이나, 로컬은 그 위에 `4ec190d`를 추가로 얹음 — 다른 함수 영역(Clients 소스 정렬)이라 **낮은 위험으로 예측**하나 확정 아님 |
| scripts/build-brand-master-merge-plan.mjs | **DIFFERS(41줄)** | origin의 `1c537cd`(로컬에 대응 커밋 없음)가 원인 — §5 |
| scripts/build-brand-sourcing-review-table.mjs | **DIFFERS(14줄)** | 위와 동일, `1c537cd` |
| scripts/validate-brand-sourcing-decisions.mjs | **DIFFERS(14줄)** | 위와 동일, `1c537cd` |
| audit-brand-master-integrity.mjs / brand-engine.mjs / build-brand-sourcing-candidates.mjs / build-brand-sourcing-decision-workbook.mjs / build-brand-universe-candidates.mjs / promote-brand-universe.mjs / refresh-monthly-sales.mjs / upload-work-snapshots-to-render.mjs | **IDENTICAL** | 3쌍의 patch-equivalent 커밋에 포함, 완전 동일 |
| test/brand-engine 외 6개 테스트 파일 | **IDENTICAL** | 위와 동일 |

**현재 작업트리(커밋 안 된 수정분)와의 추가 교집합** — 이것이
진짜 위험 지점이다. 9개 수정된 추적 파일 중 **정확히 5개**가
origin-only 파일 목록과도 겹친다:
```
.gitignore                                     — origin/main과 diff 2줄(로컬 전용 code-review-graph 라인 추가뿐, 낮은 위험)
intelligence-service.mjs                       — origin/main과 diff 207줄(HEAD 대비도 더 큼, 작업트리에 추가 미커밋 변경 있음) — **가장 위험도 높은 파일**
scripts/build-brand-master-merge-plan.mjs      — origin/main과 **byte-identical**(작업트리가 이미 origin 상태와 같음)
scripts/build-brand-sourcing-review-table.mjs  — origin/main과 **byte-identical**
scripts/validate-brand-sourcing-decisions.mjs  — origin/main과 **byte-identical**
```
(`outputs/samplas-marketing-os.css`/`.html`, `scripts/monthly-brand-sales.mjs`,
`test/monthly-brand-sales.test.mjs`는 origin의 6개 커밋이 전혀
건드리지 않는 파일이라 병합 위험권 밖이다.)

**DIRECT MERGE IN CURRENT WORKTREE 안전한가**: **NO(위험 높음)** —
git은 병합이 어떤 파일의 내용을 바꿔야 하는데 그 파일에 커밋되지
않은 로컬 수정이 있으면 병합 자체를 시작하기 전에 거부하는 것이
표준 동작이다. 위 5개 파일 중 특히 `intelligence-service.mjs`는
작업트리 내용이 origin과도, 로컬 HEAD와도 다른 **제3의 상태**라
자동 해결이 안 될 가능성이 높다. **더러운 작업트리 위에서 바로
병합을 시도하면 안 된다.**

## 4. Patch-Equivalent Commits Under Each Strategy

```
84791b8 ↔ 8600572
79c4302 ↔ cde20eb
4f6f827 ↔ b12b4a4
```

- **MERGE 하에서**: git의 3-way 병합은 "패치 동등성"을 알지 못하고
  트리 내용만 비교한다. 병합 기준점(`6bc06ae`)에서 양쪽이 **같은
  최종 내용**에 도달했으므로(로컬도, origin도 동일한 변경을 했음),
  겹치는 부분은 "양쪽이 합의함"으로 처리돼 **충돌 없이 자동
  해결**된다. 다만 **두 커밋 다 히스토리에 남는다** — 로컬의
  `84791b8`/`79c4302`/`4f6f827`과 origin의 대응 커밋이 별개의
  SHA로 공존하게 된다(기능적 문제 없음, 이력이 약간 중복돼
  보이는 미관상의 잔재일 뿐).
- **REBASE 하에서**: 로컬 18개 커밋을 origin/main 위에 재생하는
  과정에서, `84791b8`/`79c4302`/`4f6f827`을 적용하려는 시점에 그
  변경이 이미 새 베이스(origin의 대응 커밋)에 존재해 **결과 diff가
  비게 된다** — 최신 git의 기본 동작(`--empty=drop`에 해당하는
  표준 동작)은 이런 빈 커밋을 **자동으로 건너뛴다**(수동 개입
  불필요, git이 "patch contents already upstream, skipping"과
  유사한 메시지를 출력하며 자동 처리). **이 3개 커밋은 rebase
  결과 히스토리에서 사라지고, origin의 대응 버전만 남는다** —
  rebase 쪽이 이 부분만 놓고 보면 더 깔끔하다.

## 5. Origin-Only 1c537cd

```
1c537cd fix(master-data): harden review export and merge history
 .gitignore                                    |  1 +
 scripts/build-brand-master-merge-plan.mjs     | 14 ++++++-
 scripts/build-brand-sourcing-review-table.mjs |  3 +-
 scripts/validate-brand-sourcing-decisions.mjs |  3 +-
 test/brand-master-merge-plan-status.test.mjs  | 47 +++++++++++++++++++++
 test/csv-formula-injection.test.mjs           | 59 +++++++++++++++++++++++++++
```

로컬 히스토리에는 이 커밋에 대응하는 커밋이 **전혀 없다**(§2
audit에서 이미 확인). 그런데 **로컬 작업트리(커밋 안 된 상태)의
`scripts/build-brand-master-merge-plan.mjs`/
`scripts/build-brand-sourcing-review-table.mjs`/
`scripts/validate-brand-sourcing-decisions.mjs`는 origin/main과
byte-identical**하고, `test/brand-master-merge-plan-status.test.mjs`/
`test/csv-formula-injection.test.mjs`(작업트리에 untracked 상태로
존재)도 origin/main의 버전과 byte-identical하다(직전 audit에서
diff로 확인).

**왜 이런 상태가 됐는지(git 증거로 판단 가능한 범위)**: 가장
합리적인 설명은 — 어느 시점에 `1c537cd`가 적용된 파일 내용이
(git 커밋 형태가 아니라) 파일 자체로 이 로컬 작업 디렉터리에
동기화/복사됐고(예: 다른 세션에서 origin을 pull하지 않고 파일만
가져왔거나, 별도 워크플로로 반영했을 가능성), 그 상태에서 한
번도 `git add`/`git commit`이 실행되지 않은 채 지금까지 이어져
온 것으로 보인다. **git 자체의 증거만으로 100% 확정할 수는
없다** — 다만 결과적으로 로컬 작업트리는 이미 `1c537cd`의 내용을
전부 갖고 있다.

**조정에 미치는 영향**: 병합/리베이스 어느 쪽을 택하든, 이
5개 파일에 대해서는 **origin의 버전을 그대로 받아들이는 것이
곧 이미 작업트리에 있는 내용을 그대로 유지하는 것과 동일**하다
— 즉 이 부분은 실질적으로 "충돌 없음"에 가깝다. 유일한 절차상
문제는 §3에서 지적한 "커밋되지 않은 상태에서 병합을 시작하면
git이 사전에 거부한다"는 것뿐이다.

## 6. Safety / Recovery Plan (설계만, 아직 생성하지 않음)

**목표 두 가지**: (1) 커밋된 로컬 이력(18개 커밋) 보존, (2)
현재 작업트리의 모든 바이트(수정된 9개 + untracked 49개) 보존.

**권장 조합**(실행 시점에 순서대로):

1. **안전 브랜치**(커밋 이력 보존용) — 현재 HEAD를 가리키는 새
   브랜치(예: `backup/pre-reconcile-d08ffcf`)를 만든다. 순수
   추가적 참조라 위험이 전혀 없다(브랜치 생성 자체는 아무것도
   바꾸지 않음).
2. **추적 파일 변경분 패치 백업** — `git diff`(작업트리 vs HEAD)
   출력을 스크래치패드에 `.patch` 파일로 저장 — 9개 수정 파일의
   정확한 변경 내용을 텍스트로 보존.
3. **미추적 파일 매니페스트 + 사본** — `git ls-files --others
   --exclude-standard`로 정확한 49개 목록을 뽑고, 그 파일들을
   스크래치패드에 통째로 복사(또는 tar)해 둔다.
4. **격리된 임시 worktree**(실제 병합 작업 공간) — 새 임시 브랜치를
   현재 HEAD에서 만들고 그 브랜치를 위한 별도 worktree를 저장소
   밖 경로에 추가한다. **이 worktree는 생성 시점에 완전히
   깨끗한(uncommitted 변경이 전혀 없는) 상태로 체크아웃되므로**,
   §3의 "더러운 작업트리" 문제 자체가 이 안에서는 애초에 존재하지
   않는다 — 병합을 이 안에서 시도한다.
5. **stash — 평가만 하고 채택하지 않음**: `git stash`는 미추적
   파일까지 포함하려면 `-u`가 필요하고, 복원 시 충돌 가능성이
   있으며 무엇보다 "임시 worktree" 방식이 원본 작업트리를
   **아예 건드리지 않는다**는 점에서 근본적으로 더 안전하다 —
   stash는 원본 작업트리 자체를 일시적으로 변경(clean)시키므로
   이번 계획에서는 채택하지 않는다.
6. **파일시스템 백업**: 위 2/3번이 사실상 그 역할을 한다 — 별도
   전체 디렉터리 tar가 추가로 필요하지는 않을 것으로 판단되나,
   실행 시점에 최종 판단한다.

## 7. Recommended Strategy

**MERGE(rebase 아님), 격리된 임시 worktree 안에서 수행.**

**우선순위별 근거**:
1. **로컬 작업 손실 0**: 임시 worktree는 원본 체크아웃을 전혀
   건드리지 않으므로 원본 작업트리의 62개 항목이 병합 시도
   여부와 무관하게 그대로 남는다 — 가장 안전.
2. **이미 검증된 커밋 보존**: 병합은 어떤 기존 커밋의 SHA도
   바꾸지 않는다 — `5b70343`/`9459323`/`da1bc09`/`d08ffcf` 등
   이번 세션 리포트 10개 이상이 정확한 SHA로 인용하고 있는데,
   **rebase를 택하면 이 15개 커밋의 SHA가 전부 바뀌어 그 인용이
   깨진다.** 이것이 rebase 대신 merge를 권장하는 **결정적 이유**다.
3. **origin 수정사항 반영**: 병합이 정확히 이 목적을 달성한다.
4. **force-push 회피**: §9에서 설명하듯 merge와 rebase 둘 다
   이 상황에서는 fast-forward push가 가능해(origin의 커밋을
   버리지 않으므로) 이 기준으로는 무승부이지만, 그래도 merge가
   더 예측 가능하다.
5. **깔끔한 이력**(최하위 우선순위): merge는 3쌍의 중복 커밋을
   히스토리에 남기지만(§4), 이는 기능적으로 무해한 미관상의
   문제일 뿐이며, 다른 5개 기준에서 merge가 명백히 우월하므로
   이 기준 하나 때문에 rebase를 택하지 않는다.
6. **프로덕션 배포 위험 최소화**: 이번 조정 절차 자체는 `work/`를
   전혀 건드리지 않는다(git 이력/작업트리 파일 문제이지 런타임
   데이터 문제가 아님) — 어느 전략을 택해도 7월 아카이브
   안전성에는 영향이 없다.

## 8. Future Execution Sequence (실행 안 함 — 설계만)

각 단계 사이에 **명시적 STOP + 확인** 지점을 둔다.

```
[체크포인트 0] 안전 브랜치 생성
  git branch backup/pre-reconcile-d08ffcf HEAD
  → 확인: git log -1 backup/pre-reconcile-d08ffcf가 정확히 d08ffcf를 가리키는지
  → STOP, 사용자 확인

[체크포인트 1] 현재 작업트리 백업
  git diff > <scratchpad>/pre-reconcile-tracked-changes.patch  (9개 파일)
  git ls-files --others --exclude-standard > <scratchpad>/pre-reconcile-untracked-manifest.txt
  (매니페스트의 49개 파일을 스크래치패드로 복사)
  → 확인: patch 파일 비어있지 않은지, 매니페스트가 정확히 49줄인지, 복사된 파일 개수 일치
  → STOP, 사용자 확인

[체크포인트 2] 격리 worktree 준비
  git branch reconcile/main-merge-temp HEAD
  git worktree add <repo 밖 경로>/samplas-reconcile-tmp reconcile/main-merge-temp
  → 확인: 새 worktree의 git status가 완전히 깨끗한지(uncommitted 없음)
  → 확인: 원본 작업트리의 git status가 이전과 완전히 동일한지(전혀 안 건드려졌는지)
  → STOP, 사용자 확인

[체크포인트 3] 임시 worktree 안에서 병합 시도
  (cd <임시 worktree>) git merge origin/main
  → 충돌 없으면: 바로 체크포인트 4로
  → 충돌 있으면: §3에서 예측한 파일들(intelligence-service.mjs 등) 위주로 예상,
    §5 근거대로 3개 master-data 스크립트는 origin 버전을 그대로 받아도 무방함을
    참고해 파일별로 신중히 해결 → 해결 후 병합 커밋 생성 전 diff 전체를 사용자에게 제시
  → STOP, 사용자 확인(병합 결과 diff 검토)

[체크포인트 4] 임시 worktree에서 전체 회귀
  node --test 'test/**/*.test.mjs'
  → 확인: 전부 PASS(개수는 병합으로 인해 이전 334보다 늘어날 수 있음 — origin의
    테스트 파일들이 이미 로컬 작업트리에 untracked로 존재해 왔으므로 큰 변화는
    없을 것으로 예상되나 재계산 필요)
  → STOP, 사용자 확인

[체크포인트 5] work/ 무결성 확인
  git ls-files work/monthly/  → 비어있어야 함(추적 안 됨 유지)
  work/monthly/2026-07.json 파일 자체는 이 병합 절차와 무관하게 원본 위치에서
  전혀 건드려지지 않았어야 함(임시 worktree는 별도 경로이므로 애초에 영향 없음)
  → STOP, 사용자 확인

[체크포인트 6] 사용자 최종 승인
  → 병합 커밋 diff, 테스트 결과, 충돌 해결 내역을 종합해 사용자에게 제시
  → 승인 없이는 다음 단계 진행 안 함

[체크포인트 7] 원본 브랜치에 결과 반영(가장 섬세한 단계)
  원본 작업트리는 여전히 §2의 더러운 상태이므로, 검증된 병합 결과를 실제
  main 브랜치로 가져오는 정확한 명령은 그 시점의 실제 상태를 보고 결정한다
  (예: 원본 작업트리의 5개 위험 파일만 임시로 별도 커밋해 치운 뒤 병합 결과를
  받아들이고 그 임시 커밋을 다시 풀어내는 방식, 또는 원본 브랜치 포인터만
  검증된 병합 커밋으로 옮기고 작업트리 파일은 그대로 두는 방식 등 — 실행
  시점에 실제 diff를 보며 사용자와 함께 최종 결정)
  → STOP, 실행 전 반드시 재확인

[체크포인트 8] 임시 리소스 정리
  git worktree remove, 임시 브랜치 삭제(백업 브랜치는 유지)

[체크포인트 9, 별도 단계] push
  이번 계획 범위 밖 — 별도의 명시적 승인 STEP에서 진행
```

## 9. Post-Reconciliation Expectation

- **HEAD와 origin/main의 관계**: 병합 후 HEAD는 origin/main을
  조상으로 포함하는 직계 하위 커밋이 된다(병합 커밋 1개 추가,
  총 19개 앞섬).
- **ahead/behind**: ahead 19, behind 0.
- **중복 커밋 처리**: 3쌍 전부 히스토리에 남는다(§4, merge 기준).
- **작업트리 상태**: 임시 worktree 방식을 쓰면 원본 작업트리는
  절차 전체에서 **한 바이트도 안 바뀐 채** 남아있어야 한다(성공
  기준) — 체크포인트 7에서 결과를 반영할 때만 예외적으로,
  §3에서 식별한 5개 위험 파일에 한해 최종 내용이 origin 기준으로
  정리될 수 있다(단, 이미 그 파일들 대부분이 origin과 동일하거나
  무관한 영역이라 실질적 손실은 없을 것으로 예상).
- **334/334 재실행 필요**: **YES** — 병합으로 코드가 바뀌므로
  반드시 재확인.
- **STEP67 Chrome QA 재필요**: **YES(권장)** — 기계적으로 병합
  자체가 STEP67 기능을 바꾸지는 않지만(origin이 그 영역을 건드리지
  않으므로), 실제 push+배포 전 마지막 안전장치로 권장.
- **7월 아카이브 안전성 재확인 필요**: **YES(권장)** — 이번
  git 조정 절차 자체는 `work/`를 전혀 건드리지 않지만(순수 git
  이력/작업트리 문제), 실제 push+배포로 이어지는 다음 단계
  직전에 습관적으로 재확인하는 것을 권장(기존 세션 관행과 일치).
- **push가 fast-forward인가**: **YES** — merge 결과든(§7) 이론상
  rebase 결과든, origin/main의 기존 6개 커밋을 버리지 않고 그
  위에 쌓는 형태라 **force push 불필요**(§7에서 이미 정정된 이해).
- **Render 자동 배포 가능성**: 직전 감사에서 확인했듯
  `render.yaml`에 `autoDeploy: false`가 명시돼 있지 않아, push
  시 자동 배포가 트리거될 가능성이 있다 — 이는 이번 git 조정과는
  별개의, 이후 별도 STEP에서 다룰 사안이다.

---

====================
GIT DIVERGENCE RECONCILIATION PLAN
==================================

LOCAL HEAD:
d08ffcf chore(data): stop tracking monthly runtime archive

ORIGIN MAIN:
7a8b89a Merge pull request #2 from goflvotus-alt/codex/step50-master-data

MERGE BASE:
6bc06aea106b220c3e6a9fe86e2aa90dc364332b

AHEAD / BEHIND:
18 / 6

DIRTY WORKING TREE:
YES (9 modified tracked + 49 untracked, nothing staged)

DIRECT MERGE IN CURRENT WORKTREE SAFE:
NO

REBASE SAFE:
CONDITIONAL (기계적으로는 가능하나 15개 커밋 SHA가 전부 바뀌어 이번 세션 리포트들의 SHA 인용이 깨짐 — 권장하지 않음)

PATCH-EQUIVALENT COMMITS:
84791b8↔8600572, 79c4302↔cde20eb, 4f6f827↔b12b4a4 — merge: 둘 다 히스토리에 남되 충돌 없이 자동 해결됨 / rebase: 로컬 3개가 빈 커밋으로 자동 스킵됨

ORIGIN-ONLY CRITICAL COMMIT:
1c537cd fix(master-data): harden review export and merge history (로컬 작업트리가 이미 이 내용을 byte-identical하게 보유 중, 단 커밋 이력에는 없음)

PREDICTED CONFLICT FILES:
intelligence-service.mjs(위험 높음), .gitignore(위험 낮음, 2줄 추가뿐), scripts/build-brand-master-merge-plan.mjs·build-brand-sourcing-review-table.mjs·validate-brand-sourcing-decisions.mjs(작업트리가 이미 origin과 동일해 실질 충돌 없음, 단 커밋 전 상태이므로 병합 자체는 이 파일들에 대해 사전 거부될 수 있음)

RECOMMENDED STRATEGY:
격리된 임시 worktree 안에서 MERGE(origin/main → 로컬) 수행, 사전에 안전 브랜치 + 작업트리 백업 확보

WHY:
로컬 작업 손실 위험 0, 이미 문서화된 커밋 SHA 보존(rebase는 15개 SHA를 바꿔 리포트 인용을 깨뜨림), origin 수정사항 온전히 반영, force-push 불필요, work/ 무관

RECOVERY PLAN REQUIRED:
YES

FORCE PUSH REQUIRED:
NO

EXPECTED FINAL HISTORY:
origin/main(6개) + 로컬(18개, 3쌍 중복 포함) + 병합 커밋 1개 = origin/main 대비 19개 앞선 단일 선형 조상 관계

EXPECTED PUSH TYPE:
FAST-FORWARD

POST-RECONCILIATION FULL REGRESSION REQUIRED:
YES

POST-RECONCILIATION CHROME QA REQUIRED:
YES

JULY ARCHIVE RECHECK REQUIRED:
YES

NEXT ACTION:
사용자와 함께 §8의 체크포인트 0(안전 브랜치 생성)부터 시작할지 결정 — 이번 STEP에서는 미실행

REPORT:
docs/reports/NEXT-GIT-DIVERGENCE-RECONCILIATION-PLAN.md

COMMIT:
NONE

PUSH:
NONE

DEPLOY:
NONE
====================
