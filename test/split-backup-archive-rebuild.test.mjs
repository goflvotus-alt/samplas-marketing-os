import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as queue from "../scripts/pending-brand-queue.mjs";
import { rebuildArchiveBrandSales } from "../scripts/archive-brand-attribution.mjs";

const bucket = (code, name, offline, quantity = 1, orders = 1) => ({ brand_code: code, brand_name: name, salesAmount: offline, canonicalPaidAmount: offline, offlineSalesAmount: offline,
  onlinePaidAmount: 0, quantitySold: quantity, orderCount: orders, sales: { grossAmount: offline, paidAmount: offline, discountAmount: 0 } });

// Saved archive rows: online + offline merged (as mergeOfflineBrandSales writes them).
const saved = [
  { brand_code: "B0000BDG", brand_name: "BORC", salesAmount: 8614800, canonicalPaidAmount: 8614800, onlinePaidAmount: 198000, offlineSalesAmount: 8416800, quantitySold: 30, orderCount: 26, sales: { grossAmount: 8614800, paidAmount: 8614800 } },
  { brand_code: "B0000OTH", brand_name: "OTHER", salesAmount: 500000, canonicalPaidAmount: 500000, onlinePaidAmount: 0, offlineSalesAmount: 500000, quantitySold: 2, orderCount: 2, sales: { grossAmount: 500000, paidAmount: 500000 } },
  { brand_code: "UNASSIGNED", brand_name: "UNASSIGNED", salesAmount: 1000, canonicalPaidAmount: 1000, onlinePaidAmount: 0, offlineSalesAmount: 1000, quantitySold: 1, orderCount: 1, sales: { grossAmount: 1000, paidAmount: 1000 } }
];
const before = [bucket("B0000BDG", "BORC", 8416800, 28, 25), bucket("B0000OTH", "OTHER", 500000, 2, 2), bucket("UNASSIGNED", "UNASSIGNED", 1000)];
const after = [bucket("SPL_00b4a2e6cc", "BORC", 5087200, 18, 15), bucket("B0000BDG", "PERSONSOUL", 3329600, 10, 10), bucket("B0000OTH", "OTHER", 500000, 2, 2), bucket("UNASSIGNED", "UNASSIGNED", 1000)];
const names = new Map([["B0000BDG", "PERSONSOUL"], ["SPL_00b4a2e6cc", "BORC"], ["B0000OTH", "OTHER"]]);

test("rebuild moves only the changed offline attribution; online stays on the code; totals preserved", () => {
  const result = rebuildArchiveBrandSales({ brandSales: saved, before, after, names });
  const by = Object.fromEntries(result.brandSales.map((r) => [r.brand_code, r]));
  assert.deepEqual([by.B0000BDG.brand_name, by.B0000BDG.onlinePaidAmount, by.B0000BDG.offlineSalesAmount, by.B0000BDG.salesAmount], ["PERSONSOUL", 198000, 3329600, 3527600]);
  assert.deepEqual([by.SPL_00b4a2e6cc.brand_name, by.SPL_00b4a2e6cc.onlinePaidAmount, by.SPL_00b4a2e6cc.salesAmount], ["BORC", 0, 5087200]);
  assert.equal(by.B0000BDG.salesAmount + by.SPL_00b4a2e6cc.salesAmount, 8614800);
  assert.equal(by.B0000BDG.quantitySold, 30 - 28 + 10);
  assert.equal(by.B0000OTH, saved[1], "unchanged rows are kept as saved");
  assert.deepEqual(result.totals.salesAmount, { before: 9115800, after: 9115800 });
  assert.deepEqual(result.changes.map((c) => c.brand_code).sort(), ["B0000BDG", "SPL_00b4a2e6cc"]);
});

test("rebuild refuses when the pre-change state does not reproduce the saved archive", () => {
  assert.throws(() => rebuildArchiveBrandSales({ brandSales: saved, before: [bucket("B0000BDG", "BORC", 8000000), before[1], before[2]], after, names }), (e) => e.code === "ARCHIVE_SOURCE_MISMATCH");
  assert.throws(() => rebuildArchiveBrandSales({ brandSales: saved, before: [...before, bucket("B0000NEW", "X", 10)], after, names }), (e) => e.code === "ARCHIVE_SOURCE_MISMATCH");
});

test("rebuild refuses if totals would change", () => {
  const leaking = [after[0], after[1], after[2]]; // UNASSIGNED offline vanishes
  assert.throws(() => rebuildArchiveBrandSales({ brandSales: saved, before, after: leaking, names }), (e) => e.code === "ARCHIVE_TOTAL_MISMATCH");
});

test("consistency-only run (current state on both sides) changes nothing", () => {
  const result = rebuildArchiveBrandSales({ brandSales: saved, before, after: before, names: new Map([["B0000BDG", "BORC"], ["B0000OTH", "OTHER"]]) });
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.brandSales.map((r) => r.brand_code), saved.map((r) => r.brand_code));
});

// --- split backup / restore ---------------------------------------------------------------
const build = (brands) => ({ brands: brands.map((b) => ({ id: b.brand_code, name: b.brand_name, active: b.active })), aliases: [] });
async function splitFixture() {
  const canonical = { brands: [{ brand_code: "B0000BDG", brand_name: "BORC", name_aliases: [], instagram_tag: "", active: false, nameSource: "suggested" }] };
  const sources = { canonical, cafe24Brands: [{ brand_code: "B0000BDG", brand_name: "PERSONSOUL", created_date: "2026-08-18T18:53:00+09:00" }], products: [], ecountLines: [],
    ecountProducts: [{ productName: "PERSONSOUL / Jacket", productCode: "P1" }, { productName: "BORC / Knit", productCode: "P2" }] };
  const dir = await mkdtemp(join(tmpdir(), "split-backup-"));
  const detected = queue.detectPendingBrands({ ...sources, now: "2026-10-06T00:00:00.000Z" });
  const files = {
    "brand-master.json": canonical, "pending-brand-queue.json": detected,
    "brand-commercial-policy.json": { policies: [{ brand_code: "B0000BDG", canonical_brand_name: "BORC", stylist_discount_percent: 20 }] },
    "intelligence/brand-master-list.json": [], "intelligence/brand-aliases.json": [],
    "monthly/2026-08.json": { month: "2026-08", archiveStatus: "saved", commerce: { brandSales: saved } },
    "monthly/2026-09.json": { month: "2026-09", archiveStatus: "saved", commerce: { brandSales: [] } },
    "ecount-inventory/product-master.json": { schemaVersion: 1, complete: true, totalProducts: 2, products: [{ productCode: "P1", productName: "PERSONSOUL / Jacket", inPrice: "38", outPrice: "100" }, { productCode: "P2", productName: "BORC / Knit", inPrice: "38", outPrice: "100" }] },
    "ecount-sales/2026-09.json": { month: "2026-09", salesLines: [] }
  };
  for (const sub of ["intelligence", "monthly", "ecount-inventory", "ecount-sales"]) await mkdir(join(dir, sub), { recursive: true });
  for (const [name, value] of Object.entries(files)) await writeFile(join(dir, name), JSON.stringify(value));
  const id = detected.candidates.find((c) => c.rawBrandName === "PERSONSOUL").id;
  return { dir, sources, id, files };
}
const bytesOf = async (dir, names) => Object.fromEntries(await Promise.all(names.map(async (n) => [n, await readFile(join(dir, n), "utf8").catch(() => null)])));
const TRACKED = ["brand-master.json", "pending-brand-queue.json", "brand-commercial-policy.json", "intelligence/brand-master-list.json", "intelligence/brand-aliases.json", "monthly/2026-08.json", "monthly/2026-09.json", "product-registry.json", "brand-sourcing-master.json"];

test("split writes an exact pre-write backup; restore returns every file byte for byte", async () => {
  const { dir, sources, id } = await splitFixture();
  try {
    const original = await bytesOf(dir, TRACKED);
    const { version } = await queue.splitCodeIdentity(dir, { id, action: "SPLIT_CODE_IDENTITY" }, build, { sources, dryRun: true });
    const done = await queue.splitCodeIdentity(dir, { id, action: "SPLIT_CODE_IDENTITY", expectedVersion: version }, build, { sources, dryRun: false });
    const manifest = done.backup;
    assert.match(manifest.backupId, /^[0-9A-Za-z_-]+$/);
    const backedUp = manifest.files.map((f) => f.relativePath);
    for (const name of ["brand-commercial-policy.json", "brand-master.json", "brand-sourcing-master.json", "intelligence/brand-aliases.json", "intelligence/brand-master-list.json", "monthly/2026-08.json", "monthly/2026-09.json", "pending-brand-queue.json", "product-registry.json"]) assert.ok(backedUp.includes(name), name);
    for (const f of manifest.files.filter((x) => x.existed)) assert.match(f.sha256, /^[0-9a-f]{64}$/);
    assert.notDeepEqual(await bytesOf(dir, TRACKED), original, "split changed the files");
    const restored = await queue.restoreIdentitySplitBackup(dir, manifest.backupId);
    assert.equal(restored.ok, true);
    assert.deepEqual(await bytesOf(dir, TRACKED), original, "restore is byte-exact; files created by the split are removed");
    assert.equal(JSON.parse(original["pending-brand-queue.json"]).candidates.find((c) => c.id === id).status, "PENDING");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("restore rejects invalid ids and corrupt backups without changing anything", async () => {
  const { dir, sources, id } = await splitFixture();
  try {
    await assert.rejects(queue.restoreIdentitySplitBackup(dir, "../etc"), (e) => e.code === "VALIDATION_FAILED");
    await assert.rejects(queue.restoreIdentitySplitBackup(dir, "missing-backup"), (e) => e.code === "NOT_FOUND");
    const { version } = await queue.splitCodeIdentity(dir, { id, action: "SPLIT_CODE_IDENTITY" }, build, { sources, dryRun: true });
    const done = await queue.splitCodeIdentity(dir, { id, action: "SPLIT_CODE_IDENTITY", expectedVersion: version }, build, { sources, dryRun: false });
    const afterSplit = await bytesOf(dir, TRACKED);
    await writeFile(join(dir, "backups", "identity-split", done.backup.backupId, "brand-master.json"), "{\"tampered\":true}");
    await assert.rejects(queue.restoreIdentitySplitBackup(dir, done.backup.backupId), (e) => e.code === "BACKUP_CORRUPT");
    assert.deepEqual(await bytesOf(dir, TRACKED), afterSplit);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("server wiring: restore and archive rebuild are internal-only and gated; rebuild is dry-run by default", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /url\.pathname === "\/api\/pending-brands\/split-restore" \|\| url\.pathname === "\/api\/reports\/monthly\/brand-attribution-rebuild"/);
  assert.match(server, /const dryRun = !restoring && input\.dryRun !== false;/);
  assert.match(server, /if \(!dryRun && env\.CODE_IDENTITY_SPLIT_WRITE !== "on"\) return json\(res, \{ ok: false, error: "SPLIT_WRITE_DISABLED"/);
  assert.match(server, /if \(!backupId && !dryRun\) throw/);
});
