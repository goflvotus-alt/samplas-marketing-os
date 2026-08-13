# STORE-INTEL-UI-B — Intelligence Hover + Navigation Layer

**Date**: 2026-08-13
**Scope**: Add hover + click navigation affordance from existing 압구정/VAIL store-breakdown text on Today (and, where a suitable existing target already exists, Monthly) into the locked 압구정 Intelligence / VAIL Intelligence UI Shell screens (STORE-INTEL-UI-A). No redesign of the approved Store Intelligence UI, no real data connection.

---

## STARTING HEAD

`cdf4605` (STORE-INTEL-UI-A, user visual approved). `git status --short` at batch start showed only pre-existing untracked BI-BATCH docs; `git diff --stat` empty.

## TODAY APGUJEONG: **PASS**
## TODAY VAIL: **PASS**

The existing ALL-mode store breakdown segment in Today's 총매출 card (`온라인 X · 오프라인 Y · 압구정 Z · VAIL W`, built in STORE-BATCH-D) now wraps the 압구정/VAIL portions in a new `storeIntelJumpLink()` helper — an inline `<button>` styled to look exactly like plain text at rest (no visible chrome, reuses the card's existing color/typography), with a hover/focus-revealed `Intelligence →` badge and native click routing. Live-verified: hovering "압구정 미분류" shows `압구정 Intelligence →`; clicking navigates to `#store-apgujeong-intelligence` and renders the exact UI-A screen. Same confirmed for VAIL → `#store-vail-intelligence`.

## MONTHLY: **PASS**

Monthly's existing ALL-mode `매장 구성: 온라인 X · 압구정 Y · VAIL Z.` note (built in STORE-BATCH-D, `monthlyAllStoreBreakdownNote`) reuses the identical `storeIntelJumpLink()` helper — no new card, no UI restructuring, exactly the same function called from a second location. Live-verified hover/click both work identically to Today.

## ANNUAL: **DEFERRED**

No suitable existing target. Annual only shows a 압구정/VAIL-named text when `storeFilterState !== "ALL"` (`annualStoreScopeNote`, store-focus mode) — there is no ALL-mode 3-axis breakdown text in Annual (STORE-BATCH-D did not build one for Annual, unlike Today/Monthly). Live-confirmed: `document.querySelector('#annualArchiveFlow .store-filter-note')` returns null when `storeFilterState === "ALL"` (the default). Creating a new ALL-mode note purely to have a hover target would violate the batch's explicit "새 카드를 만들지 않는다" / "UI 구조를 바꾸면서까지 연결하지 않는다" constraints, so this was left alone and reported honestly as deferred rather than forced.

## HOVER AFFORDANCE: **PASS**

Implemented as a small dark badge (`.store-intel-link-affix`, reuses existing `--ink` token, 10px/800-weight text) that is always present in the DOM (never inserted/removed by JS) and `position: absolute`, so it can never affect the surrounding text flow. Underline (`border-bottom: 1px dashed`) provides the at-rest-to-hover visual cue on the link text itself, per the "border 강조" allowed pattern. Transition is 160ms (within the specified 120–200ms range). No scale animation, no color flash, no gradient — only opacity/transform(translateY 3px) on the badge and a border-color change on the link text.

**Bug found and fixed during this batch's own QA**: two pre-existing broad card-typography CSS rules (`.action-item.sales-compare-card span { white-space: normal }` and a matching `{ overflow: hidden }` / implicit `min-width: 96px` rule) had higher specificity than the new badge class and were silently wrapping/clipping the "Intelligence →" text to an unreadable fragment. Found via direct DOM measurement (`scrollWidth` 137px vs `clientWidth` 96px) after the first hover screenshot looked wrong, fixed with three narrowly-scoped `!important` overrides (`white-space`, `overflow`, `min-width`/`width`) on the badge class specifically — justified because this is a self-contained floating utility element that must never inherit ambient card span-typography rules regardless of which card it happens to render inside.

## CLICK NAVIGATION: **PASS**

Reuses the exact pre-existing generic delegated handler (`document.addEventListener("click", ...)` → `event.target.closest("[data-jump-view]")` → `document.querySelector('[data-view="..."]')?.click()`) that already powers every other `today-jump-button` in the app (Commerce 보기, 월간 리포트 보기, etc.) — no new routing code was written. `storeIntelJumpLink()` just sets the same `data-jump-view` attribute with the target view name (`ApgujeongIntelligence`/`VailIntelligence`). Browser history/hash behavior is therefore byte-identical to sidebar navigation, since it's the same code path (`setActiveView` → `updateViewHash`).

## KEYBOARD: **PASS**

Jump links are real `<button type="button">` elements (not styled `<span>`s), so Tab focus and native Enter/Space activation work with zero custom keydown code. Verified live: (1) real Tab-key traversal on the page correctly matches `:focus-visible` on sibling nav buttons, confirming the browser's standard `:focus-visible` heuristic is active on this page; (2) the identical `:focus-visible` CSS mechanism (unmodified, standard) is applied to the new buttons — `.store-intel-inline-link:focus-visible` and `.store-intel-inline-link:focus-visible .store-intel-link-affix` — so the same "Intelligence →" affordance a mouse-hovering user sees is also revealed to a keyboard-focused user, satisfying "Hover만 있어야 기능을 발견할 수 있는 구조는 금지."

## NO LAYOUT SHIFT: **PASS**

Measured via `getBoundingClientRect()` before/after hover on both Today's 총매출 card and Monthly's store-composition note:

- Today card: `265.328125 × 215.703125` → `265.328125 × 215.703125` (identical)
- Monthly note: `820 × 18.3984375` → `820 × 18.3984375` (identical)

Zero pixels of shift in either width or height in both locations, confirming the always-present + `position: absolute` badge technique works as designed.

## STORE SELECTOR REGRESSION: **PASS**

`#storeFilterSelect`'s change handler (the global `ALL/압구정/VAIL` data filter) was not touched — verified structurally (its full addEventListener body still starts with `storeFilterState = event.target.value || "ALL"` exactly as before) and confirmed the handler body never references `data-jump-view`, keeping the two concerns (data filter vs. page navigation) structurally separate as required.

## STORE INTELLIGENCE UI LOCK: **PASS**

Zero changes to `outputs/samplas-marketing-os.html` this batch (confirmed via `git diff --stat` — 0 lines touched there). `renderApgujeongIntelligenceView()`/`renderVailIntelligenceView()` (the two locked render functions) were not modified — verified structurally that neither function's body contains any `data-jump-view` attribute, meaning no mock card (스타일리스트/고객/브랜드/상품/Sell-through/재고) became clickable. The pre-existing "더보기 >" button from UI-A remains inert (no `data-jump-view`, unchanged). Live-confirmed both screens render pixel-identical to the UI-A approved screenshots.

## TARGETED TESTS: **15/15 PASS**

New file `test/store-intel-ui-b.test.mjs`:

1-2. jump targets exist (helper maps both store codes to the correct view names)
3-4. jump links reuse the pre-existing generic `[data-jump-view]` delegated handler — no second routing implementation
5. global Store Selector's change handler unchanged; 5b. selector and navigation concerns remain structurally separate
6. hover affix always rendered + absolutely positioned (cannot affect flow); 6b. transition duration within 120–200ms; 6c. no scale animation
7. jump links are native `<button>` (no custom keydown wiring needed); 7b. `:focus-visible` styling present
8. aria-label present on every jump link
9. no `data-jump-view` (or any new clickable attribute) exists inside either locked render function's body
10. UI-A's locked view section ids unchanged in HTML
Plus: Monthly reuses the same helper (no duplicate implementation); Annual confirmed to have no ALL-mode breakdown text (supports the DEFERRED call)

## FULL REGRESSION: **543/543 PASS**

528 (pre-batch) + 15 new = 543, all green. `test/store-intel-ui-a.test.mjs`'s 26 tests are included unmodified and still pass, confirming item 10 of the spec (existing UI-A structural tests remain PASS) at the automated level.

## CHROME QA: **PASS**

- Today: ALL-mode card hovered/clicked for both 압구정 and VAIL — both navigated correctly, screen content matched UI-A exactly.
- Monthly: ALL-mode note hovered/clicked for 압구정 — navigated correctly; badge rendered fully (post-fix) without clipping.
- Annual: confirmed no ALL-mode target exists (supports DEFERRED, not silently skipped).
- Verified Store Intelligence screens' internal mock cards have zero new click handlers (`querySelectorAll('[data-jump-view], .store-intel-inline-link, a[href], button')` inside each section returns only the single pre-existing inert "더보기 >" button).
- Regression swept: Today, Monthly, Annual, Brand Intelligence, Clients, 압구정 Intelligence, VAIL Intelligence — all visually unchanged from their pre-batch/UI-A-approved state.
- Console: no application-level errors across the full session (`onlyErrors: true`); only the known benign Chrome-extension messaging noise seen in every prior batch's QA.

## FILES CHANGED

- `outputs/samplas-marketing-os.js` — new `storeIntelJumpLink()` helper; `storeBreakdown` (Today) and `monthlyAllStoreBreakdownNote` (Monthly) now build their 압구정/VAIL segments through it; two render-site escaping fixes so the generated `<button>` HTML isn't double-escaped into visible text
- `outputs/samplas-marketing-os.css` — `.store-intel-inline-link` (invisible-at-rest inline link reset) and `.store-intel-link-affix` (always-present, absolutely-positioned hover/focus badge) with three narrowly-scoped `!important` overrides to defeat pre-existing broad card-typography rules
- `test/store-intel-ui-b.test.mjs` — new, 15 tests

No changes to `outputs/samplas-marketing-os.html`, `server.mjs`, `intelligence-service.mjs`, or `work/`.

## COMMITS

`8dbdfbf feat(store-intelligence): add intelligence navigation affordances` — staged only the exact 4 STORE-INTEL-UI-B files, no `git add .`/`git add -A`. Pre-existing untracked BI-BATCH docs left untouched.

## FINAL HEAD

`8dbdfbf` (parent: `cdf4605`)

## PUSH: NONE
## DEPLOY: NONE

## NEXT

**STORE-INTEL-DATA-A — Real Data Connection.** Connects the two Store Intelligence screens' mock cards to real ECOUNT/Clients/Inventory sources (per STORE-INTEL-UI-A's stop condition), and revisits Annual once/if a suitable ALL-mode store-scoped text location is designed there.
