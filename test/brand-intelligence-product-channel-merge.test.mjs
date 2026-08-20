import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const js = fs.readFileSync(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");

function sourceOfFunction(name) {
  const start = js.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} missing`);
  const brace = js.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < js.length; index += 1) {
    if (js[index] === "{") depth += 1;
    if (js[index] === "}") depth -= 1;
    if (depth === 0) return js.slice(start, index + 1);
  }
  throw new Error(`${name} source is incomplete`);
}

const helpers = Function(
  "brandSelectorActiveName",
  `${sourceOfFunction("entityProductDisplayName")}
   ${sourceOfFunction("entityProductExactKey")}
   ${sourceOfFunction("entityProductIsSaleRow")}
   ${sourceOfFunction("mergeEntityProductChannelRows")}
   return { entityProductExactKey, entityProductIsSaleRow, mergeEntityProductChannelRows };`
)("CARNET ARCHIVE");

test("exact key removes only supported leading prefixes, whitespace, and case", () => {
  const cafe24 = "[CARNET ARCHIVE : 카르넷 아카이브] ZIP BELT EGG CLUSTER  SLEEVE KNIT BLOUSE IVORY";
  const ecount = "CARNET ARCHIVE / ZIP BELT EGG CLUSTER SLEEVE KNIT BLOUSE IVORY";
  assert.equal(helpers.entityProductExactKey(cafe24), helpers.entityProductExactKey(ecount));
  assert.equal(
    helpers.entityProductExactKey("[CARNET ARCHIVE : 카르넷 아카이브] Unearthed Fragment Chain Oil Black"),
    helpers.entityProductExactKey("CARNET ARCHIVE / Unearthed Fragment Chain OIL BLACK")
  );
  assert.notEqual(helpers.entityProductExactKey("TEST PRODUCT"), helpers.entityProductExactKey("TEST PRODUCT PLUS"));
  assert.equal(helpers.entityProductExactKey(""), "");
});

test("zero-sale rows are excluded but either positive revenue or quantity remains a sale", () => {
  assert.equal(helpers.entityProductIsSaleRow({ revenue: 0, quantitySold: 0 }), false);
  assert.equal(helpers.entityProductIsSaleRow({ revenue: 1, quantitySold: 0 }), true);
  assert.equal(helpers.entityProductIsSaleRow({ revenue: 0, quantitySold: 1 }), true);
});

test("CARNET 2026-08 exact merge reconciles 29 unique products, 79 units, and 26,453,759 won", () => {
  const online = [
    { productName: "[CARNET ARCHIVE : 카르넷 아카이브] ZIP BELT EGG CLUSTER SLEEVE KNIT BLOUSE IVORY", productNo: "11753", productCode: "P0000RKB", revenue: 1210000, quantitySold: 2, orderCount: 2 },
    { productName: "[CARNET ARCHIVE : 카르넷 아카이브] Unearthed Fragment Chain Oil Black", productNo: "12000", productCode: "P0000SRG", revenue: 269660, quantitySold: 1, orderCount: 1 },
    { productName: "HAND COATED MASS VEST OIL BLACK", productNo: "12001", revenue: 628139, quantitySold: 1, orderCount: 1 },
    { productName: "Burnt Silver Dog Tag Burn Silver", productNo: "12002", revenue: 124160, quantitySold: 1, orderCount: 1 }
  ];
  const offline = [
    { productName: "CARNET ARCHIVE / ZIP BELT EGG CLUSTER SLEEVE KNIT BLOUSE IVORY", productNo: null, revenue: 1089000, quantitySold: 2 },
    { productName: "CARNET ARCHIVE / Unearthed Fragment Chain OIL BLACK", productNo: null, revenue: 1000800, quantitySold: 4 },
    { productName: "CARNET ARCHIVE / OFFLINE PRODUCT 01", productNo: null, revenue: 22108000, quantitySold: 44 },
    ...Array.from({ length: 24 }, (_, index) => ({ productName: `CARNET ARCHIVE / OFFLINE PRODUCT ${String(index + 2).padStart(2, "0")}`, productNo: null, revenue: 1000, quantitySold: 1 }))
  ];
  const rows = helpers.mergeEntityProductChannelRows(online, offline);
  assert.equal(rows.length, 29);
  assert.equal(rows.reduce((sum, row) => sum + row.quantitySold, 0), 79);
  assert.equal(rows.reduce((sum, row) => sum + row.revenue, 0), 26453759);
  const zip = rows.find((row) => helpers.entityProductExactKey(row.productName).startsWith("zip belt"));
  assert.deepEqual({ productNo: zip.productNo, quantitySold: zip.quantitySold, revenue: zip.revenue }, { productNo: "11753", quantitySold: 4, revenue: 2299000 });
  const chain = rows.find((row) => helpers.entityProductExactKey(row.productName).startsWith("unearthed fragment"));
  assert.deepEqual({ quantitySold: chain.quantitySold, revenue: chain.revenue }, { quantitySold: 5, revenue: 1270460 });
});

test("offline-only rows keep null Cafe24 identity and routing guard blocks them", () => {
  const [row] = helpers.mergeEntityProductChannelRows([], [{ productName: "CARNET ARCHIVE / OFFLINE ONLY", productNo: null, productCode: "", revenue: 1000, quantitySold: 1 }]);
  assert.equal(row.productNo, null);
  assert.match(sourceOfFunction("activateEntityDrawerRow"), /entitySkuRoutable !== "true"/);
  assert.doesNotMatch(sourceOfFunction("entityProductExactKey"), /includes|similar|fuzzy|distance/i);
  assert.match(sourceOfFunction("renderEntityProductSection"), /entityProductChannelState === "all" && \(onlinePending \|\| offlinePending\)/);
  assert.match(js, /sourceType === "product"[\s\S]*?entityProductRowsForChannel/);
});
