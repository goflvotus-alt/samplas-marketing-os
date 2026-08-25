# Price Audit SAFE10 — Final Validation & Production Sync — 2026-08-25

## 1. SAFE10 목적

`work/product-registry.json`에서 `status: "unmatched"`(Price Audit
`MATCH_REQUIRED`) 상태였던 항목 중, source 데이터(Cafe24 카탈로그 + ECOUNT 전체
품목 마스터)만으로 안전하게(fuzzy matching 없이) ECOUNT SKU family를 확정할 수
있는 Cafe24 상품 10건을 골라 registry에 confirmed로 반영하는 배치.

## 2. SAFE10 Targets (10건)

| Cafe24 productNo | Cafe24 상품명 | 브랜드 | ECOUNT family | 가격 |
|---|---|---|---|---|
| 11839 | ribbon Embroidery Cutout Cargo Pants Onyx | RUIBUILT | RUI253BT00102/03/04 (S/M/L) | 618,000 |
| 11840 | Ribbon Tank Top Chocolate | RUIBUILT | RUI253ST00301/02 (1/2) | 348,000 |
| 10178 | UNISEX STRAWBABIES BUTTON DOWN SHIRT WOVEN BLUE | SKY HIGH FARMS | SKY251SH00102/04 (S/L) | 528,000 |
| 7705 | WORLD IS BURNING T-SHIRT | SKY HIGH FARMS | SKY243ST00103/04/05/06 (M/L/XL/XXL) | 258,000 |
| 7706 | WORLD IS BURNING WORK SHIRT | SKY HIGH FARMS | SKY243SH00202/03 (S/M) | 568,000 |
| 12388 | Heavy Zip-up Hoodie Dark Grey | THE PROUDER | THE253OT00403/04/05 (M/L/XL) | 198,000 |
| 5547 | Optical illusion dot-wave artwork color block hoodie | UMAMIISM | UMA243HD01001-05 (XS-XL) | 198,000 |
| 5550 | Wrinkled coated fabric half closure pullover jacket | UMAMIISM | UMA243OT00902-05 (S-XL) | 278,000 |
| 11519 | Feline Airbrush Cardigan Grey | YUEQI QI | YUE253LT00303/04 (M/L) | 378,000 |
| 11520 | Feline Airbrush Knit Hood Cream | YUEQI QI | YUE253OT00102/03/04 (S/M/L) | 558,000 |

총 10개 Cafe24 상품 / 30개 ECOUNT SKU.

## 3. REVIEW Exclusions (SAFE10에서 제외, 자동 매칭 금지)

```
12858, 11841, 10417, 10423, 10442
```

이유: 이름이 exact여도 동일 브랜드 내 경쟁(competing) family가 존재해 자동
확정이 안전하지 않다고 판단됨. 실제 데이터로 재검증한 결과 5건 중 3건(12858,
11841, 10423)은 Cafe24 카탈로그에 완전히 동일한 상품명을 가진 다른 productNo가
실제로 존재함을 확인(예: 12858 "Cutout top Onyx" ↔ 14697도 동일 이름). 나머지
2건(10417, 10423)은 이번 검증에서 Cafe24 이름 충돌로는 재현되지 않았으나(다른
근거, 예: ECOUNT 측 family 충돌일 가능성), registry에서 여전히 unmatched로
남아 SAFE10에 포함되지 않았음을 확인.

## 4. Source Revalidation (10/10, 실제 source 기준 독립 재검증)

각 10건에 대해 아래를 실제 데이터에서 직접 확인(추정 없음):
- Cafe24 productNo 존재, 상품명, 브랜드, 정상가(`price`/`retail_price`) — `work/cafe24-full-catalog.json`
- 제시된 ECOUNT prodCd 전부 존재, 상품명(PROD_DES), 출고가(OUT_PRICE) — `work/ecount-inventory/full-products-candidate.json`
- family 완전성: 해당 prefix로 ECOUNT 마스터 전체를 스캔해 "제시된 SKU 목록 = 실제 존재하는 전체 목록"임을 확인(누락/추가 SKU 없음), 10/10 전부 일치
- 경쟁 family 여부: 동일 브랜드 내 near-duplicate 상품명 검색 — 10/10 전부 0건(경쟁 없음)
- registry 기존 상태: 10/10 전부 `status: "unmatched", verified: false, evidence: []`(적용 전 시점 기준)
- prodCd ownership: 전체 registry 대상 collision 검사 결과 10/10 전부 0건
- Cafe24/ECOUNT 가격 완전 일치(10/10)

### YUEQI QI ↔ YUE QIQI

- Cafe24 측 productNo 11519/11520의 `brand_code`: `B00000XM` (canonical name: `YUEQI QI`)
- ECOUNT 측 PROD_DES: `"YUE QIQI / ..."`
- `work/brand-master.json`의 실제 레코드:
  ```json
  {
    "brand_code": "B00000XM",
    "brand_name": "YUEQI QI",
    "name_aliases": ["YUE QIQI"],
    "active": true
  }
  ```
- 즉 "YUE QIQI"는 이미 brand-master.json에 YUEQI QI의 공식 `name_alias`로 등록되어 있던 **기존 근거**이며, 추측 없이 이 레코드를 직접 확인해 사용함. registry entry의 evidence에도 `brand_alias_yueqi_qi_yue_qiqi_verified`가 별도로 명시되어 있음.

## 5. Registry Before → After

```
entries:   3596 → 3596
verified:  382  → 392
confirmed: 382  → 392
unmatched: 179  → 169
```

Provenance evidence count (registry 전체):
```
price_audit_safe24: 24 (보존, 변화 없음)
price_audit_safe20: 20 (보존, 변화 없음)
price_audit_safe10: 10 (신규)
```

## 6. Implementation

script: `scripts/apply-price-audit-safe10-registry-matches.mjs`

안전장치(코드 직접 검수로 확인):
- target 정확히 10개(`assert(targetProductNos.length === 10)`)
- SKU 정확히 30개, 중복 없음(`assert(targetCodes.length === 30 && new Set(targetCodes).size === 30)`)
- REVIEW_EXCLUSIONS(5건)가 SAFE10에 절대 들어가지 않도록 명시적 assert
- preflight: registry_entry_missing/already_verified/already_linked/master_sku_missing/existing_owner/invalid_price/non_uniform_price/intra_batch_collision 전부 수집 후 0건일 때만 진행
- ownership collision guard(registry 전체) + intra-batch collision guard(배치 내부)
- atomic temp-write/rename(임시 파일 작성 후 재파싱 검증 → rename)
- 적용 직전 backup 자동 생성(`work/product-registry.json.backup-safe10-2026-08-23T10-46-32-234Z`)
- `--apply` 플래그 없으면 dry-run만 수행, 파일 쓰기 없음
- `BASELINE_SHA256` 고정 해시로 registry가 예상 상태와 정확히 일치할 때만 실행 허용
- non-target entry는 `assert(JSON.stringify(entry) === JSON.stringify(entries[index]))`로 완전 불변 보장
- SAFE24(24건)/SAFE20(20건) provenance 개수가 그대로 유지되는지도 사후 assert

## 7. Commit

```
hash:    65d6fffe7dcdc47da8c0ba1775d97d8a4ccd1ed0
message: fix(price-audit): confirm safe10 product matches
files:   scripts/apply-price-audit-safe10-registry-matches.mjs (신규), work/product-registry.json
push:    완료 (1b1492d..65d6fff  main -> main)
```

## 8. Price Audit Regeneration

공식 경로: `node scripts/build-price-audit.mjs` (전체 registry 대상 full run, `--limit` 없음). 이 스크립트는 `work/price-audit.json`만 쓰며, registry/brand 파일은 read-only로만 사용(자체 헤더 주석으로 확인).

```
generatedAt: 2026-08-25T02:40:11.541Z
```

| | MATCH | ECOUNT_HIGHER | ECOUNT_LOWER | MATCH_REQUIRED | REVIEW_REQUIRED | total |
|---|---|---|---|---|---|---|
| Before | 2977 | 65 | 43 | 179 | 332 | 3596 |
| After | 2977 | **75** | 43 | **169** | 332 | 3596 |

Conservation 검산: `2977 + 75 + 43 + 169 + 332 = 3596` ✅

## 9. Why SAFE10 Became ECOUNT_HIGHER, Not MATCH

10건이 예상했던 `MATCH`가 아니라 전부 `ECOUNT_HIGHER`로 분류된 원인을 raw Cafe24
Admin API를 직접 재호출해 규명했다.

| productNo | 정가(retail) | Cafe24 live `pc_discount_price` | 할인율 |
|---|---|---|---|
| 11839 | 618,000 | 309,000 | 50% |
| 11840 | 348,000 | 174,000 | 50% |
| 10178 | 528,000 | 79,200 | 85% |
| 7705 | 258,000 | 12,900 | 95% |
| 7706 | 568,000 | 28,400 | 95% |
| 12388 | 198,000 | 79,200 | 60% |
| 5547 | 198,000 | 39,600 | 80% |
| 5550 | 278,000 | 55,600 | 80% |
| 11519 | 378,000 | 113,400 | 70% |
| 11520 | 558,000 | 167,400 | 70% |

10/10 전부 `GET /api/cafe24/products/{no}/discountprice`(Cafe24 Admin API,
`server.mjs:2487`가 호출하는 `https://{mallId}.cafe24api.com/api/v2/admin/products/{no}/discountprice`)를
직접 재호출해 위 값을 재현했고, `pc_discount_price === mobile_discount_price`
(app_discount_price는 null)로 채널 간 불일치도 없었다. **parsing bug가
아니었다** — 이 10개 상품이 실제로 이 순간 정가 대비 50~95% 할인된 채로 일반
고객에게 공개 판매 중이라는 사실을 그대로 반영한 결과다. 이 Admin API는
customer_group/coupon 파라미터를 받지 않으므로 회원등급/쿠폰 조건부 가격이
아니라 상품 자체에 설정된 공개(global) 할인가임을 구조적으로 확인했다.

## 10. Price Semantics

`scripts/build-price-audit.mjs`의 `effectiveCafe24Price()`는:

```
salePrice = pc_discount_price ?? mobile_discount_price ?? product.price ?? retail_price
```

순으로 "Cafe24 실제 판매가"를 계산하며, 이 폴백 체인은 `intelligence-service.mjs`의
`resolveCommercialPolicyOnlinePrice()`가 이미 쓰고 있던 것과 완전히 동일한
공식이다(파일 자체 헤더 주석에도 명시됨 — 이번에 새로 만든 계산식이 아님).
즉 Price Audit은 정가끼리가 아니라 "ECOUNT 출고가 vs Cafe24 현재 실제 판매가"를
비교하도록 설계되어 있고, `ECOUNT_HIGHER 75`(SAFE10의 10건 포함)는 이 설계
의도대로 정확히 동작한 결과다.

## 11. Render Sync

`work/price-audit.json`은 `.gitignore`의 `work/` 규칙에 걸리는 generated
artifact로, git commit 대상이 아니다(SAFE18/SAFE20 커밋 이력에도 포함된 적
없음을 확인).

```
node scripts/upload-work-snapshots-to-render.mjs --dry-run price-audit.json
→ {"dryRun": true, "files": ["price-audit.json"]}   (대상 1개만, 다른 snapshot 없음)

node scripts/upload-work-snapshots-to-render.mjs --overwrite price-audit.json
→ {"ok": true, "overwrite": true, "uploaded": ["price-audit.json"]}
```

Production `GET /api/intelligence/price-audit` 직접 확인:

```
generatedAt: 2026-08-25T02:40:11.541Z
summary: {MATCH: 2977, ECOUNT_HIGHER: 75, ECOUNT_LOWER: 43, MATCH_REQUIRED: 169, REVIEW_REQUIRED: 332}
```

Local과 `generatedAt`까지 완전히 동일 — production이 최신 snapshot을 실제로
서빙 중임을 확인.

## 12. Final Status

```
SAFE10: COMPLETE — COMMITTED, PUSHED, REGENERATED, RENDER SNAPSHOT VERIFIED
```
