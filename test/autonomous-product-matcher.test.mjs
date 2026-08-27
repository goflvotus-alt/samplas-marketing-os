import assert from "node:assert/strict";
import { buildExactIndex, buildTrustedBrandAliases, decideEntry } from "../scripts/autonomous-product-matcher.mjs";

const match = (prodCd, productName, size = "M") => ({ prodCd, productName, size });
const trusted = {
  brandId: "B1", status: "confirmed", verified: true,
  canonicalProductName: "MODEL BLACK",
  ecount: { matchedProducts: [match("AAA00101", "BRAND A / MODEL BLACK"), match("AAA00102", "BRAND A / MODEL BLACK", "L")] },
  matching: { evidence: ["normalized_brand", "normalized_product_name"] }
};
const aliases = buildTrustedBrandAliases([trusted]);

{
  const index = buildExactIndex(trusted.ecount.matchedProducts);
  assert.equal(decideEntry(trusted, aliases, index).tier, "AUTO_SAFE");
}
{
  const samePriceDifferentProduct = match("AAA00201", "BRAND A / MODEL WHITE");
  const index = buildExactIndex([...trusted.ecount.matchedProducts, samePriceDifferentProduct]);
  assert.equal(decideEntry({ ...trusted, canonicalProductName: "MODEL WHITE", ecount: { matchedProducts: [] } }, aliases, index).tier, "SAFE_REVIEW");
}
{
  const conflictingFamily = match("BBB99901", "BRAND A / MODEL BLACK");
  const index = buildExactIndex([...trusted.ecount.matchedProducts, conflictingFamily]);
  assert.equal(decideEntry(trusted, aliases, index).tier, "AMBIGUOUS");
}
{
  const index = buildExactIndex(trusted.ecount.matchedProducts);
  assert.equal(decideEntry({ ...trusted, canonicalProductName: "MODEL", ecount: { matchedProducts: [] } }, aliases, index).tier, "SAFE_REVIEW");
}
{
  const generic = { ...trusted, canonicalProductName: "HOODIE", ecount: { matchedProducts: [match("AAA00301", "BRAND A / HOODIE")] } };
  assert.equal(decideEntry(generic, aliases, buildExactIndex(generic.ecount.matchedProducts)).tier, "SAFE_REVIEW");
}
{
  const black = { ...trusted, canonicalProductName: "MODEL BLACK" };
  const white = match("AAA00103", "BRAND A / MODEL WHITE");
  assert.equal(decideEntry(black, aliases, buildExactIndex([white])).tier, "NO_CANDIDATE");
}
{
  const model2 = match("AAA00103", "BRAND A / MODEL 2 BLACK");
  assert.equal(decideEntry(trusted, aliases, buildExactIndex([model2])).tier, "NO_CANDIDATE");
}
{
  const collab = { ...trusted, canonicalProductName: "BRAND A X BRAND B TEE", ecount: { matchedProducts: [match("AAA00401", "BRAND A / BRAND B X BRAND A TEE")] } };
  assert.equal(decideEntry(collab, aliases, buildExactIndex(collab.ecount.matchedProducts)).tier, "NO_CANDIDATE");
}
{
  const noIndependentEvidence = { ...trusted, matching: { evidence: ["normalized_brand"] } };
  assert.equal(decideEntry(noIndependentEvidence, aliases, buildExactIndex(trusted.ecount.matchedProducts)).tier, "SAFE_REVIEW");
}
console.log("autonomous product matcher tests passed");
