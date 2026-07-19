import assert from "node:assert/strict";
import { classifyUsability, scanIdentityFields } from "../scripts/diagnose-cafe24-product-identity-sources.mjs";

const records = [
  {
    productNo: 1,
    productCode: "P1",
    manufacturer_code: "M1",
    options: [{ variantCode: "V1", optionSummary: "COLOR:BLACK", quantity: 2 }]
  },
  {
    productNo: 2,
    productCode: "P2",
    barcode: "B2",
    options: [{ variantCode: "V2", ean: "E2" }]
  }
];

const result = scanIdentityFields(records);
assert.equal(result.productNo.recordCount, 2);
assert.equal(result.productCode.recordCount, 2);
assert.equal(result.manufacturerCode.recordCount, 1);
assert.equal(result.variantCode.recordCount, 2);
assert.equal(result.barcode.recordCount, 1);
assert.equal(result.ean.recordCount, 1);
assert.equal(result.optionValue.recordCount, 2);
assert.equal(classifyUsability("barcode", result.barcode), "Strong if API provenance is confirmed");
assert.equal(classifyUsability("barcode", { recordCount: 0 }), "Not usable in current cache");
assert.equal(classifyUsability("manufacturerCode", result.manufacturerCode), "Medium");
assert.equal(classifyUsability("optionValue", result.optionValue), "Weak");

console.log("cafe24 product identity source tests passed");
