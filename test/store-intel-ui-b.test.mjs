import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// STORE-INTEL-UI-B: Intelligence Hover + Navigation Layer. Hover/click affordance only —
// current STORE-INTEL-UI-A screens are locked (structure/layout/mock content unchanged).
// Same structural-assertion pattern as store-intel-ui-a.test.mjs (no jsdom).
let js;
let css;
test.before(async () => {
  js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  css = await readFile(new URL("../outputs/samplas-marketing-os.css", import.meta.url), "utf8");
});

// 1/2. jump targets exist (storeIntelJumpLink helper is the single source both Today and
// Monthly reuse — this is what "target exists" means at the structural level).
test("1. Apgujeong intelligence jump target exists (storeIntelJumpLink maps APGUJEONG -> ApgujeongIntelligence)", () => {
  assert.match(js, /function storeIntelJumpLink\(storeCode, text\)/);
  assert.match(js, /storeCode === "APGUJEONG" \? "ApgujeongIntelligence" : "VailIntelligence"/);
});

test("2. VAIL intelligence jump target exists (same helper, VAIL branch)", () => {
  assert.match(js, /data-jump-view="\$\{esc\(viewName\)\}"/);
});

// 3/4. reuses the existing [data-jump-view] delegated click handler — no new routing.
test("3/4. jump links reuse the existing delegated [data-jump-view] click handler (no new routing system)", () => {
  const handlerMatch = js.match(/const button = event\.target\.closest\("\[data-jump-view\]"\);\s*\n\s*if \(!button\) return;\s*\n\s*document\.querySelector\(`\[data-view="\$\{button\.dataset\.jumpView\}"\]`\)\?\.click\(\);/);
  assert.notEqual(handlerMatch, null, "the pre-existing generic [data-jump-view] delegated handler must still be the only click-routing mechanism");
  // storeIntelJumpLink's generated buttons use the same attribute name, so they are
  // automatically routed by this one handler — verified by attribute name match, not a
  // second implementation.
  assert.match(js, /class="store-intel-inline-link" data-jump-view=/);
});

// 5. Store Selector unchanged (global ALL/APGUJEONG/VAIL filter logic untouched by this batch)
test("5. existing global Store Selector (#storeFilterSelect) change handler is unchanged", () => {
  assert.match(js, /\$\("#storeFilterSelect"\)\?\.addEventListener\("change", \(event\) => \{\s*\n\s*storeFilterState = event\.target\.value \|\| "ALL";/);
});

test("5b. Store Selector and Intelligence navigation remain structurally distinct concerns (selector never dispatches a jump-view click)", () => {
  const selectorHandlerMatch = js.match(/\$\("#storeFilterSelect"\)\?\.addEventListener\("change", \(event\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.notEqual(selectorHandlerMatch, null);
  assert.doesNotMatch(selectorHandlerMatch[1], /data-jump-view/, "the store filter's own change handler must never trigger Intelligence page navigation");
});

// 6. hover must not alter layout structure — verified structurally (affix is always
// present/absolutely positioned, never inserted/removed) plus live-measured in Chrome QA
// (see report) since layout geometry isn't observable from static source alone.
test("6. hover affix is always rendered (not conditionally inserted) and absolutely positioned so it cannot affect flow layout", () => {
  assert.match(css, /\.store-intel-link-affix\s*\{[^}]*position:\s*absolute/);
  // the affix must be part of every jump link's initial markup, not added on hover via JS
  assert.match(js, /<span class="store-intel-link-affix" aria-hidden="true">\$\{esc\(label\)\} Intelligence →<\/span>/);
});

test("6b. hover-visible transition duration is within the specified subtle range (120-200ms)", () => {
  const match = css.match(/\.store-intel-link-affix\s*\{[^}]*transition:\s*opacity (\d+)ms/);
  assert.notEqual(match, null);
  const ms = Number(match[1]);
  assert.ok(ms >= 120 && ms <= 200, `transition duration ${ms}ms must be within 120-200ms`);
});

test("6c. no forbidden large-scale animation (no transform: scale on the link itself)", () => {
  const linkBlock = css.match(/\.store-intel-inline-link\s*\{[^}]*\}/)?.[0] || "";
  assert.doesNotMatch(linkBlock, /scale\(/);
});

// 7. keyboard navigation works — native <button> is used (not a span with custom keydown
// wiring), which guarantees Tab focus + native Enter/Space activation without extra JS.
test("7. jump links are native <button> elements (native keyboard activation, no custom keydown handler needed)", () => {
  assert.match(js, /<button type="button" class="store-intel-inline-link"/);
  assert.doesNotMatch(js, /store-intel-inline-link[\s\S]{0,300}addEventListener\("keydown"/);
});

test("7b. focus-visible state is styled distinctly (keyboard users can perceive the affordance without hovering)", () => {
  assert.match(css, /\.store-intel-inline-link:focus-visible\s*\{/);
  assert.match(css, /\.store-intel-inline-link:focus-visible \.store-intel-link-affix/);
});

// 8. aria-label exists
test("8. every jump link carries an aria-label naming both the value and the destination", () => {
  assert.match(js, /aria-label="\$\{esc\(text\)\} — \$\{esc\(label\)\} Intelligence로 이동"/);
});

// 9. Store Intelligence mock cards remain non-clickable — only the pre-existing (UI-A)
// inert "더보기 >" button exists inside the two views; no new [data-jump-view] or click
// handler was added to any mock card (stylist/customer/brand/product/sell-through/
// inventory) in this batch.
test("9. no new clickable affordance was added inside the two Store Intelligence view render functions themselves", () => {
  const apgujeongFn = js.match(/function renderApgujeongIntelligenceView\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  const vailFn = js.match(/function renderVailIntelligenceView\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(apgujeongFn, /data-jump-view/, "Apgujeong mock cards must stay non-clickable this batch");
  assert.doesNotMatch(vailFn, /data-jump-view/, "VAIL mock cards must stay non-clickable this batch");
});

// 10. existing UI-A structural tests remain PASS — enforced by running the full suite
// (test/store-intel-ui-a.test.mjs is unmodified and included in `node --test test/*.test.mjs`);
// this test additionally guards that this batch did not touch the two locked render functions'
// section-producing structure (title/container ids), only added the Today/Monthly note wiring.
test("10. UI-A's locked view section ids are unchanged", async () => {
  const html = await readFile(new URL("../outputs/samplas-marketing-os.html", import.meta.url), "utf8");
  assert.match(html, /<section id="ApgujeongIntelligence" class="view store-intel-accent-apgujeong">/);
  assert.match(html, /<section id="VailIntelligence" class="view store-intel-accent-vail">/);
});

// Monthly: confirms the same jump-link helper is reused there too (Part 6 of the batch),
// with the ALL-mode 3-axis breakdown note as the target.
test("Monthly reuses storeIntelJumpLink in monthlyAllStoreBreakdownNote (same helper, no duplicate implementation)", () => {
  const fn = js.match(/function monthlyAllStoreBreakdownNote\([\s\S]*?\n\}/)?.[0] || "";
  assert.match(fn, /storeIntelJumpLink\(code, text\)/);
});

// Annual: DEFERRED, not silently skipped — confirms no ALL-mode store-scoped text exists
// in Annual to attach a link to (annualStoreScopeNote is store-focus-mode only), and no new
// UI was force-created just to have a hover target (forbidden by the batch spec).
test("Annual: no ALL-mode store breakdown text exists (confirms DEFERRED — nothing to hook a link into without adding new UI)", () => {
  const fn = js.match(/async function renderAnnualArchiveFlow\([\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(fn, /annualAllStoreBreakdownNote/, "no new ALL-mode note function should have been created for Annual this batch");
});
