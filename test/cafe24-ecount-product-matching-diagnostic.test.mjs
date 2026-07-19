import assert from "node:assert/strict";
import {
  normalizeProductName,
  splitEcountProductName,
  stripConsignmentToken,
  tokenSimilarity
} from "../scripts/diagnose-cafe24-ecount-product-matching.mjs";

assert.equal(stripConsignmentToken("CON JACKET"), "JACKET");
assert.equal(stripConsignmentToken("  CON   JACKET  "), "JACKET");
assert.equal(stripConsignmentToken("CONVERSE JACKET"), "CONVERSE JACKET");
assert.equal(stripConsignmentToken("BACON TEE"), "BACON TEE");

assert.equal(normalizeProductName("[424] DRAGONRIDER SOFT NAPPA BLACK (LIMITED) 42"), "DRAGONRIDER SOFT NAPPA BLACK");
assert.equal(normalizeProductName("TWO-TONE / ZIP_CARDIGAN FREE"), "TWO TONE ZIP CARDIGAN");

assert.deepEqual(splitEcountProductName("424 / DRAGONRIDER SOFT NAPPA BLACK"), {
  raw: "424 / DRAGONRIDER SOFT NAPPA BLACK",
  brandRaw: "424",
  nameRaw: "DRAGONRIDER SOFT NAPPA BLACK"
});

assert.ok(tokenSimilarity("DRAGONRIDER SOFT NAPPA BLACK", "DRAGONRIDER NAPPA BLACK") >= 0.7);
assert.equal(tokenSimilarity("DRAGONRIDER SOFT NAPPA BLACK", "CHECK SHIRT BLUE"), 0);

console.log("cafe24 ecount product matching diagnostic tests passed");
