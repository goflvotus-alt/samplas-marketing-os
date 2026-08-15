import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { approveRevenueReviewItem, buildRevenueReviewQueue } from "../scripts/product-registry-revenue-review.mjs";

const sale = (productNo, revenue, quantitySold = 1, orderCount = 1) => ({ productNo, productCode: `P-${productNo}`, productName: `Product ${productNo}`, brand_code: "B1", brand_name: "Brand", canonicalPaidAmount: revenue, quantitySold, orderCount });
const entry = (productNo, status, verified, matchedProducts = [{ prodCd: `SKU-${productNo}`, size: "M" }]) => ({ canonicalProductId: `CP-C24-${productNo}`, brandId: "B1", brandName: "Brand", canonicalProductName: `Product ${productNo}`, status, verified, confidence: verified ? 100 : 78, cafe24: { productNo, productCode: `P-${productNo}`, productName: `Product ${productNo}` }, ecount: { matchedProducts }, matching: { diagnosticType: [status], pendingReasons: verified ? [] : ["manual_review_required"] } });

test("revenue priority excludes confirmed and zero revenue, includes ambiguous/candidate/no-entry, sorted by revenue", () => {
  const registry = { entries: [entry("1", "confirmed", true), entry("2", "ambiguous", false), entry("3", "candidate", false), entry("5", "candidate", false)] };
  const inventoryProducts = [{ productCode: "SKU-4-S", productName: "Brand / Product 4", specification: "S" }, { productCode: "QQQ-4", productName: "Brand / Product 4", specification: "M" }];
  const queue = buildRevenueReviewQueue({ productSales: [sale("1", 900), sale("2", 500, 2, 2), sale("3", 700), sale("4", 800), sale("5", 0)], registry, inventoryProducts });
  assert.deepEqual(queue.reviewItems.map((row) => row.productNo), ["4", "3", "2"]);
  assert.equal(queue.reviewItems.find((row) => row.productNo === "4").registryStatus, "no_registry_entry");
  assert.deepEqual(queue.reviewItems.find((row) => row.productNo === "4").candidates.map((row) => row.prodCd), ["SKU-4-S", "QQQ-4"]);
  assert.equal(queue.summary.confirmedCount, 1);
});

test("human approval uses a temporary registry, preserves multi-size products, and creates a backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "samplas-revenue-review-"));
  const registryPath = join(dir, "product-registry.json");
  const candidates = [{ prodCd: "SKU-S", size: "S" }, { prodCd: "SKU-M", size: "M" }];
  await writeFile(registryPath, JSON.stringify({ summary: { verifiedCount: 0, reviewQueueCount: 1 }, entries: [entry("2", "ambiguous", false, candidates)] }));
  const result = await approveRevenueReviewItem({ registryPath, productNo: "2", prodCds: ["SKU-S", "SKU-M"], now: "2026-08-15T00:00:00.000Z", backupDir: join(dir, "backups") });
  const saved = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(saved.entries[0].verified, true);
  assert.equal(saved.entries[0].status, "confirmed");
  assert.equal(saved.summary.verifiedCount, 1);
  assert.equal(saved.summary.reviewQueueCount, 0);
  assert.deepEqual(saved.entries[0].ecount.matchedProducts.map((row) => row.prodCd), ["SKU-S", "SKU-M"]);
  assert.equal(JSON.parse(await readFile(result.backupPath, "utf8")).entries[0].verified, false);
});

test("human approval can create a missing Cafe24 entry from trusted exact candidates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "samplas-revenue-review-"));
  const registryPath = join(dir, "product-registry.json");
  await writeFile(registryPath, JSON.stringify({ summary: { registryCount: 0, verifiedCount: 0, reviewQueueCount: 0 }, entries: [] }));
  await approveRevenueReviewItem({ registryPath, productNo: "4", prodCds: ["SKU-4-S"], product: sale("4", 800), candidateProducts: [{ prodCd: "SKU-4-S", productName: "Brand / Product 4", size: "S" }], backupDir: join(dir, "backups") });
  const saved = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(saved.entries[0].canonicalProductId, "CP-C24-4");
  assert.equal(saved.entries[0].verified, true);
  assert.equal(saved.entries[0].status, "confirmed");
  assert.equal(saved.summary.registryCount, 1);
  assert.equal(saved.summary.verifiedCount, 1);
});

test("approval rejects untrusted missing entry and QQQ without changing the registry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "samplas-revenue-review-"));
  const registryPath = join(dir, "product-registry.json");
  await writeFile(registryPath, JSON.stringify({ entries: [entry("2", "candidate", false, [{ prodCd: "QQQ00260" }])] }));
  const before = await readFile(registryPath, "utf8");
  await assert.rejects(() => approveRevenueReviewItem({ registryPath, productNo: "missing", prodCds: ["SKU"] }), /trusted Cafe24 product evidence/);
  await assert.rejects(() => approveRevenueReviewItem({ registryPath, productNo: "2", prodCds: ["QQQ00260"] }), /QQQ/);
  assert.equal(await readFile(registryPath, "utf8"), before);
});
