import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseVeilFoundCaption, productNameKey, matchCafe24Product, evaluateCafe24Stock, classifyItem, runVeilSoldOutAudit
} from "../scripts/veil-found-soldout-audit.mjs";
import { fetchInstagramFeed } from "../scripts/veil-found-publisher.mjs";
import { createVeilControl, VEIL_TOOLS, validateUploadInput } from "../scripts/veil-found-control.mjs";
import worker from "../veil-found-plugin/worker/index.mjs";

// Real public captions of @samplas_veil (read in Chrome 2026-10-11), ids/permalinks only.
const fixture = JSON.parse(await readFile(new URL("./fixtures/veil-found-captions-2026-10-11.json", import.meta.url), "utf8"));
const feed = fixture.feed.map(({ slides: _slides, ...media }) => media);

const variant = (inv, extra = {}) => ({ variant_code: "V1", options: [{ name: "SIZE", value: "1" }], display: "T", selling: "T", inventories: [inv], ...extra });
const inStock = (q = 2) => variant({ use_inventory: "T", quantity: q, display_soldout: "T" });
const soldOut = () => variant({ use_inventory: "T", quantity: 0, display_soldout: "T" });
const product = (extra = {}) => ({ product_no: 1, brand_code: "B0000AAA", product_name: "X", display: "T", selling: "T", sold_out: "F", ...extra });

test("real feed: #001-#034 parsed, every carousel's slide count equals its item count", () => {
  const all = [];
  for (const media of fixture.feed) {
    const items = parseVeilFoundCaption(media.caption);
    if (media.caption.includes("VEIL FOUND")) assert.equal(items.length, media.slides, media.permalink);
    all.push(...items);
  }
  assert.deepEqual(all.map((i) => i.number).sort((a, b) => a - b), Array.from({ length: 34 }, (_, i) => i + 1));
  assert.ok(all.every((i) => i.parsed));
  const byNo = Object.fromEntries(all.map((i) => [i.number, i]));
  assert.deepEqual([byNo[1].brand, byNo[1].productName, byNo[1].price], ["BED J.W FORD", "26SS-B-BL04 OFFICE CASUAL SHIRT RED", 888000]);
  assert.deepEqual([byNo[2].productName, byNo[2].soldOutMarked, byNo[2].price], ["Cropped Cartel Worker Jacket", true, null]);
  assert.equal(byNo[5].price, 336000, "price on its own line");
  assert.equal(byNo[22].brand, "KIMYO", "trailing space after the number");
  assert.equal(byNo[26].soldOutMarked, true);
  assert.equal(byNo[33].price, 558000);
});

test("caption without price or SOLD OUT is unparsed, never guessed", () => {
  const [item] = parseVeilFoundCaption("VEIL FOUND #040\n\nBRAND\n\nPRODUCT NAME");
  assert.equal(item.parsed, false);
  assert.equal(item.reason, "price_or_sold_out_missing");
  assert.equal(parseVeilFoundCaption("VEIL PEOPLE 001").length, 0);
});

test("exact name match within the brand; similar names are candidates only", () => {
  assert.equal(productNameKey("[KIMYO] Macramé  toggle high-neck zip jacket"), productNameKey("MACRAMÉ TOGGLE HIGH-NECK ZIP JACKET"));
  const products = [product({ product_no: 1, product_name: "LAYERED SHIRT WHITE" }), product({ product_no: 2, product_name: "LAYERED SHIRT WHITE (S/S)" })];
  assert.equal(matchCafe24Product("layered shirt white", products).product.product_no, 1);
  const similar = matchCafe24Product("LAYERED SHIRT", products);
  assert.equal(similar.status, "NOT_FOUND");
  assert.equal(similar.candidates.length, 2);
  assert.equal(matchCafe24Product("LAYERED SHIRT WHITE", [...products, product({ product_no: 3, product_name: "Layered Shirt White" })]).status, "AMBIGUOUS");
});

test("stock: display/selling, per-option stock, sold-out flags, unlimited and unclear states", () => {
  assert.equal(evaluateCafe24Stock(product({ display: "F" }), [inStock()]).stock, "NOT_SELLABLE");
  assert.equal(evaluateCafe24Stock(product({ selling: "F" }), [inStock()]).reason, "selling_off");
  assert.equal(evaluateCafe24Stock(product({ display: undefined }), [inStock()]).stock, "UNCERTAIN");
  assert.equal(evaluateCafe24Stock(product({ sold_out: "T" }), [soldOut(), soldOut()]).stock, "SOLD_OUT");
  const partial = evaluateCafe24Stock(product(), [soldOut(), inStock(1)]);
  assert.deepEqual([partial.stock, partial.sellableOptions, partial.soldOutOptions], ["SELLABLE", 1, 1]);
  const unlimited = evaluateCafe24Stock(product(), [variant({ use_inventory: "F", quantity: 0, display_soldout: "T" })]);
  assert.deepEqual([unlimited.stock, unlimited.unlimited], ["SELLABLE", true]);
  assert.equal(evaluateCafe24Stock(product({ sold_out: "T" }), [soldOut(), inStock()]).stock, "UNCERTAIN", "flag conflict");
  assert.equal(evaluateCafe24Stock(product(), [variant({ use_inventory: "T", quantity: 0, display_soldout: "F" })]).reason, "zero_stock_without_sold_out_display");
  assert.equal(evaluateCafe24Stock(product(), [variant(null)]).reason, "inventory_settings_missing");
  assert.equal(evaluateCafe24Stock(product(), [soldOut({}), variant({ use_inventory: "T", quantity: 3 }, { selling: "F" })]).stock, "UNCERTAIN", "product says not sold out but no option is sellable");
  assert.equal(evaluateCafe24Stock(product(), []).reason, "no_variant_data");
  assert.equal(classifyItem({ price: 1000, soldOutMarked: false }, { stock: "NOT_SELLABLE" }), "SOLD_OUT_BUT_PRICED");
});

const brandMaster = { brands: [
  { brand_code: "B0000BAF", brand_name: "BED J.W FORD" },
  { brand_code: "B00000HD", brand_name: "SUNDAY OFF CLUB", name_aliases: "SUNDAYOFFCLUB" },
  { brand_code: "B00000LC", brand_name: "XLIM" },
  { brand_code: "B0000BDV", brand_name: "RECORDS INC" },
  { brand_code: "SPL_92ce8d7290", brand_name: "SOC X MEANTIME" }
] };
const catalog = {
  B0000BAF: [product({ product_no: 13857, brand_code: "B0000BAF", product_name: "26SS-B-BL04 OFFICE CASUAL SHIRT RED" })],
  B00000HD: [product({ product_no: 13799, brand_code: "B00000HD", product_name: "Cropped Cartel Worker Jacket", display: "F" }),
    product({ product_no: 13797, brand_code: "B00000HD", product_name: "THE NIGHT PORTER DISTRESSED T-SHIRT" })],
  B00000LC: [product({ product_no: 13485, brand_code: "B00000LC", product_name: "EP.9 01 JACKET DEEP ORANGE", sold_out: "T" })],
  B0000BDV: [product({ product_no: 15200, brand_code: "B0000BDV", product_name: "LEE L/S TEE WHITE" })]
};
const variantsByNo = { 13857: [inStock()], 13797: [inStock()], 13799: [soldOut()], 13485: [soldOut(), soldOut()], 15200: [inStock(3)] };

function sources({ failVariants = new Set(), failBrands = new Set() } = {}) {
  const calls = { brands: [], variants: [] };
  return {
    calls,
    fetchFeed: async () => feed,
    loadBrandMaster: async () => brandMaster,
    listBrandProducts: async (code) => { calls.brands.push(code); if (failBrands.has(code)) throw Object.assign(new Error("Cafe24 API error 503"), { status: 503 }); return catalog[code] || []; },
    listVariants: async (no) => { calls.variants.push(no); if (failVariants.has(no)) throw Object.assign(new Error("Too Many Requests"), { status: 429 }); return variantsByNo[no] || []; }
  };
}

test("audit over the real feed: verdicts, uncertain brands and a complete result", async () => {
  const src = sources();
  const result = await runVeilSoldOutAudit({ ...src, now: () => new Date("2026-10-11T00:00:00Z") });
  const v = Object.fromEntries(result.rows.map((r) => [r.number, r]));
  assert.equal(v[1].verdict, "OK");
  assert.equal(v[2].verdict, "OK", "not displayed and captioned SOLD OUT");
  assert.equal(v[7].verdict, "OK", "brand alias SUNDAYOFFCLUB");
  assert.equal(v[14].verdict, "SOLD_OUT_BUT_PRICED");
  assert.equal(v[26].verdict, "SELLING_BUT_MARKED_SOLD_OUT");
  assert.deepEqual([v[27].verdict, v[27].reason], ["UNCERTAIN_MATCH", "brand_has_no_cafe24_brand_code"]);
  assert.deepEqual([v[19].verdict, v[19].reason], ["UNCERTAIN_MATCH", "no_exact_name_match"]);
  assert.deepEqual([v[3].verdict, v[3].reason], ["UNCERTAIN_MATCH", "brand_not_resolved"]);
  assert.ok(!src.calls.brands.includes("SPL_92ce8d7290"), "no Cafe24 lookup with an internal split code");
  assert.equal(new Set(src.calls.brands).size, src.calls.brands.length, "each brand listed once");
  assert.deepEqual([result.ok, result.auditStatus, result.notChecked], [true, "COMPLETE", 0]);
  assert.deepEqual(result.coverage, { postsScanned: 5, itemsFound: 34, numberRange: "#001-#034", missingNumbers: [], duplicateNumbers: [] });
  assert.equal(result.rows.length, 34);
});

test("partial Cafe24 failure is INCOMPLETE with the missed count and cause", async () => {
  const result = await runVeilSoldOutAudit(sources({ failVariants: new Set([13485]), failBrands: new Set(["B0000BDV"]) }));
  assert.equal(result.ok, false);
  assert.equal(result.auditStatus, "INCOMPLETE");
  assert.equal(result.notChecked, result.failures.length);
  assert.deepEqual(result.failures.find((f) => f.number === 14), { number: 14, stage: "variants", errorCode: "RATE_LIMITED", status: 429 });
  assert.ok(result.failures.some((f) => f.number === 26 && f.stage === "brand_products" && f.errorCode === "CAFE24_UNAVAILABLE"));
});

test("duplicate number in the feed, single-number check and unknown number", async () => {
  const dup = await runVeilSoldOutAudit({ ...sources(), fetchFeed: async () => [...feed, { id: "x", caption: "VEIL FOUND #001\n\nBED J.W FORD\n\nOTHER\n\n1,000 KRW" }] });
  assert.deepEqual(dup.coverage.duplicateNumbers, [1]);
  assert.ok(dup.rows.filter((r) => r.number === 1).every((r) => r.reason === "duplicate_number_in_feed"));
  const one = await runVeilSoldOutAudit({ ...sources(), number: 14 });
  assert.deepEqual([one.ok, one.rows.length, one.rows[0].verdict], [true, 1, "SOLD_OUT_BUT_PRICED"]);
  assert.deepEqual(one.rows[0].cafe24.options.map((o) => o.state), ["SOLD_OUT", "SOLD_OUT"]);
  const missing = await runVeilSoldOutAudit({ ...sources(), number: 99 });
  assert.deepEqual([missing.ok, missing.error], [false, "number_not_found_in_feed"]);
});

test("Instagram feed read for the audit is GET only", async () => {
  const methods = [];
  const fetchImpl = async (url, options = {}) => { methods.push(options.method || "GET"); return new Response(JSON.stringify({ data: feed })); };
  await fetchInstagramFeed({ config: { token: "isolated", igUserId: "isolated", graphVersion: "v25.0" }, fetchImpl });
  assert.deepEqual(methods, ["GET"]);
});

test("plugin: two read-only audit tools after the five upload tools; Site lists the same tools", async () => {
  assert.deepEqual(VEIL_TOOLS.map((t) => t.name), ["getUploadStatus", "previewReadyPosts", "scheduleUpload", "runUpload", "getUploadHistory", "auditSoldOutCaptions", "checkSoldOutPost"]);
  for (const name of ["auditSoldOutCaptions", "checkSoldOutPost"]) {
    const tool = VEIL_TOOLS.find((t) => t.name === name);
    assert.deepEqual([tool.annotations.readOnlyHint, tool.annotations.destructiveHint], [true, false]);
  }
  assert.match(VEIL_TOOLS.find((t) => t.name === "auditSoldOutCaptions").description, /VEIL 품절 검수/);
  const list = await (await worker.fetch(new Request("https://isolated.test/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), {})).json();
  assert.deepEqual(list.result.tools, VEIL_TOOLS);
});

test("plugin input validation for the audit tools", () => {
  assert.doesNotThrow(() => validateUploadInput("auditSoldOutCaptions", {}));
  assert.doesNotThrow(() => validateUploadInput("auditSoldOutCaptions", { view: "all" }));
  for (const args of [{ view: "everything" }, { number: 1 }]) assert.throws(() => validateUploadInput("auditSoldOutCaptions", args), /malformed_payload/);
  for (const args of [{}, { number: 0 }, { number: "1" }, { number: 1.5 }, { number: 1, extra: true }]) assert.throws(() => validateUploadInput("checkSoldOutPost", args), /malformed_payload/);
  assert.doesNotThrow(() => validateUploadInput("checkSoldOutPost", { number: 34 }));
});

test("control: issues view hides OK rows, no file is written, unconfigured audit fails closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "veil-audit-isolated-"));
  try {
    const src = sources();
    let publishCalls = 0;
    const control = createVeilControl({ workDir: dir, env: {}, publish: async () => { publishCalls++; }, soldOutAudit: ({ number }) => runVeilSoldOutAudit({ ...src, number }) });
    const issues = await control.call("auditSoldOutCaptions", {});
    assert.ok(issues.rows.length > 0 && issues.rows.every((r) => r.verdict !== "OK"));
    assert.equal((await control.call("auditSoldOutCaptions", { view: "all" })).rows.length, 34);
    assert.equal((await control.call("checkSoldOutPost", { number: 26 })).rows[0].verdict, "SELLING_BUT_MARKED_SOLD_OUT");
    assert.deepEqual(await readdir(dir), [], "no control state, lock or cache file");
    assert.equal(publishCalls, 0);
    await assert.rejects(createVeilControl({ workDir: dir, env: {} }).call("auditSoldOutCaptions", {}), /sold_out_audit_not_configured/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
