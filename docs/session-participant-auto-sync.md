# SESSION 참가자 자동 연동

상태: 구현·가짜 데이터 검증용. Render 인증 복구와 운영 적용 확인 전에는 이 변경을 main에 병합하거나 운영 동기화를 실행하지 않는다. SESSION 001 최초 실데이터 저장은 별도 승인 대상이다.

## 기존 저장 흐름 재사용

- 기존 SESSION 001 고정 Sheets 연결, `readSheetRows`, `parseSheetRows`, `mergeSync`, `participants.json`을 그대로 사용한다.
- 신규 신청은 `applied`. 정원 15명이어도 유효 신청 18건을 모두 저장한다. 확정 정원 검사는 기존 운영 API 정책을 유지한다.
- 같은 연락처·Instagram HMAC의 반복 신청은 기존 파서가 병합한다. 기존 참가자 ID, 상태, 안내, 메모, 체크인은 `mergeSync`가 보존한다.
- 프로젝트/TODO/큐시트와 Google 원본은 쓰지 않는다. SESSION 002와 테스트 프로젝트는 자동 연동 대상이 아니다.

## 최초 저장 승인 경계

자동 동기화는 `sync.importKeyId`가 없는 명단을 초기화하지 않는다. 기존 인증된 preview/commit의 최초 저장이 완료되어야 자동 동기화 대상이 된다. 공개 GET, MCP 조회, 브라우저 새로고침으로 이 경계를 열 수 없다. 신규 활성화 API나 환경변수는 없다.

최초 저장 직전 승인 절차:

1. Render 관리 연결을 복구하고 실제 운영 revision·기존 인증·Sheets/HMAC 준비 상태를 확인한다. Secret 값은 출력하지 않는다.
2. 기존 private import preview로 최신 원본 건수·중복·제외·현재 저장 버전을 다시 확인한다.
3. 예상 추가 수·기존 상태 변경 없음·정원과 프로젝트 영향·승인 후 60초 자동 연동을 보고하고 사용자의 명시적 승인을 받는다.
4. 승인된 version과 유효한 preview token으로 기존 commit을 한 번 실행한다. 409나 모호한 결과는 재조회하고 임의 재시도하지 않는다.

현재 알려진 18건/저장 0명은 과거 확인값이며 최초 저장 직전 반드시 다시 확인한다. 이 문서와 테스트는 실데이터 저장을 승인하지 않는다.

## 서버 동작

Render가 제공하는 `RENDER=true`, `IS_PULL_REQUEST=false`, `NODE_ENV=production`인 런타임에서만 60초 타이머를 시작한다. PR preview, 빌드, Mac, 테스트 import에서는 자동 시작하지 않는다. 새 환경변수나 서비스는 추가하지 않는다.

기존 `SESSION_PARTICIPANTS_SYNC=on`·Sheets 자격증명·HMAC 준비 상태와 최초 저장 증거를 검사한다. 동시 호출은 진행 중 Promise를 공유한다. 매번 최신 Dropbox 문서와 revision을 읽고, 유효한 원본을 병합한 뒤 변경이 있을 때만 CAS로 한 번 저장·재조회한다. 동일 응답은 버전/이력을 증가시키지 않는다.

네트워크/헤더/빈 원본/HMAC 변경/409/쓰기 확인 실패는 기존 파일과 운영 상태를 보존하며 일반 오류 상태만 메모리에 남긴다. 다음 주기는 최신 문서를 다시 읽어 변경이 필요한 경우만 저장하므로 응답 유실 때 중복 저장하지 않는다. 서버 오류 원문과 신청 응답은 로그에 기록하지 않는다.

기존 private participants 응답에 `autoSync` 상태·시각이 추가된다. HMAC 키 식별자는 참가자 조회/MCP 응답에서 제외한다. Vercel은 상태·시각과 기존 이름/Instagram/상태/체크인만 허용한다. 전화번호·답변·메모·시트·HMAC은 공개하지 않는다.

화면은 캐시된 명단을 먼저 표시하고 재방문/복귀/새로고침 및 보이는 참가자 화면에서 60초마다 GET 재조회한다. 브라우저는 import/자동 저장 요청을 보내지 않는다. 화면 조회 주기와 서버 주기는 독립이므로 열린 화면 반영에는 최악의 경우 두 주기와 네트워크 시간이 걸릴 수 있다.

## 검증

`node --test test/session*.test.mjs` — fake Dropbox와 합성 Sheets만 사용한다. 승인 대기, 18건 applied, 신규 추가, HMAC 중복 병합, 운영 필드 보존, 용량 검사, 409, 네트워크/빈 원본/헤더/HMAC 오류, 응답 유실, MCP 동일 저장소 조회를 검증한다.

Render 플랫폼 변수 근거: https://render.com/docs/environment-variables
