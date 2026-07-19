import assert from "node:assert/strict";
import {
  compareBarcodeValues,
  findIdentityFields,
  summarizeIdentityFields
} from "../scripts/probe-cafe24-product-identity-api.mjs";

const productRows = [
  {
    endpointName: "render_product_detail",
    identityHits: findIdentityFields({
      product: {
        product_no: 14600,
        product_code: "P0000XYZ",
        manufacturer_code: "M-14600",
        barcode: "8800000000011"
      }
    })
  },
  {
    endpointName: "render_product_detail",
    identityHits: findIdentityFields({
      product: {
        product_no: 14595,
        product_code: "P0000ABC",
        manufacturer_code: "",
        barcode: "8800000000028"
      }
    })
  }
];

const ecount = new Set(["8800000000011", "8800000000028"]);
const fields = summarizeIdentityFields(productRows, ecount);
const barcode = fields.find((field) => field.alias === "barcode");
assert.equal(barcode.populatedCount, 2);
assert.equal(barcode.distinctCount, 2);
assert.equal(barcode.strength, "strong");
assert.equal(barcode.ecountExactMatches, 2);

const productCode = fields.find((field) => field.alias === "product_code");
assert.equal(productCode.populatedCount, 2);
assert.equal(productCode.strength, "medium");

const comparison = compareBarcodeValues(fields, ecount);
assert.equal(comparison.cafe24BarcodeLikePopulatedCount, 2);
assert.equal(comparison.ecountExactBarcodeMatchCount, 2);
assert.equal(comparison.duplicateBarcodeCount, 0);
assert.equal(comparison.oneToOneMatchCount, 2);

const empty = summarizeIdentityFields([{ endpointName: "render_product_detail", identityHits: [] }], ecount);
assert.equal(compareBarcodeValues(empty, ecount).cafe24BarcodeLikePopulatedCount, 0);

console.log("cafe24 render product identity probe tests passed");
