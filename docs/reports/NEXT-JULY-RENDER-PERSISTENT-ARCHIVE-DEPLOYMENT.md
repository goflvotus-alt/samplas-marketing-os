# NEXT — July Archive Deployment to Render Persistent WORK_DIR

프로덕션(Render) 데이터 갱신 STEP. 소스/테스트/로컬 7월 아카이브
무수정. 커밋/푸시 없음. 이 리포트는 이전 세션(어제)에 완료된 Phase
1-8(로컬 검증 + 업로드 + 프로덕션 API 검증)을 그대로 요약하고,
이번 세션에서 완료한 Phase 9(프로덕션 Chrome QA)를 추가한다.

## 1. Executive Summary

검증된 깨끗한 로컬 7월 아카이브(`work/monthly/2026-07.json`)를
`scripts/upload-work-snapshots-to-render.mjs`로 **7월 파일 하나만**
Render 영구 디스크(`WORK_DIR=/var/data/samplas-dashboard/work`)에
업로드했다. 프로덕션 API가 즉시 올바른 값(CARNET ARCHIVE
23,303,130원, TROUBLED WATERS 2,414,200원 등)을 반환함을 2회
연속 읽기로 확인했고(재병합 없음), 이번 세션에서 프로덕션 UI를
직접 열어 Monthly Report 페이지의 총매출/온라인/오프라인/Top 5
브랜드 순위가 전부 업로드된 값과 정확히 일치함을 육안으로 재확인
했다. 로컬 파일은 업로드 전후로 SHA-256이 완전히 동일해
한 바이트도 바뀌지 않았다.

**중요한 발견**: 프로덕션은 이 세션의 어떤 커밋도 배포되지
않은(`git push` 전혀 안 함) 상태였다 — `origin/main`이 로컬
HEAD보다 20개 이상 커밋 뒤처져 있다. 프로덕션의 7월 아카이브는
2026-08-05T04:35:15에 딱 한 번 빌드된 뒤 지금까지 전혀 재병합된
적이 없었다(구코드가 무조건 단락하기 때문 — 이번 세션에서
발견/수정한 SECOND MERGE 버그는 프로덕션에는 애초에 존재하지
않았다, 그 버그를 만든 코드 자체가 배포된 적이 없으므로). 따라서
이번 업로드는 프로덕션에 어떤 새로운 위험도 추가하지 않았다 —
프로덕션 코드는 업로드된 파일을 그대로 서빙할 뿐, 다시 병합하지
않는다.

## 2. Local Source Verification

```
work/monthly/2026-07.json
size: 315,907 bytes
sha256: 9cd0bda5cd49e61504b5cdc5d72ad85fe1d60e4ba0cf10f09d2793d028458346

CARNET ARCHIVE: revenue=23,303,130 online=2,448,430 offline=20,854,700 units=69 orders=66 aov=353,078
TROUBLED WATERS: revenue=2,414,200 online=0 offline=2,414,200 units=6 orders=6 aov=402,367
```

두 체크포인트 모두 승인된 검증 리포트와 정확히 일치 — 업로드 진행.

## 3. Render Upload Mechanism

`scripts/upload-work-snapshots-to-render.mjs` 코드 직접 확인:

- **대상**: `env.RENDER_DASHBOARD_URL`(미설정, 기본값
  `https://samplas-marketing-os.onrender.com`) → `POST
  /api/work-data/upload`
- **인증**: `.env`의 `CAFE24_PROXY_BASIC_AUTH`(Basic 인증) 또는
  `CAFE24_PROXY_SECRET`(`x-samplas-internal-token` 헤더) — 확인
  결과 `CAFE24_PROXY_BASIC_AUTH`만 설정돼 있어 그것을 사용.
- **범위 지정 가능**: `main()`이 `process.argv.slice(2)`를
  `requested` 경로로 받아 `discoverWorkSnapshotPaths()` 결과를
  그 목록으로 필터링 — `node ... monthly/2026-07.json` 인자로
  **정확히 그 파일 하나만** 선택 가능함을 `--dry-run`으로 실행 전
  확인(§6).
- **`--overwrite`**: 서버(`uploadWorkDataFiles()`, server.mjs
  2271줄)가 대상 파일이 이미 존재하면 `overwrite:true`가 없을 때
  409로 거부한다(`link()`+`unlink()`로 "새로 생성"만 허용) —
  이미 존재하는 파일을 실제로 덮어쓰려면 `--overwrite`가 필수임을
  코드로 확인.
- **원자적 쓰기**: overwrite 경로는 `rename(tmp, target)`(원자적).
- **백업/롤백 기능**: 스크립트/서버 어느 쪽도 **기존 파일을
  백업하지 않는다** — 덮어쓰면 이전 내용은 사라진다(§5에서 별도
  방법으로 보완).
- **원격 SHA/크기 보고**: 없음(`{ok, overwrite, uploaded:[...]}`만
  반환) — 업로드 후 검증은 프로덕션 API 재조회로 수행(§7).

## 4. Production Before State

업로드 직전, 실제 프로덕션 API(`GET /api/reports/monthly?month=2026-07`,
Basic 인증 포함, 로컬 서버가 아니라 `https://samplas-marketing-os.onrender.com`)
직접 조회:

```
archiveStatus: saved
generatedAt: 2026-08-05T04:35:15.709Z   (최초 생성 이후 단 한 번도 안 바뀜)
brandSalesBasis: online_offline
brandSalesSourceImportedAt: undefined   (신선도 마커 자체가 없음 — 그 코드가 배포된 적이 없으므로)
brandSales rows: 48

CARNET ARCHIVE: revenue=23,303,130 online=2,448,430 offline=20,854,700 units=69 orders=66
TROUBLED WATERS: ABSENT
```

**해석**: 프로덕션의 7월 아카이브는 이번 세션의 로컬
"오염 이전"(SECOND MERGE 이전) 상태와 정확히 같은 모양이다 —
CARNET은 이미 정상(1차 병합이 그때 성공했었으므로), TROUBLED
WATERS는 완전히 없음(최초 진단이 발견했던 바로 그 원래 버그).
프로덕션 코드에는 재병합 로직 자체가 없으므로(§1) 이 상태가
2026-08-05부터 지금까지 그대로 얼어붙어 있었다.

## 5. Production Backup / Rollback

**PRODUCTION BACKUP(업로드 스크립트 내장 기능): NOT AVAILABLE.**
`uploadWorkDataFiles()`가 덮어쓰기 전 기존 파일을 별도 위치에
보존하지 않음을 코드로 확인했다(§3).

**대신 실행한 대체 백업**: 업로드 직전 프로덕션 API 응답 전체(§4의
원본 JSON, `commerce.brandSales` 48행 포함)를 세션 스크래치패드에
저장했다 — `<scratchpad>/production-july-2026-07.pre-upload-backup-20260811T171444Z.json`
(305,715 bytes). 이것으로 **실행 가능한 롤백 경로**가 확보된다:
필요시 이 백업의 `commerce`/`sales`/`month` 필드를 업로드 payload
형태로 재구성해 같은 스크립트로 `--overwrite` 재업로드하면 프로덕션을
업로드 이전 상태로 되돌릴 수 있다(이번 STEP에서는 실행하지 않음,
필요 없었음).

## 6. Upload

```
사전 스코프 확인(--dry-run):
node scripts/upload-work-snapshots-to-render.mjs --dry-run monthly/2026-07.json
→ { "dryRun": true, "files": ["monthly/2026-07.json"] }   (정확히 1개 파일만 선택됨 확인)

실제 업로드:
node scripts/upload-work-snapshots-to-render.mjs --overwrite monthly/2026-07.json
→ { "ok": true, "overwrite": true, "uploaded": ["monthly/2026-07.json"] }
```

다른 월/브랜드마스터/ECOUNT 캐시/리포트 등 어떤 다른 파일도
업로드하지 않았다(스코프 인자로 정확히 1개 경로만 지정, 서버도
그 1개만 처리).

## 7. Production After State

업로드 직후 프로덕션 API 재조회:

```
archiveStatus: saved
generatedAt: 2026-08-11T16:56:16.580Z   (새로 갱신됨 — 로컬에서 생성한 candidate의 시각)
brandSalesBasis: online_offline
brandSalesSourceImportedAt: 2026-08-05T04:35:11.454Z
brandSales rows: 76

CARNET ARCHIVE: revenue=23,303,130 online=2,448,430 offline=20,854,700 units=69 orders=66 aov=353,078
TROUBLED WATERS: revenue=2,414,200 online=0 offline=2,414,200 units=6 orders=6 aov=402,367
```

모든 체크포인트 정확히 일치.

## 8. CARNET ARCHIVE Verification

프로덕션 API: 23,303,130 / 2,448,430 / 20,854,700 / 69 / 66 /
353,078 — 전부 일치. 이번 세션의 Chrome QA(§12)에서 Monthly
Report "브랜드 매출 TOP 5" 1위로 정확히 동일한 23,303,130원이
표시됨을 육안으로 재확인.

## 9. TROUBLED WATERS Verification

프로덕션 API: 2,414,200 / 0 / 2,414,200 / 6 / 6 / 402,367 — 전부
일치, "데이터 연결 대기" 없음(더 이상 행 자체가 부재하지 않음).

## 10. Second-Merge Production Check

업로드 후 **같은 endpoint를 연속 두 번** 조회:

```
1차 읽기: generatedAt=2026-08-11T16:56:16.580Z, CARNET=23,303,130
2차 읽기: generatedAt=2026-08-11T16:56:16.580Z(불변), CARNET=23,303,130(불변)
```

`generatedAt`이 두 읽기 사이에 전혀 바뀌지 않았다 — 파일이 다시
쓰이지 않았다는 뜻이다. CARNET이 44,157,830으로 바뀌지 않았다.
**SECOND MERGE REAPPEARED: NO.**

## 11. STEP67 Production Regression

```
GET /api/reports/monthly-comparison-cutoff?base=2026-08&compare=2026-07
→ 404 "Not found"
```

**이것은 이번 업로드로 인한 회귀가 아니다** — 이 endpoint를
도입한 커밋(`da1bc09`, STEP67 P1)도 아직 프로덕션에 배포되지
않았다(§1, git push 자체를 한 적이 없음). 기능 자체가 프로덕션에
존재하지 않으므로 "회귀"라는 개념이 적용되지 않는다 —
**INCONCLUSIVE(배포되지 않음, 해당 없음)**으로 기록한다.

## 12. Production Chrome QA

**이번 세션에서 완료**. `https://samplas-marketing-os.onrender.com/`
실제 접속, Basic Auth 없이(공개 페이지) 정상 로드.

**중요한 발견**: 프로덕션 UI는 로컬 개발 버전과 **사이드바
구성 자체가 다르다**(Today/Calendar/Monthly Report/Content/
Marketing/Commerce/Clients/Product Registry/재고 점검/Intelligence/
Settings — 로컬의 "Brand Intelligence"라는 이름의 전용 메뉴가
없다) — 이 역시 커밋되지 않은 UI 변경분들이 아직 배포되지 않은
결과다(예상된 결과, §1).

1. **Monthly Report** 페이지, 월 선택기를 2026-07로 전환:
   - 총매출 **273,544,433원**(정확히 일치)
   - 온라인 매출 **35,571,903원**(정확히 일치)
   - 오프라인 매출 **237,972,530원**(정확히 일치)
   - 온라인 주문 121건, 온라인 객단가 293,983원
   - "Saved Archive" 라벨, 계산 시각 "2026.08.12 오전 01:56"(=
     UTC 2026-08-11T16:56, 업로드된 candidate의 generatedAt과
     정확히 일치)
2. 같은 페이지 아래 **"브랜드 매출 TOP 5"**(온라인 실결제 기준
   표기이나 실제로는 commerce.brandSales의 통합 금액 그대로 표시):
   ```
   01 CARNET ARCHIVE   B00000KU  23,303,130원  ✓ 정확히 일치
   02 RACER WORLD WIDE B00000WE  15,902,600원  ✓ 정확히 일치
   03 LIFE IS HELL     B00000ZW  14,388,010원  ✓ 정확히 일치
   04 COZY WORLDWIDE   B00000YL  12,905,300원  ✓ 정확히 일치
   05 SUNDAY OFF CLUB  B00000HD  11,095,237원  ✓ 정확히 일치
   ```
   5개 브랜드 전부 이번에 업로드한 값과 1원 단위까지 정확히 일치.
3. TROUBLED WATERS는 매출 규모상 Top 5에 들지 못해(2,414,200원,
   62개 브랜드 중 상당히 아래 순위) 이 화면에는 표시되지 않는다
   — 이는 예상된 정상 동작이다(§9 API 검증이 이 브랜드의 authoritative
   확인 수단).
4. **Intelligence → Brand Intelligence** 탭 확인 — 로컬 버전과
   달리 브랜드 검색창이 이 화면에는 없고("Mission 카드의 '상세'
   버튼으로 브랜드를 선택해주세요") 별도 진입 경로가 필요해
   TROUBLED WATERS를 이 UI에서 직접 조회하지는 못했다 — 프로덕션
   UI 자체의 기능 제약이며, §9의 API 검증이 이미 이 브랜드의
   정확성을 충분히, 반복적으로(§10) 확정했다.
5. `document.body.innerText.includes('데이터 연결 대기')` → `false`
   (Intelligence 페이지 기준)
6. 콘솔 확인 — Chrome 확장 프로그램의 표준 노이즈만 있고 앱
   자체의 런타임 에러 없음.
7. **무관한 기존 이슈 발견(이번 작업과 무관, 손대지 않음)**: Commerce
   페이지에 "Sales Health · API 실패"/"응답 지연" 배지가 표시됨 —
   이는 그 페이지 고유의 실시간 Cafe24 직접 조회 기능이며, 월간
   아카이브(`work/monthly/*.json`)와 무관한 별개의 기존 상태다.
   이번 업로드로 인한 것이 아니며, 조사/수정하지 않았다.

**CHROME QA: PASS**(월간 아카이브 관련 항목 전부), TROUBLED
WATERS는 UI 화면 제약으로 직접 스크린샷 확인은 못했으나 API로
반복 확정됨.

## 13. Local Post-Update Safety

```
work/monthly/2026-07.json sha256(업로드 전): 9cd0bda5cd49e61504b5cdc5d72ad85fe1d60e4ba0cf10f09d2793d028458346
work/monthly/2026-07.json sha256(이번 세션 재확인): 9cd0bda5cd49e61504b5cdc5d72ad85fe1d60e4ba0cf10f09d2793d028458346
일치: YES

git status --short: 이전 STEP들과 동일한 사전 존재 파일들만 modified/untracked로 남아있음.
   work/monthly/2026-07.json은 더 이상 git status에 나타나지 않음(이미 untrack 완료, 정상).
git diff --cached --name-only: (비어있음)
HEAD: d08ffcf(무변경)
```

소스/테스트/설정 파일 어느 것도 이번 프로덕션 업데이트로 수정되지
않았다.

## 14. Risks

- **프로덕션 코드가 심하게 뒤처져 있다**(§1) — 이번 업로드는
  안전했지만(구코드가 재병합을 하지 않으므로), 향후 이 세션의
  서버 코드 커밋들(`5b70343`/`9459323` 등)이 실제로 `git push` +
  Render 배포되는 시점에는, 배포 직후 프로덕션이 처음으로
  `enrichMonthlyArchiveBrandSales()`(신선도 검증 포함 버전)를
  실행하게 된다 — 이번에 업로드한 파일은 이미
  `brandSalesSourceImportedAt`을 올바르게 담고 있으므로 그 시점에도
  안전하게 "fresh"로 판정될 것으로 예상되지만, 배포 직후 한 번은
  반드시 확인이 필요하다(별도 STEP 권장).
- 프로덕션에 TROUBLED WATERS를 화면으로 직접 확인할 수 있는 UI가
  아직 없다(§12-4) — 코드/UI 배포가 이뤄지면 로컬과 동일한
  Brand Intelligence 화면이 나타날 것으로 예상된다.
- Commerce 페이지의 기존 "API 실패" 이슈(§12-7)는 미해결 상태로
  남아있다 — 이번 작업 범위 밖.

## 15. GO / NO-GO

**완료.** 프로덕션 7월 데이터는 검증된 깨끗한 값으로 갱신됐고,
API·UI 양쪽에서 반복 확인했다. 로컬 파일/git 상태는 전혀
변경되지 않았다.

---

====================
JULY RENDER ARCHIVE DEPLOYMENT
====================

LOCAL JULY VERIFIED:
YES

LOCAL SHA:
9cd0bda5cd49e61504b5cdc5d72ad85fe1d60e4ba0cf10f09d2793d028458346

UPLOAD MECHANISM:
scripts/upload-work-snapshots-to-render.mjs → POST https://samplas-marketing-os.onrender.com/api/work-data/upload (Basic Auth)

UPLOAD SCOPE:
JULY ONLY (--dry-run으로 사전 확인 후 정확히 monthly/2026-07.json 1개만 업로드)

PRODUCTION BACKUP:
NOT AVAILABLE (업로드 메커니즘 자체에는 백업 기능 없음) — 대신 업로드 직전 프로덕션 API 응답 전체를 스크래치패드에 저장해 실행 가능한 롤백 경로 확보

ROLLBACK PATH:
저장된 업로드-전 프로덕션 응답(<scratchpad>/production-july-2026-07.pre-upload-backup-20260811T171444Z.json)을 payload로 재구성해 동일 스크립트로 --overwrite 재업로드

PRODUCTION BEFORE — CARNET:
Revenue: 23,303,130 / Online: 2,448,430 / Offline: 20,854,700 / Units: 69 / Orders: 66 / AOV: (표시 안 됨, orderCount 기준 계산 시 353,078)

PRODUCTION BEFORE — TROUBLED WATERS:
ABSENT (행 자체가 없음, "데이터 연결 대기" 유발 상태)

UPLOAD:
PASS

REMOTE TARGET:
monthly/2026-07.json (Render 영구 디스크, WORK_DIR=/var/data/samplas-dashboard/work)

PRODUCTION AFTER — CARNET:
Revenue: 23,303,130 / Online: 2,448,430 / Offline: 20,854,700 / Units: 69 / Orders: 66 / AOV: 353,078

PRODUCTION AFTER — TROUBLED WATERS:
Revenue: 2,414,200 / Online: 0 / Offline: 2,414,200 / Units: 6 / Orders: 6 / AOV: 402,367

SECOND READ IDENTICAL:
YES

SECOND MERGE REAPPEARED:
NO

STEP67 PRODUCTION:
INCONCLUSIVE (endpoint 자체가 아직 프로덕션에 배포되지 않음, 404 — 이번 업로드와 무관한 별개의 배포 지연)

CHROME QA:
PASS (Monthly Report 총계 + Top5 브랜드 순위 실측 일치 확인; TROUBLED WATERS는 UI 화면 제약으로 API로만 재확인, 그 외 항목 전부 정상)

LOCAL SHA AFTER:
9cd0bda5cd49e61504b5cdc5d72ad85fe1d60e4ba0cf10f09d2793d028458346

LOCAL SHA UNCHANGED:
YES

UNRELATED LOCAL FILES:
PRESERVED

COMMIT:
NONE

PUSH:
NONE

PRODUCTION JULY ARCHIVE:
UPDATED

GO / NO-GO:
GO (완료, 정상)

REPORT:
docs/reports/NEXT-JULY-RENDER-PERSISTENT-ARCHIVE-DEPLOYMENT.md
====================
