import assert from "node:assert/strict";
import { buildCandidateMatches, normalizeProductName } from "../scripts/build-canonical-product-matching-registry.mjs";

const now = "2026-07-19T00:00:00.000Z";
const ecountBase = [
  { productCode: "E-BAR", productName: "[BRAND A] BAR PRODUCT", barcode: "BAR123" },
  { productCode: "PC-001", productName: "[BRAND A] PRODUCT CODE", barcode: "BC-PC" },
  { productCode: "E-NAME", productName: "[BRAND A : 브랜드A] SAME NAME", barcode: "BC-NAME" },
  { productCode: "E-DUP1", productName: "DUPLICATE", barcode: "DUP" },
  { productCode: "E-DUP2", productName: "DUPLICATE", barcode: "DUP" },
  { productCode: "E-BRAND", productName: "[OTHER] CONFLICT", barcode: "BC-BRAND" },
  { productCode: "E-MISSING", productName: "ONLY ECOUNT", barcode: "BC-MISS" }
];
const cafe24Base = [
  { productNo: "100", productCode: "BAR123", productName: "[BRAND A : 브랜드A] BAR PRODUCT", brandId: "B1", manufacturerCode: "M100", variantIds: ["V100"], optionSummaries: [] },
  { productNo: "101", productCode: "P101", productName: "[BRAND A : 브랜드A] PRODUCT CODE", brandId: "B1", manufacturerCode: "PC-001", variantIds: ["V101"], optionSummaries: [] },
  { productNo: "102", productCode: "P102", productName: "[BRAND A : 브랜드A] SAME NAME", brandId: "B1", manufacturerCode: "M102", variantIds: ["V102A", "V102B"], optionSummaries: [] },
  { productNo: "103", productCode: "DUP", productName: "DUPLICATE", brandId: "B2", manufacturerCode: "M103", variantIds: ["V103"], optionSummaries: [] },
  { productNo: "104", productCode: "DUP", productName: "DUPLICATE", brandId: "B2", manufacturerCode: "M104", variantIds: ["V104"], optionSummaries: [] },
  { productNo: "105", productCode: "P105", productName: "[BRAND A : 브랜드A] CONFLICT", brandId: "B1", manufacturerCode: "E-BRAND", variantIds: ["V105"], optionSummaries: [] },
  { productNo: "106", productCode: "P106", productName: "ONLY CAFE24", brandId: "B3", manufacturerCode: "M106", variantIds: ["V106"], optionSummaries: [] }
];

assert.equal(normalizeProductName("[A:B]  Test-Name"), "A B TEST NAME");
const matches = buildCandidateMatches({ ecountProducts: ecountBase, cafe24Products: cafe24Base, now });
const byPair = (e, c) => matches.find((match) => match.ecountProductCode === e && match.cafe24ProductId === c);
assert.equal(byPair("E-BAR", "100").matchStatus, "confirmed");
assert.equal(byPair("E-BAR", "100").evidence.some((item) => item.type === "barcode"), true);
assert.equal(byPair("PC-001", "101").matchStatus, "confirmed");
assert.equal(byPair("E-NAME", "102").matchStatus, "candidate");
assert.equal(byPair("E-NAME", "102").pendingReasons.includes("name_similarity_only"), true);
assert.equal(byPair("E-BRAND", "105").matchStatus, "candidate");
assert.equal(byPair("E-BRAND", "105").pendingReasons.includes("brand_conflict"), true);
assert(matches.some((match) => match.matchStatus === "ambiguous"));
assert(matches.some((match) => match.matchStatus === "missing_cafe24" && match.ecountProductCode === "E-MISSING"));
assert(matches.some((match) => match.matchStatus === "missing_ecount" && match.cafe24ProductId === "106"));
assert(matches.some((match) => match.pendingReasons.includes("duplicate_mapping")));
const duplicateExisting = buildCandidateMatches({
  ecountProducts: ecountBase,
  cafe24Products: cafe24Base,
  existingRegistryEntries: [
    { productId: "dup-1", ecountProductCode: "E-BAR", cafe24ProductId: "100", brandId: "B1", canonicalProductName: "Dup", variantIds: [], matchStatus: "confirmed", matchMethod: "existing_registry", confidence: 1, evidence: [], pendingReasons: [], sourceRefs: {} },
    { productId: "dup-2", ecountProductCode: "E-BAR", cafe24ProductId: "101", brandId: "B1", canonicalProductName: "Dup", variantIds: [], matchStatus: "confirmed", matchMethod: "existing_registry", confidence: 1, evidence: [], pendingReasons: [], sourceRefs: {} }
  ],
  now
});
assert(duplicateExisting.some((match) => match.matchStatus === "duplicate"));

console.log("canonical product matching tests passed");
