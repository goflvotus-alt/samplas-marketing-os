# SAMPLAS-OPERATING-BASELINE.md — Local ↔ Render 운영 기준 문서

이 문서는 "SAMPLAS Marketing OS"의 **운영 baseline**을 기록하는 living
document다. `docs/PROJECT_MEMORY.md`가 코드/데이터의 Source of Truth와
아키텍처 규칙(프로젝트 헌법)을 다루고, `docs/DECISIONS.md`가 "왜 그렇게
결정했는가"를 다루는 반면, 이 문서는 **Local 개발 환경과 Render 프로덕션
환경 사이의 운영 역할, 배포 흐름, 안전 규칙**을 다룬다. 최초 작성:
Batch 5(`docs/reports/local-to-render-batch5-local-dev-hygiene-2026-08-26.md`).
이후 운영 방식이 바뀌면 이 문서를 갱신한다(일회성 report가 아님).

---

## 1. Production

```
URL:  https://samplas-marketing-os.onrender.com/
역할: primary operational baseline — 실제 매장/운영진이 참조하는 production
```
- 코드: `render.yaml` 기준 `buildCommand: npm install`, `startCommand: npm start`.
- 영구 데이터: `disk.mountPath: /var/data`, `WORK_DIR=/var/data/samplas-dashboard/work`.
- Health check: `GET /api/status` → `render.yaml.healthCheckPath`와 일치.

## 2. Development (Local)

```
URL:  http://127.0.0.1:8787
역할: diagnosis / implementation / validation — Render에 반영되기 전 모든
     변경은 여기서 먼저 검증한다.
```
- 시작: `npm start`(=`node server.mjs`), 별도 launcher 스크립트 없음(2026-08-26
  기준 저장소 전수 검색 결과 `launcher_v2` 등 존재하지 않음).
- Port: `8787`(`server.mjs`의 `env.PORT || 8787`).
- Intelligence 라우트는 같은 프로세스가 `intelligence-service.mjs`의 핸들러를
  위임받아 처리(별도 `npm run start:intelligence`는 독립 실행 시에만 사용).

## 3. Git

```
main branch = 배포 기준. origin/main에 push되면 Render가 코드를 자동
재배포한다(Render 쪽 별도 트리거 불필요).
```
- **주의**: 이건 **코드에만** 해당한다. §5(Snapshot Deployment) 참조 —
  데이터 파일은 git push만으로 Render에 반영되지 않는 경우가 있다.
- 작업 규칙: `git add -A`/`git add .` 금지, 항상 명시적 경로 staging.
  Unrelated tracked modified 파일은 절대 같이 커밋하지 않는다.

## 4. Data Authority Matrix

| Domain | Primary Authority | Local Role | Render Role |
|---|---|---|---|
| Today / Monthly(당월) | Render | Test/compare | Production |
| Historical Monthly/Annual | Render production archive | Local regeneration/validation(`buildMonthlyArchive()`) | Canonical operational |
| Clients / Store Intelligence | Render | Validation | Production |
| Inventory | Render latest uploaded snapshot | Sync(`sync-ecount-inventory.mjs`)/validation | Production |
| Brand Registry(derived) | canonical `brand-master.json` + rebuilt derived, uploaded | Build(`buildIntelligenceBrandRegistry()`)/validate | Production derived snapshot |
| Price Audit(summary) | Render verified snapshot(업로드됨) | 생성(`build-price-audit.mjs`)/validate | Production |
| **Product Registry(entry-level)** | **Local git HEAD — 2026-08-26 기준 Render 전달 경로 없음(미해결, 아래 참조)** | 편집/커밋 | stale 가능성 있음, 검증 필요 |
| Source Code | Git `main` | Development | Deploy from main(자동) |
| Development Reports | Git `docs/reports/` | Authoring | n/a |

## 5. Snapshot Deployment — Code Deploy와 Data Sync는 별개다

**핵심 원칙**: `git push`는 **코드만** 즉시 배포한다. `work/` 아래 운영
데이터는 두 가지 서로 다른 경로 중 하나로만 Render에 도달하며, 둘 다 밟지
않으면 Render는 stale한 채로 남는다.

### 경로 A — Git-tracked (force-add)
`work/product-registry.json`, `work/store-master.json` 등 16개 파일은
`.gitignore`의 `work/` 규칙에도 불구하고 git에 force-add되어 있다. 이
경로로 커밋+푸시하면 **저장소에는** 반영되지만, Render 런타임은
`WORK_DIR=/var/data/samplas-dashboard/work`(git 체크아웃과 완전히 분리된
영구 디스크)를 읽으므로 **git push만으로는 Render 실행 데이터가 갱신되지
않는다.**

### 경로 B — Upload API
`POST /api/work-data/upload`(server.mjs `workDataUploadPaths` allowlist +
`monthlyWorkDataPathPattern` 정규식)로 명시적으로 업로드해야만 영구
디스크에 실제로 반영된다. 클라이언트: `node
scripts/upload-work-snapshots-to-render.mjs [--dry-run|--overwrite]
<relativePath...>`.

현재 upload allowlist(Batch 6, 2026-08-26 갱신):
```
brand-master.json, price-audit.json, today-product-sync-issues.json,
store-master.json, product-registry.json, intelligence/brand-master-list.json,
intelligence/brand-aliases.json, ecount-inventory/latest.json,
ecount-inventory/diagnostic.json,
그리고 정규식으로: ecount-sales/{YYYY-MM}[.STORE].json, monthly/{YYYY-MM}.json
```

### 알려진 gap(Batch 5에서 발견 → Batch 6에서 해소, 아래 기록은 원문 보존)
`work/product-registry.json`은 경로 A(git-tracked)에만 해당하고 경로
B(upload allowlist)에는 없다 — SAFE10/18/20 등 사람 검토 결과가 git에는
누적됐지만 Render에는 한 번도 업로드된 적이 없어(2026-08-26 실측 확인,
`docs/reports/local-to-render-batch5-local-dev-hygiene-2026-08-26.md` §K),
Render의 Product Registry 개별 항목이 stale하다. Today/Monthly 매출
총계에는 영향 없음(Identity Resolution과 Revenue Calculation은 항상
분리— `docs/DECISIONS.md` Decision-001). 해결 전까지: **product-registry.json
을 새로 편집한 뒤 "Render에도 반영됐다"고 가정하지 말 것** — 반영하려면
allowlist 추가 + 명시적 upload가 필요하다(아직 실행되지 않음, 별도
승인/작업 필요).

**해소(Batch 6, 2026-08-26)**: `server.mjs`의 `workDataUploadPaths`와
`scripts/upload-work-snapshots-to-render.mjs`의 `explicitPaths`에
`product-registry.json`을 각각 1줄씩 추가(commit `bc65017`), Render 배포
확인 후 SAFE10/18/20/24(총 72건) + 기타 deterministic-match 확인분(66건,
총 138건 차이)을 포함한 Local 레지스트리를 Render에 명시적으로 업로드.
업로드 후 Local↔Render 레지스트리 JSON이 완전히 동일함을 확인
(`docs/reports/render-product-registry-alignment-2026-08-26.md`). **이
gap은 재발 가능**하다 — 아래 "Product Registry 업데이트 규칙"을 반드시
따를 것.

### Product Registry 업데이트 규칙(Batch 6 이후 표준)
`work/product-registry.json`을 수정하는 모든 작업(SAFE-N 배치 승인,
Product Registry Review 반영 등)은 다음 4단계를 모두 거쳐야 "Render에도
반영됐다"고 말할 수 있다:
1. Local validation — 수정 후 Local API(`/api/intelligence/product-registry`,
   `/api/intelligence/price-audit`)로 먼저 검증.
2. Git commit — `work/product-registry.json`은 git-tracked이므로 커밋(해당
   시).
3. **명시적 Render snapshot upload** — `node
   scripts/upload-work-snapshots-to-render.mjs --overwrite
   product-registry.json`. **git commit만으로는 충분하지 않다**(§5 핵심
   원칙과 동일한 이유 — Render는 git 체크아웃이 아니라 영구 디스크를
   읽는다).
4. Production API verification — 업로드 후 Local↔Render를 다시 비교해서
   실제로 동일해졌는지 확인.

## 6. Reports — 보존 정책

`docs/reports/`는 SAMPLAS development history의 정식 저장소다:
- generated junk 아님, cleanup 대상 아님.
- major task(diagnosis/fix/migration/deploy)의 Definition of Done 일부 —
  chat 요약만으로 끝나지 않는다.
- **기존 report는 삭제/병합/덮어쓰기 금지.** 결론이 바뀌면 새 report를
  쓰거나, 기존 report에 "Follow-up" 섹션을 추가한다(원문은 그대로 둔다) —
  Batch 4/4.5/4.6에서 실제로 적용한 패턴.
- `work/reports/`(STEP67-era, 47개, gitignored)는 더 오래된 시기의 산출물
  — 자동 삭제 금지, `docs/reports/`와의 중복 여부는 별도 검토 대상.

## 7. Definition of Done

Major task는 다음이 모두 끝나야 DONE이다:
```
Diagnosis → Implementation → Tests → Commit/Deploy → Production Validation → Report
```
"Deploy"는 코드와 데이터에서 의미가 다르다(§5) — 코드는 push로 끝나지만,
데이터는 push 이후 별도의 upload 단계와 Local↔Render 비교 검증까지 마쳐야
"Production Validation"이 끝난 것으로 본다.

## 8. Safety Rules

- **Unrelated worktree 보존**: 현재 작업과 무관한 tracked modified 파일은
  절대 같이 stage/commit하지 않는다. 매 batch 시작 전 `git status`로
  베이스라인을 기록하고, 끝날 때 그 파일들이 그대로인지 재확인한다.
- **No bulk add**: `git add -A`/`git add .` 금지, 항상 명시적 경로.
- **No cleanup without classification**: untracked 파일을 지우기 전
  반드시 분류(CATEGORY A~F, `docs/reports/local-to-render-batch5-*`
  참조)하고, 삭제 후보는 사용자 승인 전까지 목록화만 한다.
- **Production verification required**: Render에 영향을 주는 모든 배치는
  Local↔Render 비교(같은 순간 조회)로 마무리한다 — 추정하지 않는다.
- **Render mutation은 명시적 승인 필요**: snapshot upload/historical
  overwrite/deploy/restart/source 변경은 사용자가 명시적으로 승인한
  batch에서만 수행한다.

---

*최초 작성: Batch 5(2026-08-26). 이 문서가 실제 코드/설정과 어긋나면 코드가
최신 사실이다 — 특히 §4/§5의 allowlist·경로는 `server.mjs`의
`workDataUploadPaths`/`monthlyWorkDataPathPattern`을 직접 확인해서
재검증할 것.*
