# AI Audit Feature — Forensic Investigation — 2026-08-26

**결론: CLASSIFICATION B — Backend-only by design. 회귀 아님, 조치 불필요.**

## 1. Purpose

Batch 4(Local→Render migration)에서 `/api/ai-audit/*` 백엔드 라우트는
존재하지만 프론트엔드 번들(`outputs/samplas-marketing-os.js`)에서 "AI
Audit" 관련 문자열/경로 참조가 전혀 발견되지 않았다. 이것이 (a) 네비게이션
메뉴만 사라진 회귀인지, (b) 원래부터 백엔드 전용 기능인지, (c) 과거에
있었다가 삭제된 것인지 확정되지 않은 채 남아 있었다. Batch 7에서 저장소
전체와 git 히스토리를 전수 조사해 확정한다.

## 2. 결론

**AI Audit은 SAMPLAS Marketing OS 대시보드의 화면 기능이 아니다.**
별도의, 의도적으로 backend-only인 읽기 전용 API로, **ChatGPT Custom GPT
Action**("SAMPLAS AI")이 소비하도록 설계된 통합이다. `docs/samplas-ai-audit-setup.md`
가 이를 명시적인 아키텍처 다이어그램으로 기록하고 있다:

```
Custom GPT → AI Audit API → SAMPLAS Marketing OS → Cafe24
```

이 기능의 "프론트엔드"는 ChatGPT 자체의 Custom GPT 채팅 인터페이스이며,
이 저장소 밖에 있다 — 따라서 프론트엔드 번들에 참조가 0건인 것은
**회귀가 아니라 애초에 의도된, 올바른 상태**다.

## 3. 증거

### 3.1 실제 구현 존재(스텁 아님)

`scripts/ai-audit.mjs`(411줄)에 10개 export 함수:
`buildAiAuditHealth`, `buildAiAuditClientsOverview`,
`buildAiAuditInventoryOverview`, `buildAiAuditCommerceOverview`,
`buildAiAuditRevenueReconciliation`, `buildAiAuditOrder`,
`isAiAuditAuthorized`, `resolveAiAuditSecret`,
`classifyAiAuditCafe24Error`, `validateAiAuditRange`.

`server.mjs`에 이 함수들을 import해 실제로 연결한 6개 라우트: health,
clients, inventory, commerce, revenue-reconciliation, orders/:id — 각각
`x-samplas-internal-token` 헤더 인증(`isAiAuditAuthorized`) 필요.
`/health` 핸들러는 실제 live Cafe24 API probe를 수행한다(AbortController,
5초 timeout) — 더미 응답이 아니다.

### 3.2 OpenAPI 스키마 완비

`docs/samplas-ai-audit-openapi.yaml`(29KB, 2026-07-29 작성) — Custom GPT의
Actions 설정에 그대로 붙여넣도록 설계된 완전한 OpenAPI 스펙.
`docs/samplas-ai-audit-setup.md`가 이 파일을 사용하는 단계별 설정
절차까지 기록.

### 3.3 빌드 이력 — 완성까지 이어진 선형 개발

```
7f6c50b feat: add secure Cafe24 read-only diagnostics
8f19ca0 docs: finalize phase 1 integration
fcebcb9 feat: expose clients overview
0056960 feat: expose inventory overview
cdd0fed fix: inline revenue query parameters
28e3762 feat: expose commerce overview
```
전부 `(ai-audit)` 태그가 붙은 `main` 브랜치 커밋. 마지막 커밋이 "finalize
phase 1 integration"으로 끝나며, 이후 이 기능을 되돌리거나 삭제한 커밋은
없음 — 미완성 실험이 아니라 완성된 기능.

### 3.4 프론트엔드 참조 — 전체 히스토리에 걸쳐 0건

```
git log -S"ai-audit" --all -- outputs/
```
결과: **0건, 단 한 번도 없음.** 프론트엔드 파일이 이 기능을 참조한
적이 히스토리 전체에서 전혀 없다 — "빌드 후 삭제됨(D)"이 아니라
"애초에 프론트엔드가 필요 없던 기능(B)"임을 직접 증명한다.

### 3.5 기획 문서 — 별도 관리, 메인 로드맵과 분리

`docs/ROADMAP.md`, `docs/ROADMAP_BACKLOG.md`, `docs/PROJECT_MEMORY.md`,
`docs/DECISIONS.md` 어디에도 "AI Audit" 언급 0건. 이 기능의 문서는
전용 setup 문서(`docs/samplas-ai-audit-setup.md`)에만 존재 — 메인 제품
기획과 의도적으로 분리된 "사이드 통합"이라는 성격과 일치.

## 4. 라우트가 실제로 하는 일

스텁이 아니라 실제 로직:
- `/health`: live Cafe24 probe, 장애 시 500이 아니라 `DEGRADED` +
  안전한 에러 코드 반환.
- `/clients`, `/inventory`, `/commerce`: 대시보드가 이미 쓰는 기존
  canonical aggregation 함수를 재사용하되, allowlist로 필드를 필터링한
  응답(setup 문서: "API 응답에는 고객 이름, 수령인, 전화번호... 포함되지
  않는다" — PII 제거).
- `/revenue-reconciliation`: 명시적 ≤31일 range 요구(`validateAiAuditRange`).
- `/orders/:id`: allowlist된 필드만 반환.

## 5. 명시적 제품 결정

setup 문서 자체가 결정 기록이다 — Phase 1 범위를 Health/Revenue
Reconciliation/Order Audit/Clients/Inventory/Commerce로 명시적으로
한정하고, "현재 Meta, Instagram, ECOUNT 전체 분석은 지원하지 않는다"고
못박았다. 이후 이 범위를 수정한 문서는 없음.

## 6. 분류

| 옵션 | 해당 여부 |
|---|---|
| A. 기능이 존재하고 navigation만 사라짐 | 아니오 — 애초에 대시보드 navigation에 속한 적이 없음 |
| **B. backend만 존재** | **예 — 정확히 이 경우, 의도된 설계** |
| C. frontend만 존재 | 아니오 |
| D. 과거 구현됐다가 삭제됨 | 아니오 — 삭제 이력 없음, 완성된 채로 유지 중 |
| E. 기획만 있었고 구현 안 됨 | 아니오 — 완전히 구현되어 동작 중 |
| F. 다른 이름으로 존재 | 아니오 |

## 7. 조치

**없음.** 회귀가 아니고 새 기능 설계가 필요한 상태도 아니다 — 현재
설계대로 정상 동작 중.

별도 확인 권장 사항(이번 forensic의 범위 밖, action 아님): Render에
`AI_AUDIT_SECRET` 환경변수가 실제로 설정되어 있는지 — setup 문서에 따르면
미설정 시 `CAFE24_PROXY_SECRET`으로 폴백한다고 되어 있어 즉각적인
운영 장애는 아니지만, 의도한 대로 별도 시크릿을 쓰고 있는지는 별도
운영 점검 대상.

## 8. Final Status

```
AI AUDIT FORENSIC COMPLETE — CLASSIFICATION B, NO ACTION REQUIRED
```
