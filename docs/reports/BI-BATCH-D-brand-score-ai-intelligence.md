# BI-BATCH-D — Brand Score + AI Summary + Recommended Action

Traced, connected where a real formula already exists, and left honestly unavailable where none does. One commit, no push, no deploy.

## Pre-Flight

```
branch = main
HEAD (start) = 43ed1781f91d14dc2a8f80e506b8c9832093f944
```
`c9d90f4` / `92cba37` / `2c90677` / `43ed178` all present. Working tree clean except the usual untracked `docs/reports/*.md` files.

## Phase 1/2 — Brand Score Component Inventory

| Component | Source | Formula | Weight | Available? | Canonical? | Verified? | Current UI |
|---|---|---|---|---|---|---|---|
| Overall Health Score | none | none | none | NO | N/A | N/A | `.brand-hero-score-value` = `--`, ring `--score: 0` |
| 매출 성장 (Sales growth) | none (MoM% exists via `entityTrendMoMPct()`, but no *score* mapping was ever approved) | none | none | NO | N/A | N/A | bar `width:0%`, text `--` |
| 재고 건전성 (Inventory health) | none (status buckets exist in `inventory-overview-lib.mjs`, but no health-score formula was ever approved) | none | none | NO | N/A | N/A | bar `width:0%`, text `--` |
| 판매 회전율 (Turnover) | none | none | none | NO | N/A | N/A | bar `width:0%`, text `--` |
| 고객 성장 (Customer growth) | none | none | none | NO | N/A | N/A | bar `width:0%`, text `--` |

**Classification (Phase 2): all 5 = E — UNDEFINED FORMULA.** This is not a gap I'm reporting for the first time — `docs/ROADMAP.md:159-161` already states, in the project's own words, that Health Score "무엇을 근거로 계산할지부터 설계 필요(새 계산식이 될 가능성이 높으므로 STEP0 조사 먼저)" ("needs its calculation basis designed first — likely a new formula, so investigate before anything else"). `docs/PROJECT_MEMORY.md`/`docs/DAILY_LOG/2026-08-08.md` independently confirm the same conclusion at an earlier checkpoint (when the score was still a fake hardcoded "78/Strong" — since fixed by STEP67-5 to the current honest `--` state). No STEP0 design work has happened since; nothing changed upstream. **No formula was invented this batch.** The current honest `--`/"산식 연결 대기" shell was already correct and is unchanged — a structural test (`no JS code computes or assigns .brand-hero-score-value`) confirms 0 lines of code anywhere touch the score display.

## Phase 6/7 — AI Summary: Traced and Extended

**Trace**: `renderEntityHeroInsight(row, index)` (STEP67-6) — a deterministic client-side template, not an LLM, not server-generated. Already used real signals before this batch: revenue (live-month snapshot or completed-month MoM%), channel mix dominant %, and completed-month min/max ranking — all read directly from `entityTrendMonths`/`entityTrendMoMPct()` with BI-CORE-4's NULL≠ZERO guards and STEP67-10G-4's live-month partial-period guards already in place and untouched.

**Extension this batch** (Phase 7, using the task's own allowed example style — "현재 재고는 Z개입니다."): two more real, already-computed facts, using zero new fetches:
- **"이번 기간 온라인 판매가 확인된 상품은 N개입니다."** — `row.skuCount`, already computed synchronously inside `refreshEntityTrendMonths()` (STEP67-6, distinct `productNo` count from `archive.commerce.productSales`). Always included when the row isn't `fetchFailed` (a genuine 0 renders as 0, per Phase 11).
- **"현재 재고는 N개입니다."** — the same `knownStock` value `refreshEntityInventory()` already resolves for the Hero Inventory card. A new module-level state, `entityHeroInventoryState`, holds it (`{ brandCode, ready, stock, fetchFailed }`) so `renderEntityHeroInsight` can read it without a second fetch. The sentence is appended **only** when `ready === true`, `stock !== null`, and `entityHeroInventoryState.brandCode === brandIdentityState.brandCode` — otherwise it's silently omitted (never rendered as a fabricated "0개"). Because Inventory is a separate async fetch that can resolve after the Trend/AI Summary render, `refreshEntityInventory()` now calls `renderEntityHeroKpiFromMonthlyState()` again once it settles (success or confirmed-unavailable), reusing the exact same "re-render an already-drawn view when late data arrives" pattern BATCH A/B already established (`refreshOpenEntityCustomerDetailViews`/`refreshOpenEntitySkuDrawer`) — no new render path was invented.

**Guards verified** (Phase 8/9/11): the summary never mentions "카테고리"/Category or "셀스루"/Sell-through in any state (success, fetch-failure, no-brand). No fabricated causality was added — both new sentences are flat, unconditional facts, not "X 때문에 Y" claims.

## Phase 8/9 — Recommended Action: Traced, Confirmed Correct, Unchanged

**Trace**: same `renderEntityHeroInsight()` function writes `#entityHeroActionList`. Its own code comment (STEP67-6) already documents the finding this batch was asked to re-verify: *"이 프로젝트에 매출 급감/온라인 비중 관련 기존 threshold가 전혀 없어(재고 관련 threshold만 존재, Inventory는 SOURCE NOT AVAILABLE) 새 threshold를 만드는 대신 정직하게 '추천 기준 미확정'을 표시한다."* An inventory-related threshold *does* exist (`DEFAULT_LOW_STOCK_THRESHOLD`, `negative_review`/`depleted_candidate` status buckets in `scripts/inventory-overview-lib.mjs`, already surfaced as "확인 필요 N개" on the Hero Inventory note) — but turning that count into an *action recommendation* ("reorder now") would require a business threshold/policy decision this project has explicitly not made (the same comment states inventory is "참고 정보"/reference-only, not an action trigger). Per Phase 9's own rule — reuse only an *existing approved deterministic rule*, not just an existing *count* — this does not qualify, so no action bullet was added from it.

**Result**: `#entityHeroActionList` text is unchanged — still the existing, honest single bullet: *"공식 추천 규칙 미확정 — 현재 재고는 참고 정보이며 Sell-through 산식과 Action threshold가 확정되기 전에는 행동을 자동 추천하지 않습니다."* No 할인/프로모션/재입고/발주/광고 recommendation was invented.

## Phase 11 — Monthly Trend

Not rebuilt (out of scope, already connected per BI-GAP-1). Spot-verified via the full existing `brand-intelligence-partial-period.test.mjs` suite (19/19 pass, unchanged) that BI-CORE-4's NULL≠ZERO policy and STEP67-10G-4's partial-period guards still hold with the new AI Summary sentences layered on top.

## Files Changed

- `outputs/samplas-marketing-os.js` (29 insertions): new `entityHeroInventoryState`; `refreshEntityInventory()` now sets it at each of its 3 exit points and re-renders the Hero once resolved; `refreshEntityTrendMonths()` resets it in the no-brand-selected branch; `renderEntityHeroInsight()` gained the two new sentences. No other function touched. Brand Score markup/CSS untouched (still the honest static shell).
- `test/brand-intelligence-partial-period.test.mjs` (12 insertions): added `entityHeroInventoryState`/`brandIdentityState` as default-idle free variables at the 4 existing `renderEntityHeroInsight` extraction sites, so the new required parameters don't break the pre-existing suite. No existing assertion was weakened or removed.
- `test/brand-intelligence-score-ai-recommended-action.test.mjs` (new, 15 tests).

## Tests

New file: **15/15 PASS** — real SKU-count sentence, real-zero SKU count, real stock sentence, stock sentence omitted while loading/failed/unmatched/stale-brand, no Category/Sell-through mention in any state, Recommended Action unchanged/no invented rule, fetch-failure safety, Brand Score structural "still unwired" guard, Brand Score tooltip-copy guard, Category-still-blocked guard, brand-deselect reset guard, no-new-fetch guard.

Targeted (new file + Brand Intelligence + partial-period + Customer Purchase Detail + SKU sales/stock + live-data/UI restoration + Product Registry/identity + monthly-brand-sales + master-data + cross-brand cutoff/partial-period + Compare summary/timeout): **158/158 PASS**.

Full regression: **386/386 PASS, 0 fail, 0 skipped** (371 prior baseline + 15 new).

## Chrome QA

Real server, hard refresh, `CARNET ARCHIVE` / `2026년 8월`:
- Core Metrics unchanged: Revenue 10,883,059원 / Units 32개 / Orders 25건 / AOV 435,322원 / Inventory 272개.
- Brand Score: overall ring still `--`/"산식 연결 대기"; all 4 sub-bars still `--`/0% width — honest, unchanged.
- AI Summary (live): *"8월 현재 누적 매출은 10,883,059원입니다. 매출의 90.6%가 오프라인에서 발생했습니다. 이번 기간 온라인 판매가 확인된 상품은 3개입니다. 현재 재고는 272개입니다."* — both new sentences present, real values, no Category/Sell-through mention.
- 추천 Action (live): unchanged honest disclosure text, confirmed verbatim.
- SKU Drawer regression: still 4 real rows (3 sales + 1 Case C, matching BI-BATCH-B2's confirmed state) — unaffected.
- Brand-switch stale guard (live): switched to `AIVER` — AI Summary correctly updated to *"...온라인 판매가 확인된 상품은 2개입니다. 현재 재고는 45개입니다."* (AIVER's own real numbers, confirmed against BI-BATCH-B2's independently-verified inventory figures) — no CARNET data leaked.
- Console: zero application errors (only the pre-existing, unrelated browser-extension "message channel closed" artifact noted in every prior report this session).

## Remaining Blockers (unchanged, disclosed, not attempted)

- Brand Score (overall + all 4 sub-components): still requires a STEP0 design/approval pass — this batch correctly did not invent one.
- Category: still PATH B per BI-BATCH-C, untouched this batch (`entityCategoryRows` still the literal empty array, guarded by a new structural test).
- Sell-through: still deferred, untouched.
- Recommended Action: still correctly gated on the same undecided inventory-action threshold policy noted in STEP67-6; nothing changed.

## Commit

```
43ed178 data(product-registry): promote deterministic sku matches   (prerequisite)
<next>  feat(brand-intelligence): connect score and ai intelligence  (this batch)
```

## Next Recommended

A human STEP0 design/approval pass for the Brand Score formula (what data, what weights, how partial-availability is handled) is the actual unblock for that component — not another code batch. Separately, Category Intelligence remains blocked pending the business taxonomy input identified in BI-BATCH-C.
