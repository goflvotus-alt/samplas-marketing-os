# BATCH 12 — Product Identity Resolution / Ambiguity Reduction

## A. Baseline

- Repository: `/Users/binggu/Dropbox/SAMPLAS WORK/INTELLIGENCE/SAMPLAS Marketing OS DEV`
- Branch: `main`
- Starting HEAD/origin: `45941c6021bc5156a3c9977efcafc97d0cd0616d`; ahead/behind `0/0`
- Starting staged/tracked modified: `0/0`; untracked baseline: 116, preserved
- Registry: 3,596 total; 595 verified; 299 unresolved
- Initial tiers: SAFE_REVIEW 52; AMBIGUOUS 47; NO_CANDIDATE 186; DATA_ISSUE 14
- Initial Price Audit: MATCH 2,977; ECOUNT_HIGHER 228; ECOUNT_LOWER 92; MATCH_REQUIRED 169; REVIEW_REQUIRED 130
- Initial Production: 13/13 PASS

## B. SAFE_REVIEW forensic

All 52 initial SAFE_REVIEW rows were analyzed. Reasons: missing independent exact evidence 46; regenerated family differing from existing candidates 6.

Post-application remaining 50 reconcile as:

| Cluster | Count |
|---|---:|
| Exact unique family, no existing link | 24 |
| Exact family differs from existing set | 18 |
| Exact family overlaps a broader existing set | 7 |
| Exact candidate set but missing title evidence | 1 |
| **Total** | **50** |

The two removed SAFE_REVIEW rows were RESURRECITON 13 `26-AC011 BLACK` and `26-T011 BLACK`. Each had an exact canonical brand, exact complete title, exact strong model/style code, and one current ECOUNT family. Their prior Registry links pointed to `25-*` identities and therefore contained an explicit model contradiction.

## C. AMBIGUOUS forensic

All 47 AMBIGUOUS rows were analyzed. Every row contains multiple exact ECOUNT product families: 38 rows have two families, 8 have three, and 1 has four.

| Cluster | Count |
|---|---:|
| Existing candidate set spans all competing families | 14 |
| Candidate drift across multiple families | 11 |
| Historical/reissue collision, existing link selects one family | 10 |
| No existing link and multiple families | 10 |
| Existing candidate subset across multiple families | 2 |
| **Total** | **47** |

No AMBIGUOUS row was promoted. `US-011 UNBORN SOCIETY PADDED JACKET` demonstrates the guard: the model is exact, but two ECOUNT families remain, so the row stays AMBIGUOUS.

## D. Identity-related NO_CANDIDATE forensic

The 43 BATCH 11 PRODUCT_NAME_IDENTITY_FAILURE rows were revisited. They comprise 25 ECOUNT-price-disagreement rows and 18 low-confidence price-difference rows across 16 brands. None gained an exact trusted brand/title candidate under the structured rule, so all remain terminal NO_CANDIDATE. Special operational rows and true no-counterpart rows were not touched.

## E. Structured identity architecture

The existing matcher pipeline was extended in place:

```text
normalized brand + exact normalized title
  -> conservative strong model/style token extraction
  -> exact model/title candidate set
  -> unique ECOUNT family gate
  -> contradiction checks
  -> AUTO_SAFE or abstain
```

Strong model tokens must contain both letters and digits and an internal hyphen, for example `26-AC011`, `26-T011`, or `US-011`. Plain years, prices, sizes, and season labels such as `25SS` do not qualify. Model evidence never overrides multiple families.

## F. Rule evidence and rejected rules

Verified-registry evaluation showed:

- Exact brand/title + unique family: 562 evaluated, 548 candidate-set correct, 14 wrong — rejected as globally unsafe.
- The same condition with explicit color: 381 evaluated, 375 correct, 6 wrong — no color AUTO_SAFE rule added.
- Exact brand/title + strong model/style code + unique family: 17 evaluated, 17 correct, 0 wrong — accepted.

No color synonym, collaboration-order equivalence, season stripping, size stripping, recency preference, inactive-listing preference, fuzzy title rule, or sequential-family inference was added. Existing exact-title behavior already rejects different colors and reversed collaborations. Reissues and historical duplicates remain ambiguous when families collide.

## G. Implementation

- `scripts/autonomous-product-matcher.mjs`
  - added conservative `extractStrongModelTokens()`;
  - added `trusted_brand_exact_title_model_unique_family` decision;
  - permits replacement of a contradicted/empty candidate set only for this rule;
  - records exact model evidence and negative checks;
  - backtest now measures candidate-code correctness instead of assuming every AUTO_SAFE result is correct;
  - separates identity certainty from Price Audit data-quality status for this rule.
- `test/autonomous-product-matcher.test.mjs`
  - added strong-model extraction, numeric/season noise rejection, candidate replacement, multi-family model ambiguity, and price-data/identity separation checks.
- `work/product-registry.json`
  - updated exactly two entries and their ECOUNT candidate sets/provenance.

## H. Backtest

- Pre-apply trusted mappings: 592
- AUTO_SAFE: 172
- Correct: 172
- False positive: 0
- Abstained: 420
- Post-apply trusted mappings: 594
- AUTO_SAFE: 174
- Correct: 174
- False positive: 0
- Abstained: 420
- Previously AUTO_SAFE downgraded: 0

## I. Resolution transitions

| Transition | Count |
|---|---:|
| SAFE_REVIEW → AUTO_SAFE | 2 |
| SAFE_REVIEW → remains SAFE_REVIEW | 50 |
| AMBIGUOUS → AUTO_SAFE | 0 |
| AMBIGUOUS → SAFE_REVIEW | 0 |
| AMBIGUOUS → remains AMBIGUOUS | 47 |
| NO_CANDIDATE → candidate-bearing | 0 |
| NO_CANDIDATE → remains terminal | 186 |

Applied identities:

- `CP-C24-14559`, `26-AC011 BLACK` → `RES261AC00100`
- `CP-C24-14563`, `26-T011 BLACK` → `RES261ST00102/103/104`

Repeated apply returned `applied=0`.

## J. Price Audit before/after

| Status | Before | After | Delta |
|---|---:|---:|---:|
| MATCH | 2,977 | 2,978 | +1 |
| ECOUNT_HIGHER | 228 | 228 | 0 |
| ECOUNT_LOWER | 92 | 92 | 0 |
| MATCH_REQUIRED | 169 | 169 | 0 |
| REVIEW_REQUIRED | 130 | 129 | -1 |

`26-T011` became MATCH at 85,000 KRW. `26-AC011` remains REVIEW_REQUIRED because Cafe24 price is 0; identity certainty did not erase the price-data issue.

## K. Final Registry / unresolved

- Registry total: 3,596
- Verified: 595 → 597 (+2)
- Unresolved: 299 → 298 (-1; one confirmed identity still has a Price Audit data issue)
- Final tiers: SAFE_REVIEW 50; AMBIGUOUS 47; NO_CANDIDATE 186; DATA_ISSUE 15

## L. Performance

- Requests: 3,529, identical to BATCH 11
- Catalog: 9,793 products / 98 pages
- Detail fallback: 4
- Discount requests: 3,427
- Fetch errors: 0
- Runtime: 45m 02.4s versus BATCH 11's 32m 42.8s; request count did not regress, and the increase is remote latency rather than architecture expansion.

## M. Tests

- Focused matcher/adversarial, Price Audit, and full-catalog tests: PASS
- Idempotency: PASS (`applied=0`)
- Full suite: historical 824 total / 822 pass / 2 known failures; zero new failures
- Known failures: APGUJEONG/VAIL offline totals fixture; Today Overview markup fixture

## N. Git / Production sync

- Implementation/data commit: `8d6c11f` — `feat(price-audit): resolve exact model identities`
- Pushed normally to `origin/main`
- Snapshot dry-run and upload selected exactly `price-audit.json` and `product-registry.json`
- No unrelated snapshot was uploaded

## O. Production verification

The first parity run occurred during Render deployment transition and returned several simultaneous undefined payloads. Direct probes confirmed `/api/status`, historical monthly, and Price Audit recovery. The identical verifier was rerun.

Final `npm run verify:production`: 13/13 PASS. Product Registry parity is 3,596 exact entries; Price Audit parity is MATCH 2,978 / ECOUNT_HIGHER 228 / ECOUNT_LOWER 92 / MATCH_REQUIRED 169 / REVIEW_REQUIRED 129. Verdict: `PRODUCTION BASELINE HEALTHY`.

## P. Terminal categories and follow-up

The remaining 47 multi-family collisions require external identity evidence such as a trusted product-family relation, listing lineage, or human review. The 43 identity-related NO_CANDIDATE rows require a deterministic title representation, not broader fuzzy matching. Color, collaboration order, season, size, and recency rules should remain abstaining until larger verified evidence yields zero contradictions.

## Q. Verdict

BATCH 12 safely resolved the only two currently explainable strong-model identities. Verified mappings increased by two, one Price Audit row became MATCH, false positives remained zero, all genuine family ambiguity was preserved, request count did not regress, and Production finished 13/13 healthy.
