import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cafe24CodeAudit } from "../scripts/cafe24-code-reuse.mjs";
import * as queue from "../scripts/pending-brand-queue.mjs";

// Production 2026-10-07 after the three splits and the B0000COL re-key (see
// docs/reports/UNCONFIRMED-CAFE24-CODE-AUDIT-2026-10-07.md and B0000COL-PREEMPTIVE-REKEY-DRY-RUN.md).
const fixture = JSON.parse(readFileSync(new URL("./fixtures/cafe24-code-audit-2026-10-07.json", import.meta.url), "utf8"));
const evidence = { products: fixture.products, ecountProducts: fixture.ecountProducts };
const clone = () => structuredClone(fixture.brands);
const audit = (brands, cafe24Brands = fixture.cafe24Brands, extra = evidence) => cafe24CodeAudit(brands, cafe24Brands, extra);
const statusOf = (result, code) => result.findings.find((f) => f.brandCode === code)?.status ?? "VALID_OR_NOT_AUDITED";
const COLLAB = { brand_code: "B0000COL", brand_name: "MEANTIME X SUNDAYOFFCLUB", name_aliases: ["SOC X MEANTIME", "선데이오프클럽 X 민타임"], instagram_tag: "", active: false, nameSource: "confirmed" };
const withoutRekey = () => clone().map((b) => (b.brand_code.startsWith("SPL_92ce") ? COLLAB : b));

test("129-case regression: current Production has 175 valid identities, 126 retired codes and nothing actionable", () => {
  const result = audit(fixture.brands);
  assert.equal(result.cafe24MaxCode, "B0000BEI");
  assert.deepEqual(result.summary, { VALID_CONFIRMED_CAFE24_IDENTITY: 175, CODE_REUSE_SPLIT_REQUIRED: 0, CODE_AHEAD_OF_CAFE24: 0,
    PREEMPTIVE_REKEY_REQUIRED: 0, RETIRED_CAFE24_CODE: 126, REVIEW_REQUIRED: 0 });
  assert.equal(result.findings.filter((f) => f.actionable).length, 0);
  const retired = result.findings.filter((f) => f.status === "RETIRED_CAFE24_CODE");
  assert.ok(retired.every((f) => f.brandCode.startsWith("B00000") && f.brandCode < "B0000BEI" && !f.active && f.catalogProducts === 0 && f.ecountProducts === 0 && f.ecountSalesLines === 0));
  // Completed identities are valid, and the split/re-keyed old codes are history only.
  for (const code of ["B0000BDG", "B0000BDJ", "B0000BDM", "B0000BEI"]) assert.equal(statusOf(result, code), "VALID_OR_NOT_AUDITED", code);
  assert.equal(result.findings.some((f) => f.brandCode === "B0000COL" || f.brandCode.startsWith("SPL_")), false);
});

test("pre-re-key state: the minted collab code above the Cafe24 maximum is PREEMPTIVE_REKEY_REQUIRED", () => {
  const result = audit(withoutRekey());
  const finding = result.findings.find((f) => f.brandCode === "B0000COL");
  assert.equal(finding.status, "PREEMPTIVE_REKEY_REQUIRED");
  assert.equal(finding.actionable, true);
  assert.equal(finding.ecountProducts, 9);
  assert.equal(result.summary.CODE_AHEAD_OF_CAFE24, 1);
  assert.equal(result.summary.PREEMPTIVE_REKEY_REQUIRED, 1);
  // Recorded Cafe24 ownership means it is not a Marketing OS mint: ahead of Cafe24, but not a re-key candidate.
  const owned = withoutRekey().map((b) => (b.brand_code === "B0000COL" ? { ...b, externalCodes: { cafe24: { code: "B0000COL", since: "2026-08", until: null } } } : b));
  assert.equal(statusOf(audit(owned), "B0000COL"), "CODE_AHEAD_OF_CAFE24");
});

test("pre-split state and a future collision on the minted code are CODE_REUSE_SPLIT_REQUIRED", () => {
  const before = clone().filter((b) => !["B0000BDG", "B0000BDJ", "B0000BDM"].includes(b.brand_code) && !(b.formerCodes || []).length)
    .concat(["BORC:B0000BDG", "GKL:B0000BDJ", "LAMASKARADE:B0000BDM"].map((x) => { const [name, code] = x.split(":"); return { brand_code: code, brand_name: name, name_aliases: [], active: false, nameSource: "suggested" }; }));
  const result = audit(before);
  for (const code of ["B0000BDG", "B0000BDJ", "B0000BDM"]) {
    const finding = result.findings.find((f) => f.brandCode === code);
    assert.equal(finding.status, "CODE_REUSE_SPLIT_REQUIRED", code);
    assert.equal(finding.codeReuseClassification, "MINTED_CODE_COLLISION", code);
  }
  const issued = [...fixture.cafe24Brands, { brand_code: "B0000COL", brand_name: "NEW BRAND", created_date: "2032-01-01T00:00:00+09:00" }];
  assert.equal(statusOf(audit(withoutRekey(), issued), "B0000COL"), "CODE_REUSE_SPLIT_REQUIRED");
  // After the re-key Cafe24 issuing the code collides with nothing: no Brand Master entry owns it.
  assert.equal(audit(fixture.brands, issued).findings.some((f) => f.brandCode === "B0000COL"), false);
});

test("ambiguous evidence stays REVIEW_REQUIRED instead of being retired", () => {
  const brands = clone();
  const retiredCode = audit(brands).findings.find((f) => f.status === "RETIRED_CAFE24_CODE").brandCode;
  const entry = brands.find((b) => b.brand_code === retiredCode);
  assert.equal(statusOf(audit(brands.map((b) => (b === entry ? { ...b, active: true } : b))), retiredCode), "REVIEW_REQUIRED", "active");
  assert.equal(statusOf(audit(brands, fixture.cafe24Brands, { ...evidence, ecountProducts: [{ productName: `${entry.brand_name} / Item` }] }), retiredCode), "REVIEW_REQUIRED", "ECOUNT products");
  assert.equal(statusOf(audit(brands, fixture.cafe24Brands, { ...evidence, products: [{ brand_code: retiredCode }] }), retiredCode), "REVIEW_REQUIRED", "catalog products");
  assert.equal(statusOf(audit(brands, [...fixture.cafe24Brands, { brand_code: "B0000BEZ", brand_name: entry.brand_name }]), retiredCode), "REVIEW_REQUIRED", "same name live");
  assert.equal(statusOf(audit(brands, []), retiredCode), "REVIEW_REQUIRED", "no live list");
});

test("pending scan: audit block keeps only actionable findings and creates no candidates for audited codes", () => {
  const result = queue.detectPendingBrands({ canonical: { brands: fixture.brands }, cafe24Brands: fixture.cafe24Brands, products: [], ecountLines: [], ecountProducts: fixture.ecountProducts, now: "2026-10-07T00:00:00.000Z" });
  assert.deepEqual(result.audit.unconfirmedCafe24Codes, []);
  assert.equal(result.audit.cafe24CodeSummary.RETIRED_CAFE24_CODE, 126);
  assert.equal(result.audit.cafe24CodeSummary.cafe24MaxCode, "B0000BEI");
  assert.equal(result.audit.retiredCafe24Codes.length, 126);
  const audited = new Set([...result.audit.retiredCafe24Codes, "B0000BDG", "B0000BDJ", "B0000BDM", "B0000COL"]);
  assert.equal(result.candidates.filter((c) => audited.has(c.sourceBrandCode)).length, 0);
  assert.equal(result.candidates.filter((c) => ["PERSONSOUL", "UNDER THE SIGN", "PRAYING", "MEANTIME X SUNDAYOFFCLUB"].includes(c.rawBrandName)).length, 0);
});
