# CATEGORY MASTER — MANUAL REVIEW WORKSPACE

## 기준

- Starting branch: `main`
- Starting HEAD: `21771e3`
- 구현 목적: 기존 Category Master v1과 기존 model audit artifact를 재사용해 미분류 product model을 수동 승인하는 내부 Workspace 제공
- 새 Category taxonomy 또는 새 model grouping algorithm: 없음

## 1. 기존 Category Master persistence 구조

`work/category-master.json`의 기존 `manualOverrides`는 product number 중심 수동 override다. 이번 구현은 기존 필드를 변경하지 않고 `modelAssignments`를 additive하게 사용한다. 기존 자동 분류와 기존 manual override는 그대로 유지된다.

## 2. Manual assignment authority

사용자가 Category Review에서 승인한 값은 `modelAssignments`에 저장되고, Product/Brand Intelligence의 category resolution에서 기존 자동 keyword/suffix 분류보다 먼저 product code로 조회된다. 원본 Inventory record와 Product Registry는 수정하지 않는다.

저장 taxonomy는 기존 Category Master v1의 `TOP`, `BOTTOM`, `OUTER`, `DRESS`, `BAG`, `FOOTWEAR`, `HEADWEAR`, `JEWELRY`, `ACCESSORY`, `OTHER`만 허용한다. `UNCLASSIFIED`는 상태값이며 승인값으로 저장할 수 없다.

## 3. Review model identity

Review 대상과 model identity는 기존 `work/category-unclassified-model-audit.json`의 `modelKey`와 `productCodes`를 그대로 사용한다. Barcode는 화면 식별 정보일 뿐 authority로 사용하지 않는다. 새 grouping 로직은 만들지 않았다.

검증된 artifact 수치:

- Inventory SKU: 10,000
- Manual review models: 1,342
- PACOSPLY: 43 SKU / 19 models

## 4. API

- `GET /api/intelligence/category-review`: brand별 진행률, review models, 저장된 assignment를 반환
- `PATCH /api/intelligence/category-review`: `modelKey`와 `categoryCode`를 검증한 뒤 해당 model의 모든 `productCodes`에 대한 assignment를 저장
- 잘못된 taxonomy와 artifact에 없는 model identity는 저장 전에 거부
- 저장 요청은 process 내 write queue로 직렬화

기존 `server.mjs`의 `/api/intelligence/*` 전달 경로를 재사용했으며 `server.mjs`는 이번 작업에서 수정하지 않았다.

## 5. Persistence safety

저장 시 Category Master 전체를 메모리에서 검증하고, 임시 파일 작성 후 rename하는 atomic write를 사용한다. 저장 성공 후에만 UI가 진행률을 갱신하고 다음 model로 이동한다. 실패 시 현재 model에 남고 `CATEGORY SAVE FAILED`를 표시한다.

검증용 저장 테스트는 임시 디렉터리 fixture만 사용했다. 실제 `work/category-master.json`은 브라우저 QA에서도 PATCH하지 않았으며 현재 SHA-256은 `e2b4345292c37795212d5320a35c9dee354de03257405e4242a6394e5a8c522a`다.

## 6. UI 위치와 동작

SAMPLAS INTELLIGENCE sidebar의 관리·분석 영역에 `Category Review` 진입점을 추가했다.

- 브랜드 selector 및 brand별 remaining/completed/progress
- 첫 검수 브랜드 PACOSPLY 기본 선택
- model별 Brand, Product Name, Model Code, SKU 수, size/spec, barcode, current stock, classifier failure reason 표시
- category 1회 클릭 → 저장 확인 → 진행률 갱신 → 다음 model
- 보류 → Category Master 미변경, 현재 브라우저 세션에서 다음 model로 이동

## 7. PACOSPLY 검증

로컬 API와 실제 브라우저에서 PACOSPLY `19 MODELS TO REVIEW`, `0 / 19`를 확인했다. 첫 model에서 10개 승인 category 버튼과 보류 버튼이 표시됐다. 보류 후 저장 없이 다음 PACOSPLY model로 이동했다.

## 8. Tests

- Targeted: 29/29 PASS
- Full regression: 685/685 PASS
- JavaScript syntax: PASS
- `git diff --check`: PASS
- Browser console errors: 0
- Browser horizontal overflow: 없음 (`body.scrollWidth = viewportWidth = 1280`)

Covered cases include artifact load, brand/model grouping preservation, taxonomy validation, manual save, member SKU resolution, automatic classification regression, hold no-write, invalid category/model rejection, persistence reload, PACOSPLY 19 models, and APGUJEONG/VAIL reconciliation.

## 9. Canonical regression

- APGUJEONG: 97,177,900원 PASS
- VAIL: 70,200원 PASS
- PACOSPLY: 70,200원 PASS
- canonical sales calculation 변경: 없음
- Today / Monthly / Annual / Clients / Commerce / Brand Intelligence / Store Intelligence revenue 로직 변경: 없음

## 10. 이번 작업 변경 파일

- `intelligence-service.mjs`
- `outputs/samplas-marketing-os.html`
- `outputs/samplas-marketing-os.js`
- `outputs/samplas-marketing-os.css`
- `scripts/category-review.mjs` (new)
- `test/category-review.test.mjs` (new)
- `docs/reports/CATEGORY-MASTER-MANUAL-REVIEW-WORKSPACE.md` (new)

기존 dirty working tree의 unrelated 변경은 보존했다. Commit, push, deploy는 수행하지 않았다.

## 11. VEIL 연결 상태

Category Master의 model assignment는 product code가 있는 Product/Brand category resolution에서 공통으로 사용된다. 현재 VEIL offline Category 경로의 line에는 product code가 없는 경우가 있어, 70,200원 매출은 이번 작업에서 임의 category로 분류하지 않았다. 이 연결은 별도 Store Category pipeline 작업이 필요하다.

## 사용자 검수 방법

1. 로컬 SAMPLAS INTELLIGENCE를 열고 sidebar의 `Category Review`를 선택한다.
2. 브랜드가 `PACOSPLY`, 진행률이 `0 / 19`, 대상이 `19 MODELS TO REVIEW`인지 확인한다.
3. model 정보와 10개 category 버튼이 표시되는지 확인한다.
4. 확실하지 않은 model에서 `보류`를 눌러 저장 없이 다음 model로 이동하는지 확인한다.
5. 확정 가능한 model에서 category를 한 번 선택하고, 성공 후 진행률 증가 및 다음 model 이동을 확인한다.
