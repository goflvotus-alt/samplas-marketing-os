# BATCH 11 — NO_CANDIDATE Source Recovery / Product Universe Completeness

## A. Baseline

- Repository: `/Users/binggu/Dropbox/SAMPLAS WORK/INTELLIGENCE/SAMPLAS Marketing OS DEV`
- Branch: `main`
- Starting HEAD / origin: `552cb737a2a68b15d4debc3b1f5943619724c543`
- Starting tracked state: clean; unrelated untracked baseline: 142 (preserved)
- Product Registry: 3,596 total, 566 verified
- Price Audit: MATCH 2,977; ECOUNT_HIGHER 200; ECOUNT_LOWER 91; MATCH_REQUIRED 169; REVIEW_REQUIRED 159
- Matcher unresolved: 328 (SAFE_REVIEW 29; AMBIGUOUS 42; NO_CANDIDATE 244; DATA_ISSUE 13)

## B. NO_CANDIDATE universe

All 244 BATCH 10 NO_CANDIDATE rows were inspected, not sampled. Every row had a Cafe24 `product_no`, and all 244 were present in the 9,692-product persisted full-catalog evidence. Therefore Cafe24 pagination/filter loss for this set was zero.

## C. Root-cause clusters

| Root Cause | Count | Recoverable? | Resolution | Risk |
|---|---:|---|---|---|
| SPECIAL_PRODUCT_TYPE | 109 | No normal match | Preserve personal-payment/operational records unresolved | Low |
| BRAND_ATTRIBUTION_FAILURE | 58 | Yes, candidate visibility | Reuse canonical Brand Master name/aliases | Low; existing matcher gates remain |
| CAFE24_INACTIVE_OR_HISTORICAL | 12 | No automatic mapping | Preserve display-off/selling-off items unresolved | Low |
| PRODUCT_NAME_IDENTITY_FAILURE | 43 | Review only | Existing candidates do not have an exact safe title identity | Medium |
| TRUE_NO_COUNTERPART | 22 | No current evidence | Keep unresolved; no forced fuzzy match | Low |
| **Total** | **244** |  |  |  |

## D. Cafe24 universe completeness

- Persisted full-catalog evidence: 9,692 unique products, 97 pages, no display/selling filter.
- Live BATCH 11 Price Audit catalog: 9,793 products, 98 pages, `partial_page` termination.
- Product Registry: 3,596 Cafe24 product numbers.
- Live catalog resolved 3,592 Registry products locally; four missing entries used the existing detail fallback.
- ECOUNT full master: 13,387 SKUs (`ecount-range-union`).
- The 244-row source gap was not Cafe24 absence. It was predominantly special product policy plus Brand Master aliases not being visible to Autonomous Matcher V1.

## E. Request-graph / performance forensic

BATCH 10's 6,854 calls were deterministic: 3,427 ECOUNT-linked Registry products × two Cafe24 calls (product detail + discount price). The detail response is catalog-cacheable; the discount endpoint remains required for the effective online sale price.

The new path fetches the complete Cafe24 catalog once, indexes it by `product_no`, and reuses it for product price/display/selling. It calls individual detail only when a Registry product is absent from the live catalog. Discount price remains sequential with existing retry and 100 ms pacing; concurrency was intentionally not increased.

## F. Source recovery implementation

- `scripts/autonomous-product-matcher.mjs`: seeds the existing trusted brand-alias map with active `work/brand-master.json` `brand_name` and `name_aliases`, then adds aliases learned from confirmed Registry entries.
- `scripts/build-price-audit.mjs`: reuses `fetchAllCafe24ProductsFullCatalog()`, builds a local `product_no` map, retains failure-safe detail fallback, and records request provenance in `requestStats`.
- No new cache file, framework, matching threshold, or fuzzy rule was added.

## G. Candidate recovery results

Former NO_CANDIDATE 244 disposition:

- AUTO_SAFE: 29
- SAFE_REVIEW: 23
- AMBIGUOUS: 5
- DATA_ISSUE: 1
- still NO_CANDIDATE: 186

Recovered candidate visibility: 58. Only the 29 existing AUTO_SAFE decisions were applied. Human-confirmed mappings were not overwritten.

## H. Autonomous Matcher rerun

- Pre-apply backtest: evaluated 563; AUTO_SAFE 163; correct 163; false positives 0; abstained 400.
- Applied: 29.
- Post-apply idempotency: `applied=0` on repeat.
- Final Registry: 3,596 total; 595 verified (+29).
- Final unresolved: 299 (SAFE_REVIEW 52; AMBIGUOUS 47; NO_CANDIDATE 186; DATA_ISSUE 14).

## I. Backtest

Post-apply backtest evaluated 592 verified mappings: AUTO_SAFE 163; correct 163; wrong 0; abstained 429; precision 1.0. Candidate visibility increased without weakening any BATCH 10 gate.

## J. Price Audit before/after

| Status | Before | After | Delta |
|---|---:|---:|---:|
| MATCH | 2,977 | 2,977 | 0 |
| ECOUNT_HIGHER | 200 | 228 | +28 |
| ECOUNT_LOWER | 91 | 92 | +1 |
| MATCH_REQUIRED | 169 | 169 | 0 |
| REVIEW_REQUIRED | 159 | 130 | -29 |

Unresolved fell from 328 to 299 (-29).

## K. Performance before/after

- Before: approximately 6,854 requests; 1+ hour observed in BATCH 10.
- After: 3,529 requests; 32m 42.8s.
- Reduction: 3,325 requests (48.5%).
- After breakdown: catalog pages 98; catalog products 9,793; detail fallback 4; discount requests 3,427; fetch errors 0.
- Remaining bottleneck: per-product `discountprice`. Removing it would change effective sale-price correctness; concurrency was not raised without rate-limit evidence.

## L. Tests

- Focused matcher, Brand Master alias, candidate visibility, Price Audit, full-catalog pagination, display/selling inclusion, fallback, and idempotency checks: PASS.
- Full suite: historical 824 total / 822 pass / 2 known failures reproduced; zero new failures.
- Known failures: APGUJEONG/VAIL offline totals fixture and Today Overview markup fixture.

## M. Git / commit

- Implementation: `320ed4d1e36cecd1f39832b41bfda9e65cac6c51` — `feat(price-audit): recover no-candidate source visibility`
- Pushed normally to `origin/main`; no force push, reset, clean, or unrelated staging.

## N. Production sync

Dry-run selected exactly:

- `price-audit.json`
- `product-registry.json`

The same two snapshots were uploaded with explicit overwrite. No Cafe24 catalog/cache or unrelated snapshot was uploaded.

## O. Production verification

The first parity run observed transient Render response gaps during deployment. Direct probes then confirmed recovery, and the identical verifier was rerun.

Final `npm run verify:production`: 13/13 PASS — STATUS, TODAY, MONTHLY CURRENT, HISTORICAL MONTHLY, ANNUAL, CLIENTS, ECOUNT CURRENT MONTH, STORE MASTER, INVENTORY, BRAND REGISTRY, PRODUCT REGISTRY, PRICE AUDIT, FRONTEND.

Verdict: `PRODUCTION BASELINE HEALTHY`.

## P. Remaining unresolved universe

- Total: 299
- SAFE_REVIEW: 52
- AMBIGUOUS: 47
- NO_CANDIDATE: 186
- DATA_ISSUE: 14

These remain intentionally unresolved. Special products, inactive/historical products, title-identity conflicts, ambiguity, and rows without trustworthy counterparts were not auto-confirmed.

## Q. Follow-up opportunities

The only material performance opportunity is a Cafe24-supported bulk/current-discount source or measured safe concurrency for `discountprice`. Do not add either until rate-limit behavior and semantic equivalence are proven.

## R. Verdict

BATCH 11 recovered the real source-visibility gap at the narrowest layer: 58 former NO_CANDIDATE rows gained deterministic candidates, 29 passed unchanged AUTO_SAFE gates, verified mappings increased by 29, false positives remained zero, request volume fell 48.5%, and Production returned to 13/13 healthy parity.
