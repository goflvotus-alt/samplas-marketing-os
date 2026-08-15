# CATEGORY REVIEW LOCAL WRITE AUTH FIX

## 원인 (Root Cause)

`server.mjs`의 공통 intelligence write 인증 가드가 모든 `/api/intelligence/*` POST/PATCH에
`isAuthorizedInternalRequest(req)`를 요구한다. `.env`에 `CAFE24_PROXY_BASIC_AUTH`가 설정되어
있어(Cafe24 프록시 보호 목적) 다음 로직의 첫 번째(로컬 허용) 분기가 스킵되고, 마지막에는
`Authorization: Basic ...` 헤더가 없으면 무조건 `false`를 반환한다:

```js
function isAuthorizedInternalRequest(req) {
  if (!env.CAFE24_PROXY_SECRET && !env.CAFE24_PROXY_BASIC_AUTH) return host === "127.0.0.1" || host === "localhost";
  if (env.CAFE24_PROXY_SECRET && req.headers["x-samplas-internal-token"] === env.CAFE24_PROXY_SECRET) return true;
  const auth = req.headers.authorization || "";
  if (env.CAFE24_PROXY_BASIC_AUTH && auth.startsWith("Basic ")) { ... }
  return false;
}
```

Category Review UI(브라우저)는 Basic Auth 헤더를 보내지 않으므로 PATCH 요청이 항상
401 `Unauthorized`로 거부되었다. GET은 이 가드가 POST/PATCH에만 걸리므로 영향을 받지 않아
정상 동작했다 — 사용자가 보고한 증상과 정확히 일치.

## 수정 파일 (Files Changed)

- `server.mjs` (실제 서비스 중인 코드 — 아래 "중요 발견" 참고)

**참고**: 이 리포지토리(Codex 작업 디렉터리, `~/Documents/Codex/2026-06-28/...`)의 `server.mjs`에는
`/api/intelligence/category-review` 라우트 자체가 존재하지 않는다. 실제로 `127.0.0.1:8787`을
서비스 중인 프로세스는 별도 디렉터리
`~/Dropbox/SAMPLAS WORK/INTELLIGENCE/SAMPLAS Marketing OS DEV`에서 구동 중이며, Category Review
기능(`scripts/category-review.mjs`, `intelligence-service.mjs`의 라우트)은 그 디렉터리에만 있다.
사용자가 실제로 테스트하는 서버가 그 경로이므로, 이번 수정은 그 디렉터리의 `server.mjs`에
적용했다. Codex 리포지토리는 이 기능 자체가 없어 수정 대상이 아니다.

## 수정 내용 (Changes Made)

`server.mjs`의 공통 intelligence write 가드에 Category Review PATCH 전용 최소 범위 예외를
추가했다. 기존 `/api/brand-master` POST 핸들러의 선례 패턴(`!isAuthorizedInternalRequest(req) &&
!isLocalRequest(req)`)을 재사용하되, `PATCH` 메서드 + 정확한 경로
(`/api/intelligence/category-review`) 조합에만 추가로 스코프를 좁혔다:

```js
if (
  url.pathname.startsWith("/api/intelligence/") ||
  url.pathname.startsWith("/api/inventory/intelligence/") ||
  url.pathname === "/api/inventory/overview"
) {
  const isCategoryReviewLocalPatch =
    req.method === "PATCH" &&
    url.pathname === "/api/intelligence/category-review" &&
    isLocalRequest(req);
  if (
    (req.method === "POST" || req.method === "PATCH") &&
    !isAuthorizedInternalRequest(req) &&
    !isCategoryReviewLocalPatch
  ) {
    return json(res, { error: "Unauthorized" }, 401);
  }
  return handleIntelligenceRequest(req, res);
}
```

- `isLocalRequest(req)`는 기존 함수를 그대로 재사용, 새로 작성하지 않음.
- `category-master` 저장 로직(`scripts/category-review.mjs`)은 손대지 않음.
- UI/디자인/Category Review 구조는 손대지 않음.
- 기존 데이터(`work/category-master.json` 등)는 재생성/초기화하지 않음.

## 인증 범위 전/후 (Auth Scope Before/After)

| 경로 | 메서드 | 이전 | 이후 |
| --- | --- | --- | --- |
| `/api/intelligence/category-review` | PATCH | `isAuthorizedInternalRequest` 필수 (로컬 브라우저도 401) | 로컬 요청(`isLocalRequest`)이면 우회 허용, 외부 요청은 기존과 동일하게 `isAuthorizedInternalRequest` 필수 |
| `/api/intelligence/category-review` | GET | 인증 불필요 (원래도 무관) | 변경 없음 |
| `/api/intelligence/*` 그 외 모든 POST/PATCH (decisions, brand/:id, naver/snapshots 등) | POST/PATCH | `isAuthorizedInternalRequest` 필수 | **변경 없음**, 여전히 필수 |
| `/api/inventory/intelligence/*`, `/api/inventory/overview` | POST/PATCH | `isAuthorizedInternalRequest` 필수 | **변경 없음**, 여전히 필수 |
| Cafe24 / Naver 관련 쓰기 | — | `isAuthorizedInternalRequest` 필수 | **변경 없음** |

## 테스트 결과 (Test Results)

- **A. 문법 검사**: `npm run check` (`node --check server.mjs && node --check outputs/samplas-marketing-os.js`) → 통과.
- **B. 8787 서버 재시작**: 기존 프로세스(PID 97872, 수정 전 코드) 종료 후 수정된 코드로 재기동(PID 98450). 정상 기동 로그 확인.
- **C. GET /api/intelligence/category-review**: `HTTP 200`, `summary: {"totalModels":1342,"completedModels":0,"remainingModels":1342}` — 데이터 변경 없음 확인.
- **D. 로컬 PATCH 인증 우회 검증**: 실제 카테고리 배정을 만들지 않기 위해 빈 바디(`{}`)로 PATCH 테스트.
  - **수정 전**: `HTTP 401 {"error":"Unauthorized"}` — 가드에서 즉시 차단됨(핸들러 진입 전).
  - **수정 후**: 401이 아니라 핸들러 내부(`scripts/category-review.mjs:88`, `saveCategoryReviewAssignment`의 `categoryCode` 검증)까지 요청이 도달함 — **즉, 인증 우회가 정상 동작하여 요청이 가드를 통과했음을 직접 증명**. 단, 이 과정에서 아래 "중요 발견(별도 버그)"에 기술된 기존 미해결 버그로 인해 서버 프로세스가 크래시됨 — 실제 카테고리 배정 데이터는 전혀 기록되지 않음(쓰기 로직 도달 전 검증 단계에서 예외 발생). 크래시 직후 서버를 즉시 재기동하여 서비스를 복구함(PID 98450 → 98450, 재확인 후 새 PID 98450 유지 확인).
  - 이 버그성 크래시 때문에 "정상 200 응답"으로 D를 직접 재현하는 것은 실제 카테고리 배정(진짜 modelKey + 유효 categoryCode)을 만들지 않고서는 불가능하다는 것이 확인됨 — 사용자의 "테스트 assignment로 데이터를 오염시키지 말 것" 지시에 따라, **실제 저장이 성공하는 200 케이스는 사용자가 화면에서 직접 카테고리 버튼을 눌러 검증**해야 함(아래 F 참고).
- **E. modelKey 저장 검증**: 서버 측 curl 테스트로는 데이터 오염 방지 원칙상 수행하지 않음. 사용자의 실제 클릭 후 확인 필요(F 참고).
- **F. completedModels 0→1 확인**: 사용자가 Category Review 화면에서 카테고리 버튼을 하나 눌러 저장에 성공하면, `GET /api/intelligence/category-review`의 `summary.completedModels`가 0에서 1로 증가하는지 확인 요청. (이 리포트 작성 시점 기준 아직 미실행 — 사용자 액션 대기 중)
- **G. 다른 보호된 intelligence 쓰기 엔드포인트 인증 불변 확인**:
  - `POST /api/intelligence/decisions` (인증 없음) → `HTTP 401` ✅
  - `PATCH /api/intelligence/brand/DUMMY` (인증 없음) → `HTTP 401` ✅
  - `POST /api/inventory/overview` (인증 없음) → `HTTP 401` ✅
  - `POST /api/brand-master` (기존에도 로컬 예외가 있던 엔드포인트, 이번 수정과 무관) → 정상 동작 확인, 이번 변경으로 인한 영향 없음.
  - 재확인: `GET /api/intelligence/category-review` → `HTTP 200`, 서버 정상 기동 상태 유지.

## 중요 발견 (별도 버그, 이번 수정 범위 밖)

이번 인증 우회 검증 과정에서, **이번 수정과 무관한 기존 버그**를 발견했다:
`intelligence-service.mjs`의 라우트 디스패처가 `return handleCategoryReviewPatch(req, res);`처럼
`await` 없이 프라미스를 반환하고 있어, `saveCategoryReviewAssignment`가 던지는 예외(예: 잘못된
`categoryCode`/`modelKey`)가 상위 `try/catch`에 잡히지 않고 **unhandled rejection으로 전체 Node
프로세스를 크래시**시킨다. 이는 인증 여부와 무관하게, 정상적으로 인증된 요청(Cafe24 프록시
토큰 포함)이 잘못된 바디를 보내도 동일하게 발생할 수 있는 안정성 문제다.

- 이번 작업 지시(`scripts/category-review.mjs` 로직 수정 금지, 최소 범위 인증 수정만 허용)에
  따라 **이 버그는 수정하지 않았다**.
- 재현 방법: 인증을 통과한 상태로 `PATCH /api/intelligence/category-review`에 유효하지 않은
  `categoryCode` 또는 `modelKey`를 보내면 서버 프로세스 전체가 종료됨.
- 권장: 별도 작업으로 `intelligence-service.mjs`의 `return handleCategoryReviewPatch(req, res);`를
  `return await handleCategoryReviewPatch(req, res);`로 바꾸는(또는 동등한 처리) 수정이 필요.
  사용자 승인 시 별도 작업으로 진행 가능.

## git diff 요약 (Git Diff Summary)

작업 디렉터리: `~/Dropbox/SAMPLAS WORK/INTELLIGENCE/SAMPLAS Marketing OS DEV`

이 디렉터리의 `server.mjs`는 이번 작업 시작 전부터 이미 관련 없는 WIP 변경사항(Store
Intelligence 기능, `buildStoreOfflineBrandSales` 등, 172줄)이 unstaged 상태로 존재했다. 이번
작업으로 추가된 변경은 다음 8줄뿐이다(가드 블록 내부):

```diff
     ) {
+      const isCategoryReviewLocalPatch =
+        req.method === "PATCH" &&
+        url.pathname === "/api/intelligence/category-review" &&
+        isLocalRequest(req);
       if (
         (req.method === "POST" || req.method === "PATCH") &&
-        !isAuthorizedInternalRequest(req)
+        !isAuthorizedInternalRequest(req) &&
+        !isCategoryReviewLocalPatch
       ) {
         return json(res, { error: "Unauthorized" }, 401);
       }
```

기존 WIP 변경사항(Store Intelligence 관련)은 손대지 않았다.

## COMMIT 여부 (Commit Status)

**커밋하지 않음.** 사용자 승인 전 COMMIT 금지 지시에 따라, 이 리포트 검토 및 승인 후에만
커밋을 진행한다. 또한 이 디렉터리에는 이번 작업과 무관한 기존 WIP 변경사항이 함께 unstaged
상태로 존재하므로, 커밋 시 `server.mjs`의 이번 변경분만 정확히 분리해서 커밋할지, 또는 전체 WIP를
함께 커밋할지 사용자 확인이 필요하다.

## 다음 액션 (사용자 확인 필요)

1. Category Review 화면에서 카테고리 버튼 하나를 직접 클릭해 실제 저장이 200으로 성공하는지 확인 부탁.
2. 성공 시 `completedModels`가 0→1로 증가하는지 함께 확인.
3. 위 "중요 발견" 크래시 버그를 별도 작업으로 수정할지 여부 결정.
4. 이 리포트 승인 후 커밋 진행 여부 및 범위(이번 diff만 vs 기존 WIP 포함) 확인.

## 추가 수정: Unhandled Rejection 크래시 버그 (2026-08-14)

위 "중요 발견"에서 지적한 크래시 버그를 사용자 지시에 따라 별도로 수정했다. 범위는 이 버그
하나로 한정.

**수정**: `intelligence-service.mjs`의 category-review PATCH 라우트 디스패치에 `await` 추가.

```diff
-      if (req.method === "PATCH") return handleCategoryReviewPatch(req, res);
+      if (req.method === "PATCH") return await handleCategoryReviewPatch(req, res);
```

**검증**: 유효하지 않은 categoryCode/modelKey로 PATCH해도 프로세스가 죽지 않고 `500
{"ok":false,"error":"Internal Server Error","message":"Invalid categoryCode"}` 형태로 정상
응답함을 확인. 이후 GET 200 유지, 동일 PID 생존, 다른 보호된 쓰기 엔드포인트 401 회귀 없음,
`work/category-master.json` 체크섬 테스트 전후 동일 확인.

**추가로 발견한, 이번에도 손대지 않은 별도 버그**: `handleCategoryReviewPatch`가
`readJsonBody(req)`의 반환값(`{ ok, value }`)에서 `.value`를 거치지 않고 `body.modelKey`/
`body.categoryCode`를 직접 읽고 있어(다른 핸들러들은 모두 `body.value.*` 패턴 사용), 실제
요청 바디와 무관하게 항상 `categoryCode: ""`가 전달됨 → **현재 상태로는 실제 카테고리 버튼을
클릭해도 항상 "Invalid categoryCode" 500으로 실패한다.** 이번 지시 범위(unhandled rejection
하나)를 벗어나므로 수정하지 않았으며, 별도 승인 후 진행 필요.
