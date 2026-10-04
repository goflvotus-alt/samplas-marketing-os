import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as queue from "../scripts/pending-brand-queue.mjs";
import { buildBrandSourcingMaster } from "../scripts/build-brand-sourcing-master.mjs";

// Brand onboarding evidence = Cafe24 + current ECOUNT product master; sales are optional.
const fixture = (patch = {}) => ({
  canonical: { brands: [] },
  cafe24Brands: [{ brand_code: "NEWB1", brand_name: "Fresh Label", product_count: 3 }],
  products: [],
  ecountLines: [],
  ecountProducts: [{ productName: "Fresh Label / Coat", productCode: "FRL261OT00101" }],
  ...patch
});
const build = brands => ({ brands: brands.map(b => ({ id: b.brand_code, name: b.brand_name, active: b.active })), aliases: [] });
const decide = sources => {
  const c = queue.detectPendingBrands(sources).candidates.find(row => row.sourceBrandCode === "NEWB1");
  return { c, decision: c && queue.isAutoSafePendingDecision(c, sources.canonical, sources) };
};

test("Cafe24 + ECOUNT product master with zero sales is BOTH and AUTO_SAFE NEW", () => {
  const { c, decision } = decide(fixture());
  assert.equal(c.source, "BOTH");
  assert.deepEqual(c.ecountVariants, ["Fresh Label"]);
  assert.equal(decision?.action, "NEW");
});

test("Cafe24 only stays PENDING", () => {
  const { c, decision } = decide(fixture({ ecountProducts: [] }));
  assert.equal(c.source, "CAFE24");
  assert.equal(c.status, "PENDING");
  assert.equal(decision, null);
});

test("ECOUNT product master only never opens or approves a candidate", () => {
  const sources = fixture({ cafe24Brands: [] });
  const result = queue.detectPendingBrands(sources);
  assert.equal(result.candidates.length, 0, "product rows only corroborate Cafe24 brands");
  // ECOUNT sales-only observation keeps the previous PENDING behaviour.
  const sales = queue.detectPendingBrands({ ...sources, ecountLines: [{ productName: "Fresh Label / Coat" }] });
  assert.equal(sales.candidates[0].source, "ECOUNT");
  assert.equal(sales.candidates[0].status, "PENDING");
  assert.equal(queue.isAutoSafePendingDecision(sales.candidates[0], sources.canonical, { ...sources, ecountLines: [{ productName: "Fresh Label / Coat" }] }), null);
});

test("ambiguous alias or competing identity blocks AUTO_SAFE even with product master", () => {
  for (const patch of [
    { aliases: [{ alias: "Fresh Label", brandId: "OTHER" }] },
    { compatibility: [{ id: "OTHER", name: "Fresh Label" }] },
    { canonical: { brands: [{ brand_code: "OLD", brand_name: "Old", name_aliases: ["Fresh Label"], active: true }] } },
    { cafe24Brands: [...fixture().cafe24Brands, { brand_code: "NEWB2", brand_name: "Fresh Label" }] }
  ]) {
    const sources = fixture(patch);
    const c = queue.detectPendingBrands(sources).candidates.find(row => row.sourceBrandCode === "NEWB1");
    assert.equal(c ? queue.isAutoSafePendingDecision(c, sources.canonical, sources) : null, null, JSON.stringify(patch));
  }
});

test("collaboration blocks AUTO_SAFE even with product master", () => {
  const sources = fixture({
    cafe24Brands: [{ brand_code: "NEWB1", brand_name: "Fresh Label X Other" }],
    ecountProducts: [{ productName: "Fresh Label X Other / Coat" }]
  });
  const c = queue.detectPendingBrands(sources).candidates[0];
  assert.ok(c.collabCandidates.length);
  assert.equal(queue.isAutoSafePendingDecision(c, sources.canonical, sources), null);
});

test("sales-free sourcing from product master: WHOLESALE, CONSIGNMENT, HYBRID", () => {
  const brandMaster = { brands: [{ brand_code: "NEWB1", brand_name: "Fresh Label", name_aliases: [], active: true }] };
  const run = products => buildBrandSourcingMaster({ brandMaster, products, salesSnapshots: [] }).brands[0].sourcing_type;
  const wholesale = { PROD_DES: "Fresh Label / Coat", IN_PRICE: "500", OUT_PRICE: "1000" };
  const exact30 = { PROD_DES: "Fresh Label / Bag", IN_PRICE: "300", OUT_PRICE: "1000" };
  assert.equal(run([wholesale]), "WHOLESALE");
  assert.equal(run([exact30]), "CONSIGNMENT");
  assert.equal(run([{ ...exact30, PROD_DES: "CON - Fresh Label / Bag", IN_PRICE: "0", OUT_PRICE: "0" }]), "CONSIGNMENT");
  assert.equal(run([wholesale, exact30]), "HYBRID");
});

test("later sales only add sourcing evidence; approved identity does not flip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brand-product-master-"));
  try {
    for (const sub of ["ecount-inventory", "ecount-sales", "intelligence"]) await mkdir(join(dir, sub));
    for (const [name, value] of Object.entries({
      "brand-master.json": { brands: [] }, "intelligence/brand-master-list.json": [], "intelligence/brand-aliases.json": [],
      "ecount-inventory/raw-products.json": { Data: { Result: [{ PROD_CD: "FRL261OT00101", PROD_DES: "CON - Fresh Label / Coat", IN_PRICE: "0", OUT_PRICE: "0" }] } }
    })) await writeFile(join(dir, name), JSON.stringify(value));
    const month = "2026-10";
    const load = async () => ({ ...(await queue.loadPendingBrandSources(dir, month)), cafe24Brands: fixture().cafe24Brands });
    const loaded = await load();
    assert.equal(loaded.ecountLines.length, 0, "no sales snapshot");
    assert.deepEqual(loaded.ecountProducts, [{ productName: "Fresh Label / Coat", productCode: "FRL261OT00101" }], "CON prefix stripped");
    const result = await queue.refreshPendingBrands(dir, load, { autoApprove: true, buildCompatibility: build });
    const approved = result.candidates.find(c => c.sourceBrandCode === "NEWB1");
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.approvalAction, "NEW");
    const code = approved.canonicalBrandCode;
    const sourcingPath = join(dir, "brand-sourcing-master.json");
    assert.equal(JSON.parse(await readFile(sourcingPath, "utf8")).brands.find(b => b.brand_code === code).sourcing_type, "CONSIGNMENT");

    await writeFile(join(dir, "ecount-sales", `${month}.json`), JSON.stringify({ month, salesLines: [{ productName: "Fresh Label / Coat", brandGroup: "FRL" }] }));
    const again = await queue.refreshPendingBrands(dir, load, { autoApprove: true, buildCompatibility: build });
    assert.equal(again.onboarding.length, 0);
    const same = again.candidates.filter(c => c.sourceBrandCode === "NEWB1" || c.rawBrandName === "Fresh Label");
    assert.equal(same.length, 1);
    assert.equal(same[0].canonicalBrandCode, code);
    const master = JSON.parse(await readFile(join(dir, "brand-master.json"), "utf8"));
    assert.equal(master.brands.filter(b => b.brand_name === "Fresh Label").length, 1);
    const { refreshBrandSourcingMaster } = await import("../scripts/build-brand-sourcing-master.mjs");
    const sourcing = await refreshBrandSourcingMaster(dir);
    assert.equal(sourcing.brands.find(b => b.brand_code === code).sourcing_type, "HYBRID", "non-CO sale adds a wholesale signal");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
