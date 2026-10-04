import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildProductMaster, productMasterProblem, readEcountProductMaster } from "../scripts/ecount-product-master.mjs";
import { fetchAllProducts, writeInventoryOutputsAtomically } from "../scripts/sync-ecount-inventory.mjs";
import { refreshBrandSourcingMaster } from "../scripts/build-brand-sourcing-master.mjs";
import * as queue from "../scripts/pending-brand-queue.mjs";
import { isAllowedRenderSnapshotPath } from "../scripts/render-snapshot-manifest.mjs";

const rawRow = (PROD_CD, PROD_DES, IN_PRICE = "500.0000000000", OUT_PRICE = "1000.0000000000") => ({ PROD_CD, PROD_DES, IN_PRICE, OUT_PRICE, BAR_CODE: "x", CLASS_CD: "1" });
const pagination = { fetchedAt: "2026-10-04T00:00:00.000Z", pageCount: 1, duplicateCount: 0, firstProdCd: "A", lastProdCd: "B", complete: true };
const master = products => buildProductMaster(products, { ...pagination, firstProdCd: products[0]?.PROD_CD, lastProdCd: products.at(-1)?.PROD_CD });

async function workDir(files) {
  const dir = await mkdtemp(join(tmpdir(), "product-master-"));
  for (const sub of ["ecount-inventory", "ecount-sales", "intelligence"]) await mkdir(join(dir, sub));
  const base = { "brand-master.json": { brands: [] }, "intelligence/brand-master-list.json": [], "intelligence/brand-aliases.json": [] };
  for (const [name, value] of Object.entries({ ...base, ...files })) await writeFile(join(dir, name), JSON.stringify(value));
  return dir;
}

test("product master covers every fetched product 1:1 with the needed fields only", async () => {
  const all = Array.from({ length: 14_746 }, (_, i) => `P${String(i).padStart(6, "0")}`);
  const request = async body => {
    const rows = all.filter(c => !body.FROM_PROD_CD || (c >= body.FROM_PROD_CD && c <= body.TO_PROD_CD)).slice(0, 10_000);
    return { httpStatus: 200, body: { Data: { Result: rows.map(c => rawRow(c, `BRAND / ${c}`)) } } };
  };
  const { productList, pagination: p } = await fetchAllProducts(request, {}, { delayMs: 0 });
  const pm = buildProductMaster(productList, p);
  assert.equal(pm.totalProducts, 14_746);
  assert.deepEqual(pm.products.map(r => r.productCode), productList.map(r => r.PROD_CD));
  assert.deepEqual(Object.keys(pm.products[0]).sort(), ["inPrice", "outPrice", "productCode", "productName"]);
  assert.deepEqual({ complete: pm.complete, pageCount: pm.pageCount, duplicateCount: pm.duplicateCount, firstProdCd: pm.firstProdCd, lastProdCd: pm.lastProdCd },
    { complete: true, pageCount: 2, duplicateCount: 1, firstProdCd: "P000000", lastProdCd: "P014745" });
  assert.equal(pm.products[0].inPrice, "500.0000000000", "raw decimal string kept for exact 30% checks");
  assert.throws(() => buildProductMaster(productList, { ...p, complete: false }), /complete/);
});

test("malformed or incomplete product masters are rejected", () => {
  const good = master([rawRow("A", "X / a"), rawRow("B", "X / b")]);
  assert.equal(productMasterProblem(good), null);
  for (const bad of [null, [], { ...good, complete: false }, { ...good, totalProducts: 3 }, { ...good, schemaVersion: 2 },
    { ...good, products: [...good.products, good.products[0]], totalProducts: 3 }, { ...good, products: [{ productName: "x" }], totalProducts: 1 }, { ...good, products: "x" }]) {
    assert.ok(productMasterProblem(bad), JSON.stringify(bad)?.slice(0, 80));
  }
});

test("loaders prefer product-master, fall back to raw-products only when it is absent, and reject a bad one", async () => {
  const raw = { Data: { Result: [rawRow("OLD1", "Old Brand / Item")] } };
  const pm = master([rawRow("NEW1", "Fresh Label / Coat")]);
  const both = await workDir({ "ecount-inventory/raw-products.json": raw, "ecount-inventory/product-master.json": pm });
  const rawOnly = await workDir({ "ecount-inventory/raw-products.json": raw });
  const broken = await workDir({ "ecount-inventory/raw-products.json": raw, "ecount-inventory/product-master.json": { ...pm, complete: false } });
  try {
    const a = await queue.loadPendingBrandSources(both, "2026-10");
    assert.deepEqual(a.ecountProducts, [{ productName: "Fresh Label / Coat", productCode: "NEW1" }]);
    assert.equal(a.provenance.ecountProductSource, "ecount-inventory/product-master.json");
    assert.equal((await refreshBrandSourcingMaster(both)).sources.inventory, "work/ecount-inventory/product-master.json");

    const b = await queue.loadPendingBrandSources(rawOnly, "2026-10");
    assert.deepEqual(b.ecountProducts, [{ productName: "Old Brand / Item", productCode: "OLD1" }]);
    assert.equal(b.provenance.ecountProductSource, "ecount-inventory/raw-products.json");
    assert.equal((await refreshBrandSourcingMaster(rawOnly)).sources.inventory, "work/ecount-inventory/raw-products.json");

    await assert.rejects(readEcountProductMaster(broken), /complete/);
    await assert.rejects(queue.loadPendingBrandSources(broken, "2026-10"), /product master/);
    await assert.rejects(refreshBrandSourcingMaster(broken), /product master/);
    const empty = await workDir({});
    assert.equal(await readEcountProductMaster(empty), null);
    await rm(empty, { recursive: true, force: true });
  } finally { for (const d of [both, rawOnly, broken]) await rm(d, { recursive: true, force: true }); }
});

test("Cafe24 + product-master with zero sales auto-onboards; sourcing comes from product prices", async () => {
  const dir = await workDir({ "ecount-inventory/product-master.json": master([rawRow("FRL1", "CON - Fresh Label / Coat", "0", "0"), rawRow("ZZZ1", "Other / Bag", "300", "1000")]) });
  try {
    const load = async () => ({ ...(await queue.loadPendingBrandSources(dir, "2026-10")), cafe24Brands: [{ brand_code: "NEWB1", brand_name: "Fresh Label" }] });
    assert.equal((await load()).ecountLines.length, 0);
    const result = await queue.refreshPendingBrands(dir, load, { autoApprove: true, buildCompatibility: brands => ({ brands: brands.map(b => ({ id: b.brand_code, name: b.brand_name })), aliases: [] }) });
    const c = result.candidates.find(row => row.sourceBrandCode === "NEWB1");
    assert.equal(c.source, "BOTH");
    assert.equal(c.status, "APPROVED");
    assert.equal(result.onboarding[0].sourcingRefresh.ok, true);
    const sourcing = JSON.parse(await readFile(join(dir, "brand-sourcing-master.json"), "utf8"));
    assert.equal(sourcing.brands.find(b => b.brand_code === c.canonicalBrandCode).sourcing_type, "CONSIGNMENT", "CON prefix");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("sourcing from product-master: exact 30% CONSIGNMENT, plain WHOLESALE, mixed HYBRID", async () => {
  const brands = { brands: ["Thirty", "Plain", "Mixed"].map((n, i) => ({ brand_code: `B${i}`, brand_name: n, name_aliases: [], active: true })) };
  const dir = await workDir({ "brand-master.json": brands, "ecount-inventory/product-master.json": master([
    rawRow("T1", "Thirty / a", "300.0000000000", "1000.0000000000"),
    rawRow("P1", "Plain / a", "450.5", "1000"),
    rawRow("M1", "Mixed / a", "300", "1000"), rawRow("M2", "Mixed / b", "410", "1000")
  ]) });
  try {
    const type = code => result.brands.find(b => b.brand_code === code).sourcing_type;
    const result = await refreshBrandSourcingMaster(dir);
    assert.deepEqual([type("B0"), type("B1"), type("B2")], ["CONSIGNMENT", "WHOLESALE", "HYBRID"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("sync writes product-master in the same atomic set; a failure keeps every canonical file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "product-master-sync-"));
  const payload = productMaster => ({ rawProducts: { Data: { Result: [rawRow("A", "X / a")] } }, rawInventory: { Data: { Result: [] } }, latest: [], diagnostic: { startedAt: "s", finishedAt: "f" }, productMaster });
  try {
    await writeInventoryOutputsAtomically(dir, payload(master([rawRow("A", "X / a")])));
    const before = Object.fromEntries(await Promise.all((await readdir(dir)).map(async f => [f, await readFile(join(dir, f), "utf8")])));
    assert.ok(before["product-master.json"]);
    await assert.rejects(writeInventoryOutputsAtomically(dir, payload({ ...master([rawRow("B", "Y / b")]), complete: false })), /product master/);
    const failingRename = async (from, to) => { if (to.endsWith("product-master.json") && from.includes(".sync-")) throw new Error("injected"); return rename(from, to); };
    await assert.rejects(writeInventoryOutputsAtomically(dir, payload(master([rawRow("B", "Y / b")])), { mkdir, writeFile, rename: failingRename, rm }), /injected/);
    const after = Object.fromEntries(await Promise.all((await readdir(dir)).map(async f => [f, await readFile(join(dir, f), "utf8")])));
    assert.deepEqual(after, before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("upload allowlist adds only product-master, never raw-products", () => {
  assert.equal(isAllowedRenderSnapshotPath("ecount-inventory/product-master.json"), true);
  assert.equal(isAllowedRenderSnapshotPath("ecount-inventory/raw-products.json"), false);
  assert.equal(isAllowedRenderSnapshotPath("ecount-inventory/raw-inventory.json"), false);
});
