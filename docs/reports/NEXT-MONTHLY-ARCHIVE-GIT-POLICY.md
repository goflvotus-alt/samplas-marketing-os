# NEXT — Monthly Archive Git Tracking Policy (READ-ONLY DECISION)

READ-ONLY. 파일/git 인덱스/.gitignore 전부 무수정. 깨끗한 7월
아카이브(`work/monthly/2026-07.json`)는 이 조사 동안 손대지 않았다.

## 1. Current Tracking State

```
git ls-files work/monthly/        → work/monthly/2026-07.json (단 하나)
git status --short work/monthly/  →  M work/monthly/2026-07.json

.gitignore(9번째 줄, 관련 섹션 주석 포함):
  # Local runtime cache and private business data
  work/
  baselines/**/work-samples/
  *.csv
  *.log

git check-ignore -v work/monthly/2026-01.json → .gitignore:9:work/  (무시됨)
git check-ignore -v work/monthly/2026-08.json → .gitignore:9:work/  (무시됨)
git check-ignore -v work/monthly/2026-07.json → (매치 없음 — 이미 추적 중이라 ignore 규칙이 적용되지 않음, git의 표준 동작: 이미 tracked인 파일은 .gitignore가 있어도 계속 추적됨)
```

**결론**: 2026-07.json은 명백한 **의도된 예외**다 — `.gitignore`
자체가 `work/`를 "Local runtime cache and private business data"라고
**스스로 명시적으로 규정**하고 있고, 다른 모든 달(2026-01~06,
2026-08)은 정확히 그 규칙대로 무시된다. 향후 새로 생성되는 월간
아카이브는 **자동으로는 추적되지 않는다**(git add를 명시적으로,
그것도 `-f`로 강제해야만 추적 가능).

## 2. Git History

```
git log --follow --oneline -- work/monthly/2026-07.json
  → 4322b67 data: backfill July offline sales archive (2026-07-17 01:55:32, 단 1개 커밋, 그 이후 재커밋 없음)

커밋 메시지 전문: "data: backfill July offline sales archive"(본문 없음, 제목 한 줄)
diff: work/monthly/2026-07.json | 2539 +++...  (신규 파일 1개, 2,539줄 추가, 다른 파일 없음)
```

**직전/전후 커밋 맥락(같은 날, 2026-07-17 새벽)**:

```
0df11a7 feat: add monthly offline sales backfill tool   (4322b67보다 7분 먼저, scripts/backfill-monthly-offline-sales.mjs 신규 258줄)
4322b67 data: backfill July offline sales archive        (← 이 파일)
aa9a583 feat: show online and offline sales in monthly reports
ca259a3 feat: show total sales in annual flow
3b53cc7 feat: show total sales in today summary
```

`.gitignore`의 `work/` 규칙은 이보다 이틀 앞선 `f215088`(2026-07-15)
시점에 **이미 존재**했다(직접 확인) — 즉 `4322b67`은 `.gitignore`를
무시하고 **의도적으로 force-add**됐다.

**원래 목적 판정**: `scripts/backfill-monthly-offline-sales.mjs`
(방금 막 추가된 새 CLI 도구)를 **처음 만들고 바로 실행한 결과물을
예시/참고용으로 함께 커밋한 것**으로 강하게 판단된다 — 근거:
(a) 도구 커밋과 데이터 커밋이 7분 간격, 같은 새벽 세션, (b)
`scripts/backfill-monthly-offline-sales.mjs`는 **저장소 어디에서도
다시 참조되지 않는다**(grep 결과 자기 자신만 매치 — 다른 스크립트/
server.mjs/테스트 어디서도 import/호출되지 않음, 고아 상태 CLI),
(c) 그 시점 저장된 아카이브 자체가 `generatedAt: 2026-07-13T13:36:44`
(7월이 채 끝나기도 전의 부분월 스냅샷)였다는 것도 "정식 월말 결산
스냅샷"이 아니라 "막 만든 도구를 테스트해본 결과물"이라는 성격과
일치한다.

**분류**: **B(임시 backfill fixture/개발 중 예시 데이터)** — A(영구
canonical 스냅샷)로 보기 어렵다. 명시적 문서/커밋 본문에 "이후에도
계속 이렇게 관리하겠다"는 정책 선언은 전혀 없다.

## 3. Application Behavior

```
buildMonthlyArchive(month)          → Cafe24(buildBrandSalesDiagnostics)/ECOUNT(readEcountOfflineSalesSnapshot)/
                                       Meta Ads/Instagram에서 매번 100% 새로 계산(work/monthly/*.json을 입력으로 쓰지 않음)
readMonthlyArchive(month)           → work/monthly/{month}.json이 있으면 그대로 읽고, 없으면 null
writeMonthlyArchive(month, archive) → work/monthly/{month}.json에 원자적으로 씀(writeJsonAtomic, tmp+rename)
enrichMonthlyArchiveBrandSales()    → 캐시가 stale하면(신선도 마커 비교) 오프라인만 재병합 후 재저장(이번 세션에서 구현/수리)
ensurePreviousMonthlyArchiveSaved() → 직전 월 파일이 없으면 build+저장(build-once, 있으면 손대지 않음)
GET /api/reports/monthly            → 당월=항상 live(캐시 없음), 과거월=캐시 있으면 enrich 후 서빙, 없으면 draft로 즉석 빌드
```

**분류**: `work/monthly/*.json`은 **재생성 가능한 서빙 캐시/
materialization**이다 — 원본(Cafe24 주문 캐시 + ECOUNT 오프라인
스냅샷)만 있으면 언제든 동일한(또는 더 정확한, freshness 수리
이후) 결과를 다시 만들 수 있다. **애플리케이션이 "이 정확한 파일이
영구히 존재해야 한다"고 요구하는 지점은 코드 어디에도 없다** —
없으면 그냥 다시 만든다(draft/build-once 경로).

**주의**: `work/ecount-sales/*.json`(오프라인 원본 스냅샷, XLSX에서
1회 수입)은 이것과 다르다 — 이건 **진짜 시드(seed) 데이터**다(재생성
불가, 원본 XLSX 재업로드 필요). `work/monthly/*.json`은 그 시드
+ Cafe24로부터 **파생된 계산 결과**일 뿐이다.

## 4. Deployment Behavior

**결정적 증거 — `render.yaml`**:

```yaml
disk:
  name: samplas-cafe24-token-store
  mountPath: /var/data
  sizeGB: 1
envVars:
  - key: WORK_DIR
    value: /var/data/samplas-dashboard/work
```

프로덕션(Render)은 **1GB 영구 디스크**를 갖고 있고, `WORK_DIR`
환경변수가 그 디스크 안의 경로(`/var/data/samplas-dashboard/work`)를
가리킨다 — **git 체크아웃 안의 `work/` 디렉터리가 아니다.**
즉 프로덕션의 `work/monthly/*.json`은 git 커밋과 완전히 독립적으로,
그 영구 디스크에 직접 존재/유지된다.

**결정적 증거 2 — `scripts/upload-work-snapshots-to-render.mjs`**:
이 스크립트가 정확히 이런 상황(로컬에서 고친 `work/monthly/*.json`
을 프로덕션에 반영하고 싶을 때)을 위해 이미 존재한다 — 로컬 파일을
읽어 `POST {RENDER_DASHBOARD_URL}/api/work-data/upload`로 인증된
HTTP 요청을 보내 **직접 그 영구 디스크에 씀**(`monthly/YYYY-MM.json`
패턴을 명시적으로 허용 목록에 포함, `discoverWorkSnapshotPaths()`
정규식으로 이미 확인).

**결론**: **프로덕션이 수정된 7월 데이터를 받는 데 git 커밋은
전혀 필요하지 않다.** 의도된 배포 경로는 이 업로드 스크립트다.
(단, 이 스크립트를 실제로 실행하는 것은 프로덕션에 쓰기 작업을
가하는 행위이므로 — 이번 READ-ONLY STEP에서는 절대 실행하지
않았다. 실행 여부는 별도의, 명시적 승인이 필요한 결정이다.)

## 5. Repository Consistency

**현재 상태는 이미 비일관적이다** — 7월만 추적되고 다른 모든 달은
무시된다. 이것이 "앞으로 완결된 달은 전부 커밋해야 한다"는 기대를
만드는가? **아니오, 그럴 근거가 없다** — `.gitignore`의 명시적 문구
("Local runtime cache and private business data") 자체가 그런
기대와 정반대다. 7월 파일은 §2에서 확인했듯 **의도적, 반복되지
않은, 일회성 예외**(도구 개발 중 예시 데이터)로 판단되며, 앞으로도
매달 커밋하는 관행으로 이어질 근거가 저장소 어디에도 없다.

## 6. Options

| 옵션 | 장점 | 리스크 | 배포 영향 | 향후 유지보수 영향 |
|---|---|---|---|---|
| **A. 지금 깨끗한 7월을 canonical 스냅샷으로 커밋** | 이번 수정의 감사 흔적이 git 이력에 남음, `git status`가 즉시 clean해짐 | `.gitignore`가 스스로 선언한 정책과 정면으로 배치됨, "이제부터 매달 커밋해야 하나"라는 잘못된 선례를 만들 위험(§5) | 없음(§4 — 배포는 git과 무관) | 매달 반복해야 한다는 오해 유발 가능, 향후 온라인 freshness 등 추가 수리가 있을 때마다 다시 큰 diff 커밋을 반복해야 함 |
| **B. 커밋하지 않음(runtime 생성 상태로 취급)** | `.gitignore` 정책과 완전히 일치, 배포에 영향 없음(§4), 추가 git 조작 없이 가장 낮은 리스크 | `git status`가 이 파일에 대해 계속 "modified"로 남아 잡음이 됨(단, 기능적 위험은 전혀 없음) | 없음 | 없음 — 온라인 freshness 등 향후 수리 시에도 동일하게 무시하면 됨(일관적) |
| **C. 향후 별도 정책 변경으로 추적 해제(`git rm --cached`)** | 저장소를 `.gitignore`가 이미 선언한 정책과 완전히 일치시킴, 가장 근본적인 정리 | git 이력 조작(이번 STEP의 절대 금지 목록에 포함, 지금 실행 불가), 파일을 지우는 것으로 오인되지 않도록 커밋 메시지에 명확한 설명 필요 | 없음 | 한 번만 하면 이후 이 파일에 대한 혼란이 완전히 사라짐 — **장기적으로 가장 깨끗한 결과** |
| **D. 기타** | — | — | — | — |

## 7. Recommendation

**DO NOT COMMIT JULY ARCHIVE.**

근거: `.gitignore`가 저장소 스스로 `work/`를 "local runtime cache
and private business data"로 명시했고(§1), 7월의 추적 자체가
의도된 장기 정책이 아니라 도구 개발 중 우연히 생긴 일회성
예외였으며(§2), 애플리케이션은 이 파일을 언제든 원본에서 재생성
가능한 캐시로 취급하고(§3), 프로덕션은 git과 완전히 분리된 영구
디스크 + 전용 업로드 스크립트로 이 데이터를 받는다(§4) — **커밋이
줄 수 있는 유일한 이득은 "감사 흔적을 git 이력에 남기는 것"뿐이고,
그 이득은 이미 이 세션에서 만든 여러 `docs/reports/*.md`(이들은
git으로 추적되는 디렉터리)로 충분히, 오히려 더 상세하게 확보돼
있다.**

**추가로, 별도의 향후 STEP에서 Option C(`git rm --cached
work/monthly/2026-07.json` + 명확한 커밋 메시지)를 통해 저장소를
`.gitignore`가 선언한 정책과 완전히 일치시키는 것을 권장한다** —
단, 이는 이번 READ-ONLY STEP의 범위 밖이며 별도의 명시적 승인이
필요하다.

## 8. Important — Clean Archive Untouched

이번 조사 전체 동안 `work/monthly/2026-07.json`을 전혀 읽기 외의
방식으로 건드리지 않았다 — 확인:

```
git status --short work/monthly/2026-07.json →  M work/monthly/2026-07.json (직전 STEP 종료 시점과 동일)
```

---

====================
MONTHLY ARCHIVE GIT POLICY
====================

TRACKED MONTHLY FILES:
work/monthly/2026-07.json (단 하나)

IGNORED MONTHLY PATTERN:
work/ (.gitignore 9번째 줄, "Local runtime cache and private business data") — 2026-01/02/03/04/05/06/08 전부 이 규칙으로 무시됨

2026-07 TRACKING ORIGIN:
4322b67 "data: backfill July offline sales archive" (2026-07-17 01:55:32)

ORIGINAL PURPOSE:
B(임시 backfill fixture) — scripts/backfill-monthly-offline-sales.mjs(같은 새벽, 7분 전 커밋)를 막 만들고 실행한 결과물을 예시로 함께 커밋한 것으로 판단됨. 그 스크립트는 저장소 어디서도 다시 참조되지 않는 고아 CLI. 영구 canonical 스냅샷 정책 선언은 어디에도 없음.

RUNTIME DATA TYPE:
CACHE (재생성 가능한 materialization — 원본은 work/ecount-sales/*.json(진짜 시드) + Cafe24)

REGENERATABLE:
YES (buildMonthlyArchive(month), work/monthly/*.json을 입력으로 쓰지 않음)

PRODUCTION REQUIRES COMMITTED JULY:
NO

DEPLOYMENT STORAGE:
Render 영구 디스크(render.yaml: disk mountPath=/var/data, sizeGB=1) + WORK_DIR=/var/data/samplas-dashboard/work — git 체크아웃과 완전히 분리됨. 전용 업로드 경로: scripts/upload-work-snapshots-to-render.mjs → POST /api/work-data/upload

OTHER MONTHS TRACKED:
NO

TRACKING JULY ONLY CONSISTENT:
NO (`.gitignore`가 스스로 선언한 정책과 배치되는 일회성 예외)

OPTION A — COMMIT:
비권장 — 배포 이득 없음(§4), .gitignore 선언 정책과 정면 배치, 향후 "매달 커밋해야 하나"라는 오해 유발 위험

OPTION B — DO NOT COMMIT:
권장 — .gitignore 정책과 완전히 일치, 배포 무관, 추가 리스크 없음. git status가 이 파일에 대해 계속 modified로 보이는 것은 기능적 문제 아님.

OPTION C — UNTRACK FUTURE:
차선 권장(별도 STEP) — 가장 근본적인 정리, 단 이번 STEP의 금지 목록(git rm 등)에 포함돼 지금 실행 불가

OPTION D — SPECIAL SEED:
비권장 — "시드"라는 표현이 맞지 않음(진짜 시드는 work/ecount-sales/*.json), commerce.brandSales는 파생 계산 결과일 뿐

RECOMMENDATION:
DO NOT COMMIT JULY ARCHIVE (추가로, 별도 승인 STEP에서 Option C 정책 정리를 권장)

CLEAN JULY FILE MODIFIED:
NO

STAGED:
NO

COMMIT:
NONE

PUSH:
NONE

REPORT:
docs/reports/NEXT-MONTHLY-ARCHIVE-GIT-POLICY.md
====================
