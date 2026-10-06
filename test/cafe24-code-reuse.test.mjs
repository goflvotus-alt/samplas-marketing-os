import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as queue from "../scripts/pending-brand-queue.mjs";
import { CAFE24_CODE_PATTERN, auditUnconfirmedCafe24Codes, classifyCodeReuse, internalIdentityCode, parseIdentityMetadata } from "../scripts/cafe24-code-reuse.mjs";

// Fixture mirrors Production evidence read on 2026-10-06: Marketing OS minted B0000BDG/BDJ/BDM for
// ECOUNT brands (BORC, GKL, LAMASKARADE) and Cafe24 later issued the same codes to new brands.
const canonical = { brands: [
  { brand_code: "B0000BDG", brand_name: "BORC", name_aliases: [], active: false, nameSource: "suggested" },
  { brand_code: "B0000BDJ", brand_name: "GKL", name_aliases: [], active: false, nameSource: "suggested" },
  { brand_code: "B0000BDM", brand_name: "LAMASKARADE", name_aliases: [], active: false, nameSource: "suggested" },
  { brand_code: "B0000CCC", brand_name: "OLDNAME", name_aliases: [], active: false, nameSource: "confirmed" },
  { brand_code: "B0000EEE", brand_name: "AMBIGOLD", name_aliases: [], active: false, nameSource: "suggested" },
  { brand_code: "B0000DDD", brand_name: "SAMEBRAND", name_aliases: [], active: false, nameSource: "confirmed" },
  { brand_code: "B0000AAA", brand_name: "RELIVE", name_aliases: [], active: true, nameSource: "confirmed" }
] };
const cafe24Brands = [
  { brand_code: "B0000BDG", brand_name: "PERSONSOUL", created_date: "2026-08-18T18:53:00+09:00", product_count: 23 },
  { brand_code: "B0000BDJ", brand_name: "UNDER THE SIGN", created_date: "2026-08-21T17:55:19+09:00", product_count: 16 },
  { brand_code: "B0000BDM", brand_name: "PRAYING", created_date: "2026-08-26T13:17:16+09:00", product_count: 11 },
  { brand_code: "B0000CCC", brand_name: "NEWCO", created_date: "2025-01-10T10:00:00+09:00" },
  { brand_code: "B0000EEE", brand_name: "AMBIGNEW" },
  { brand_code: "B0000DDD", brand_name: "SAMEBRAND", created_date: "2025-02-01T10:00:00+09:00" },
  { brand_code: "B0000AAA", brand_name: "RELIVE" },
  { brand_code: "B0000BEI", brand_name: "BLUEMARBLE", created_date: "2026-10-05T10:00:00+09:00" }
];
const products = [
  { product_no: 1, brand_code: "B0000BDG", product_name: "[PERSONSOUL : 퍼슨소울] Leather Jacket", created_date: "2026-08-18T19:00:00+09:00" },
  { product_no: 2, brand_code: "B0000CCC", product_name: "[OLDNAME] Coat", created_date: "2025-03-01T10:00:00+09:00" },
  { product_no: 3, brand_code: "B0000CCC", product_name: "[NEWCO] Shirt", created_date: "2026-06-10T10:00:00+09:00" },
  { product_no: 4, brand_code: "B0000CCC", product_name: "[NEWCO] Pants", created_date: "2026-07-01T10:00:00+09:00" }
];
const ecountProducts = ["PERSONSOUL / Jacket", "UNDER THE SIGN / Sweatshirt", "PRAYING / Top", "NEWCO / Shirt", "AMBIGNEW / Hat", "SAMEBRAND / Bag", "BLUEMARBLE / Cap", "BORC / Knit", "BORC / Pants", "GKL / Tee"]
  .map((productName, i) => ({ productName, productCode: `P${i}` }));
const ecountLines = [{ productName: "BORC / Knit", salesAmount: 100000, isOfflineRevenue: true }, { productName: "PERSONSOUL / Jacket", salesAmount: 200000, isOfflineRevenue: true }];
const sources = { canonical, cafe24Brands, products, ecountLines, ecountProducts, aliases: [], compatibility: [] };
const detect = () => queue.detectPendingBrands({ ...sources, now: "2026-10-06T00:00:00.000Z" });
const byName = (result, name) => result.candidates.find((c) => c.rawBrandName === name);

test("minted-code collisions (PERSONSOUL, UNDER THE SIGN, PRAYING) need an identity split from the Cafe24 creation month", () => {
  const result = detect();
  for (const [name, code, old] of [["PERSONSOUL", "B0000BDG", "BORC"], ["UNDER THE SIGN", "B0000BDJ", "GKL"], ["PRAYING", "B0000BDM", "LAMASKARADE"]]) {
    const c = byName(result, name);
    assert.equal(c.reviewReason, "CODE_REUSE_SPLIT_REQUIRED", name);
    assert.equal(c.codeReuseClassification, "MINTED_CODE_COLLISION", name);
    assert.equal(c.suggestedEffectiveMonth, "2026-08", name);
    assert.equal(c.requiresIdentitySplit, true, name);
    assert.equal(c.previousCanonicalBrand, old, name);
    assert.equal(c.previousCanonicalCode, code, name);
    assert.equal(c.currentCafe24Brand, name, name);
    assert.equal(c.evidenceSummary.previousOwnerCafe24Evidence, false, name);
    assert.equal(c.evidenceSummary.cafe24CreatedAt.slice(0, 7), "2026-08", name);
    assert.equal(queue.isAutoSafePendingDecision(c, canonical, sources), null, `${name} never auto-approvable`);
  }
  const personsoul = byName(result, "PERSONSOUL").evidenceSummary;
  assert.equal(personsoul.previousOwnerEcountProducts, 2);
  assert.equal(personsoul.previousOwnerEcountSalesLines, 1);
  assert.equal(personsoul.currentEcountProducts, 1);
  assert.equal(personsoul.currentCafe24Products, 1);
});

test("real historical Cafe24 reuse starts at the first month the new identity is observed", () => {
  const c = byName(detect(), "NEWCO");
  assert.equal(c.reviewReason, "CODE_REUSE_SPLIT_REQUIRED");
  assert.equal(c.codeReuseClassification, "CAFE24_CODE_REUSED");
  assert.equal(c.suggestedEffectiveMonth, "2026-06");
  assert.equal(c.evidenceSummary.previousOwnerCafe24Evidence, true);
});

test("ambiguous evidence is REVIEW_REQUIRED with no effective month", () => {
  const c = byName(detect(), "AMBIGNEW");
  assert.equal(c.reviewReason, "CODE_REUSE_SPLIT_REQUIRED");
  assert.equal(c.codeReuseClassification, "REVIEW_REQUIRED");
  assert.equal(c.suggestedEffectiveMonth, null);
});

test("same-name reactivation is not a split; ordinary NEW brand (BLUEMARBLE) keeps NEW auto-approval", () => {
  const result = detect();
  assert.equal(result.candidates.some((c) => c.rawBrandName === "SAMEBRAND" && c.requiresIdentitySplit), false);
  assert.equal(classifyCodeReuse({ candidateName: "SAMEBRAND", code: "B0000DDD", owner: canonical.brands[5], ...sources }), null);
  const blue = byName(result, "BLUEMARBLE");
  assert.equal(blue.reviewReason, "UNRESOLVED");
  assert.equal(blue.requiresIdentitySplit, undefined);
  assert.equal(queue.isAutoSafePendingDecision(blue, canonical, sources)?.action, "NEW");
});

test("unattended refresh approves only NEW; split cases stay PENDING and manual REASSIGN is refused", async () => {
  assert.deepEqual([...queue.UNATTENDED_AUTO_APPROVE_ACTIONS], ["NEW"]);
  const dir = await mkdtemp(join(tmpdir(), "code-reuse-"));
  try {
    await writeFile(join(dir, "brand-master.json"), JSON.stringify(canonical));
    const result = await queue.refreshPendingBrands(dir, async () => sources, { autoApprove: true, buildCompatibility: () => ({ brands: [], aliases: [] }) });
    const approved = result.candidates.filter((c) => c.status === "APPROVED").map((c) => c.rawBrandName);
    assert.deepEqual(approved, ["BLUEMARBLE"]);
    for (const name of ["PERSONSOUL", "UNDER THE SIGN", "PRAYING", "NEWCO", "AMBIGNEW"]) assert.equal(byName(result, name).status, "PENDING", name);
    const saved = JSON.parse(await readFile(join(dir, "pending-brand-queue.json"), "utf8"));
    const personsoul = byName(saved, "PERSONSOUL");
    assert.throws(() => queue.planPendingBrandDecision(canonical, saved, { id: personsoul.id, action: "REASSIGN_INACTIVE_CODE" }, "2026-10-06T00:00:00.000Z", [], sources), /identity split/i);
    // A second scan keeps the classification (no flip back to the legacy reason).
    const again = queue.detectPendingBrands({ ...sources, canonical: JSON.parse(await readFile(join(dir, "brand-master.json"), "utf8")), previous: saved, now: "2026-10-07T00:00:00.000Z" });
    assert.equal(byName(again, "PERSONSOUL").codeReuseClassification, "MINTED_CODE_COLLISION");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("internal identity codes are deterministic, distinct and outside the Cafe24 namespace", () => {
  const a = internalIdentityCode("B0000BDG", "BORC");
  assert.match(a, /^SPL_[0-9a-f]{10}$/);
  assert.equal(internalIdentityCode("B0000BDG", "BORC"), a);
  assert.equal(internalIdentityCode("B0000BDG", " borc "), a, "normalized name");
  const codes = new Set([a, internalIdentityCode("B0000BDJ", "GKL"), internalIdentityCode("B0000BDM", "LAMASKARADE"), internalIdentityCode("B0000BDG", "PERSONSOUL")]);
  assert.equal(codes.size, 4);
  for (const code of codes) assert.doesNotMatch(code, CAFE24_CODE_PATTERN);
  const many = new Set(Array.from({ length: 20000 }, (_, i) => internalIdentityCode(`B${String(i).padStart(7, "0")}`, `Brand ${i}`)));
  assert.equal(many.size, 20000, "no collisions in 20k identities");
});

test("identity metadata is additive: legacy entries derive it, explicit metadata is preserved and validated", () => {
  assert.deepEqual(parseIdentityMetadata({ brand_code: "B0000BEI", brand_name: "BLUEMARBLE" }), {
    brandCode: "B0000BEI", identityCode: "B0000BEI", externalCodes: { cafe24: { code: "B0000BEI", since: null, until: null } }, formerCodes: []
  });
  assert.deepEqual(parseIdentityMetadata({ brand_code: "MANUAL_x", brand_name: "X" }).externalCodes, { cafe24: null });
  const explicit = { brand_code: "B0000BDG", identityCode: "B0000BDG", externalCodes: { cafe24: { code: "B0000BDG", since: "2026-08", until: null } },
    formerCodes: [{ code: "B0000BDG", source: "MARKETING_OS_MINTED", until: null }] };
  assert.deepEqual(parseIdentityMetadata(explicit), { brandCode: "B0000BDG", identityCode: "B0000BDG", externalCodes: explicit.externalCodes, formerCodes: explicit.formerCodes });
  assert.throws(() => parseIdentityMetadata({ brand_code: "B1", externalCodes: { cafe24: { code: "B1", since: "2026-8" } } }), /month/);
});

test("UNCONFIRMED_CAFE24_CODE audit flags Cafe24-format codes whose Cafe24 identity differs", () => {
  const flagged = auditUnconfirmedCafe24Codes(canonical.brands, cafe24Brands).map((f) => [f.brandCode, f.brandName, f.cafe24Name, f.rule]);
  assert.deepEqual(flagged.filter((f) => ["B0000BDG", "B0000BDJ", "B0000BDM"].includes(f[0])), [
    ["B0000BDG", "BORC", "PERSONSOUL", "UNCONFIRMED_CAFE24_CODE"],
    ["B0000BDJ", "GKL", "UNDER THE SIGN", "UNCONFIRMED_CAFE24_CODE"],
    ["B0000BDM", "LAMASKARADE", "PRAYING", "UNCONFIRMED_CAFE24_CODE"]
  ]);
  assert.ok(!flagged.some((f) => ["B0000AAA", "B0000DDD"].includes(f[0])), "confirmed identities are not flagged");
  assert.deepEqual(auditUnconfirmedCafe24Codes([{ brand_code: "SPL_0123456789", brand_name: "BORC" }, { brand_code: "B0000ZZZ", brand_name: "GONE" }], []).map((f) => [f.brandCode, f.cafe24Name]), [["B0000ZZZ", null]]);
});

test("pending API/UI/one-click surface the split case without approve paths", async () => {
  const { pendingBrandUiMetadata } = await import("../scripts/pending-brand-ui-metadata.mjs");
  const { summarizePending } = await import("../scripts/run-ecount-product-sync-and-publish.mjs");
  const result = detect();
  const personsoul = byName(result, "PERSONSOUL");
  const meta = pendingBrandUiMetadata ? pendingBrandUiMetadata(personsoul, canonical, []) : null;
  if (meta) assert.equal(meta.operationalClass ?? meta.uiReview?.operationalClass, "CODE_REUSE_SPLIT_REQUIRED");
  const summary = summarizePending({ candidates: result.candidates });
  const row = summary.needsReview.find((r) => r.brandName === "PERSONSOUL");
  assert.match(row.reason, /identity split required \(MINTED_CODE_COLLISION, from 2026-08\)/);
  assert.equal(summary.blocked.CODE_REUSE_SPLIT_REQUIRED, undefined, "split cases are listed for review, not as blocked");
  const ui = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  assert.match(ui, /CODE_REUSE_SPLIT_REQUIRED: "코드 재사용 감지"/);
  assert.match(ui, /수동 분리 필요 \(자동 승인·재할당 불가\)/);
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /\.\.\.identityMetadataFields\(entry\)/, "Brand Master saves keep identity metadata");
});
