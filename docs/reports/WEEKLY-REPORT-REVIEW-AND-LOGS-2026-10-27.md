# 주간 리포트 검수 지시문 수정안 · Render 로그 조회 절차 (2026-10-27)

## 1. 배경

- PARTIAL 판정은 Render 생성기가 아니라 ChatGPT "SAMPLAS Weekly Reports" 검수 스레드가 붙인다.
- 검수기는 Dropbox XLSX가 없거나 일부만 읽으면 MCP 요약 도구(`get_advertising_summary` 등)로 대체본을 만든다.
  MCP 도구에는 광고그룹·검색 수요·계정 고유 도달·주간 팔로워 스냅샷이 없으므로 대체본은 구조적으로 매주 PARTIAL이 된다.
- Naver 10/20·10/27 자동 리포트는 생성되지 않았다. 10/27 원인은 Render 로그로 확인했다(3절).

## 2. ChatGPT 검수 자동화 지시문 수정안

아래 블록을 기존 "SAMPLAS Weekly Reports" 지시문의 데이터 출처·판정 부분과 교체한다.

```text
[데이터 출처 우선순위]
1. 기준 기간: 직전 완료된 화~월 7일(KST). 비교 기간: 그 직전 7일.
2. Dropbox에서 플랫폼별 폴더를 먼저 확인한다.
   - Meta:      /SAMPLAS WORK/병구 작업/메타 광고/리포트/META_ADS_WEEKLY_<since>_<until>.xlsx
   - Instagram: /SAMPLAS WORK/병구 작업/인스타그램 리포트/INSTAGRAM_WEEKLY_<since>_<until>.xlsx
   - Naver:     /SAMPLAS WORK/병구 작업/네이버 광고 리포트/NAVER_ADS_WEEKLY_<since>_<until>.xlsx
3. 판정은 반드시 해당 XLSX 내용으로 한다. MCP 요약 도구 값은 교차 확인용으로만 쓰고,
   XLSX와 다르면 차이를 "불일치"로 보고하며 XLSX 값을 MCP 값으로 덮어쓰지 않는다.
4. XLSX 대신 <PREFIX>_<since>_<until>_FAILED.txt 가 있으면 상태는 FAILED다.
   파일의 reason 줄을 그대로 인용한다. MCP 값으로 대체 리포트를 만들지 않는다.
5. XLSX도 FAILED.txt도 없으면 상태는 MISSING(자동 실행 미확인)이다. 대체 리포트를 만들지 않는다.

[플랫폼별 확인 위치]
- Meta: REPORT 4행 검증 배너(PASS/UNKNOWN/FAIL)와 ISSUE_EVIDENCE.review.result를 기준으로 한다.
  "매출 · Meta 귀속"과 "실제 유료 매출(Cafe24)"은 서로 다른 지표이며 합산하지 않는다.
  직전 주 발행 금액과 현재 순매출 차이는 ISSUED_COMPARISON·REFUND_TRACKING의 환불 조정으로 설명되면 누락이 아니다.
  광고명 후보(G2_AD_NAME)는 실제 매출에 합산하지 않는다.
- Instagram: REPORT의 "계정 고유 도달"(주간 total_value)과 "팔로워 증감"(7일 간격 스냅샷)을 사용한다.
  일별 도달 합계나 게시물 도달 합계를 고유 도달로 쓰지 않는다. MCP 일별 팔로워 시계열은 판정에 쓰지 않는다.
- Naver: REPORT 4행 배너와 ISSUE_EVIDENCE.review(result, sections.campaigns, sections.adgroups, issues)를 기준으로 한다.
  sections.adgroups가 FAILED/PARTIAL/UNAVAILABLE이면 전체 판정은 PARTIAL이며, 캠페인 성과는 검증된 값으로 그대로 사용한다.
  FAILED의 issues[].evidence.exceeded(campaignId, campaignSpend, adgroupSpend, excess)를 그대로 인용한다.
  광고그룹 표가 "검증 실패"로 표시된 주에는 03 표가 캠페인 기준이며, 광고그룹·브랜드 성과로 해석하지 않는다.

[판정 기준]
- PASS: XLSX가 있고, 검증 배너·필수 지표가 확인되며, 미확인 값이 0으로 대체되지 않았다.
- PARTIAL: XLSX가 있으나 XLSX 스스로 N/A·UNAVAILABLE·UNKNOWN으로 표시한 필수 지표가 있다. 해당 항목과 XLSX의 사유를 적는다.
- FAILED: FAILED.txt가 있다. MISSING: 둘 다 없다.
- 금액 차이를 주장할 때는 시트명·행·셀 또는 주문번호를 함께 적는다. 근거 셀이 없는 금액은 "미검증 주장"으로 표시한다.
- 샘플·테스트·추정 데이터로 빈 값을 채우지 않는다.
```

## 3. Render 로그 조회 절차 (읽기 전용)

서비스: `samplas-marketing-os` (`srv-d930l06h2hms73d203n0`). 로그 보존 기간은 현재 플랜 기준 **7일**이다
(대시보드의 Last 14/30 days 비활성). 화요일 장애는 다음 주 화요일 전에 확인해야 한다.

1. 대시보드: `https://dashboard.render.com/web/srv-d930l06h2hms73d203n0/logs?t=app&r=7d&q=naver_weekly_report`
   - 시간 범위: 해당 화요일 10:00–11:00 KST (01:00–02:00 UTC).
   - 검색어: `naver_weekly_report`, `[NAVER_ADS_WEEKLY_REPORT]`, `[SAMPLAS_API_ERROR]`.
   - Meta·Instagram은 `[META_ADS_WEEKLY_REPORT]`, `meta_weekly_report`, `[INSTAGRAM_WEEKLY_REPORT]`, `instagram_weekly_report`.
2. Render Shell(읽기만): `tail -n 200 /var/data/samplas-dashboard/work/samplas-api-errors.ndjson | grep weekly_report`
   - 이 파일은 최근 200건만 유지한다. 수정 전 코드는 ok:false 실패를 이 파일에 남기지 않았다.
3. 인증된 `/api/status`의 `naverWeeklyReport.lastError` (프로세스 메모리 값이므로 재시작 시 사라진다).

### 확인 결과 (2026-10-27 조회)

| 시각 (KST) | source | message |
|---|---|---|
| 2026-10-27 10:02:52 | naver_weekly_report | naver_adgroup_spend_exceeds_campaign |
| 2026-10-27 10:17:53 | naver_weekly_report | naver_adgroup_spend_exceeds_campaign |
| 2026-10-27 10:32:51 | naver_weekly_report | naver_adgroup_spend_exceeds_campaign |
| 2026-10-27 10:47:52 | naver_weekly_report | naver_adgroup_spend_exceeds_campaign |

- 10/20 로그는 7일 보존 범위를 벗어나 조회되지 않았다(미확인).
- `scripts/naver-weekly-adgroup-integrity.mjs`의 `reconcileAdgroupCoverage()`는 선택 상세인 광고그룹 지출 합계가
  캠페인 지출을 0.01원이라도 넘으면 throw한다. 이 throw가 캠페인 단위 리포트 전체를 폐기했다.
- 초과 금액과 해당 캠페인은 기존 메시지에 없어서 아직 알 수 없다.
- 수정 후: 광고그룹 대조 실패는 광고그룹 섹션만 FAILED로 처리하고, 검증된 캠페인 성과로 PARTIAL 리포트를 발행한다.
  초과 캠페인 ID·금액은 REPORT 4행 배너, ISSUE_EVIDENCE, 오류 메시지에 기록된다. 원본 금액은 보정하지 않는다.
