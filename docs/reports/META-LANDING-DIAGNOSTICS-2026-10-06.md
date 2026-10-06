# Meta landing diagnostics — 2026-10-06

Base: GitHub main `984980e73c3fd0e8b3c01475bd164d14f0393d34`.
Workspace: `/private/tmp/samplas-meta-landing-main`, branch `codex/meta-landing-diagnostics`.
Existing local Marketing OS changes were not modified. No push or deployment.

## Implementation

- GET `/api/meta-ads/landing-diagnostics`; other methods return 405 before Graph access.
- Existing Graph GET transport queries the account ads edge with campaign, adset and creative fields. Cursor pagination rejects unsafe/repeated cursors and fails closed at the limit instead of silently returning partial ads.
- Collects HTTP(S) destination candidates from object_story_spec link/video/template/child attachments, asset_feed_spec link URLs, creative link/object/template URLs and template URL structures. Image/video asset URLs are excluded. Creative url_tags are appended before exact ghost_mall_id query parsing.
- Returns IDs/names, deduplicated destinationUrls, ghostMallIds, TRACKED/MISSING/UNRESOLVED, trackingCoverage, warnings and expectedTrackingCode=null. There is no confirmed ad-ID mapping registry; ad names never determine expectations.
- TRACKED means at least one concrete meta_* query value. PARTIAL identifies ads with both tracked and untracked URL candidates. Dynamic macros and duplicate conflicting values are disclosed. The endpoint does not follow public landing redirects or resolve catalog product feeds/published posts; unresolved candidates cannot be presented as verified final rendered URLs.
- ACTUAL_PRODUCTS_SOLD is unavailable with the requested exact reason if no order exposes inflow_path or ghost_mall_id. Empty/null exposed fields remain unattributed under existing semantics. Nested unrelated fields are not used to fabricate attribution. No Meta purchase/revenue substitution.
- Existing cancellation/refund/partial cancellation canonical helpers and weekly report scheduling remain unchanged. VEIL FOUND, popup, UI and intelligence-service files have no diff.

## Verification

- Requested regression/new test set: 98 passed, 0 failed, 0 skipped.
- Final entire repository suite: 1218 tests; 1189 passed, 27 failed, 2 skipped.
- Clean unchanged main suite, same environment: 1207 tests; 1178 passed, 27 failed, 2 skipped.
- Failure names match exactly; no additional failures after this change. Failures include missing gitignored business fixtures/caches and Cafe24 token configuration. These are not repaired or bypassed in this task.
- npm run check, node --check scripts/meta-landing-diagnostics.mjs and git diff --check passed.
- New helper transport test exercises the actual graphGet function with fake responses; all requests are GET against /act_123/ads. Endpoint tests execute its actual source branch, reject POST/PUT/PATCH/DELETE, and workbook test verifies an explicit UNAVAILABLE row with no actual paid amount.
- Production Meta API was not invoked; production credentials and resolved live creative payloads are not validated before deployment.
- Before commit, both suites were rerun: the same 27 failure locations matched exactly and new failures remained 0. These are pre-existing main baseline failures unrelated to this change. The user explicitly authorized committing only this change with baseline failures documented. No push or production deployment is authorized.

Commands:

```sh
node --test test/meta-ads-weekly-report.test.mjs test/instagram-weekly-report.test.mjs test/naver-ads-weekly-report.test.mjs test/weekly-report-phase2.test.mjs test/meta-instagram-weekly-report-scheduler.test.mjs test/naver-weekly-report-scheduler.test.mjs test/cafe24-canceled-item.test.mjs test/cafe24-order-amount.test.mjs test/meta-landing-diagnostics.test.mjs test/meta-actual-tracking-availability.test.mjs
node --test test/*.test.mjs
npm run check
node --check scripts/meta-landing-diagnostics.mjs
git diff --check
```

## Existing baseline failures

- test at test/brand-intelligence-offline-attribution.test.mjs:71:1
- ✖ real CARNET August offline lines are canonical-resolved once on the server (50.141041ms)
- test at test/brand-master-integrity-audit.test.mjs:77:1
- ✖ real Brand Master is parseable and auditable without fixed issue counts (5.970833ms)
- test at test/cafe24-full-product-catalog.test.mjs:88:1
- ✖ buildCafe24EcountProductMatchingDiagnostic: 237개 전체 Cafe24 상품이 display/selling과 무관하게 결과에 반영된다 (2.205375ms)
- test at test/category-review.test.mjs:46:1
- ✖ review artifact loads and reflects the fully-classified post-rules-update set (0 remaining) (5.910542ms)
- test at test/category-review.test.mjs:64:1
- ✖ excluded product codes (payment/operational lines) never appear in the Category Review audit (0.607042ms)
- test at test/category-review.test.mjs:130:1
- ✖ APGUJEONG and VAIL canonical offline totals remain unchanged (0.899792ms)
- test at test/monthly-performance-ia.test.mjs:43:1
- ✖ store TOP brands reuse canonical identity and never cross store boundaries (33.082125ms)
- test at test/production-ecount-import.test.mjs:84:1
- ✖ operator session and ECOUNT import use the dedicated credential over real HTTP (302.66075ms)
- test at test/store-filter.test.mjs:59:1
- ✖ 1. default store = ALL preserves the legacy-fallback result (no per-store files yet) (73.433959ms)
- test at test/store-filter.test.mjs:67:1
- ✖ 2. ALL total = APGUJEONG offline + VAIL offline (exact regression) (68.543917ms)
- test at test/store-filter.test.mjs:81:1
- ✖ 3/4. storeCode=APGUJEONG / VAIL route to the exact matching filter (not ALL) (60.117584ms)
- test at test/store-filter.test.mjs:94:1
- ✖ 5/6. APGUJEONG filter excludes VAIL's offline lines and vice versa (61.888166ms)
- test at test/store-filter.test.mjs:105:1
- ✖ 7/8. online total is identical across ALL/APGUJEONG/VAIL (never store-attributed) (37.961583ms)
- test at test/store-filter.test.mjs:124:1
- ✖ 9/10. a legacy (pre-store-separation) month returns 0 for both APGUJEONG and VAIL filters, never guessed (31.227792ms)
- test at test/store-filter.test.mjs:138:1
- ✖ 11. partial upload (APGUJEONG only) surfaces storesIncluded/storesMissing so VAIL is distinguishable from a real zero (40.572292ms)
- test at test/store-filter.test.mjs:150:1
- ✖ 13. ALL: total = online + offline invariant unchanged from pre-STORE-BATCH-C behavior (84.260625ms)
- test at test/store-filter.test.mjs:159:1
- ✖ 14. store=ALL result is byte-identical whether requested explicitly or omitted (40.763541ms)
- test at test/store-intelligence-live-data.test.mjs:128:1
- ✖ APGUJEONG and VAIL category accounting reconciles to each canonical store total (127.823084ms)
- test at test/store-performance.test.mjs:45:1
- ✖ 10. ALL offlineSales.byStore sums to offlineSalesAmount when both stores complete (92.162625ms)
- test at test/store-performance.test.mjs:56:1
- ✖ 11/12. byStore is present and consistent regardless of storeCode filter (usable as canonical ALL share denominator) (53.5575ms)
- test at test/store-performance.test.mjs:73:1
- ✖ 7/8/9. APGUJEONG revenue excludes VAIL, VAIL excludes APGUJEONG, both exclude online (38.719167ms)
- test at test/store-performance.test.mjs:88:1
- ✖ 13/14/15. legacy null-store is neither APGUJEONG nor VAIL; missing store is not a fabricated zero (56.031042ms)
- test at test/store-performance.test.mjs:182:1
- ✖ 20/21. Brand APGUJEONG/VAIL offline revenue is correct and store-isolated (1.387375ms)
- test at test/unified-identity-resolver.test.mjs:177:1
- ✖ STEP63-2B: BON CO productName → BONNAE, Brand Master 1차 조회로 성공 (38.227292ms)
- test at test/unified-identity-resolver.test.mjs:188:1
- ✖ STEP63-2B: SUN CO productName → SUNDAY OFF CLUB(선데이오프클럽), 온라인 카탈로그 2차 조회 (43.461458ms)
- test at test/unified-identity-resolver.test.mjs:205:1
- ✖ STEP63-2B: onlineCatalog를 넘기지 않으면 STEP63-2와 동일하게 동작(하위 호환) (27.730333ms)
- test at test/unified-identity-resolver.test.mjs:227:1
- ✖ loadResolverContext(): work/brand-master.json을 읽기만 하고 수정하지 않는다 (6.92975ms)
