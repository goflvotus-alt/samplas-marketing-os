import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// BI-BATCH-E (Single-Brand Completion Sweep). Same source-extraction + Function() execution
// pattern already established in this repo (no jsdom). Covers the 4 wiring/wording gaps found
// during the live Chrome walkthrough: (1) the "전체 고객" full-list drawer's row click still
// only toasted instead of opening the real Client Workspace BATCH A already built; (2) the SKU
// Drawer's shared empty-state text said "데이터 연결 대기" even though SKU Intelligence is
// fully connected (BATCH B) — misleading when a brand genuinely has zero online sales this
// period; (3) the clientOrders Drawer had the same wording issue; (4) fixing (2)/(3) naively
// would have violated NULL != ZERO (a fetch failure must never render as a confirmed "no data"
// sentence) — emptyText is now a per-type function that can distinguish the two.
const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");

function sourceOfFunction(name) {
  const asyncMarker = `async function ${name}(`;
  const asyncStart = js.indexOf(asyncMarker);
  const marker = asyncStart !== -1 ? asyncMarker : `function ${name}(`;
  const start = asyncStart !== -1 ? asyncStart : js.indexOf(marker);
  assert.notEqual(start, -1, `${name} missing`);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let index = start; index < js.length; index += 1) {
    if (js[index] === "(") parenDepth += 1;
    if (js[index] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) { bodyStart = js.indexOf("{", index); break; }
    }
  }
  assert.notEqual(bodyStart, -1, `${name} body not found`);
  let depth = 0;
  let opened = false;
  for (let index = bodyStart; index < js.length; index += 1) {
    if (js[index] === "{") { depth += 1; opened = true; }
    if (js[index] === "}" && --depth === 0 && opened) return js.slice(start, index + 1);
  }
  throw new Error(`${name} incomplete`);
}

function sourceOfObjectProperty(objectMarker, key) {
  const objectStart = js.indexOf(objectMarker);
  assert.notEqual(objectStart, -1, `${objectMarker} missing`);
  const propMarker = `${key}: {`;
  const start = js.indexOf(propMarker, objectStart);
  assert.notEqual(start, -1, `${key} missing inside ${objectMarker}`);
  const braceStart = start + key.length + 2;
  let depth = 0;
  let opened = false;
  for (let index = braceStart; index < js.length; index += 1) {
    if (js[index] === "{") { depth += 1; opened = true; }
    if (js[index] === "}" && --depth === 0 && opened) return js.slice(braceStart, index + 1);
  }
  throw new Error(`${key} incomplete`);
}

const DRAWER_CONFIG_MARKER = "const entityDrawerConfig = {";

// --- Gap 1: "전체 고객" drawer row click now opens the real Client Workspace -------------

test("entityDrawerCustomerRowHtml no longer hardcodes a literal \"placeholder\" identity", () => {
  const source = sourceOfFunction("entityDrawerCustomerRowHtml");
  assert.doesNotMatch(source, /data-entity-id="placeholder"/);
  assert.match(source, /data-entity-id="\$\{esc\(row\.name\)\}"/);
  assert.match(source, /data-entity-label="\$\{esc\(row\.name\)\}"/);
});

test("customer drawer config: onRowClick finds the real row by name and opens the real Client Workspace", () => {
  const configSource = sourceOfObjectProperty(DRAWER_CONFIG_MARKER, "customer");
  const calls = { closeEntityDrawer: 0, openClientWorkspace: null };
  const entityCompositionRows = [
    { name: "이지은 실장님", type: "stylist", count: 7, sales: 3548700, lastPurchase: "2026-08-08" },
    { name: "현국선 실장님", type: "stylist", count: 1, sales: 100000, lastPurchase: "2026-08-01" }
  ];
  const config = Function(
    "entityCompositionRows", "closeEntityDrawer", "openClientWorkspace", "entityDrawerCustomerRowHtml",
    `return ${configSource};`
  )(
    entityCompositionRows,
    () => { calls.closeEntityDrawer += 1; },
    (row) => { calls.openClientWorkspace = row; },
    () => ""
  );
  assert.equal(config.next, undefined, "customer stays a terminal drawer type, not a next-level chain");
  assert.equal(typeof config.onRowClick, "function");
  config.onRowClick({ dataset: { entityLabel: "현국선 실장님" } });
  assert.equal(calls.closeEntityDrawer, 1, "drawer must close before the Workspace opens (matches openEntityWorkspace's existing precedent)");
  assert.deepEqual(calls.openClientWorkspace, entityCompositionRows[1], "must open the Workspace for the exact clicked row, not just the first one");
});

test("customer drawer config: onRowClick is a no-op when the clicked label matches no known row (no crash, no fabricated Workspace)", () => {
  const configSource = sourceOfObjectProperty(DRAWER_CONFIG_MARKER, "customer");
  let opened = false;
  const config = Function(
    "entityCompositionRows", "closeEntityDrawer", "openClientWorkspace", "entityDrawerCustomerRowHtml",
    `return ${configSource};`
  )([], () => {}, () => { opened = true; }, () => "");
  config.onRowClick({ dataset: { entityLabel: "존재하지 않는 고객" } });
  assert.equal(opened, false);
});

test("click/keydown dispatch: both paths reuse the shared row activation handler", () => {
  assert.equal((js.match(/activateEntityDrawerRow\(row\);/g) || []).length, 2);
  const activationSource = sourceOfFunction("activateEntityDrawerRow");
  assert.match(activationSource, /if \(config\.onRowClick\) config\.onRowClick\(row\);/);
});

// --- Gap 2/3/4: honest, failure-aware empty-state text ------------------------------------

test("renderEntityDrawerBody supports a function-valued emptyText and calls it (so it can react to live fetch-failure state)", () => {
  const source = sourceOfFunction("renderEntityDrawerBody");
  assert.match(source, /typeof config\.emptyText === "function" \? config\.emptyText\(\) : \(config\.emptyText \|\| "데이터 연결 대기"\)/);
});

test("sku drawer config: emptyText distinguishes a genuinely-empty period from a sales-fetch failure (NULL != ZERO)", () => {
  const configSource = sourceOfObjectProperty(DRAWER_CONFIG_MARKER, "sku");
  const config = Function("entitySkuRows", "entityDrawerSkuRowHtml", `return ${configSource};`)([], () => "");
  assert.equal(typeof config.emptyText, "function");
});

test("sku drawer emptyText: 'no data this period' vs 'fetch failed' render different, honest sentences", () => {
  const configSource = sourceOfObjectProperty(DRAWER_CONFIG_MARKER, "sku");
  const load = (fetchFailed) => Function(
    "entitySkuRows", "entityDrawerSkuRowHtml", "entitySkuSalesState",
    `return ${configSource};`
  )([], () => "", { fetchFailed });
  const notFailed = load(false).emptyText();
  const failed = load(true).emptyText();
  assert.match(notFailed, /없습니다/);
  assert.doesNotMatch(notFailed, /불러오지 못했습니다/);
  assert.match(failed, /불러오지 못했습니다/);
  assert.notEqual(notFailed, failed);
});

test("clientOrders drawer config: emptyText distinguishes a genuinely-empty purchase history from a clients-fetch failure", () => {
  const configSource = sourceOfObjectProperty(DRAWER_CONFIG_MARKER, "clientOrders");
  const config = Function(
    "entityClientRecentPurchases", "entityDrawerClientOrderRowHtml", "entityClientsOverviewFetchFailed",
    `return ${configSource};`
  )([], () => "", false);
  assert.equal(typeof config.emptyText, "function");
  assert.match(config.emptyText(), /구매 내역이 없습니다/);
});

test("clientOrders drawer emptyText: renders the fetch-failure sentence when entityClientsOverviewFetchFailed is true", () => {
  const configSource = sourceOfObjectProperty(DRAWER_CONFIG_MARKER, "clientOrders");
  const config = Function(
    "entityClientRecentPurchases", "entityDrawerClientOrderRowHtml", "entityClientsOverviewFetchFailed",
    `return ${configSource};`
  )([], () => "", true);
  assert.match(config.emptyText(), /불러오지 못했습니다/);
  assert.doesNotMatch(config.emptyText(), /구매 내역이 없습니다/);
});

test("clientOrders drawer config: clickToast copy-paste bug fixed (was the SKU drawer's toast text, unreachable but wrong)", () => {
  const configSource = sourceOfObjectProperty(DRAWER_CONFIG_MARKER, "clientOrders");
  assert.doesNotMatch(configSource, /clickToast: "SKU Intelligence 연결 예정"/);
});

test("order drawer distinguishes loading, fetch failure, and a genuine empty SKU period", () => {
  const orderSource = sourceOfObjectProperty(DRAWER_CONFIG_MARKER, "order");
  assert.match(orderSource, /entityOrderState\.loading/);
  assert.match(orderSource, /entityOrderState\.fetchFailed/);
  assert.match(orderSource, /이번 기간 해당 SKU 주문이 없습니다/);
});

test("BI-BATCH-I: category drawer now has an honest, function-valued emptyText distinguishing fetch-failure from genuine zero (NULL != ZERO)", () => {
  const categorySource = sourceOfObjectProperty(DRAWER_CONFIG_MARKER, "category");
  assert.match(categorySource, /emptyText/);
  assert.match(categorySource, /entitySkuSalesState\.fetchFailed/);
});
