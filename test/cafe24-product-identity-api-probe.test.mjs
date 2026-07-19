import assert from "node:assert/strict";
import {
  compareBarcodeValues,
  findIdentityFields,
  maskedSample,
  summarizeIdentityFields
} from "../scripts/probe-cafe24-product-identity-api.mjs";

const fixture = {
  product: {
    product_no: 1,
    barcode: "8800000000011",
    nested: { GTIN13: "8800000000028" },
    authorization: "secret-token",
    variants: [
      { variant_code: "P0001A", ean13: "8800000000035", empty: "" },
      { variant_code: "P0001B", upc: null }
    ]
  }
};

const hits = findIdentityFields(fixture);
assert(hits.some((hit) => hit.alias === "barcode" && hit.jsonPath === "product.barcode" && hit.populated));
assert(hits.some((hit) => hit.alias === "gtin13" && hit.jsonPath === "product.nested.GTIN13" && hit.populated));
assert(hits.some((hit) => hit.alias === "ean13" && hit.jsonPath === "product.variants[0].ean13" && hit.populated));
assert(!hits.some((hit) => /authorization/i.test(hit.jsonPath)));
assert.equal(maskedSample("8800000000011").numeric, true);
assert.equal(maskedSample("").populated, false);

const rows = [
  { endpointName: "product_detail", identityHits: hits },
  { endpointName: "product_variants", identityHits: findIdentityFields({ variants: [{ barcode: "8800000000011" }, { barcode: "8800000000011" }] }) }
];
const summary = summarizeIdentityFields(rows, new Set(["8800000000011", "8800000000035"]));
const barcode = summary.find((row) => row.alias === "barcode" && row.sourceEndpoint === "product_detail");
assert.equal(barcode.populatedCount, 1);
assert.equal(barcode.distinctCount, 1);
assert.equal(barcode.ecountExactMatches, 1);
const duplicateBarcode = summary.find((row) => row.alias === "barcode" && row.sourceEndpoint === "product_variants");
assert.equal(duplicateBarcode.populatedCount, 2);
assert.equal(duplicateBarcode.distinctCount, 1);
assert.equal(duplicateBarcode.uniquenessRate, 0.5);
const comparison = compareBarcodeValues(summary, new Set(["8800000000011", "8800000000035"]));
assert.equal(comparison.cafe24BarcodeLikePopulatedCount, 5);
assert.equal(comparison.ecountExactBarcodeMatchCount, 4);
assert.equal(comparison.duplicateBarcodeCount, 1);
assert.equal(comparison.oneToManyMatchCount, 1);

const sorted = summarizeIdentityFields([...rows].reverse(), new Set(["8800000000011", "8800000000035"]));
assert.deepEqual(summary.map((row) => `${row.alias}:${row.sourceEndpoint}:${row.jsonPath}`), sorted.map((row) => `${row.alias}:${row.sourceEndpoint}:${row.jsonPath}`));

console.log("cafe24 product identity api probe tests passed");
