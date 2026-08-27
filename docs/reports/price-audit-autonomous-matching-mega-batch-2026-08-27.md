# Price Audit Autonomous Matching Mega Batch — 2026-08-27

## A. Repository baseline

- Repository: `/Users/binggu/Dropbox/SAMPLAS WORK/INTELLIGENCE/SAMPLAS Marketing OS DEV`
- Branch: `main`
- HEAD/origin-main before: `e9fd5a4885b398ad550430c7248c3909a1f43af6`
- Ahead/behind: `0/0`
- Staged/tracked modified: `0/0`
- Untracked baseline: `142` (preserved; no cleanup)

## B. Current Price Audit baseline

| Status | Before |
| --- | ---: |
| MATCH | 2,977 |
| ECOUNT_HIGHER | 75 |
| ECOUNT_LOWER | 43 |
| MATCH_REQUIRED | 169 |
| REVIEW_REQUIRED | 332 |
| Total | 3,596 |

## C. Current Product Registry baseline

- Entries: 3,596
- Confirmed/verified: 392/392
- Ambiguous: 3,023
- Candidate: 12
- Unmatched: 169
- Candidate-bearing/candidate-less: 3,427/169
- Trusted provenance: normalized brand+product exact 180, normalized product exact manual safe apply 114, human review approved 90, brand-scoped fuzzy safe apply 4, four other manual strategies 1 each.

## D. Matching pipeline map

```text
ECOUNT full/current product master
  -> existing Cafe24/ECOUNT diagnostic candidate generation
  -> Product Registry (canonical identity mapping)
  -> autonomous-product-matcher exact-evidence verification
  -> Product Registry confidence/provenance update
  -> official build-price-audit generator
  -> work/price-audit.json (derived)
  -> Local API
  -> explicit Render persistent snapshot upload
  -> Production API/UI
```

Canonical: `work/product-registry.json`. Derived: `work/price-audit.json`. Price Audit does not create identity; it consumes Registry identity and ECOUNT/Cafe24 prices.

## E. Human-review forensic (100%, before-state)

All 501 `MATCH_REQUIRED`/`REVIEW_REQUIRED` rows were classified once into mutually exclusive clusters.

| Failure cluster | Count | % unresolved | Example/meaning | Deterministic action | Risk |
| --- | ---: | ---: | --- | --- | --- |
| Missing product identity | 3 | 0.6% | `상품명 없음` | DATA_ISSUE | High |
| Existing diagnostic lacks both exact evidence signals | 23 | 4.6% | fuzzy/partial evidence | SAFE_REVIEW | Medium |
| No exact trusted-brand/title candidate | 244 | 48.7% | includes candidate-less and non-exact naming | NO_CANDIDATE | High |
| Exact trusted brand+title, unique family, regenerated set equals existing set | 174 | 34.7% | deterministic option-family identity | AUTO_SAFE | Low |
| Cafe24 price missing/invalid | 1 | 0.2% | identity safe, price still invalid | DATA_ISSUE; no review reduction | Medium |
| Multiple exact ECOUNT product families | 42 | 8.4% | same title, competing families | AMBIGUOUS | High |
| ECOUNT SKU prices disagree on verified mapping | 8 | 1.6% | price-data contradiction | DATA_ISSUE | High |
| Regenerated family differs from existing candidates | 6 | 1.2% | candidate-set drift | SAFE_REVIEW | High |
| **Total** | **501** | **100.0%** |  |  |  |

## F. Confirmed-data forensic

Trusted confirmed mappings supply explicit `brandId -> ECOUNT brand label` aliases. No fuzzy brand alias or ML was introduced. ECOUNT names consistently use `BRAND / PRODUCT` with size held separately or appended; exact normalized title plus a single `prodCd` family often represents Cafe24 option variants. However, exact brand+title alone produced 14 wrong selections in an exploratory backtest (historical and current families can share names), so that rule was rejected. The final rule additionally requires the independently regenerated full-master SKU set to equal the existing diagnostic candidate set exactly.

Collaboration order is not treated as interchangeable. Color, model, generic one-word title, family, and candidate-set conflicts cause abstention.

## G. Architecture and safety model

New module: `scripts/autonomous-product-matcher.mjs`.

Pipeline:

1. NFKC/case/punctuation normalization without stripping color/model tokens.
2. Trusted brand aliases learned only from confirmed+verified mappings.
3. Exact brand+title index over the full ECOUNT master.
4. Unique `prodCd` family gate.
5. Existing diagnostic must contain both `normalized_brand` and `normalized_product_name`.
6. Independently regenerated candidate codes must exactly equal current candidate codes.
7. Generic one-token titles and every contradiction abstain.

Tiers: `AUTO_SAFE`, `SAFE_REVIEW`, `AMBIGUOUS`, `NO_CANDIDATE`, `DATA_ISSUE`.

AUTO_SAFE provenance is stored backward-compatibly under `matching.autonomous` with version, tier, positive evidence, and negative checks. Existing ECOUNT links are not changed; only status/confidence/verified/provenance are promoted. Human-confirmed entries are never overwritten.

## H. Holdout/backtest and negative tests

True leave-one-out alias training: the evaluated confirmed entry is removed from its alias training set.

- Trusted evaluated: 389
- AUTO_SAFE: 145
- Correct: 145
- Wrong/known false positives: 0
- Abstained: 244
- AUTO_SAFE precision: 100%

Adversarial tests cover different products under one brand, color/model conflict, collaboration-order conflict, generic one-word titles, multiple families, missing independent evidence, and candidate-set disagreement.

## I. AUTO_SAFE cohort and application

- Discovered/applied: 174
- Evidence family: 174 exact trusted-brand alias + exact normalized title + unique ECOUNT family + existing candidate-set equality
- Provenance completeness: 174/174
- Second apply: 0 changes; SHA256 unchanged (`96a79d88f209940c01944c6fccac075b9b04a33db80ba1deac0bdde31f5cab24`)
- Product Registry confirmed/verified: 392 -> 566 (+174)

One AUTO_SAFE identity has invalid Cafe24 price and correctly remains `REVIEW_REQUIRED`; identity confidence does not erase price-data errors.

## J. Price Audit before/after

Official generator: `node scripts/build-price-audit.mjs` (3,596/3,596 rows, completed successfully).

| Status | Before | After | Delta |
| --- | ---: | ---: | ---: |
| MATCH | 2,977 | 2,977 | 0 |
| ECOUNT_HIGHER | 75 | 200 | +125 |
| ECOUNT_LOWER | 43 | 91 | +48 |
| MATCH_REQUIRED | 169 | 169 | 0 |
| REVIEW_REQUIRED | 332 | 159 | -173 |

- Unresolved before/after: 501 -> 328
- Reduction: 173 (34.5%)
- AUTO_SAFE applied: 174
- Remaining for review/data investigation: 328

## K. Tests

Focused tests: matcher, Product Registry, Product Registry summary, and Price Audit all PASS. Idempotency and deterministic decision output PASS.

Full suite: 824 total, 822 PASS, 2 FAIL. The two failures are the unchanged historical baselines:

1. `APGUJEONG and VAIL canonical offline totals remain unchanged`
2. `existing Today (Overview) view markup preserved`

No new BATCH 10 failure.

## L. Git and deployment

- Implementation/data commit: `9fa7e74` — `feat(price-audit): add autonomous safe matching`
- Pushed: `origin/main` (`e9fd5a4..9fa7e74`)
- Explicit upload dry-run selected only `price-audit.json`, `product-registry.json`.
- First upload during Render redeploy returned 502 and was not counted as success.
- After `/api/status` returned 200, retry succeeded with exactly:
  - `price-audit.json`
  - `product-registry.json`

## M. Production validation

Production APIs:

- Status: 200
- Product Registry: 3,596 entries, verified 566
- Price Audit: 3,596 rows; 2,977/200/91/169/159
- Inventory Operations: 200, operations payload present

First parity run: 12/13 PASS; Store Master had a transient `fetch failed`. Immediate full retry:

- Status, Today, Monthly current, Historical Monthly, Annual, Clients, ECOUNT current month, Store Master, Inventory, Brand Registry, Product Registry, Price Audit, Frontend: **13/13 PASS**
- Final verdict: `PRODUCTION BASELINE HEALTHY`

## N. Remaining unresolved universe

| Tier | Count |
| --- | ---: |
| SAFE_REVIEW | 29 |
| AMBIGUOUS | 42 |
| NO_CANDIDATE | 244 |
| DATA_ISSUE | 13 |
| **Total** | **328** |

These remain protected from automatic confirmation. Future work should prioritize source catalog completeness and explicit review of the 29 SAFE_REVIEW rows; thresholds should not be weakened. The official Price Audit full generator also has no per-request fetch timeout and took about 62 minutes; add a timeout/progress counter only as a separate operational-hardening task.

## O. Final verdict

`AUTONOMOUS MATCHING V1 PRODUCTION VERIFIED`

