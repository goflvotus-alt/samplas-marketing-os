# Cafe24 ↔ ECOUNT Product Matching Diagnostic

Generated artifact:

`work/cafe24-ecount-product-matching-diagnostic.json`

This phase is read-only. It does not update Cafe24, ECOUNT snapshots, product cache, registry, UI, or operational APIs.

## Data Sources

| Source | Path | Count |
| --- | --- | ---: |
| Cafe24 Product Dashboard cache | `work/product-dashboard-proxy-2026-06-24_2026-07-18.json` | 177 |
| ECOUNT inventory normalized cache | `work/ecount-inventory/latest.json` | 10,000 |
| Brand registry / aliases | `work/brand-master.json`, `work/intelligence/brand-master-list.json`, `work/intelligence/brand-aliases.json` | reused |

Cafe24 barcode-like fields are not available in the inspected cache/API path, so ECOUNT `BAR_CODE` is preserved as evidence but not used as an exact Cafe24 matching key.

## Matching Policy

Priority used by the diagnostic:

1. normalized brand + normalized product name exact
2. normalized brand + normalized product name with manufacturer/supplier/product code as auxiliary evidence only
3. normalized brand + product-name token similarity
4. Cafe24 `product_code` is retained for traceability, not treated as ECOUNT barcode

Normalization:

- trim leading/trailing spaces
- collapse repeated spaces
- normalize Unicode with NFKC
- uppercase Latin text
- normalize common separators such as `-`, `_`, `/`, `·`
- split Cafe24 bracket brand tokens such as `[BRAND : 브랜드명]`
- remove bracketed product annotations from product-name matching
- remove size/color/option-like suffix tokens conservatively
- preserve original raw strings in every result
- remove only independent ECOUNT `CON` token for comparison; do not remove `CON` inside a word

## Result Metrics

| Metric | Value |
| --- | ---: |
| Cafe24 products | 177 |
| ECOUNT products | 10,000 |
| exact one-to-one | 17 |
| exact one-to-one rate | 0.17% of ECOUNT |
| fuzzy high-confidence | 6 |
| fuzzy high-confidence rate | 0.06% of ECOUNT |
| ambiguous ECOUNT rows | 383 |
| ambiguous rate | 3.83% of ECOUNT |
| unmatched ECOUNT rows | 9,298 |
| unmatched Cafe24 products | 46 |
| QQQ excluded rows | 430 |
| consignment candidates | 12 |

## Classification Counts

| Classification | Count |
| --- | ---: |
| exact_one_to_one | 17 |
| exact_one_to_many | 249 |
| fuzzy_high_confidence | 6 |
| fuzzy_ambiguous | 205 |
| cafe24_only | 46 |
| ecount_only | 9,286 |
| excluded_qqq | 430 |
| consignment_candidate | 12 |
| unresolved | 0 |

## Key Findings

- Automatic application should not happen in this phase.
- `exact_one_to_one` is the only low-risk future auto-match candidate class, and even that should be reviewed before production registry application.
- `fuzzy_high_confidence` has only 6 rows in the current dataset, fewer than the requested 20 sample rows because only 6 exist.
- Most ambiguity comes from ECOUNT option/size-level rows sharing the same normalized product key while Cafe24 has a product-level row.
- Cafe24 `manufacturer_code` / `supplier_code` did not resolve ambiguity in this run.
- CON handling found 12 independent-token consignment candidates, but CON removal did not create additional exact key matches.
- QQQ produced 430 excluded rows and remains outside automatic matching.
- Brand alias quality is a major blocker. Examples include ECOUNT short/English brand spellings that do not fully resolve to Cafe24 canonical display names.

## Duplicate and Collision Signals

Top duplicate Cafe24 normalized keys:

- `B0000000||이승엽 실장님 개인결제창` count 4
- `B0000000||전예린 실장님 개인결제창` count 2
- `B0000000||주현 실장님 개인결제창` count 2
- `KIMYO||TUXEDO BUTTON SET` count 2

Top duplicate ECOUNT normalized keys:

- `써저리||PROCESS` count 25
- `본네||AT ZIP JACKET` count 18
- `본네||STRAP MICRO SHORTS` count 18
- `본네||BELTED MICRO SHORTS` count 12
- `본네||CORSET SEAM SHIRT` count 12

Same normalized product name with different brand signals was found. Representative causes:

- truncated ECOUNT brand spelling, e.g. `AAH MIDNIGH` vs `AAH MIDNIGHT CLUB`
- English/Korean brand alias gaps, e.g. `BOHEMSEO` vs `보헤미안 서울`
- genuinely same product-name text under different brands, e.g. cargo pants names shared across brands

## Auto vs Review Boundary

Potential later auto candidate:

- `exact_one_to_one`

Human review required:

- `exact_one_to_many`
- `fuzzy_high_confidence`
- `fuzzy_ambiguous`
- `consignment_candidate`
- `ecount_only`
- `cafe24_only`

Do not use `manufacturer_code`, `supplier_code`, or Cafe24 `product_code` alone as confirmed match keys.

## Test

Executed:

- `node --check scripts/diagnose-cafe24-ecount-product-matching.mjs`
- `node --check test/cafe24-ecount-product-matching-diagnostic.test.mjs`
- `node test/cafe24-ecount-product-matching-diagnostic.test.mjs`
- `node scripts/diagnose-cafe24-ecount-product-matching.mjs --sample-limit=20`

The unit test covers independent `CON` removal, non-removal of embedded `CON`, product-name normalization, ECOUNT brand/name split, and token similarity.
