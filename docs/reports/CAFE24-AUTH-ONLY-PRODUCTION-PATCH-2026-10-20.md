# Cafe24 인증 전용 Production 분리 패치

## 기준과 구조

Production 기준은 `7f2c6538a4dbc2282aa8bb142dab10e7367db50c`이다. 새 로컬 브랜치는 `codex/cafe24-auth-only`이며 이 Production 커밋에서 직접 시작했다. 기존 `codex/meta-issued-adjustments`는 `9697bf9a22734e03a7d97d9f865bc06f82e6fba0` 그대로 보존했다.

기존 검수 브랜치의 인증 변경만 Production 함수에 옮겼다. `9697bf9` 전체를 cherry-pick하지 않았다. Analytics는 Production의 기존 `{ok,statusCode,request,data}` 반환 형태를 유지하며 coverage 필드를 추가하지 않는다.

## 수정 계획과 실제 변경 파일

1. `server.mjs`
   - `normalizeCafe24ExpiresAt()` 추가: 기존 offset 없는 토큰 만료값은 앞서 실측한 KST(+09:00) 기준으로 해석한다. 명시적 Z/offset의 원래 순간은 보존한다.
   - `writeCafe24TokenRecord()`: 신규 만료값을 UTC ISO(Z)로 저장한다. 기존 private 임시 파일 작성과 rename 방식 유지.
   - `cafe24TokenNeedsRefresh()`: 정규화된 값으로 만료 10분 전 갱신 판정. 누락/invalid 날짜는 갱신 필요. 읽기만으로 기존 파일을 소급 수정하지 않는다.
   - `fetchCafe24AnalyticsOrderDetails()`: 초기 ensure 재사용. 명시적인 access token 만료 HTTP401만 기존 single-flight로 갱신 후 1회 재시도. 다른 401/403은 재시도하지 않는다. 이미 회전된 토큰은 추가 갱신 없이 사용한다. 인증/갱신 실패는 원문 credential 오류 없이 종료한다.
2. `test/cafe24-auth-timezone.test.mjs`
   - Production 반환 계약에 맞춘 독립 인증 회귀 10개. Meta 모듈 의존성 없음.
3. 이 검수 문서.

## 제외 범위 검증

server.mjs에서 신규 정규화 함수를 제거하고, 변경한 기존 함수 세 개(writer/needsRefresh/Analytics reader)를 Production 원문으로 복원한 결과가 Production server.mjs와 **바이트 단위로 동일**함을 로컬 스크립트로 검증했다.

따라서 다음은 Production과 동일하다.

- Meta 발행본 저장·자동 승인 동작 및 coverage 판정: 이번 패치에 미포함.
- `scripts/meta-issued-report.mjs`, `scripts/weekly-data-completeness.mjs`: 이 브랜치에 존재하지 않음.
- Meta/Instagram/Naver REPORT 생성기와 레이아웃.
- 화요일 10시 스케줄러, 보고서 전달 경로 및 Dropbox 업로더.
- Cafe24 canonical 매출/취소·환불 계산.
- 기존 refresh token single-flight 구현, 토큰 저장 구조와 파일 권한.

이 분리 패치는 기존 Meta 자동 발행 동작을 강화하거나 완화하지 않는다. 별도 Meta 발행·coverage 작업을 배포한 것으로 간주하면 안 된다.

## 테스트 결과

운영 API·토큰 없이 모의 응답과 로컬 파일 쓰기 대역을 사용했다. 보고서 테스트의 파일은 지정 `_temp/cafe24-auth-only/` 아래에 생성했다. 의존성은 기존 npm 캐시의 복사본에서 오프라인 설치했고 저장소 package.json/lockfile은 변경하지 않았다.

- 인증 회귀 **10/10 PASS**:
  - offset 없는 만료값, Z, +09:00을 UTC·Asia/Seoul 별도 프로세스에서 동일하게 판정.
  - 10분 선제 갱신 경계와 invalid/missing 날짜.
  - 신규 저장 ISO 정규화.
  - 만료 401 → 1회 갱신 → 성공, 지속 401의 재시도 상한.
  - 권한 부족 401·invalid_client·이유 불명 invalid_token·403 무갱신.
  - 초기 ensure/refresh 실패의 안전한 인증 오류.
  - 동시 및 늦은 401의 중복 갱신 방지.
  - 기존 ensure 병렬 호출의 single-flight 회전 1회.
  - private 임시 파일 mode0600, rename 교체, write/rename 실패 시 기존 레코드 보존 및 env 미갱신.
- 인증·Meta/Instagram/Naver 보고서·스케줄러·Dropbox 관련 회귀 **149/149 PASS**.
- 전체 동일 환경 비교:

| 소스 | 테스트 | PASS | FAIL | SKIP |
|---|---:|---:|---:|---:|
| Production 7f2c653 | 1,666 | 1,601 | 63 | 2 |
| 분리 패치 | 1,676 | 1,611 | 63 | 2 |

실패명 집합 일치, 신규 실패 0, 의존성 로딩 실패 없음. 별도 소스 사본과 동일 명령 `node --test test/*.test.mjs`로 비교했다. 기존 환경/fixture/기존 기능 실패 63개는 수정하지 않았다.

`npm run check`, `git diff --check` PASS. 추가 검토 에이전트는 계정 사용량 제한으로 실행되지 못했다. 이번 분리본에 대한 독립 리뷰 완료 주장은 하지 않는다. 자체 diff/계약/회귀 확인을 수행했으며 Claude 검수를 위해 커밋을 분리했다.

## Claude 검수 방법

- 새 커밋의 부모가 `7f2c653`인지 확인.
- `git diff 7f2c653..codex/cafe24-auth-only --stat`
- `git diff 7f2c653..codex/cafe24-auth-only -- server.mjs`
- 검수 대상은 위 소스/테스트/문서 3개 파일뿐이다. 기존 검수 브랜치 전체를 배포하거나 `9697bf9`를 그대로 이식하지 않는다.
- 테스트 실행에는 저장소 기존 의존성 설치가 필요하다. `node --test test/cafe24-auth-timezone.test.mjs`는 외부 API나 운영 인증을 호출하지 않는다.

## 배포 위험 및 남은 검증

- 운영 토큰 갱신과 실제 Analytics 401 복구는 미실행. 실제 refresh token 만료/폐기는 로컬 테스트로 보증할 수 없다.
- 기존 offset 없는 Cafe24 토큰 만료값은 KST로 취급한다. 임의의 UTC 무offset 값을 수동 저장한 레코드는 이 계약 대상이 아니다. 명시적 UTC/KST 값은 원래 순간을 보존한다.
- invalid/missing 만료값은 선제 갱신을 요구하므로 기존보다 갱신 요청이 발생할 수 있다. 초기 인증 오류와 Analytics 원본 오류 메시지는 안전한 일반 오류로 제한한다.
- 기존 단일 갱신과 atomic rename을 재사용한다. 프로세스 간 잠금/다중 인스턴스 토큰 회전 문제를 새로 해결하는 패치는 아니다.
- 운영 승인 후 실제 token refresh→정규화 저장→Orders/Analytics 재조회 및 보고서 실행을 확인해야 한다. Dropbox 실전 업로드/실제 화요일 자동 실행은 수행하지 않았다.
- GitHub push, Production 배포, 운영 토큰 갱신, 운영 데이터 변경 모두 미수행. Claude 검수와 별도 운영 승인 전 배포 준비 완료로 간주하지 않는다.
