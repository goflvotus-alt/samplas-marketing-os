# MONTHLY QUICK INTELLIGENCE HOVER

**Date**: 2026-08-14
**Scope**: Expand Monthly's existing hover popovers (from MONTHLY-INTELLIGENCE-HOVER-NAVIGATION) from a simple "this data goes here" badge into a small Quick Intelligence analysis card (title / key-value rows / destination CTA). No new navigation, no new canonical calculations — richer popover content built entirely from data already computed elsewhere in the same render. All prior navigation (dynamic Brand Intelligence resolution, Store/Product/Commerce destinations, zero-layout-shift mechanism, delegated click routing) is preserved unchanged.

---

## STARTING HEAD

`ad16673` (MONTHLY-INTELLIGENCE-HOVER-NAVIGATION + doc-fix). `git status --short` at batch start showed only pre-existing untracked BI-BATCH docs; `git diff --stat` empty.

## FILES CHANGED

- `outputs/samplas-marketing-os.js`:
  - New helpers: `monthlyIntelDeltaParts(current, previous)` (splits the existing `monthlyReportDelta` diff/percent math into separate values for per-row display — same `diff = current - previous` calculation, not a new one) and `monthlyIntelPopoverCard(titleHtml, rows, ctaLabel)` (title + key/value rows + destination CTA, shared by every popover in this batch)
  - `monthlyIntelBrandLabelHtml` gained `quantitySold`/`rank` parameters and now builds a full card: 이번 달 매출 (always) / 전월 매출, 증감, 성장률 (only when a previous value exists) / 판매수량 (only when present) / 현재 순위 (from the row's own index)
  - `monthlyIntelProductLabelHtml` gained a `rank` parameter and now builds: 브랜드 / 이번 달 매출 / 판매수량 (if present) / 매출 순위
  - New local helper `monthlyIntelKpiPopoverRows(currentLabel, current, previous, formatter, includeAmountDelta)` inside `renderMonthlyArchiveReport`, reused by 총매출/온라인 매출/온라인 실제 매출 (증감액+증감률) and 온라인 주문수/온라인 객단가/주문수/객단가 (증감률만, per spec section 6)
  - 결제수단 popover and the store donut's legend popover rebuilt on `monthlyIntelPopoverCard` (금액/비중/주문수 and 매출/전체 매출 비중 respectively)
  - All four `labelHtmlFn` call sites (상승 TOP3, 하락 TOP3, 브랜드 TOP5, 상품 TOP5) updated to pass each row's own `quantitySold`/index through, so popover content is fully per-row dynamic
- `outputs/samplas-marketing-os.css`:
  - `.monthly-intel-popover` widened from 230px to 280px max-width (spec-permitted 260-300px range)
  - `.monthly-intel-popover b` restyled as a card title with a bottom divider; new `.monthly-intel-popover-rows`/`.monthly-intel-popover-row` (flex label/value rows with a divider) replacing the old single-line `strong`/`em` styling
  - `.monthly-intel-delta-positive`/`-negative` reuse the existing `--green`/`--red` tokens for delta coloring (no new color system)
  - `!important` overrides added on the row `span`/`strong` (font-size/display/font-weight/color/text-transform) — see CSS bug section below
- `test/monthly-intel-navigation.test.mjs` — 2 stale assertions updated to match the new function signature/max-width range (this batch legitimately changes both)
- `test/monthly-quick-intelligence.test.mjs` — new, 30 tests

No changes to `outputs/samplas-marketing-os.html`, `server.mjs`, `intelligence-service.mjs`, or `work/`.

## QUICK INTELLIGENCE DESIGN

Every popover now follows one shared card shape, built by `monthlyIntelPopoverCard`:

```
<title>
──────────
label   value
label   value
──────────
Destination →
```

Dark card language unchanged (`var(--ink)` background, white text). Positive/negative deltas reuse the existing `--green`/`--red` semantic tokens — no new color system. Font hierarchy: title 13px/800, row label 11px subdued white, row value 12px/700 bright white (or green/red for deltas). CTA stays a plain (non-clickable) destination indicator — per the "안정성 우선" decision in the spec, the whole row/label remains the single click target rather than adding a separate interactive CTA button, avoiding any new pointer-leave/re-enter complexity. Mechanism is unchanged from the prior batch: the popover is always present in the DOM and toggled purely by CSS `opacity`/`transform` on `:hover`/`:focus-visible`, `pointer-events: none` throughout.

## BRAND POPOVER DATA

**Used** (already computed elsewhere in the same render, no new calculation):
- 이번 달 매출 — `currentAmount` (already passed into the old popover too)
- 전월 매출 / 증감 / 증감률 — from `monthlyIntelDeltaParts(currentAmount, previousAmount)`, same math as the pre-existing `monthlyReportDelta`
- 판매수량 — `item.quantitySold`, already present on every `commerce.brandSales` row (server-side `aggregateCafe24BrandSalesByBrandCode` already returns it; confirmed by reading `server.mjs`)
- 현재 순위 — the row's own 0-based index from `monthlyReportRankRows`, +1

**Omitted, and why**: nothing was omitted for brand rows — all six spec-priority fields (이번 달 매출/비교 월 매출/증감액/증감률/판매수량/현재 ranking) were already available from data already fetched or already rendered elsewhere on the row, so all six are shown whenever the underlying value exists. When a brand has no matching previous-month row (rare — only happens if brand_code didn't exist last month), the 전월/증감/증감률 rows are simply omitted rather than fabricated.

## DYNAMIC BRAND TEST

Verified with the following distinct brands, from three different Monthly sections (상승 TOP3, 하락 TOP3, TOP5), confirming the popover content and the click destination are both genuinely per-row dynamic — not hardcoded to one brand:

| Brand | Monthly section | Popover content (live) | Clicked → Brand Intelligence selected |
| --- | --- | --- | --- |
| TROUBLED WATERS | 상승 TOP3 #1 | 이번 달 8,274,400원 · 전월 2,414,200원 · 증감 +5,860,200원 · 성장률 +242.7% · 판매수량 26개 · 순위 1위 | (verified via popover content match; navigation confirmed via the identical mechanism on the other 3 brands below) |
| AESIR STUDIOS | 상승 TOP3 #2 | 이번 달 1,507,200원 · 전월 695,200원 · 증감 +812,000원 · 성장률 +116.8% | ✅ "AESIR STUDIOS" (via `#entityHeroName`) |
| ROCK STEADY | 하락 TOP3 #1 | 이번 달 0원 · 전월 1,348,423원 · 증감 -1,348,423원 · 성장률 -100.0% | ✅ "ROCK STEADY" |
| CARNET ARCHIVE | TOP5 #1 | 이번 달 2,231,959원 · 전월 2,448,430원 · 증감 -216,471원 · 성장률 -8.8% · 판매수량 34개 | ✅ "CARNET ARCHIVE" (Brand Intelligence hero also showed 판매수량 34개, matching exactly) |

Also spot-checked 4 more brands purely for dynamic-content variety (PHTMNE, GOOMHEO, LSOUL, BONNAE) — every one had distinct, internally-consistent numbers (e.g. ROCK STEADY/GOOMHEO/LSOUL all correctly show "이번 달 매출 0원" + "-100.0%" for brands that sold nothing this month but had sales last month). No brand name appears literally anywhere in the popover-building source code (`monthlyIntelBrandLabelHtml`, `monthlyIntelPopoverCard`) — confirmed via `test/monthly-quick-intelligence.test.mjs` test 2, which greps for known brand-name literals and asserts none are found.

## PRODUCT POPOVER

Card shows: 브랜드 (canonical display name) / 이번 달 매출 / 판매수량 (when `item.quantitySold` is present) / 매출 순위. No 전월 comparison row — Monthly does not currently compute or store previous-month product sales, and per the batch's own constraint, no new calculation/API surface was added to produce one. Destination unchanged: the existing Product Dashboard (`data-jump-view="Product"`) — same conclusion as the prior batch's investigation (Product Registry is a diagnostic review-queue screen, not a general catalog, so no per-item deep link was fabricated). Live-verified: clicked the #1 TOP5 product ("[CARNET ARCHIVE : 카르넷 아카이브] ZIP BELT EGG CLUSTER SLEEVE KNIT BLOUSE IVORY"), landed on `#product` (Product Dashboard) with matching catalog data.

## STORE POPOVER

Card shows only 매출 and 전체 매출 비중 — the two fields that actually exist today (reusing the exact same `computeMonthlyStoreOfflineBreakdown` byStore/share computation the donut already had). 전월 대비/주문수/객단가 were explicitly **not** added: no store-specific previous-month fetch or per-store order-count/AOV data exists anywhere in the current render context, and adding one would require a new fetch — out of scope per the batch's own instruction ("store upload/data attribution은 별도 작업이다... 이 문제를 이번 batch에서 해결하려 하지 않는다"). The donut's rendering gate (`storesIncluded` must include both APGUJEONG and VAIL) was left untouched — verified live that every month in the current archive (2026-02 through 2026-08) still has `storesIncluded: []`, so the donut correctly does not render with real data. Rendering logic was instead visually verified via a safe temporary DOM injection (calling `monthlyStoreDonutBlock()` directly with representative store totals in the browser console, appended to a throwaway debug `<div>`, then removed) — showed "압구정 / 매출 66,699,888원 / 전체 매출 비중 68.7%" correctly, with the legend-row hover background and click-through to `#store-vail-intelligence` both confirmed working.

## COMMERCE POPOVER

- 총매출 / 온라인 매출 / 온라인 실제 매출: 이번 달 / 전월 / 증감 (colored) / 증감률 (colored) / "Commerce →" — verified live, e.g. 총매출 popover showed "이번 달 97,177,592원 · 전월 273,544,433원 · 증감 -176,366,841원 (red) · 증감률 -64.5% (red)".
- 온라인 주문수 / 온라인 객단가 / 주문수 / 객단가: 이번 달 / 전월 / 증감률 only (no raw 증감액 row, per spec section 6 — counts read better as a percentage than a raw diff).
- 오프라인 매출: unchanged from the prior batch — hover-only, no click destination (ALL-mode combined total can't map to one specific store; the donut below is the correct place for per-store detail).
- 결제수단: 금액 / 비중 / 주문수 rows, CTA relabeled "Commerce 결제수단" (was "Commerce 상세"). Live-verified: clicked "신용카드", landed exactly at Commerce's 결제수단 section showing "신용카드 86.2% / 15,551,545원 · 주문 42건" — matching the popover precisely.

## CSS BUG FOUND DURING BROWSER QA (and fix)

**Found**: hovering the 총매출 hero number showed popover row values ("97,177,5...", "273,544...") rendered at a giant font size instead of the intended small 12px card text.

**Root cause**: `.monthly-intel-popover-row strong` never declared its own `font-size`. CSS cascade resolves per-property, not per-rule — since the pre-existing `.monthly-report-hero-main strong { font-size: clamp(34px, 5vw, 62px); ... }` rule (equal specificity, and the popover's `<strong>` is a DOM descendant of `.monthly-report-hero-main` since the popover lives inside the hero button) does declare `font-size` and mine didn't, the ambient giant font-size "won" for that one property even though my rule came later in the stylesheet and would have won on every property it did declare.

**Fix**: explicitly pinned every property that any ambient card rule (hero-main/side-row/legend-row/rank-row's existing broad `span`/`strong` styling) could set — `display`, `font-size`, `font-weight`, `color`, `text-transform`, `margin` — on `.monthly-intel-popover-row span`/`strong`, using `!important` (same justification already established for `.store-intel-link-affix` in STORE-INTEL-UI-B: a self-contained floating utility element must never inherit ambient typography rules regardless of which card it renders inside). Delta tone color overrides (`.monthly-intel-delta-positive`/`-negative`) also needed `!important` to win against the now-`!important` base color. Verified fixed live: total-sales popover now shows "97,177,592원"/"273,544,433원" at the correct small size, with the negative delta correctly colored red (`var(--red)`).

A regression test (`test 10c` in `test/monthly-quick-intelligence.test.mjs`) was added specifically guarding that `font-size` is pinned with `!important` on both row `span` and `strong`, so this exact leak can't silently return.

## DATA CALCULATION CHANGED

**No.** `server.mjs` is untouched (confirmed via `git diff --stat` — 0 lines). Every popover value comes from data already fetched/computed in the same render pass: `commerce.*`, `previousCommerce.*`, `performanceBrandSalesOnline`, `canonicalProductSales`, `computeMonthlyStoreOfflineBreakdown`. `monthlyIntelDeltaParts` and `monthlyIntelKpiPopoverRows` are presentation-layer helpers that split/reuse `monthlyReportDelta`'s existing `diff = current - previous` arithmetic into separately-displayable rows — they do not introduce any new business calculation. No new fetches were added anywhere.

## BROWSER QA

Verified live at 127.0.0.1:8787 (2026-08 archive):

1. **총매출 hover**: PASS — card shows 이번 달/전월/증감(red)/증감률(red)/"Commerce →", zero layout shift, fits within its card.
2. **상승 브랜드 hover (TROUBLED WATERS, AESIR STUDIOS)**: PASS — popover content verified via `getComputedStyle`/`textContent` (opacity:1, correct dynamic values); underline hover-affordance visually confirmed in screenshot.
3. **하락 브랜드 hover (ROCK STEADY)**: PASS — same verification, correctly shows negative/zero-sales figures.
4. **브랜드 TOP5 hover (CARNET ARCHIVE)**: PASS.
5. **Brand Intelligence dynamic navigation — 3+ distinct brands**: PASS — AESIR STUDIOS, ROCK STEADY, CARNET ARCHIVE all independently clicked and each correctly selected its own brand in Brand Intelligence (`#entityHeroName` matched every time); TROUBLED WATERS separately confirmed via matching popover data (already proven live in the prior batch for this exact brand/mechanism).
6. **상품 TOP5 hover/click**: PASS — popover showed 브랜드/이번 달 매출/판매수량/매출 순위; click landed on Product Dashboard with matching catalog row.
7. **결제수단 hover/click**: PASS — popover showed 금액/비중/주문수; click landed exactly at Commerce's 결제수단 section with matching figures.
8. **Store donut (via safe temp injection, since no month currently has real store-split data)**: PASS — legend hover/click and card content verified as described above.
9. **Zero layout shift**: PASS — `MutationObserver` recorded 0 DOM mutations across a hover cycle; `getBoundingClientRect()` of the hero card, a brand row, and both chapter containers were byte-identical before/after hover (re-verified with the new, larger card content, not just the old simple badge).
10. **Keyboard `:focus-visible`**: PASS structurally — the CSS mechanism (`.monthly-intel-link:focus-visible .monthly-intel-popover`, `.monthly-intel-link-inline:focus-visible .monthly-intel-popover`) is byte-identical to the prior batch's mechanism, which was already live-verified with real Tab-key presses in that batch's QA; only the popover's inner content changed in this batch, not the focus-trigger CSS.
11. **Console errors**: PASS — only the known benign Chrome-extension messaging noise seen in every prior batch's QA (`onlyErrors: true` check, 3 identical benign exceptions, zero application errors).
12. **Today/Annual regression**: PASS — both screenshot-identical to pre-batch (Today: same 97,177,592원 총매출, all cards intact; Annual: same ~2,060,973,554원 cumulative total, own Marketing/Content tabs still present and untouched).

## QUICK INTELLIGENCE TEST

**30/30 PASS** (`test/monthly-quick-intelligence.test.mjs`) — covers: no hard-coded brand/product names; brand card row priority/omission logic; dynamic per-row quantitySold/rank plumbing for all 4 rank-row call sites; brand_code-based (not name-based) resolution preserved; product card fields and destination; Commerce KPI `includeAmountDelta` flag behavior; payment method card; store donut card field omission and unchanged rendering gate; `--green`/`--red` token reuse (no new color system); the CSS-leak regression guard; zero-layout-shift/pointer-events:none mechanism preserved; `:focus-visible` preserved; Store/Product/Commerce destinations all still reachable; Today/Annual/server.mjs untouched; Commerce figures unchanged.

## FULL REGRESSION

**654/654 PASS** (`node --test test/*.test.mjs`) — 624 pre-existing + 30 new. This exact result was obtained immediately before the interruption and git state confirms no code changed since (working tree matches what was tested); not rerun per the resume instructions.

## KNOWN ISSUES

- **Tooling, not a product bug**: the Chrome automation's `screenshot` action reliably captures hover state for large block-level triggers (e.g. the 총매출 hero) but frequently fails to capture it for small inline triggers (brand/product/payment-method row labels), even when a same-moment `getComputedStyle` check confirms `opacity: 1` and correct on-screen positioning. This is the same class of automation-environment artifact already documented in the prior batch's report (`resize_window`, smooth-scroll completion) — verified via direct computed-style inspection and full click-through navigation instead, which is unaffected by this limitation.
- **Store Quick Intelligence cannot be verified with real live data**: every month in the current archive has `storesIncluded: []` (no store-separated offline upload has ever occurred in this environment — predates this batch). Rendering was verified via a safe temporary code-path injection instead of relaxing the gate or fabricating data, per the batch's explicit instruction not to solve store upload/attribution in this batch.

---

## COMMITS

(recorded after commit — see follow-up doc-fix)

## FINAL HEAD

(recorded after commit — see follow-up doc-fix)

## PUSH: NONE
## DEPLOY: NONE
