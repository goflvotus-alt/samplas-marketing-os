# SAMPLAS Product Registry Phase 1

This phase creates a diagnostic-only Canonical Product Registry from the Cafe24 ↔ ECOUNT matching diagnostic.

It does not connect the registry to production APIs, UI, caches, Cafe24, ECOUNT, inventory, or any existing registry.

## Generated Files

- `scripts/build-product-registry.mjs`
- `test/product-registry.test.mjs`
- `work/product-registry.json`
- `work/product-registry-review-queue.json`

## Input

`work/cafe24-ecount-product-matching-diagnostic.json`

Input diagnostic summary:

- Cafe24 products: 177
- ECOUNT products: 10,000
- `exact_one_to_one`: 17
- `exact_one_to_many`: 249 pair rows
- `fuzzy_high_confidence`: 6 pair rows
- `fuzzy_ambiguous`: 205 pair rows

## Registry Build Policy

Cafe24 product is used as the initial registry anchor.

Verified:

- only `exact_one_to_one`
- `verified = true`
- `confidence = 100`

Review required:

- `exact_one_to_many`
- `fuzzy_high_confidence`
- `fuzzy_ambiguous`

Excluded from Phase 1 registry:

- `ecount_only`
- `cafe24_only`
- `excluded_qqq`
- `consignment_candidate`
- `unresolved`

These rows remain in the matching diagnostic and should be handled by a later review/import phase.

## Schema

Each registry entry includes:

- `canonicalProductId`
- `brandId`
- `brandName`
- `canonicalProductName`
- `status`
- `confidence`
- `verified`
- `cafe24.productNo`
- `cafe24.productCode`
- `cafe24.productName`
- `ecount.matchedProducts[].prodCd`
- `ecount.matchedProducts[].barcode`
- `ecount.matchedProducts[].productName`
- `ecount.matchedProducts[].size`
- `ecount.matchedProducts[].supplier`
- `ecount.matchedProducts[].consignment`
- `matching.strategy`
- `matching.diagnosticType`
- `matching.evidence`
- `matching.pendingReasons`
- `createdAt`
- `updatedAt`

## Results

| Metric | Value |
| --- | ---: |
| Registry entries | 131 |
| Verified entries | 17 |
| Review queue entries | 114 |

Confidence distribution:

| Range | Count |
| --- | ---: |
| 100 | 17 |
| 95-99 | 0 |
| 80-94 | 6 |
| 60-79 | 108 |
| 0-59 | 0 |

Top brand counts:

| Brand | Registry entries |
| --- | ---: |
| 본네 | 20 |
| OURSELVES REMAKE | 16 |
| 나밀리아 | 14 |
| 에프엔케이 스튜디오 | 11 |
| 파코서플라이 | 10 |
| 레이서 월드 와이드 | 7 |
| 아이필럭키 | 5 |
| 레저렉션13 | 4 |

## Review Queue Priority

HIGH:

- exact one-to-many
- fuzzy high-confidence

MEDIUM:

- confidence 80-94 without higher priority rule

LOW:

- confidence below 80

The queue stores recommended candidates with reason, confidence, diagnostic type, and pending reasons.

## Test

Executed:

- `node --check scripts/build-product-registry.mjs`
- `node --check test/product-registry.test.mjs`
- `node test/product-registry.test.mjs`
- `node scripts/build-product-registry.mjs`
- `git diff --check`

## Operational Impact

None.

No Cafe24 data, ECOUNT data, brand registry, inventory, UI, API, or production cache was modified. The generated registry remains offline in `work/` and is not wired into the app.
