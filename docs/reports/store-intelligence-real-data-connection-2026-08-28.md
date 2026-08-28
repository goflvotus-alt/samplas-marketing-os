# STORE INTELLIGENCE REAL DATA CONNECTION — BATCH 14

## A. BASELINE

- Repository: `/Users/binggu/Dropbox/SAMPLAS WORK/INTELLIGENCE/SAMPLAS Marketing OS DEV`
- Branch: `main`
- Starting HEAD / origin/main: `c77b1e07d39502484e0882e1128d64a28dd583ff`
- Ahead / behind: `0 / 0`
- Staged / tracked modified: `0 / 0`
- Unrelated untracked files: 142, all preserved
- Production authority: Render (`https://samplas-marketing-os.onrender.com/`)

## B. CURRENT SHELL FORENSIC

| Store | Section | State before BATCH 14 | Canonical source | BATCH 14 action |
| --- | --- | --- | --- | --- |
| APGUJEONG | Sales KPIs | Live endpoint existed; stale mock disclosure remained | store ECOUNT + canonical sales + Clients | Keep real data; fix transaction AOV semantics; remove mock disclosure |
| APGUJEONG | Customer type | Real | store-scoped Clients | Keep real data |
| APGUJEONG | Stylist-type client share/ranking | Real | canonical client type `stylist` | Keep; preserve meaning as customer type, not assigned employee |
| APGUJEONG | Stylist customer relationship | Static unavailable | No assignment source | Keep unavailable |
| APGUJEONG | Brand × stylist | Static unavailable | No approved cross payload | Keep unavailable |
| APGUJEONG | Recent clients | Real fields plus unsupported assigned stylist column | Clients | Replace unsupported column with canonical customer type |
| APGUJEONG | Insight | Static unavailable | Existing period/brand/client aggregates | Add deterministic facts only |
| VEIL | Sales KPIs | Real; AOV used purchase-line average | store ECOUNT + canonical sales + Clients | Fix to sales divided by unique documents |
| VEIL | Products | Real exact confirmed Product Registry subset | Product Registry identity | Keep with explicit coverage |
| VEIL | Brands | Real locally; Render resolver path was wrong | Brand Master + resolver + offline brand aggregation | Fix Render to read canonical `WORK_DIR` |
| VEIL | Category | Misleading `미분류 100%` donut at 0% coverage | No connected canonical category | Mark unavailable; never draw fake 100% composition |
| VEIL | Inventory / sell-through | Static unavailable | Store/warehouse inventory and opening stock absent | Keep unavailable with exact reason |
| VEIL | New brand response | Static unavailable | Canonical onboarding date absent | Keep unavailable |
| VEIL | Insight | Static unavailable | Existing period/brand/product aggregates | Add deterministic facts only |

## C. DATA SOURCE MAP

| Metric | Source / existing helper | Scope / rule |
| --- | --- | --- |
| Store identity | `work/store-master.json` | Internal key remains `VAIL`; display is VEIL |
| Coverage / sales lines | `readEcountOfflineSalesSnapshot(month,{workDir,storeCode})` | Exact store and date filtering |
| Period sales | `buildCanonicalTotalSales({storeCode})` | Existing canonical offline sales |
| Orders / quantity / clients | `buildClientsOverview({storeCode})` | Physical-store offline only; online is not inferred into a store |
| AOV | period sales / distinct ECOUNT document count | Same canonical sales and unique-document outputs; not purchase-line count |
| Brands | `loadResolverContext({workDir})` + `mergeOfflineBrandSales()` | Exact canonical resolver; no fuzzy attribution |
| Products | confirmed Product Registry identity | Ambiguous/unknown lines abstain |
| Customer type | existing Clients classification | No name-based reclassification added |
| Inventory / sell-through | no adequate canonical source | Explicit unavailable |

No new persistence format, parser, fuzzy rule, synthetic value, or snapshot was created.

## D. APGUJEONG IMPLEMENTATION

- Live selected-period sales, latest-day sales, customers, distinct orders, quantity and AOV are rendered from the shared Store endpoint.
- AOV now uses `190,060,400 / 285 = 666,878.596...` (UI: 666,879원), rather than Clients purchase-line average 255,976원.
- Customer composition and stylist-type customer ranking remain canonical Clients output.
- Recent customer table now shows canonical customer type instead of an unsupported assigned-stylist value.
- Deterministic insight items report period sales/orders, top canonical brand, and stylist-type customer revenue/count.
- Production 2026-08-01~28: 190,060,400원, 643 units, 285 orders, 91 clients; top brand 카르넷 아카이브 32,296,600원; stylist-type clients 155,564,100원 / 71 clients.

## E. VAIL IMPLEMENTATION

- User-facing spelling is VEIL; route/store contract remains `VAIL`.
- Production 2026-08-01~28: 11,202,500원, 60 units, 41 orders, AOV 273,232원.
- Exact Product Registry coverage: 8 resolved lines / 60 unresolved lines; 7 canonical product rows, without padding.
- Top product: `Schwarze Stunde wax coated multi panels denim pants black`, 2 units / 356,400원.
- Top canonical brand: SUNDAYOFFCLUB, 3,214,800원 / 14 units / 13 orders.
- A Render-only defect was found and fixed: Store composition passed no `workDir` to `loadResolverContext()`, causing the deployment checkout rather than canonical persistent data to be used. The one-call-site fix restores Local/Production brand parity.
- Deterministic MD facts report period sales/orders, top brand, and top confirmed product.

## F. UNAVAILABLE / BLOCKED METRICS

| Metric | State | Reason |
| --- | --- | --- |
| Store inventory | Unavailable | ECOUNT inventory has no trustworthy store/warehouse dimension |
| Sell-through | Unavailable | Opening inventory and receipt/onboarding dates do not exist |
| New-brand 7-day response | Unavailable | Canonical brand onboarding date does not exist |
| Category composition | Unavailable | Confirmed products have no connected canonical category in this endpoint |
| Repeat/new customer share | Unavailable | Operational definition is not approved |
| Assigned stylist/customer relationship | Unavailable | Staff assignment source does not exist |
| Brand × stylist | Unavailable | No approved canonical customer-brand cross payload |

The former 0%-coverage `미분류 100%` category visualization was removed. No company-wide inventory was relabeled as VEIL inventory and no proxy sell-through was calculated.

## G. DATA RECONCILIATION

Production, same query window (2026-08-01~28):

- APGUJEONG offline: 190,060,400원
- VEIL offline: 11,202,500원
- Store sum: 201,262,900원
- Canonical offline total: 201,262,900원
- Online (not store-attributed): 33,337,848원
- Canonical total: 234,600,748원

`190,060,400 + 11,202,500 = 201,262,900`

`201,262,900 + 33,337,848 = 234,600,748`

Store coverage includes APGUJEONG and VAIL with no missing store. The current month is correctly marked partial through 2026-08-26.

## H. TESTS

- Syntax (`server.mjs`, frontend JS): PASS
- Focused Store Intelligence tests: 7/7 PASS
- Related Store UI/live tests: 32/33 PASS; the only failure is the known unrelated Today Overview text fixture
- Official full suite (`node --test test/*.test.mjs`): 825 total / 823 pass / 2 known failures
- Known failures: offline-total fixture and Today Overview fixture
- New failures: 0
- `git diff --check`: PASS

## I. UI QA

Local and Production deep links were verified in the in-app browser:

- APGUJEONG live coverage, 5 KPIs, customer-type composition, stylist-type ranking, recent customer types, and deterministic insights: PASS
- VEIL live coverage, 5 KPIs, exact products, canonical brands, explicit unavailable inventory/sell-through/category/new-brand states, and deterministic insights: PASS
- Mock/placeholder disclosure removed: PASS
- Console warnings/errors attributable to Store Intelligence: 0
- A script cache-busting version was updated so Production clients load the new renderer immediately.

## J. GIT / COMMIT

- `70914eb` — `feat(store): connect real Store Intelligence data`
- `60f3f05` — `fix(store): read canonical resolver data on Render`
- Both commits pushed normally to `origin/main`; no force push.
- Only BATCH 14 files were staged. Unrelated untracked files remain untouched.

## K. PRODUCTION DEPLOYMENT

- Render automatic deployment triggered by each normal `main` push.
- The first check during the second deployment returned a transient 502 and was not counted as success.
- Service recovery and the final code deployment were confirmed by the new API contract and frontend hash.
- Snapshot sync: not performed. No canonical data or snapshot changed in this batch.

## L. PRODUCTION VERIFICATION

- APGUJEONG Store API/UI: PASS
- VEIL Store API/UI: PASS
- Local/Production canonical brand attribution: PASS after `WORK_DIR` fix
- Sales reconciliation: PASS
- Production UI console: 0 Store Intelligence errors
- Final `npm run verify:production`: 13/13 PASS
- Verdict from verifier: `PRODUCTION BASELINE HEALTHY`

## M. REPORT

New report: `docs/reports/store-intelligence-real-data-connection-2026-08-28.md`

No previous development report was overwritten or deleted.

## N. VERDICT

`STORE INTELLIGENCE REAL DATA — PRODUCTION VERIFIED`
