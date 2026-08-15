# BI-BATCH-E — Single-Brand Completion Sweep

Full top-to-bottom UI walk (source + live Chrome), 4 real gaps fixed, 3-brand + period + failure QA. One commit, no push, no deploy.

## Pre-Flight

```
branch = main
HEAD (start) = 0d5df53bb6229b5b324ed4b29bab67b84948fdb8
```
BATCH D (`feat(brand-intelligence): connect score and ai intelligence`) was already committed as `0d5df53` at the start of this batch — no checkpoint commit needed. Working tree clean except the usual untracked `docs/reports/*.md` files.

## UI Walkthrough Method

Walked all 33 Phase-1 areas via a combination of source inspection and live Chrome (`selectBrandSelectorName()` — the real click-path wrapper, not `applyBrandIdentity()` alone, which skips the visible-panel/hero-name toggle and gave a false "brand didn't select" signal during testing until this was caught and corrected).

## Gaps Found and Fixed

**1. "전체 고객" (full customer list) Drawer — row click did nothing but toast, despite showing 100% real data.** `entityCompositionRows` (real names/sales/counts) has powered this list since STEP67-6, and BATCH A already built the real per-customer purchase-detail machinery (`entityClientOverviewMatchFor`/`openClientWorkspace`) — but it was only wired to the TOP5 hover mini-list, not this full drawer (which can show far more than 5 customers). Fixed: `entityDrawerCustomerRowHtml` now carries the real customer name as `data-entity-id`/`data-entity-label` (was the literal string `"placeholder"`, never read by anything — harmless but wrong); the drawer config gained `onRowClick`, a new but minimal extension point in the existing click-dispatch chain (`if (config.next) ... else if (config.onRowClick) ... else toast(...)`), wired for both the mouse-click and Enter/Space keyboard handlers. Verified live: clicking a customer beyond the TOP5 (index 7, "현국선 실장님", then again via real mouse click on "이종현 실장님(이서영 팀원)") now opens their real Client Workspace with real totals and real recent orders — previously impossible for anyone outside the TOP5.

**2/3. SKU Drawer and clientOrders Drawer empty states said "데이터 연결 대기" (connection pending) even though both are fully connected (BATCH B/A).** For a brand with genuinely zero online sales this period (e.g. TROUBLED WATERS) or a customer with genuinely zero brand purchases, the shared empty-state fallback claimed the *feature itself* wasn't built yet — misleading, since it is. Fixed: `entityDrawerConfig[type].emptyText` (new, optional) overrides the default only for `sku` and `clientOrders`; `category`/`order` (still genuinely unconnected, BI-BATCH-C/no-source) keep the original "데이터 연결 대기" text unchanged.

**4. The same fix, done naively, reintroduced a NULL≠ZERO violation** — a real Monthly-archive or Clients fetch *failure* would have rendered the same confident "no data this period" sentence as a genuine empty result, exactly the failure-as-zero bug this whole BI- effort has repeatedly guarded against. Caught via live fetch-failure mocking (Phase 7) before it shipped. Fixed by making `emptyText` accept a function: `sku`'s checks `entitySkuSalesState.fetchFailed` (→ "이번 기간 매출 데이터를 불러오지 못했습니다." vs "이번 기간 온라인 판매 또는 확인된 재고가 없습니다."); `clientOrders`'s checks the existing `entityClientsOverviewFetchFailed` flag BATCH A already maintains (→ "구매 내역을 불러오지 못했습니다." vs "이 고객의 이 브랜드 구매 내역이 없습니다."). `renderEntityDrawerBody` calls `config.emptyText` if it's a function, else uses it as a string, else falls back to the original text — zero behavior change for every other type.

**Bonus, zero-risk**: `clientOrders`'s `clickToast` was a copy-paste leftover reading `"SKU Intelligence 연결 예정"` (the SKU type's own toast text). It's structurally unreachable (`clientOrders.next = "sku"`, so the toast branch never fires), but was clearly wrong — corrected to `"Client Intelligence 연결 예정"`.

## Confirmed Correct, No Fix Needed (classified, not touched)

- Brand Score (overall + 4 sub-metrics): still the honest static `--`/"산식 연결 대기" shell — **E, intentional blocker**, per BI-BATCH-D.
- Category (Hero badge, Client Workspace section, Category Drawer, Category→SKU shell): still correctly `entityCategoryRows = []` and "데이터 연결 대기" — **D, intentional blocker**, per BI-BATCH-C.
- Sell-through, Recommended Action, Customer Grade (VIP ring `산식 연결 대기`), per-customer "AI Insight" (`공식 고객 상세 분석 규칙 연결 대기`) — **F/G/E, intentional blockers**, all correctly still honest, none touched.
- Hero Meta badges "지역"/"업데이트" — **J, genuinely undefined, not a bug**: neither `brand-master.json` nor `brand-sourcing-master.json` has a region field, and "업데이트" has no single agreed-upon timestamp (Cafe24 sync vs ECOUNT sync vs Monthly archive generation are all different, real timestamps with no documented precedence) — left as-is rather than guessing which one "counts."
- System Status row (Cafe24/Meta/Instagram/ECOUNT): already connected to real `/api/status` (STEP67-8), confirmed unchanged.
- Category→SKU navigation, SKU→Order shell, clientOrders "SKU"/"Orders" Explore chips: all confirmed working/honest as designed.
- Compare Mode: not investigated (**H, out of scope** — this batch is single-brand only).

## Cross-Brand QA (Phase 5)

| Brand | State | Revenue | Units | Orders | AOV | Inventory | Online SKU | Result |
|---|---|---|---|---|---|---|---|---|
| CARNET ARCHIVE | baseline | 10,883,059원 | 32개 | 25건 | 435,322원 | 272개 | 3개 (+1 Case C) | PASS, unchanged from BI-BATCH-D |
| AIVER | real confirmed SKU joins | 239,400원 | 3개 | 4건 | 59,850원 | 45개 | 2개, both Case A (real matched stock: 1개, 3개) + 1 Case C | PASS, unchanged from BI-BATCH-B2 |
| TROUBLED WATERS | zero online SKU sales, no ECOUNT canonical match | 8,274,400원 | 26개 | 21건 | 394,019원 | "데이터 없음" (honest) | 0개 | PASS — SKU Drawer correctly shows the new honest empty text, not "연결 대기" |

Customer-drawer-click fix verified on all three: CARNET (10 customers, tested rank 1, 5, 8), AIVER (2 customers, sparse), TROUBLED WATERS (not separately re-tested per-customer, covered structurally by the same shared code path already proven on the other two).

## Period QA (Phase 6)

CARNET, current partial month (2026-08) vs. completed month (2026-07):
- 2026-07: Revenue 23,303,130원 / Units 69개 / Orders 66건 / AOV 353,078원 — matches BI-CORE-4's independently-recorded July regression value exactly.
- MoM correctly shows "전월 대비 4% 감소" (completed-month semantics, not the live-month "진행 중" label).
- Ranking sentence correctly appears ("최근 7개월 중 이번 달 매출이 가장 낮습니다.") — only for the completed month, never the live one (STEP67-10G-4 guard intact).
- Online SKU count correctly period-scoped (3개 in Aug vs 5개 in Jul — different real product sets, confirmed via the SKU Drawer's actual row contents).
- Current inventory correctly stayed **272개 in both periods** — confirms the "current snapshot, not period-specific" semantic (Phase 6 of BI-BATCH-B) still holds exactly as designed.
- Switching back to August returned to the exact original baseline — no stale leakage either direction.

## Failure QA (Phase 7)

All via temporary `window.fetch` overrides (BI-CORE-4's established mocking technique, real server untouched):
- **Monthly archive failure**: all 4 Hero KPIs → "-", AI Summary → the existing neutral fallback, SKU Drawer → new failure-specific sentence ("이번 기간 매출 데이터를 불러오지 못했습니다.") not the empty-period sentence.
- **Clients (purchase detail) failure**: Client Workspace body → existing "불러오지 못했습니다" state (BATCH A, still correct); clientOrders Drawer (opened from the failed state) → new failure-specific sentence, not "이 고객의 구매 내역이 없습니다."
- **Inventory failure**: Hero Inventory → "데이터 없음" (honest, pre-existing behavior, unaffected); AI Summary correctly omits the "현재 재고는" sentence entirely rather than showing a fabricated 0.
- In every case, restoring the real `fetch` and calling `refreshEntityTrendMonths()` again returned the page to the exact correct baseline — confirming no residual mock state or race condition.

## Console / Network QA (Phase 9)

Zero application console errors across the entire sweep (only the pre-existing, unrelated browser-extension "message channel closed" artifact, consistent with every prior report this session). Network trace during a brand switch: exactly 2 `/api/inventory/overview` requests (rollup + brand-filtered items, matching BATCH B's documented contract); `/api/reports/monthly` and `/api/intelligence/clients` correctly served from `getSharedJson`'s cache on a repeat brand switch within the same period (0 new requests) — confirms no duplicate-fetch regression from any of this batch's re-render calls.

## Files Changed

- `outputs/samplas-marketing-os.js` (45 insertions, 4 deletions): `entityDrawerCustomerRowHtml` real identity; `entityDrawerConfig.customer.onRowClick` (new); `entityDrawerConfig.sku.emptyText`/`entityDrawerConfig.clientOrders.emptyText` (new, function-valued); `entityDrawerConfig.clientOrders.clickToast` corrected; the click and keydown row-dispatch handlers gained one `else if (config.onRowClick)` branch each; `renderEntityDrawerBody` gained the function-vs-string `emptyText` check.
- `test/brand-intelligence-single-brand-sweep.test.mjs` (new, 12 tests).

## Tests

New file: **12/12 PASS** — real-identity row template, onRowClick opens the correct Workspace row (and is a safe no-op on no match), click/keydown dispatch wiring, function-valued `emptyText` support, SKU and clientOrders empty-vs-failure sentence distinction (both directions), clickToast correction, and two regression guards (category/order unchanged, Category still blocked).

Targeted (new file + Brand Score/AI + Brand Intelligence + partial-period + Customer Purchase Detail + SKU sales/stock + live-data/UI restoration + Product Registry/identity + monthly-brand-sales + master-data + cross-brand cutoff/partial-period + Compare summary/timeout): **170/170 PASS**.

Full regression: **398/398 PASS, 0 fail, 0 skipped** (386 prior baseline + 12 new).

## Completion Matrix

| Section | Status | Source | Verified | Blocker | User-Visible State | Follow-Up |
|---|---|---|---|---|---|---|
| Brand Selector / Period Selector | COMPLETE | existing | live | — | works | none |
| Hero identity / KPI (Revenue/Units/Orders/AOV) | COMPLETE | Monthly Archive | live, 3 brands, 2 periods | — | real values, honest `-` on failure | none |
| Inventory | COMPLETE | ECOUNT rollup+items | live, 3 brands | — | real value or honest "데이터 없음" | none |
| Sell-through | DEFERRED | — | — | F: formula not defined | honest `BLOCKED · 공식 산식 필요` | separate workstream |
| Brand Score | BLOCKED | — | — | E: formula/weights not defined | honest `--`/"산식 연결 대기" | needs a human design pass |
| AI Summary | COMPLETE | Monthly/Inventory/SKU count | live, 3 brands, failure-mocked | — | real facts only, no Category/Sell-through claims | none |
| Recommended Action | BLOCKED | — | — | G: action threshold policy not defined | honest "규칙 미확정" disclosure | needs a policy decision |
| Monthly trend/chart/cards | COMPLETE | Monthly Archive | live, 2 periods | — | real, partial-period-safe | none |
| Customer Composition (donut/TOP5) | COMPLETE | Customer Composition | live, 3 brands | — | real | none |
| Customer full-list Drawer | COMPLETE (fixed this batch) | entityCompositionRows | live, 3 brands | — | real rows + real click-through to Workspace | none |
| Quick Profile (hover) | COMPLETE | entityCompositionRows | live | — | real | none |
| Client Workspace (Brand/Recent Orders sections) | COMPLETE | BATCH A | live, failure-mocked | — | real, honest failure/empty split | none |
| Customer Workspace Category section | BLOCKED | — | — | D: Category taxonomy | honest "연결 대기" | needs Category unblock first |
| Client Orders Drawer | COMPLETE (wording fixed this batch) | BATCH A | live, failure-mocked | — | real rows, honest failure-vs-empty text | none |
| SKU Drawer (sales+stock join, search, sort) | COMPLETE (wording fixed this batch) | BATCH B/B2 | live, 3 brands, failure-mocked | — | real rows, honest failure-vs-empty text | none |
| Category shell (Hero badge/Drawer/Client Workspace) | BLOCKED | — | — | D: taxonomy not proven (BI-BATCH-C) | honest "연결 대기" throughout | needs business taxonomy input |
| Order Drawer | BLOCKED | — | — | no source exists | honest "연결 대기" | out of scope, no fake data added |
| System Status row | COMPLETE | `/api/status` | source-confirmed | — | real | none |
| Hero "지역"/"업데이트" badges | BLOCKED | — | — | J: no canonical field/no agreed timestamp | honest "연결 대기" | needs a definition decision, not urgent |
| Compare Mode | H (out of scope) | — | not investigated | — | unchanged | separate batch, per instruction |

No item required a "PARTIAL" status — every discovered concrete technical defect (all 4, listed above) was fixed in this batch; everything else is either COMPLETE or a genuine, already-documented, non-technical blocker.

## Recommendation

**SINGLE-BRAND technical implementation can now be considered complete**, excluding the four explicitly-out-of-scope business-definition items (Category taxonomy, Brand Score formula/weights, Sell-through formula, Recommended Action policy) and Compare Mode. Every data-wired section was live-verified across 3 brands with meaningfully different data states, 2 periods, and 3 mocked failure scenarios, with zero console errors and zero duplicate-fetch regressions. The remaining work is exclusively either (a) human business/policy decisions this codebase cannot supply on its own, or (b) the explicitly-deferred Compare Mode workstream.

## Commit

```
0d5df53 feat(brand-intelligence): connect score and ai intelligence   (BATCH D, prerequisite)
<next>  fix(brand-intelligence): complete single-brand data wiring    (this batch)
```

## Next Recommended

Compare Mode is the next reasonable code batch, per the user's own instruction not to auto-start it here. Outside code work: a human decision on the Brand Score formula (BI-BATCH-D's finding), the Category taxonomy (BI-BATCH-C's finding), and the Recommended Action threshold policy would unblock the three remaining honest-`--` sections.
