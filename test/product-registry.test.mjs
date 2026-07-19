import assert from "node:assert/strict";
import { buildProductRegistryFromDiagnostic } from "../scripts/build-product-registry.mjs";

const now = "2026-07-19T00:00:00.000Z";
const cafeA = {
  productNo: "100",
  productCode: "P000A",
  rawName: "[BRAND A] EXACT PRODUCT",
  brandCode: "B-A",
  brandName: "Brand A",
  productName: "EXACT PRODUCT"
};
const cafeB = {
  productNo: "101",
  productCode: "P000B",
  rawName: "[BRAND A] AMBIG PRODUCT",
  brandCode: "B-A",
  brandName: "Brand A",
  productName: "AMBIG PRODUCT"
};
const diagnostic = {
  generatedAt: "2026-07-18T00:00:00.000Z",
  results: [
    {
      classification: "exact_one_to_one",
      confidence: 0.96,
      evidence: ["normalized_brand", "normalized_product_name"],
      pendingReasons: [],
      cafe24: cafeA,
      ecount: {
        productCode: "E100",
        barcode: "BC100",
        rawName: "BRAND A / EXACT PRODUCT",
        productName: "EXACT PRODUCT",
        specification: "M",
        consignmentCandidate: false
      }
    },
    {
      classification: "exact_one_to_many",
      confidence: 0.78,
      evidence: ["normalized_brand", "normalized_product_name"],
      pendingReasons: ["multiple_exact_candidates"],
      cafe24: cafeB,
      ecount: {
        productCode: "E101A",
        barcode: "BC101A",
        rawName: "BRAND A / AMBIG PRODUCT",
        productName: "AMBIG PRODUCT",
        specification: "S",
        consignmentCandidate: false
      }
    },
    {
      classification: "exact_one_to_many",
      confidence: 0.78,
      evidence: ["normalized_brand", "normalized_product_name"],
      pendingReasons: ["multiple_exact_candidates"],
      cafe24: cafeB,
      ecount: {
        productCode: "E101B",
        barcode: "BC101B",
        rawName: "BRAND A / AMBIG PRODUCT",
        productName: "AMBIG PRODUCT",
        specification: "M",
        consignmentCandidate: false
      }
    },
    {
      classification: "ecount_only",
      cafe24: null,
      ecount: { productCode: "E999" }
    }
  ]
};

const { registry, reviewQueue } = buildProductRegistryFromDiagnostic(diagnostic, { now });

assert.equal(registry.mode, "product_registry_phase1_diagnostic_only");
assert.equal(registry.summary.registryCount, 2);
assert.equal(registry.summary.verifiedCount, 1);
assert.equal(registry.summary.reviewQueueCount, 1);
assert.equal(registry.summary.confidenceDistribution["100"], 1);
assert.equal(registry.summary.confidenceDistribution["60-79"], 1);

const exact = registry.entries.find((entry) => entry.cafe24.productNo === "100");
assert.equal(exact.canonicalProductId, "CP-C24-100");
assert.equal(exact.status, "confirmed");
assert.equal(exact.verified, true);
assert.equal(exact.confidence, 100);
assert.equal(exact.ecount.matchedProducts.length, 1);

const ambiguous = registry.entries.find((entry) => entry.cafe24.productNo === "101");
assert.equal(ambiguous.status, "ambiguous");
assert.equal(ambiguous.verified, false);
assert.equal(ambiguous.confidence, 78);
assert.equal(ambiguous.ecount.matchedProducts.length, 2);

assert.equal(reviewQueue.items.length, 1);
assert.equal(reviewQueue.items[0].priority, "HIGH");
assert.equal(reviewQueue.items[0].recommendedCandidate.ecount.length, 2);

console.log("product registry tests passed");
