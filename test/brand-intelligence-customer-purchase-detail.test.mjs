import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// BATCH A (Customer Purchase Detail). Same source-extraction + Function() execution pattern
// already established by test/brand-intelligence-partial-period.test.mjs and
// test/brand-comparison-yoy-timeout.test.mjs (no jsdom in this repo) — the real function
// bodies are pulled out of outputs/samplas-marketing-os.js and run with a minimal fake DOM
// and injected free variables (entityClientsOverviewData/brandIdentityState), not
// reimplemented.
const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");

function sourceOfFunction(name) {
  const marker = `function ${name}(`;
  const start = js.indexOf(marker);
  assert.notEqual(start, -1, `${name} missing`);
  let depth = 0;
  let opened = false;
  for (let index = start; index < js.length; index += 1) {
    if (js[index] === "{") { depth += 1; opened = true; }
    if (js[index] === "}" && --depth === 0 && opened) return js.slice(start, index + 1);
  }
  throw new Error(`${name} incomplete`);
}

function makeFakeDom() {
  const nodes = new Map();
  const $ = (selector) => {
    const id = selector.replace(/^#/, "");
    if (!nodes.has(id)) {
      nodes.set(id, { textContent: "", innerHTML: "", className: "", hidden: false, style: {}, querySelector: () => null, querySelectorAll: () => [] });
    }
    return nodes.get(id);
  };
  return { $, nodes };
}

// Real purchaseDetails shape confirmed live against /api/intelligence/clients this session
// (Phase 2) — online lines always carry canonicalBrandCode: null by design (personal-payment
// Cafe24 orders have no real product data), only offline ECOUNT lines resolve a brand.
const CARNET_CODE = "B00000KU";
const OTHER_CODE = "B00000SA";

function purchaseLine(overrides = {}) {
  return {
    date: "2026-08-10",
    orderId: "20",
    productName: "CARNET ARCHIVE / Test Jacket",
    brand: "CAR",
    canonicalBrandCode: CARNET_CODE,
    canonicalBrandName: "카르넷 아카이브",
    brandConfidence: "CANDIDATE",
    operationalBrandGroup: "CAR",
    quantity: 1,
    salesAmount: 126400,
    source: "offline",
    rawName: "이종현 실장님",
    ...overrides
  };
}

function clientGroup(overrides = {}) {
  return {
    clientId: "client_abc123",
    name: "이종현 실장님",
    clientType: "stylist",
    aliases: ["이종현 실장님", "이종현 실장님(넥스지)", "이종현 실장님 (스키즈)"],
    purchaseDetails: [
      purchaseLine(),
      purchaseLine({ date: "2026-08-05", orderId: "10", salesAmount: 358400, quantity: 1 }),
      purchaseLine({ canonicalBrandCode: OTHER_CODE, productName: "BONNAE / Other item", brand: "BON", salesAmount: 99000 }),
      purchaseLine({ canonicalBrandCode: null, productName: null, brand: null, source: "online", salesAmount: 50000, date: "2026-08-11", rawName: "개인결제창 온라인 주문" })
    ],
    ...overrides
  };
}

const MATCH_SOURCE = [
  sourceOfFunction("entityClientOverviewMatchFor"),
  sourceOfFunction("entityClientPurchaseLinesFor")
].join("\n\n");

function loadMatchFns(entityClientsOverviewData, brandCode) {
  return Function(
    "entityClientsOverviewData", "brandIdentityState",
    `${MATCH_SOURCE}; return { entityClientOverviewMatchFor, entityClientPurchaseLinesFor };`
  )(entityClientsOverviewData, { brandCode });
}

// 1/2. purchaseDetails -> brand filtering + customer (alias) matching
test("1/2. entityClientPurchaseLinesFor: matches customer by alias and filters to the selected canonicalBrandCode", () => {
  const data = { clients: [clientGroup()] };
  const { entityClientPurchaseLinesFor } = loadMatchFns(data, CARNET_CODE);
  // row.name as Brand Intelligence's Customer Composition would supply it — an alias, not
  // necessarily the group's canonical display name (Phase 3: exact alias-containment match).
  const row = { name: "이종현 실장님(넥스지)" };
  const lines = entityClientPurchaseLinesFor(row);
  assert.equal(lines.length, 2, "only the 2 CARNET-attributed offline lines, not the BONNAE line or the unattributed online line");
  assert.ok(lines.every((l) => l.canonicalBrandCode === CARNET_CODE));
});

test("2b. entityClientOverviewMatchFor: exact-name match and alias-containment match both work; no match returns null", () => {
  const data = { clients: [clientGroup()] };
  const { entityClientOverviewMatchFor } = loadMatchFns(data, CARNET_CODE);
  assert.equal(entityClientOverviewMatchFor({ name: "이종현 실장님" })?.clientId, "client_abc123");
  assert.equal(entityClientOverviewMatchFor({ name: "이종현 실장님 (스키즈)" })?.clientId, "client_abc123");
  assert.equal(entityClientOverviewMatchFor({ name: "존재하지 않는 고객" }), null);
});

// 7. no matching brand purchases -> valid empty result (not a crash, not a fabricated row)
test("7. entityClientPurchaseLinesFor: customer exists but has no purchases in the selected brand -> empty array", () => {
  const data = { clients: [clientGroup()] };
  const { entityClientPurchaseLinesFor } = loadMatchFns(data, "B0000ZZZ");
  assert.deepEqual(entityClientPurchaseLinesFor({ name: "이종현 실장님" }), []);
});

// 9. brand switch: same fetched data, different brandCode -> different (correct) filtered result
test("9. entityClientPurchaseLinesFor: switching brandCode against the same fetched data changes the filtered result correctly", () => {
  const data = { clients: [clientGroup()] };
  const carnetLines = loadMatchFns(data, CARNET_CODE).entityClientPurchaseLinesFor({ name: "이종현 실장님" });
  const otherLines = loadMatchFns(data, OTHER_CODE).entityClientPurchaseLinesFor({ name: "이종현 실장님" });
  assert.equal(carnetLines.length, 2);
  assert.equal(otherLines.length, 1);
  assert.notEqual(carnetLines[0].canonicalBrandCode, otherLines[0].canonicalBrandCode);
});

test("online lines are structurally excluded (canonicalBrandCode is always null for personal-payment orders)", () => {
  const data = { clients: [clientGroup()] };
  const { entityClientPurchaseLinesFor } = loadMatchFns(data, CARNET_CODE);
  const lines = entityClientPurchaseLinesFor({ name: "이종현 실장님" });
  assert.ok(lines.every((l) => l.source === "offline"), "no online line can ever match, by design — not a bug in this batch");
});

// 8. fetch failure must render distinctly from "no purchases" (NULL != ZERO discipline, BI-CORE-4 precedent)
const STATE_SOURCE = sourceOfFunction("entityClientPurchaseStateHtml");
function loadStateHtml(fetchFailed, hasData, brandLines) {
  return Function(
    "entityClientsOverviewFetchFailed", "entityClientsOverviewData",
    `${STATE_SOURCE}; return entityClientPurchaseStateHtml;`
  )(fetchFailed, hasData ? {} : null)(brandLines);
}

test("8. fetch failure state text differs from genuine empty-purchase-history text", () => {
  const failureHtml = loadStateHtml(true, false, []);
  const loadingHtml = loadStateHtml(false, false, []);
  const emptyHtml = loadStateHtml(false, true, []);
  const dataHtml = loadStateHtml(false, true, [purchaseLine()]);
  assert.match(failureHtml, /불러오지 못했습니다/);
  assert.match(loadingHtml, /불러오는 중/);
  assert.match(emptyHtml, /구매 내역이 없습니다/);
  assert.doesNotMatch(failureHtml, /구매 내역이 없습니다/, "a fetch failure must never read as 'no purchases'");
  assert.equal(dataHtml, null, "when real lines exist, the caller proceeds to render them (no empty-state markup)");
});

// 3/4/6. Client Workspace Brand section + Recent Orders section + drawer row template use real fields
test("3/4. clientWorkspaceBodyHtml renders real Brand-section totals and Recent Orders rows for a matched customer", () => {
  const source = [
    "const nf = new Intl.NumberFormat(\"ko-KR\");",
    sourceOfFunction("hasApiValue"),
    sourceOfFunction("apiNum"),
    sourceOfFunction("apiWon"),
    sourceOfFunction("esc"),
    sourceOfFunction("entityClientOverviewMatchFor"),
    sourceOfFunction("entityClientPurchaseLinesFor"),
    sourceOfFunction("entityClientPurchaseStateHtml"),
    sourceOfFunction("clientWorkspaceOrderRowHtml"),
    // BI-BATCH-I: clientWorkspaceBodyHtml now also renders Customer Contribution Grade v1
    // and real Category breakdown — pull in their real source too (no reimplementation).
    sourceOfFunction("entityCustomerContributionGrade"),
    sourceOfFunction("matchCategoryByNameKeywords"),
    sourceOfFunction("categoryKeywordPattern"),
    sourceOfFunction("clientWorkspaceCategoryHtml"),
    sourceOfFunction("clientWorkspaceBodyHtml")
  ].join("\n\n");
  const entityCompositionColors = { stylist: "#000" };
  const entityCompositionTypeLabel = { stylist: "스타일리스트" };
  const CATEGORY_NAME_KEYWORD_RULES = [
    ["TOP", ["t-shirt", "tee", "shirt", "blouse", "knit", "sweater", "cardigan", "hoodie", "sweatshirt", "jersey top", "tank top"]],
    ["BOTTOM", ["pants", "trousers", "jeans", "denim pants", "shorts", "skirt", "slacks"]],
    ["OUTER", ["jacket", "coat", "blazer", "vest", "parka", "bomber", "outer"]],
    ["DRESS", ["dress", "one-piece"]],
    ["BAG", ["bag", "backpack", "tote", "shopper", "pouch"]],
    ["FOOTWEAR", ["boots", "boot", "shoe", "shoes", "sneaker", "sneakers", "mule", "sandal", "sandals", "loafer"]],
    ["HEADWEAR", ["cap", "hat", "beanie", "headwear"]],
    ["JEWELRY", ["necklace", "ring", "earring", "earrings", "bracelet", "bangle", "chain jewelry", "pendant"]],
    ["ACCESSORY", ["belt", "wallet", "keyring", "key chain", "scarf", "tie", "gloves", "sunglasses", "eyewear", "socks", "accessory"]]
  ];
  const CATEGORY_MASTER_V1_NAME_BY_CODE = new Map([["UNCLASSIFIED", "미분류"], ["OUTER", "아우터"]]);
  const html = Function(
    "entityClientsOverviewData", "entityClientsOverviewFetchFailed", "brandIdentityState",
    "entityCompositionColors", "entityCompositionTypeLabel", "entityCompareBrandA",
    "entityCompositionRows", "CATEGORY_NAME_KEYWORD_RULES", "CATEGORY_MASTER_V1_NAME_BY_CODE",
    `${source}; return clientWorkspaceBodyHtml;`
  )(
    { clients: [clientGroup()] }, false, { brandCode: CARNET_CODE },
    entityCompositionColors, entityCompositionTypeLabel, () => "CARNET ARCHIVE",
    [{ name: "이종현 실장님", sales: 1000000, count: 10 }], CATEGORY_NAME_KEYWORD_RULES, CATEGORY_MASTER_V1_NAME_BY_CODE
  )({ name: "이종현 실장님", type: "stylist", count: 10, sales: 1000000, lastPurchase: "2026-08-10" });

  assert.doesNotMatch(html, /고객별 브랜드 구매 데이터 연결 대기/, "old static placeholder text must be gone");
  assert.doesNotMatch(html, /상품 단위 주문 데이터가 연결되지 않았습니다/, "old static placeholder text must be gone");
  assert.match(html, /484,800원/, "Brand-section total = 126,400 + 358,400 (the 2 CARNET-attributed lines only)");
  assert.match(html, /구매 건수[\s\S]*?2건/);
  assert.match(html, /Test Jacket/, "Recent Orders shows the real product name");
  assert.doesNotMatch(html, /BONNAE/, "the other brand's line must not leak into this brand's workspace view");
});

test("6. clientOrders drawer row template (entityDrawerClientOrderRowHtml) renders real fields, not the old product/amount/variant placeholder shape", () => {
  const source = [
    sourceOfFunction("esc"),
    "const nf = new Intl.NumberFormat(\"ko-KR\");",
    sourceOfFunction("hasApiValue"),
    sourceOfFunction("apiNum"),
    sourceOfFunction("apiWon"),
    sourceOfFunction("entityDrawerClientOrderRowHtml")
  ].join("\n\n");
  const fn = Function(`${source}; return entityDrawerClientOrderRowHtml;`)();
  const html = fn(purchaseLine(), 0);
  assert.match(html, /Test Jacket/);
  assert.match(html, /126,400원/);
  assert.match(html, /오프라인/, "real channel/source is shown instead of the fabricated 'variant' field");
  assert.doesNotMatch(html, /undefined/);
});

// 5. entityClientRecentPurchases is no longer permanently empty — confirmed structurally:
// it is declared as [] but is not a `const [] literal never reassigned` placeholder anymore —
// the click handlers populate it via .push(...entityClientPurchaseLinesFor(row)) before
// opening the drawer (grep-verified, since simulating the actual click/DOM event wiring is
// out of proportion for this pure-logic suite — the population source itself is already
// covered by tests 1/2/9 above).
test("5. click handlers populate entityClientRecentPurchases from entityClientPurchaseLinesFor before opening the drawer", () => {
  assert.match(js, /entityClientRecentPurchases\.length = 0;\s*\n\s*entityClientRecentPurchases\.push\(\.\.\.entityClientPurchaseLinesFor\(activeRow\)\);\s*\n\s*openEntityDrawer\("clientOrders", \{ row: activeRow \}\);/);
  assert.match(js, /entityClientRecentPurchases\.length = 0;\s*\n\s*entityClientRecentPurchases\.push\(\.\.\.entityClientPurchaseLinesFor\(clientWorkspaceRow\)\);\s*\n\s*openEntityDrawer\(type, \{ row: clientWorkspaceRow \}\);/);
});

// 10. period/brand switch stale-data guard: refreshEntityTrendMonths (the single trigger for
// brand/period changes) closes any open Workspace/clientOrders Drawer before doing anything
// else, every time it runs — structural check (the guard's own logic is exercised by
// existing DOM-level close functions already covered elsewhere; this confirms the guard is
// wired at the single correct trigger point rather than scattered/missing).
test("10. refreshEntityTrendMonths closes the Client Workspace and clientOrders Drawer at its very start (brand/period switch stale-data guard)", () => {
  const fnSource = sourceOfFunction("refreshEntityTrendMonths");
  const guardIndex = fnSource.indexOf("if (clientWorkspaceRow) closeClientWorkspace();");
  const drawerGuardIndex = fnSource.indexOf('if (entityDrawerState.open && entityDrawerState.type === "clientOrders") closeEntityDrawer();');
  const brandCheckIndex = fnSource.indexOf("if (!brandIdentityState.brandCode)");
  assert.notEqual(guardIndex, -1);
  assert.notEqual(drawerGuardIndex, -1);
  assert.ok(guardIndex < brandCheckIndex && drawerGuardIndex < brandCheckIndex, "the stale-data guard must run before any brand/period branching, i.e. on every single invocation");
});

// Regression: the fetch/state architecture must not introduce a second, competing fetch
// pattern — confirms it reuses getSharedJson/intelligenceUrl/monthlyReportMonthRange exactly
// as every other Brand Intelligence secondary fetch already does (no new architecture).
test("fetch architecture reuses getSharedJson + intelligenceUrl + monthlyReportMonthRange (no new fetch pattern)", () => {
  // BI-BATCH-I Part 8: this fetch now retries once on timeout (getSharedJson(url, 30000)),
  // mirroring getEntityCompareMonthlyArchive's established pattern — still the same
  // getSharedJson/intelligenceUrl/monthlyReportMonthRange primitives, no new architecture.
  assert.match(js, /const url = intelligenceUrl\(`\/api\/intelligence\/clients\?since=\$\{monthStart\}&until=\$\{monthEnd\}`\);/);
  assert.match(js, /let data = await getSharedJson\(url, 15000\);/);
  assert.match(js, /data = await getSharedJson\(url, 30000\);/);
  assert.match(js, /const \{ monthStart, monthEnd \} = monthlyReportMonthRange\(month\);/);
});
