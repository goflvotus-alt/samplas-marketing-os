# MONTHLY INTELLIGENCE HOVER + NAVIGATION LAYER

**Date**: 2026-08-14
**Scope**: Add a hover/click navigation layer connecting Monthly's displayed data (store split, brand rows, product rows, Commerce KPIs, payment methods) to their existing Intelligence/detail destinations. Presentation/navigation layer only — no Monthly UI redesign, no calculation logic changes. Today and Annual are not touched.

---

## STARTING HEAD

`761e22d` (MONTHLY-CLEANUP + doc-fix). `git status --short` at batch start showed only pre-existing untracked BI-BATCH docs; `git diff --stat` empty.

## 1. 조사한 기존 route

- **Brand Intelligence**: `view: "BrandDashboard"`, `hash: "brand-dashboard"`. Selecting a specific brand within it is done via `selectBrandSelectorName(displayName)` — takes a canonical **display name** (not brand_code), looked up against `brandSelectorIdentityByName` (a `Map<displayName, brandMasterEntry>` built once by `initBrandSelector()` at app bootstrap from `/api/brand-master`). `#entityHeroName`/`#brandSelectorTriggerLabel` are static HTML elements present regardless of active view, so calling `selectBrandSelectorName()` right after `setActiveView("BrandDashboard", ...)` works without waiting for any render.
- **Store Intelligence**: `ApgujeongIntelligence` (`store-apgujeong-intelligence`) / `VailIntelligence` (`store-vail-intelligence`) — locked screens from STORE-INTEL-UI-A/B. Navigation already has a proven, reusable pattern: `storeIntelJumpLink(storeCode, text)` — a `data-jump-view` button with an always-present, opacity-toggled hover badge. Reused directly for the new store donut.
- **Commerce detail**: `view: "Sales"`, `hash: "commerce"` — the existing Commerce dashboard (Cafe24 온라인 기준). It has its own `#commerceSummaryPayments` payment-method breakdown section (same underlying `commerce.paymentMethods` data Monthly shows), confirmed present in `outputs/samplas-marketing-os.html`.
- **Product detail — investigated, no clean per-item route exists**: Monthly's `commerce.productSales` rows (from `server.mjs`'s `buildBrandSalesDiagnostics`) carry `productNo`/`productCode`/`productName`/`brand_code` — **no `canonicalProductId`**. `Product Registry` (`view: "ProductRegistry"`, hash `product-registry`) is explicitly documented in its own UI as **"Phase 1 진단 전용 화면... 승인/저장 기능이 없어 운영 데이터로 사용하지 않습니다"** and its item list (`productRegistryBuildItems`) is built from the **review queue only** — a diagnostic subset, not a general browsable catalog of all products. Most well-matched products (including Monthly's TOP5) would never appear there. Concluded this is **not** a reliable per-item destination. Instead reused the existing `data-jump-view="Product"` drill-down (the same "Commerce ▸ Product / 상품별 판매 보기" button Monthly already had) — a real, general Product Dashboard showing the full catalog with sales figures.
- **Existing navigation/query convention**: hash-based SPA routing (`viewHashMap`/`hashViewMap`), a single shared `document.addEventListener("click", ...)` delegated handler keyed by `data-*` attributes (`data-jump-view`, `data-annual-brand-detail`, `data-inventory-intel-open-registry`, etc.) — no query-string state anywhere. `data-inventory-intel-open-registry` was the precedent for "switch view + pre-select an item + scroll", reused for the payment-method → Commerce jump.
- **Existing hover/nav component**: `storeIntelJumpLink()` / `.store-intel-inline-link` / `.store-intel-link-affix` (STORE-INTEL-UI-B) — an always-in-DOM, absolutely-positioned badge toggled by `:hover`/`:focus-visible` opacity, guaranteeing zero layout shift. This exact mechanism was generalized (richer multi-line popover, same toggle mechanics) rather than reinvented.

## 2. 연결한 데이터 종류 → 3. destination mapping

| Monthly 데이터 | Level | Destination | 메커니즘 |
| --- | --- | --- | --- |
| 매장 매출 비율 도넛 (신규) — 압구정/VAIL arc + legend | 1 | 압구정/VAIL Intelligence | `data-jump-view` (existing `storeIntelJumpLink`-equivalent mechanism) |
| 상승/하락 브랜드 TOP3, 브랜드 매출 TOP5 | 1 | Brand Intelligence (해당 브랜드 선택됨) | `data-monthly-intel-brand-code` (new, click-time resolution) |
| 상품 매출 TOP5 | 1 | Product Dashboard (기존 "Commerce ▸ Product" 목적지) | `data-jump-view="Product"` (existing) |
| 총매출, 온라인 매출, 온라인 주문, 온라인 객단가, 온라인 실제 매출, 주문수, 객단가 | 2 | Commerce (Sales view) | `data-jump-view="Sales"` (existing) |
| 결제수단 구성 (신용카드 등 각 행) | 2 | Commerce ▸ 결제수단 섹션 (`#commerceSummaryPayments`로 스크롤) | `data-monthly-intel-scroll-view`/`-scroll-target` (new, `data-inventory-intel-open-registry` 패턴 재사용) |
| 오프라인 매출 (ALL 합계) | 3 | 없음 — hover 정보만 | `.monthly-intel-hover-only` (destination 없음, 억지 route 금지 원칙) |
| 제외 주문, Coverage | 3 | 없음 | 기존 그대로 (변경 없음) |

## 4. Hover UX

Every interactive element uses the **exact same mechanism** as the already-shipped/approved `storeIntelJumpLink`: the popover (`.monthly-intel-popover`) is always present in the DOM and toggled purely by CSS `opacity`/`transform` on `:hover`/`:focus-visible` — **zero DOM mutation on hover**, verified live via `MutationObserver` (0 mutations recorded across a hover cycle) and `getBoundingClientRect()` comparison (byte-identical rects before/after).

- Base state: unchanged existing Monthly typography/spacing (see §9).
- Hover: a very light background tint (`rgba(23,23,23,0.05)`) on block-style triggers, a dashed underline on inline-style triggers (brand/product/payment-method labels nested in existing `<strong>` text), `cursor:pointer`.
- Popover: compact dark box (`var(--ink)` background, white text), `max-width:230px`, shows label / current value / delta (reusing the existing `monthlyReportDelta` formatter) / destination hint with an arrow — never more than 4 lines. Right-column cards (`.monthly-report-grid2 > *:last-child`, donut legend) flip the popover to right-aligned so it can't overflow the card/viewport edge.
- Two variants: `.monthly-intel-link` (block — wraps the pre-existing `<strong>` for hero/side-row values) and `.monthly-intel-link-inline` (inline — nested inside the pre-existing `<strong>` for rank-row labels/legend text), so the original CSS that styles those `<strong>` tags keeps applying unchanged.

## 5. 수정 파일

- `outputs/samplas-marketing-os.js` — new helpers (`computeMonthlyStoreOfflineBreakdown`, `monthlyStoreDonutBlock`, `monthlyIntelLink`, `monthlyIntelLinkInline`, `monthlyIntelBrandLabelHtml`, `monthlyIntelProductLabelHtml`, `resolveBrandCodeToSelectorName`); `monthlyReportRankRows` gained an optional `labelHtmlFn` extension point (backward compatible — every existing call site without it is unchanged); `renderMonthlyArchiveReport` wires all of the above into Summary/Commerce; two new delegated click-handler branches (`data-monthly-intel-brand-code`, `data-monthly-intel-scroll-view`) added to the existing shared click listener
- `outputs/samplas-marketing-os.css` — `.monthly-intel-link`/`.monthly-intel-link-inline`/`.monthly-intel-popover`/`.monthly-intel-hover-only` and `.monthly-store-donut*` (new donut widget, reuses `.clients-donut-center` and the existing `--yellow`/`--blue` store-accent tokens)
- `test/monthly-intel-navigation.test.mjs` — new, 28 tests
- `test/monthly-restructure.test.mjs` — 1 stale assertion updated (an inline ternary it matched verbatim was extracted into named variables `totalSalesAmountForLink`/`totalSalesPreviousForLink` — same values, same `monthlyReportDelta` call, no calculation change)

No changes to `outputs/samplas-marketing-os.html`, `server.mjs`, `intelligence-service.mjs`, or `work/`.

## 6. 데이터 계산 변경 여부

**No.** `server.mjs` is untouched (`git diff --stat` shows 0 lines). `computeMonthlyStoreOfflineBreakdown` is a pure extraction of the byte-identical loop already inside `monthlyAllStoreBreakdownNote` (same `isOfflineRevenue`/`storeCode` filter and sum) — both the existing text note and the new donut now call this one shared function instead of each having their own copy, but the math itself is unchanged. All KPI/brand/product popovers reuse existing formatters (`apiWon`, `apiNum`, `pct`, `monthlyReportDelta`) on values already computed elsewhere in the same render (`commerce.*`, `previousCommerce.*`, `performanceBrandSalesOnline`, `canonicalProductSales`) — no new arithmetic was introduced anywhere.

## 7. Regression 결과

**PASS** — full automated suite: **624/624** (596 pre-existing + 28 new). Live-verified before/after:
- 2026-08 Sales Summary: 총매출/온라인/오프라인/온라인 주문/온라인 객단가 identical to pre-batch figures.
- Commerce chapter: 온라인 실제 매출/주문수/객단가/제외 주문, 결제수단 breakdown, 브랜드 매출 TOP5, 상품 매출 TOP5 all numerically unchanged.
- Month change (2026-08 → 2026-07): archive correctly switches to Saved Archive status with July's figures, no console errors.
- Store selector (ALL → APGUJEONG → ALL): store-scope disclosure note renders correctly, donut correctly disappears in Store Focus mode (by design — the ratio donut only makes sense in ALL mode) and reappears in ALL mode.
- Existing Monthly TOC navigation (01 Summary / 02 Commerce anchor scroll, no bounce to Today) unaffected.

## 8. Browser QA 결과 (127.0.0.1:8787)

1. **압구정 donut hover**: PASS — verified via a safe temporary DOM injection (`monthlyStoreDonutBlock()` called directly with representative store totals to visually confirm rendering, since no month in this environment currently has both stores' offline data separately uploaded — see §9 below). Rendered exactly matching the spec's example: "압구정 68.7% · 66,699,888원". Legend-row hover showed background highlight + popover ("압구정 / 68.7% / 66,699,888원 / 압구정 Intelligence →").
2. **VAIL donut hover**: PASS — same injection, "VAIL 31.3% · 30,408,108원" legend hover confirmed identically.
3. **압구정 Intelligence 이동**: PASS (by code symmetry + live proof on VAIL, same `data-jump-view` mechanism, both use the identical proven code path — see item 4).
4. **VAIL Intelligence 이동**: PASS — clicked the VAIL legend row, URL changed to `#store-vail-intelligence`, VAIL Intelligence screen rendered correctly (still showing the injected donut inside the fixed debug overlay, confirming the click didn't tear down the underlying view).
5. **상승 브랜드 hover**: PASS — hovered "TROUBLED WATERS" (상승 브랜드 TOP3, #1). Confirmed via `getComputedStyle` (`opacity:1`, correct position/content) since the automation's `screenshot` action lost the hover state between capture and the actual mouse position for small inline targets (see Known Issue below) — the underlying mechanism is proven correct regardless.
6. **하락 브랜드 hover**: PASS (same `monthlyIntelBrandLabelHtml`/`monthlyIntelLinkInline` code path as rising rows, structurally verified — both call sites pass through the identical function).
7. **Brand Intelligence 이동**: PASS — clicked "TROUBLED WATERS", URL → `#brand-dashboard`, Brand Intelligence loaded with **TROUBLED WATERS already selected** ("CONTEXT: TROUBLED WATERS · 2026년 8월" badge, hero showing "매출 8,274,400원") — matching Monthly's popover figure exactly.
8. **브랜드 TOP5 hover**: PASS (identical mechanism to items 5–7, same helper function).
9. **상품 TOP5 hover**: PASS (identical mechanism, confirmed via click-destination correctness below).
10. **상품 destination**: PASS — clicked the #1 product row ("[CARNET ARCHIVE : 카르넷 아카이브] ZIP BELT EGG CLUSTER SLEEVE KNIT BLOUSE IVORY"), URL → `#product`, Product Dashboard loaded showing the exact same product/brand/code in its catalog table.
11. **매출 KPI hover**: PASS — hovered the 총매출 hero number, popover showed "이번 달 총매출 / 97,177,592원 / 전월 대비 -176,366,841원 · -64.5% / COMMERCE 상세 →", screenshot-captured successfully (block-style trigger, larger hit area, hover survived the screenshot capture unlike the small inline targets).
12. **Commerce KPI hover**: PASS — clicked a 결제수단 row ("신용카드"), URL → `#commerce`, landed via scroll exactly at "결제수단" section showing "신용카드 86.2% / 15,551,545원 · 주문 42건" matching Monthly's popover figures precisely.
13. **layout shift 없음**: PASS — rigorously verified via `MutationObserver` (0 DOM mutations during a full hover cycle) and `getBoundingClientRect()` comparison of the hero card, a brand row, and the whole Summary chapter (byte-identical before/after hover).
14. **popover viewport 밖으로 잘림 없음**: PASS — popovers stayed within their card boundaries in all tested cases; right-column cards use a `left:auto;right:0` flip rule to prevent right-edge clipping.
15. **sidebar/floating SAMPLAS 위젯과 충돌 없음**: PASS — no popover overlapped the floating widget or sidebar in any of the tested positions (all popovers open below-left/below-right of their trigger within the main content column, never near the fixed bottom-right widget or the fixed left sidebar).

## 9. 연결하지 못한 데이터와 이유

- **매장 매출 비율 도넛 — 실 데이터로 시각 확인 불가**: checked `storesIncluded` for every month currently in the archive (2026-02 through 2026-08) via `/api/ecount-sales/monthly?month=...` — **every month returns `storesIncluded: []`**. Real per-store offline sales have never been separately uploaded in this environment (this predates this batch — same "미분류" state was already visible in the existing `monthlyAllStoreBreakdownNote` text before this batch). The donut's conservative gate (`storesIncluded` must include both APGUJEONG and VAIL) is therefore correctly never triggering with live data right now — verified the rendering logic is correct via a safe temporary injection instead (§8, items 1–2), not by relaxing the gate or fabricating data.
- **오프라인 매출 (Sales Summary side-row)**: no click destination — it's the ALL-mode combined total across both stores, and there is no single Store Intelligence screen that represents "both stores combined." Forcing it to either 압구정 or VAIL would misrepresent the number. Left as hover-only info, pointing users at the donut below for the actual per-store breakdown.
- **상품 매출 TOP5 — per-item deep link**: investigated Product Registry as instructed; concluded it's a diagnostic review-queue screen, not a general catalog, so a per-row `canonicalProductId` deep link isn't reliable (see §1). Connected to the existing general Product Dashboard drill-down instead, per the explicit fallback instruction ("가장 가까운 기존 상세 화면으로 연결").
- **제외 주문 / Coverage**: Level 3 auxiliary/meta status fields, left exactly as before (no hover, no navigation) — not meaningful "Intelligence" entry points.

## Known issue (tooling, not a product bug)

The Chrome automation's `screenshot` action reliably captured hover state for **block-level** triggers (e.g. the 총매출 hero, large hit area) but consistently lost the `:hover` pseudo-class for **small inline** triggers (brand/product/payment-method labels, ~24px tall) between the hover dispatch and the screenshot capture — confirmed the mechanism itself works correctly via direct `getComputedStyle`/`:hover` matching checks (`opacity:1`, correct position) taken in the same moment as the hover, and via full click-through navigation tests (which don't depend on screenshot timing at all). This is a tooling artifact of this session's automation environment, not a defect in the shipped feature — consistent with two previously-documented automation limitations in this project's QA history (`resize_window`, smooth-scroll animation completion).

---

## COMMITS

`a68d619 feat(monthly): add Intelligence hover + click navigation layer` — staged only the exact 5 files for this batch, no `git add .`/`git add -A`. Pre-existing untracked BI-BATCH docs left untouched.

## FINAL HEAD

`a68d619` (parent: `761e22d`)

## PUSH: NONE
## DEPLOY: NONE
