# SAMPLAS AI Audit Phase 1

SAMPLAS AI는 Marketing OS의 기존 Cafe24 OAuth와 canonical 매출 계산을 읽기 전용으로 사용한다.

```text
Custom GPT
→ AI Audit API
→ SAMPLAS Marketing OS
→ Cafe24
```

## 지원 범위

- Health: Marketing OS 및 Cafe24 인증 연결 상태
- Revenue Reconciliation: 최대 31일 동안 Cafe24 결제액과 Marketing OS canonical 매출 비교
- Order Audit: 주문 한 건의 상품·할인·취소·제외 규칙을 개인정보 없이 조회
- Clients Overview: 기존 Marketing OS의 요약·유형별 집계·Stylist/Press/FF TOP10 조회
- Inventory Overview: 기존 ECOUNT 기반 재고 요약·브랜드 집계·상태별 품목 조회

현재 Meta, Instagram, ECOUNT 전체 분석은 지원하지 않는다.

## Render 설정

Render 서비스에 `AI_AUDIT_SECRET` 환경변수를 등록한다. 값은 충분히 긴 임의 문자열을 사용하며 저장소 파일에 기록하지 않는다.

서버는 `AI_AUDIT_SECRET`을 우선 사용하고, 값이 없을 때만 기존 `CAFE24_PROXY_SECRET`을 fallback으로 사용한다.

## Custom GPT Action 설정

1. Custom GPT `SAMPLAS AI`의 Actions 설정을 연다.
2. [OpenAPI 파일](./samplas-ai-audit-openapi.yaml)의 내용을 schema로 등록한다.
3. Authentication을 `API Key`로 선택한다.
4. Auth Type은 `Custom Header`로 선택한다.
5. Header 이름을 `x-samplas-internal-token`으로 입력한다.
6. API Key 값에는 Render의 `AI_AUDIT_SECRET`과 동일한 값을 입력한다.
7. 아래 테스트 질문으로 세 Action을 각각 확인한다.

```text
Cafe24 연결 상태 확인해줘.

2026-07-01부터 2026-07-28까지 매출 차이 확인해줘.

주문번호 20260728-0000065 분석해줘.

2026-07-01부터 2026-07-28까지 Clients 현황을 알려줘.

오늘 재고 위험 브랜드 알려줘.

QQQ 음수 재고 보여줘.

음수 재고 TOP10 알려줘.
```

## 보안

비밀키를 문서, Git, 로그, 화면 캡처에 넣지 않는다. Custom GPT 인증 설정과 Render 환경변수에만 저장한다.

API 응답에는 고객 이름, 수령인, 전화번호, 이메일, 회원 ID, 주소, 배송 메모, 결제 식별정보, OAuth 토큰, 내부 secret이 포함되지 않는다.

모든 `/api/ai-audit/*` 요청은 `x-samplas-internal-token` 인증이 필요하며, 인증 실패 시 HTTP 401과 `{ "error": "Unauthorized" }`만 반환한다.

## 운영 확인

- Base URL: `https://samplas-marketing-os.onrender.com`
- OpenAPI: [`docs/samplas-ai-audit-openapi.yaml`](./samplas-ai-audit-openapi.yaml)
- Health에서 Cafe24 장애가 발생해도 인증에 성공했다면 HTTP 200을 반환하고 `status: "DEGRADED"`와 안전한 `cafe24.code`로 원인을 표시한다.
- Revenue Reconciliation의 날짜 범위는 필수이며 최대 31일이다.
- Order Audit은 명시적인 allowlist 필드만 반환한다.
