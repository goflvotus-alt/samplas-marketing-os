# CATEGORY MASTER — DETERMINISTIC RULES AND SUBCATEGORY (2026-08)

## 변경 목적

2026-08 실사용 재고 검수를 통해 확정된 SAMPLAS Category Master v1 분류 규칙을 반영한다:
1. 분류 우선순위를 `manual override → name rule → ECOUNT suffix → UNCLASSIFIED`에서
   `manual override → 개별 모델/상품 예외 → 확정 suffix/브랜드 내부 품번 → 상품명
   tail-first → UNCLASSIFIED`로 바꾼다.
2. 이전에 결정론적이지 않다고 판단해 비활성화했던 ECOUNT suffix(ST/LT/HD/DR/AC/ACC)를
   재검수를 거쳐 활성화한다.
3. subcategoryCode(소분류)를 기존 호환성을 깨지 않는 방식으로 추가한다.
4. Category Review(감사 스크립트)와 실제 Brand Intelligence 런타임이 서로 다른 규칙
   사본을 써서 결과가 어긋날 위험을 줄인다.
5. 결제/운영 편의성 라인(할인, 퀵비 등)을 분류/검수 대상에서 제외한다.

## 기존 문제

- `classifyEntityProductCategory()`가 이름 규칙을 suffix보다 먼저 확인해, 실사용
  규칙(확정 suffix가 이름 규칙보다 신뢰도가 높은 경우가 많음)과 어긋났다.
- 이름 키워드 매칭이 "정확히 1개 카테고리만 매칭"을 요구해 `SCAR BOOT CUT PANTS`처럼
  서술어(BOOT)와 실제 품목(PANTS)이 함께 매칭되는 실제 상품명에서 전부 UNCLASSIFIED로
  떨어졌다.
- AC/LT/ST/DR suffix가 "결정론적이지 않다"는 이유로 비활성화되어 있었으나, 2026-08
  재고 전수 검수 결과 명확한 공식이 확정됐다(사용자 확인 완료).
- RESURRECITON 13은 바코드 suffix가 항상 `RES`로 잡혀 카테고리 판단에 전혀 쓸 수
  없었는데, 별도 처리 로직이 없었다.
- `scripts/audit-product-identity-category-compression.mjs`(감사/Category Review용)와
  `outputs/samplas-marketing-os.js`(실제 Brand Intelligence 런타임)가 각자 독립된 규칙
  사본을 갖고 있어 정합성이 보장되지 않았다.
- 결제 편의 라인(`00000`/`00001`/`00002`/`A0001`/`MAKE001`/`QQQ00262`)이 실제 상품과
  함께 감사/분류 대상에 섞여 있었다.

## 변경 파일

| 파일 | 종류 | 내용 |
| --- | --- | --- |
| `scripts/category-classification-rules.mjs` | 신규 | 분류 정책의 Node 쪽 정본(canonical). `scripts/audit-product-identity-category-compression.mjs`가 직접 import한다. |
| `scripts/audit-product-identity-category-compression.mjs` | 수정 | 자체 보유하던 `keywordRules`/`suffixMap`/`classify()`를 제거하고 위 공용 모듈을 사용하도록 교체. 제외 코드 필터링 추가. |
| `outputs/samplas-marketing-os.js` | 수정 | `CATEGORY_NAME_KEYWORD_RULES`/`CATEGORY_ECOUNT_SUFFIX_MAP`/`matchCategoryByNameKeywords`/`ecountCategorySuffixFromProdCd`/`classifyEntityProductCategory`를 새 정책으로 교체하고, RESURRECITON 13 내부 품번·개별 예외·subcategoryCode 지원을 추가. 브라우저 plain `<script>`라 위 공용 모듈을 import할 수 없어 동일 로직을 손으로 이식(정합성은 아래 parity 테스트로 검증). `CATEGORY_MASTER_V1`(대분류 taxonomy)은 손대지 않음. UI/DOM/디자인은 전혀 변경하지 않음. |
| `work/category-unclassified-model-audit.json` | 재생성 | 새 규칙으로 감사 재실행(아래 "구현 후" 참고). `work/backups/category-unclassified-model-audit.json.pre-2026-08-15-rules-update.bak`에 이전 상태 백업. |
| `test/brand-intelligence-category-master.test.mjs` | 수정 | 새 우선순위/subcategory/RESURRECITON 13/tail-first/false-positive-guard/개별예외 테스트 추가, AC/LT/ST/DR "비활성" 기대를 "활성" 기대로 교체. |
| `test/category-review.test.mjs` | 수정 | 감사 재생성 후 실제 숫자(1342 → 6)에 맞게 갱신, PACOSPLY 보존 테스트·제외 코드 테스트 추가. |
| `test/brand-intelligence-customer-purchase-detail.test.mjs` | 수정 | `matchCategoryByNameKeywords`가 내부적으로 새로 호출하는 `matchCategoryByNameKeywordsDetailed` 의존성을 추출 목록에 추가(동작 자체는 변경 없음). |
| `test/category-classification-parity.test.mjs` | 신규 | 감사 스크립트(Node 정본)와 런타임 브라우저 사본이 동일한 fixture 집합에 대해 동일한 결과를 내는지 교차 검증. |

`scripts/category-review.mjs`(PATCH 저장 파이프라인), UI/디자인, canonical sales/inventory
계산 로직은 전혀 수정하지 않았다.

## 분류 우선순위 (신규)

```
1) manual override        — work/category-master.json manualOverrides/modelAssignments
2) 개별 모델/상품 예외      — 재고 검수로 확정된 브랜드·모델 단위 override (전역 규칙 아님)
3) 확정 ECOUNT suffix       — 또는 RESURRECITON 13 내부 품번(이 브랜드만)
4) 상품명 tail-first 키워드 — 매칭된 키워드 중 상품명에서 가장 뒤(tail)에 있는 것이 승리
5) UNCLASSIFIED
```

이전 정책(`override → name rule → suffix → UNCLASSIFIED`)에서 순서가 바뀐 점: 확정
suffix/브랜드 내부 품번이 이름 규칙보다 우선하도록 변경했다.

## Suffix 공식 (확정)

| Suffix | 대분류 | 소분류 |
| --- | --- | --- |
| ST | TOP | SHORT_SLEEVE |
| LT | TOP | LONG_SLEEVE |
| HD | TOP | HOODIE |
| SH | TOP | SHIRT |
| BT | BOTTOM | BOTTOM |
| OT | OUTER | OUTER |
| AC / ACC | ACCESSORY | ACCESSORY |
| HW | HEADWEAR | HEADWEAR |
| FW | FOOTWEAR | FOOTWEAR |
| JW | JEWELRY | JEWELRY |
| DR | DRESS | DRESS |
| BG | BAG | BAG |

**예외**: `424` / `ALIVEFORM` / `ADIDAS X AVAVAV` 브랜드는 AC/ACC suffix를 신뢰하지 않는다
(재고 검수 결과 이 세 브랜드의 AC-suffix 상품 다수가 실제로는 FOOTWEAR/BAG인데 소스
데이터가 AC로 잘못 코딩된 것으로 확인됨). 이 브랜드는 AC suffix를 만나면 규칙 3단계를
건너뛰고 4단계(이름)·2단계(개별 예외)로 넘어간다. **다른 모든 브랜드의 AC 공식 자체는
그대로 유효하다** — 무효화하지 않았다.

## Subcategory 구조

기존 `code`(대분류) 사용처는 전혀 변경 없이 그대로 동작한다. `classifyEntityProductCategory()`
의 반환값에 `subcategoryCode` 필드를 추가로 채워 넣었다(예: `{ code: "TOP", subcategoryCode:
"LONG_SLEEVE", source: "ecount_suffix" }`). `entitySkuRows`에도 `categorySubcategoryCode`
필드를 추가로 실었다(기존 UI/렌더링은 이 필드를 참조하지 않으므로 화면 변화 없음).

매칭된 키워드가 표준 소분류(`SHORT_SLEEVE`/`LONG_SLEEVE`/`HOODIE`/`SHIRT`/`DRESS`/`BAG`/
`UNDERWEAR`/`SWIMWEAR`/`OVERALL`/`SET_UP` 등)에 명확히 대응하는 경우만 채우고, 대응이
불분명한 세부 품목(CARDIGAN/SWEATER/TANK 등)은 대분류만 반환한다 — 근거 없이 소분류를
만들어내지 않았다.

## RESURRECITON 13 내부 품번 규칙

이 브랜드는 POP/QQQ 바코드 끝 suffix가 항상 `RES`로 잡혀 카테고리 판단에 쓸 수 없다.
상품명 안의 내부 품번(`25-T090`, `24-B008`, `25-O004`, `25-AC001` 형태)을 정규식
`\b(\d{2})-([A-Za-z]{1,3})(\d+)\b`으로 읽어 `T→TOP`, `B→BOTTOM`, `O→OUTER`, `AC→ACCESSORY`로
매핑한다. 이 브랜드일 때만 적용되며, 다른 브랜드의 우연한 패턴 일치는 무시한다. 실 데이터
181건 중 180건이 이 패턴으로 해석되며, 나머지 1건("beanie")은 이름 규칙으로 자동 해결된다.

## 상품명 tail-first 규칙

매칭된 카테고리 키워드가 여러 개면(예: `SCAR BOOT CUT PANTS`에서 BOOT=FOOTWEAR와
PANTS=BOTTOM이 동시 매칭) 상품명에서 **가장 뒤에 위치한 키워드**가 승리한다(실제 명명
관행: 서술어가 앞, 진짜 품목명이 뒤). 완전한 동률(같은 끝 위치)이면 여전히 추측하지 않고
UNCLASSIFIED로 넘어간다.

키워드 경계 매칭은 `\b`(ASCII `\w` 전용이라 한글에서 전혀 동작하지 않음) 대신 유니코드
인식 lookahead/lookbehind(`(?<![\p{L}\p{N}])...(?![\p{L}\p{N}])`)를 써서 `SHIRRING` 안의
`RING`, `HORSESHOE` 안의 `SHOE` 같은 부분 문자열 오검출을 막았다. 순수 한글 키워드(후드,
집업 등)는 한국어 압축 복합어(후드집업=후드+집업, 공백 없음) 특성상 경계 매칭이 원천적으로
실패하므로 의도적으로 무경계 부분 문자열 매칭을 쓴다 — 이 카탈로그의 통제된 소수 한글
용어에서는 오검출 위험이 낮다고 판단했다(향후 대규모 한글 카탈로그가 생기면 형태소 분석기
도입을 검토해야 한다).

**의도적으로 추가하지 않은 키워드**: 사용자가 제시한 명세는 JEWELRY 키워드에 `CHAIN`(단독)을
포함했으나, 실 데이터 검증 결과 `CARNET ARCHIVE / Black Plastic bag on Chain...`처럼 "bag"이
"Chain"보다 앞에 나오는 진짜 가방 상품이 있어, `chain`을 단독 키워드로 추가하면 tail-first
로직상 이 상품들이 JEWELRY로 잘못 뒤집힐 위험이 확인됐다. 이 회귀를 막기 위해 `chain` 단독
키워드는 추가하지 않았다(`necklace`/`bracelet`/`chain jewelry` 등 다른 키워드와 함께
나오는 경우는 정상 분류됨). 이로 인해 `Unearthed Fragment Chain`(2건)과 `Moneyclip
Chain`(1건)은 UNCLASSIFIED로 남는다 — 아래 "남은 수동 review 목록" 참고.

## 개별 확정 예외

전역 규칙으로 일반화하지 않고 브랜드+상품명 단위로 51건의 개별 예외를 등록했다(SURGERY
process 006~032, DOMINNICO DOM0235/DOM0006, SUPER POSITION, KIMYO, SUNDAYOFFCLUB,
604SERVICE, BONNAE, KANGJUNGSEOK, LOADING ROOM, RASSVET, CARNET, 그리고 424/ALIVEFORM/
ADIDAS X AVAVAV의 AC-suffix 미신뢰 브랜드에서 이름만으로 못 푸는 모델들 — 예:
ALIVEFORM `STRATUM RUNNER/DERBY/TALON`, `SPIRALIS OXFORD`, `FLAINE L`, `ARMIS HIGH/LOW`,
`LAPTOP CASE`; ADIDAS X AVAVAV `SST VACUUM`, `BUBBLE GB`, `MEGARIDE`, `BAND SET`,
`KNEESOCKS`). 상세 목록은 `scripts/category-classification-rules.mjs`의
`INDIVIDUAL_MODEL_EXCEPTIONS`에 있다. 원문 오타(`T-shrit`, `Bet`, `Park`, `Torusers`)가
있는 상품명도 실제 문자열 그대로 매칭하도록 했다.

## 제외 대상

`00000`(할인) / `00001`(퀵비-1) / `00002`(퀵비-2) / `A0001`(/ 품목) / `MAKE001`(김욱 이사님
의상 제작건) / `QQQ00262`(카르넷 9 제품) 6개 코드는 실제 상품 identity가 아니므로
`scripts/audit-product-identity-category-compression.mjs`의 감사 대상에서 완전히
제외했다(OTHER로 억지 분류하지 않고, Category Review 검수 목록에도 나타나지 않는다).
이 코드들은 `work/product-registry.json`에 Cafe24 productNo 연결이 전혀 없어 Brand
Intelligence 런타임 경로(`classifyEntityProductCategory`)에는 애초에 도달하지 않는다 —
확인 완료, 런타임 쪽에는 별도 제외 로직을 추가하지 않았다(불필요한 코드 중복 방지).

## 기존 PACOSPLY 승인 보존 여부

**완전히 보존됨.** `work/category-master.json`의 `modelAssignments` 8건(PACOSPLY, 전량
`category_review_manual` 소스)은 이번 작업 전후로 바이트 단위로 동일하다(`diff` 확인
완료). 이 8건은 전량 `LT` suffix 상품이라 새 규칙에서는 suffix만으로도 자동 TOP 분류가
가능해졌지만, manual override/모델 assignment가 항상 자동 규칙보다 우선한다는 원칙은
변경하지 않았다 — `work/category-master.json` 자체를 이번 작업에서 전혀 쓰지 않았다(감사
스크립트는 애초에 이 파일을 읽지 않는다).

부수 효과: 이 8건은 이제 (감사 기준으로도) UNCLASSIFIED가 아니게 되어 Category Review
워크스페이스의 "검수 필요 모델" 목록에서는 더 이상 보이지 않는다(총 리뷰 대상 자체가
줄어든 것 — 승인 데이터 삭제와는 다른 개념이다).

## 구현 후 classified/unclassified 변화

| | 최초(규칙 적용 전) | 1차(규칙 적용 후) | 2차(최종 6개 사용자 확인값 반영 후) |
| --- | --- | --- | --- |
| classifiedSku | 7,726 | 9,988 | **9,994** |
| unclassifiedSku | 2,274 | 6 | **0** |
| unclassifiedUniqueModels (Category Review 검수 대상) | 1,342 | 6 | **0** |

(전체 재고 10,000 SKU 중 제외 대상 6건을 뺀 9,994건 기준. 사용자가 제시한 "가상 적용 시
classified 약 9,374 / unclassified 약 626" 추정치보다 실제 구현 결과가 더 좋다 — tail-first
이름 규칙과 개별 예외가 suffix만으로는 못 푸는 사례까지 추가로 해결했기 때문이다. 2026-08-15
사용자가 마지막 6개를 직접 확인해줘 최종적으로 **전량(9,994/9,994, 100%) 분류 완료**됐다.)

## 2026-08-15 추가 반영: 마지막 6개 UNCLASSIFIED 사용자 확인값

1차 구현 후 남아있던 6개 모델(브랜드 근거 부족으로 정직하게 UNCLASSIFIED 유지)을 사용자가
직접 확인해 아래 값으로 확정했다. 전역 키워드 규칙을 넓히지 않고(예: JEWELRY `chain` 단독
키워드는 여전히 추가하지 않음 — 위 "의도적으로 추가하지 않은 키워드" 참고), 브랜드+상품명
단위의 explicit deterministic exception 3건을 `INDIVIDUAL_MODEL_EXCEPTIONS`에 추가하는
방식으로 처리했다:

| 브랜드 | 상품명 | 확정값 | source |
| --- | --- | --- | --- |
| DOMINNICO | PINK/BLACK/WHITE LACE SLEEVES (3 SKU) | TOP | model_exception |
| CARNET ARCHIVE | Unearthed Fragment Chain RUSTY WHITE / OIL BLACK (2 SKU) | ACCESSORY | model_exception |
| SUNDAYOFFCLUB | Montmartre Cross Moneyclip Chain - Antique Silver (1 SKU) | ACCESSORY | model_exception |

`scripts/category-classification-rules.mjs`와 `outputs/samplas-marketing-os.js`의 손이식
사본 양쪽에 동일하게 추가했고(parity 테스트로 확인), `work/category-unclassified-model-audit.json`
을 재생성해 반영했다. `work/category-master.json`(PACOSPLY 8건)은 이번에도 전혀 건드리지
않았다 — `diff` 확인 결과 바이트 단위로 동일.

**남은 수동 review 대상: 0개.** Category Review 워크스페이스의 `remainingModels`도 0이다.

## 테스트 결과

- `node --test test/*.test.mjs` — **719/719 PASS**, 0 fail (최초 685 → 1차 +30(parity
  19 + category-review 3 + category-master 8) → 2차 +4(최종 6개 확정값 회귀 테스트 1건 +
  parity fixture 3건)).
- `npm run check`(문법 검사) — 통과.
- 신규/보강 테스트가 다루는 항목(요청하신 18개 검증 항목 전체):
  1) manual override 최우선 2) ST→TOP+SHORT_SLEEVE 3) LT→TOP+LONG_SLEEVE
  4) HD→TOP+HOODIE 5) DR→DRESS 6) AC→ACCESSORY 7) RESURRECITON 13 내부 품번
  8) SCAR BOOT CUT PANTS→BOTTOM 9) HORSESHOE 오인 방지 10) SHIRRING 오인 방지
  11) SKIN-OFF SHIRT JACKET→OUTER 12) HOODIE→TOP 13) ZIP-UP/집업→OUTER
  14) UNDERWEAR/SWIMWEAR/OVERALL/SET_UP→OTHER 15) 제외 코드가 Category Review에
  재등장하지 않음 16) PACOSPLY modelAssignments 보존 17) invalid PATCH가 Category
  Master를 변경하지 않는 기존 안전성 유지(기존 테스트 그대로 통과) 18) 감사 스크립트/
  런타임 정합성(parity 테스트 22건, 최종 확정값 3건 포함).

## rollback 방법

1. **감사 아티팩트**: 두 시점의 백업이 있다 —
   `work/backups/category-unclassified-model-audit.json.pre-2026-08-15-rules-update.bak`
   (규칙 적용 직전, unclassified 1342), `work/backups/category-unclassified-model-audit.json.pre-2026-08-15-final6-exceptions.bak`
   (마지막 6개 확정값 반영 직전, unclassified 6). 원하는 시점의 파일을
   `work/category-unclassified-model-audit.json`로 복사하면 그 상태로 복원된다.
2. **category-master.json**: 이번 작업에서 전혀 수정하지 않았으므로 rollback 대상 아님
   (참고용 백업만 `work/backups/category-master.json.pre-2026-08-15-rules-update.bak`에 저장).
3. **코드**: git으로 추적되는 파일(`outputs/samplas-marketing-os.js`,
   `test/brand-intelligence-category-master.test.mjs`,
   `test/brand-intelligence-customer-purchase-detail.test.mjs`)은 `git checkout --
   <path>`로 즉시 되돌릴 수 있다. `scripts/category-classification-rules.mjs`,
   `test/category-classification-parity.test.mjs`는 이번에 새로 만든 파일이라 삭제하면
   된다. `scripts/audit-product-identity-category-compression.mjs`,
   `test/category-review.test.mjs`는 이번 세션 이전부터 이미 git 미추적 상태였으므로,
   되돌리려면 이 리포트의 "변경 전" 코드 스냅샷(이 대화 로그) 또는 별도 백업이 필요하다 —
   원하시면 되돌리기 전에 지금 상태를 파일로 백업해 드릴 수 있다.
4. 어느 경우든 **git이 추적하는 파일은 커밋하지 않았으므로 `git status`/`git diff`로
   언제든 확인 가능한 상태**를 유지했다.

## COMMIT 여부

**커밋하지 않았습니다.**
