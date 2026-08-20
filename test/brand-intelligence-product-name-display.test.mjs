import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const js = fs.readFileSync(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../outputs/samplas-marketing-os.css", import.meta.url), "utf8");

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

const displayName = Function(
  "brandSelectorActiveName",
  `${sourceOfFunction("entityProductDisplayName")}; return entityProductDisplayName;`
)("CARNET ARCHIVE");

test("Brand Intelligence display helper removes only supported leading brand prefixes", () => {
  assert.equal(displayName("[CARNET ARCHIVE : 카르넷 아카이브] TEST PRODUCT"), "TEST PRODUCT");
  assert.equal(displayName("CARNET ARCHIVE / TEST PRODUCT"), "TEST PRODUCT");
  assert.equal(displayName("TEST CARNET ARCHIVE / PRODUCT"), "TEST CARNET ARCHIVE / PRODUCT");
});

test("all Brand Intelligence product render paths reuse the display helper", () => {
  for (const name of [
    "entityCompositionProfileHtml",
    "clientWorkspaceOrderRowHtml",
    "entityDrawerClientOrderRowHtml",
    "entityDrawerSkuRowHtml",
    "renderEntityProductSection"
  ]) {
    assert.match(sourceOfFunction(name), /entityProductDisplayName\(/, `${name} bypasses display helper`);
  }
});

test("SKU and recent-order product labels expose full titles and clamp visible text to two lines", () => {
  for (const name of ["clientWorkspaceOrderRowHtml", "entityDrawerClientOrderRowHtml", "entityDrawerSkuRowHtml"]) {
    const source = sourceOfFunction(name);
    assert.match(source, /entity-drawer-product-name/);
    assert.match(source, /title="\$\{esc\(productLabel\)\}"/);
  }
  assert.match(sourceOfFunction("entityCompositionProfileHtml"), /brand-customer-profile-recent-order-name/);
  assert.match(css, /\.entity-drawer-product-label\s*\{[^}]*-webkit-line-clamp:\s*2;/s);
  assert.match(css, /\.brand-customer-profile-row \.brand-customer-profile-recent-order-name\s*\{[^}]*-webkit-line-clamp:\s*2;/s);
});
