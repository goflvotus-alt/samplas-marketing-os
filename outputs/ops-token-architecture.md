# SAMPLAS Marketing OS 운영용 토큰 구조

## 핵심 원칙

토큰을 로컬과 Render 양쪽에서 각각 갱신하면 refresh token이 서로 꼬일 수 있습니다.  
따라서 토큰 주인을 하나로 정합니다.

## 권장 구조

| 영역 | 토큰 주인 | 로컬 역할 | Render 역할 |
|---|---|---|---|
| Instagram Graph API | Render 또는 로컬 중 운영 기준 1곳 | 개발/확인용 | 운영 동기화 |
| Meta Ads | Render 또는 로컬 중 운영 기준 1곳 | 개발/확인용 | 운영 동기화 |
| Cafe24 | Render | Render API 호출만 함 | Cafe24 토큰 갱신 및 주문 수집 |

## Cafe24는 Render 한 곳에서만 갱신

로컬 `.env`에는 Cafe24 access token/refresh token을 직접 운영하지 않는 것을 권장합니다.

로컬 `.env`:

```env
CAFE24_PROXY_BASE_URL=https://samplas-meta-dashboard.onrender.com
CAFE24_PROXY_ORDERS_PATH=/api/cafe24/orders
CAFE24_PROXY_BASIC_AUTH=아이디:비밀번호
```

이렇게 하면 로컬의 `/api/cafe24/orders`는 Cafe24에 직접 접근하지 않고 Render의 `/api/cafe24/orders`를 읽습니다.

## Render Basic Auth

현재 Render는 Basic Auth로 보호되어 있습니다.  
그래서 로컬에서 Render API를 읽으려면 아래 값이 필요합니다.

```env
CAFE24_PROXY_BASIC_AUTH=아이디:비밀번호
```

이 값이 없으면 Render가 아래처럼 응답합니다.

```text
401 Authentication required
```

## Meta 토큰

Graph API Explorer에서 받은 토큰은 테스트용 단기 토큰일 수 있습니다.  
운영용으로는 장기 토큰 또는 운영 서버에서 갱신/교체하는 방식을 사용해야 합니다.

로컬에서 임시로 테스트할 때:

```env
META_ACCESS_TOKEN=현재 유효한 Meta 토큰
```

토큰이 만료되면 Instagram/Meta Ads 신규 동기화는 실패하지만, 로컬 서버는 마지막 저장 캐시를 보여주도록 되어 있습니다.

## 로컬 실행

```bash
npm start
```

또는:

```text
outputs/start-samplas-dashboard.command
```

접속:

```text
http://127.0.0.1:8787
```

## 상태 확인

```text
http://127.0.0.1:8787/api/status
```

Cafe24 프록시 확인:

```text
http://127.0.0.1:8787/api/cafe24/orders
```

Meta Ads 확인:

```text
http://127.0.0.1:8787/api/meta-ads/summary
```

## 지금 해야 하는 설정

1. Render Basic Auth 값을 로컬 `.env`에 넣기
2. Meta 토큰은 장기 토큰/운영용 토큰으로 교체
3. Cafe24 토큰은 Render에서만 관리
4. 로컬은 Render 프록시로 Cafe24 주문 데이터를 읽기

## 출근할 때 루틴

매일 새 토큰을 발급받는 방식으로 운영하지 않습니다.

출근 후에는 아래만 하면 됩니다.

1. 로컬 대시보드 실행

```bash
npm start
```

2. 브라우저에서 열기

```text
http://127.0.0.1:8787
```

3. DATA SYNC 상태 확인

- Instagram Graph API가 초록색이면 인스타그램 데이터 연결 정상
- Meta Ads가 초록색이면 광고 데이터 연결 정상
- Cafe24가 초록색이면 Render를 통해 주문 데이터 연결 정상

## 매번 다시 하면 안 되는 것

- Cafe24 토큰을 로컬과 Render 양쪽에서 번갈아 새로 발급하지 않기
- Graph API Explorer 단기 토큰을 운영 토큰처럼 매일 교체하며 쓰지 않기
- `.env` 값을 복사해서 여러 곳에 흩뿌리지 않기

## 토큰 만료 시 처리 기준

| 상황 | 조치 |
|---|---|
| Cafe24만 노란색/빨간색 | Render 쪽 Cafe24 연결만 확인 |
| Meta Ads만 노란색/빨간색 | `META_ACCESS_TOKEN` 운영용 토큰 확인 |
| Instagram만 노란색/빨간색 | `META_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID` 확인 |
| 로컬만 안 되고 Render는 됨 | 로컬 `.env`의 `CAFE24_PROXY_BASIC_AUTH` 확인 |

## 최종 운영 원칙

Cafe24 주문 데이터는 Render가 대표로 받아오고, 로컬 대시보드는 Render 결과를 읽습니다.  
그래야 Cafe24 refresh token이 한 곳에서만 갱신되어 토큰 꼬임이 생기지 않습니다.
