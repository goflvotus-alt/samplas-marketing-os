# APGUJEONG Stylist Attribution Live Data

## Result

- Starting branch: `main`
- Starting HEAD: `21771e3`
- Actual customer ↔ assigned stylist canonical relation found: **NO**
- Implementation decision: **担当자 기반 카드 유지 unavailable; 추정 구현 없음**
- Canonical sales calculation changed: **NO**
- Commit: **NO**

## 1. Attribution source audit

현재 repository와 운영 snapshot schema에는 고객과 실제 담당 직원/스타일리스트를 연결하는 canonical relation이 없다.

확인한 경로:

- `intelligence-service.mjs::buildClientsOverview()`
  - ECOUNT `customerName`을 canonical client group으로 묶는다.
  - `clientType === "stylist"`는 거래처명에 `실장`, `스타일리스트`, `팀`, `어시` 등이 포함되는지를 판정한 **고객 유형**이다.
  - 반환되는 client의 `salesStaff`는 일부 `OO님 판매` 문자열에서 추출하는 보조 분류값일 뿐 고객 담당자 relation이 아니다.
  - APGUJEONG 2026-08-01~14 실데이터에서 `salesStaff`가 있는 client는 0명이다.
- `scripts/load-ecount-offline-sales.mjs::loadEcountOfflineSalesExcel()`
  - 저장하는 판매행 필드는 날짜, 전표번호, 상품명, 규격, 수량, 품목그룹, 거래처명, PO No, 매출액, 개인결제 여부뿐이다.
  - 직원 ID/직원명/담당자 ID/담당자명 필드는 snapshot에 저장하지 않는다.
- `work/ecount-sales/2026-08.APGUJEONG.json`
  - `salesLines`에 `clientId`, `staffId`, `assignedStylist`, `salesStaff` 또는 관계 유효기간 필드가 없다.
- `server.mjs::composeStoreIntelligencePayload()`
  - `relationships: { available:false, reason:"담당 관계 데이터 미연결" }`
  - `brandClientCross: { available:false, reason:"브랜드 교차 집계 연결 대기" }`
  - 최근 고객 projection에도 담당자 필드가 없다.
- repository-wide relation/source search
  - 별도 staff master, customer-staff relationship registry, assignment history를 찾지 못했다.

`stylistTop10`의 이종현/이지은 등은 “스타일리스트 유형으로 분류된 고객”이며 SAMPLAS 담당 직원이 아니다. 이 값을 담당 스타일리스트로 재사용하면 의미가 바뀌므로 금지했다.

## 2. Requested cards

| Area | Result | Reason |
|---|---|---|
| 스타일리스트별 TOP 브랜드 | Unavailable 유지 | 실제 담당자 relation 없음 |
| 담당 스타일리스트 고객 수 | Unavailable 유지 | distinct client를 staff에 귀속할 canonical key 없음 |
| 최근 구매 고객 담당 스타일리스트 | Unavailable 유지 | recent client row에 assignment source 없음 |
| 보조 지표 | 생성하지 않음 | 위 relation을 전제로 하므로 안전한 canonical 계산 불가 |

기존 스타일리스트 **고객 유형** 매출 비중/랭킹은 현재 canonical Clients 분류 결과로 정상 표시되며, 담당자 카드와 혼합하지 않았다.

## 3. Canonical schema required for a future batch

새 관계 데이터가 들어올 때 최소한 아래 의미가 필요하다. 이번 배치에서는 파일이나 schema를 생성하지 않았다.

| Field | Required meaning |
|---|---|
| `clientId` | 기존 `buildClientsOverview()`가 반환하는 canonical client ID |
| `staffId` | 별도 staff master의 안정적인 canonical ID |
| `storeCode` | 관계가 적용되는 매장 (`APGUJEONG` 등) |
| `relationshipType` | 예: `PRIMARY_STYLIST`; 단순 판매 입력자와 담당자를 구분 |
| `validFrom` | 관계 시작일 |
| `validTo` | 관계 종료일 또는 `null` |
| `source` | 관계를 확정한 원천 시스템/승인 기록 |
| `sourceRecordId` | 원천 레코드 추적용 ID |

추가 전제:

1. staff master가 먼저 존재해야 한다.
2. 한 고객의 기간 중 담당 변경을 처리할 수 있어야 한다.
3. ECOUNT 거래 입력자와 고객 담당자를 같은 의미로 간주하면 안 된다.
4. Store Intelligence는 이 relation을 읽기만 하고 client/brand resolver를 새로 만들면 안 된다.

## 4. APGUJEONG reconciliation

검증 범위: `2026-08-01` ~ `2026-08-14`

- Snapshot coverage: `2026-08-01` ~ `2026-08-14`
- Offline sales: **97,177,900원**
- Latest day: `2026-08-14`
- Latest day sales: **5,390,600원**
- Purchase clients: **60명**
- Offline order count: **164건**
- AOV: **231,392.53원** (UI 반올림 231,393원)
- Assigned-staff values present: **0명**
- Relationship state: **Unavailable 유지**

Clients 표시 합계 96,027,900원은 기존 gift-line 표시 제외 정책이 적용된 고객 화면용 합계이며, canonical store offline sales 97,177,900원을 변경하지 않았다.

## 5. VAIL reconciliation

검증 범위: `2026-08-01` ~ `2026-08-14`

- Snapshot coverage: `2026-08-03` ~ `2026-08-13`
- Offline sales: **70,200원**
- Latest day sales: **70,200원**
- Purchase clients: **1명**
- Offline order count: **1건**
- Brand revenue: 기존 PACOSPLY **70,200원** canonical 결과 유지
- VAIL renderer/data logic modified: **NO**

## 6. Validation

- JavaScript syntax (`server.mjs`, `outputs/samplas-marketing-os.js`): **PASS**
- Targeted tests: **33/33 PASS**
  - `test/store-intelligence-live-data.test.mjs`
  - `test/store-intel-ui-a.test.mjs`
  - `test/clients-active-items.test.mjs`
- Full regression: **678/678 PASS**
- `git diff --check`: **PASS**
- Cafe24/network warnings during local test: non-blocking; tests used existing fallback/fixtures and all assertions passed.

## 7. Files changed in this batch

- `docs/reports/APGUJEONG-STYLIST-ATTRIBUTION-LIVE-DATA.md` (new report only)

No changes were made to:

- `server.mjs`
- `outputs/samplas-marketing-os.js`
- `outputs/samplas-marketing-os.css`
- canonical sales logic
- APGUJEONG/VAIL snapshots
- tests

## 8. User QA points

1. APGUJEONG의 “스타일리스트별 고객 수”가 계속 `담당 관계 데이터 미연결`로 보이는지 확인한다.
2. “스타일리스트별 TOP 브랜드”가 가짜 고객명/브랜드 조합을 표시하지 않는지 확인한다.
3. 최근 구매 고객의 담당 스타일리스트 열이 추정 이름 대신 미연결 상태를 유지하는지 확인한다.
4. 기존 스타일리스트 고객 유형 매출 랭킹(예: 이종현)이 그대로 보이되 담당 직원 성과로 표현되지 않는지 확인한다.
5. APGUJEONG 97,177,900원과 VEIL/PACOSPLY 70,200원이 유지되는지 확인한다.

## Final

실제 담당 스타일리스트 attribution은 **발견되지 않았다**. 따라서 이번 배치에서 담당자 기반 3개 영역은 구현하지 않았고, unavailable 상태를 유지했다. 이는 누락이 아니라 데이터 정책에 따른 안전한 종료다.
