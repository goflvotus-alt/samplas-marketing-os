# Store Product / Inventory Intelligence

## 기준

- Branch: `main`
- Starting HEAD: `21771e3`
- 작업일: 2026-08-14 KST
- 범위: 기존 `GET /api/intelligence/store`의 additive 상품·카테고리 응답과 VEIL 렌더 연결
- canonical 매출 계산, 전역 API, store routing 계약은 변경하지 않았다.

## 조사한 데이터 소스

| 소스 | 확인 결과 | 사용 여부 |
|---|---|---|
| `work/ecount-sales/2026-08.APGUJEONG.json` | store-scoped salesLines 존재 | 판매 원본으로 사용 |
| `work/ecount-sales/2026-08.VAIL.json` | store-scoped salesLines 1건 존재 | 판매 원본으로 사용 |
| `work/product-registry.json` | `verified:true`, `status:confirmed`, ECOUNT productName/size 매핑 존재 | 상품 identity에 사용 |
| Unified Identity Resolver | salesLine에 prodCd/barcode가 없어 Product Registry 우선순위 1 직접 적용 불가 | 기존 Brand 집계에 계속 사용 |
| `work/category-master.json` | canonical product category 연결 없음 | 추정하지 않음 |
| ECOUNT Inventory | 전사 재고이며 store dimension 없음 | 매장 재고로 사용하지 않음 |
| 기존 Sell-through | 매장별 입고·재고·입고수량 근거 없음 | 사용하지 않음 |
| 입점일/최초 입고일 | canonical store-scoped entry date 없음 | 신규 입점 반응에 사용하지 않음 |

## 구현

- 매장별 salesLines를 입력으로 받는 `buildStoreProductIntelligence()`를 추가했다.
- Product Registry에서 `verified:true && status:"confirmed"`인 ECOUNT 상품명+규격의 기존 정규화 exact match만 허용한다.
- 같은 exact key가 서로 다른 canonical product에 연결되면 선택하지 않고 unresolved 처리한다.
- 집계 필드: canonical product id/name, canonical brand id/name, 판매수량, 매출, 전표 기준 주문수.
- 정렬: 판매수량 내림차순, 매출 내림차순, 상품명 오름차순.
- 카테고리는 공식 canonical field가 없어 전 매출을 `UNKNOWN / 미분류`로 표시하고 coverage 0%를 명시한다. 상품명 기반 category 추정은 하지 않았다.
- VEIL TOP 상품 UI는 API의 canonical items만 렌더하며, 매치가 없으면 unresolved 건수를 포함한 미연결 상태를 표시한다.
- 압구정의 고객 `type=stylist` 랭킹을 담당 스타일리스트로 오인하지 않도록 사용자 표기를 `스타일리스트 유형 고객`으로 정정했다.

## 실제 결과

### APGUJEONG

- 매장 누적 매출: 97,177,900원 (회귀 없음)
- 2026-08-14 매출: 5,390,600원 (회귀 없음)
- revenue lines: 493
- canonical resolved lines: 13
- unresolved lines: 480
- 표시 가능한 순상품: 3

| 순위 | canonical product | brand | 수량 | 매출 | 주문 |
|---:|---|---|---:|---:|---:|
| 1 | CP-C24-14265 / leather patch beanie | 어나더유스 | 4 | 208,800원 | 4 |
| 2 | CP-C24-14437 / Sharp Thigh Highs | 밍가 | 2 | 158,400원 | 4 |
| 3 | CP-C24-14064 / ARM BAND SET GREY | AE SYNCTX | 1 | 61,200원 | 1 |

net 수량과 매출이 모두 0인 상쇄 상품은 TOP 표시에서 제외한다.

### VAIL

- 매장 누적 매출: 70,200원 (회귀 없음)
- 수량: 1, 주문: 1 (회귀 없음)
- 브랜드: PACOSPLY 70,200원 (기존 Brand Resolver 결과 유지)
- revenue lines: 1
- canonical resolved lines: 0
- unresolved lines: 1
- `PACOSPLY / WonderLand T-shirts BLACK`은 확정 Product Registry 연결이 없어 상품으로 억지 매칭하지 않았다.

## 연결하지 않은 영역

- 재고 현황: 현재 inventory source에 APGUJEONG/VAIL 구분이 없어 전사 재고를 매장 재고처럼 표시할 수 없다.
- Sell-through: 매장별 입고일·입고수량·재고가 없어 기존 공식을 store scope로 실행할 근거가 없다.
- 신규 입점 브랜드 반응: canonical 입점일/최초 입고일이 없으며 첫 판매일을 입점일로 추정하지 않았다.
- category 상세: canonical category가 없으므로 `미분류`만 표시한다.

## 스타일리스트 의미 검증

현재 `clients.stylistTop10`은 담당 직원 관계가 아니라 `clientType=stylist`인 고객 이름의 매출 순위다. 따라서 `TOP 스타일리스트` 의미는 부정확하며, 화면 표기를 `스타일리스트 유형 고객 TOP (매출)`로 정정했다. 담당 스타일리스트별 고객 수·브랜드 교차 표는 관계 데이터가 생길 때까지 미연결 shell을 유지한다.

## 변경 파일

- `server.mjs`
- `outputs/samplas-marketing-os.js`
- `outputs/samplas-marketing-os.html`
- `test/store-intelligence-live-data.test.mjs`
- `test/store-intel-ui-a.test.mjs`
- `docs/reports/STORE-PRODUCT-INVENTORY-INTELLIGENCE.md`

기존 dirty working tree의 다른 변경은 수정·복원·staging하지 않았다.

## 검증

- JavaScript syntax: PASS
- Targeted tests: 31/31 PASS
- Full regression: 671/671 PASS
- `git diff --check`: PASS
- APGUJEONG/VAIL 입력 분리: PASS
- exact canonical product / ambiguity / unresolved 처리: PASS
- inventory/sell-through/new-brand 미지원 상태 유지: PASS
- 전역 canonical sales 계산 변경: NO

## 다음 작업 추천

Product Registry 확정 매핑률을 높이는 승인 작업이 먼저다. 매장 재고·Sell-through·신규 입점 반응은 store-scoped 재고/입고/입점일 원천이 생긴 뒤에만 연결한다.

## Git

- Staged: 없음
- Commit: 없음
- Push: 없음
- Deploy: 없음
