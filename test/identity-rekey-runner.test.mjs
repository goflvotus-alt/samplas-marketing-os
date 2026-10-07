import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as queue from "../scripts/pending-brand-queue.mjs";
import { createSplitTokenRegistry } from "../scripts/code-identity-split-runner.mjs";
import { createIdentityRekeyRunner, planInternalRekey, previewInternalRekey, rekeyReasons } from "../scripts/identity-rekey.mjs";
import { internalIdentityCode } from "../scripts/cafe24-code-reuse.mjs";
import { loadResolverContext, resolveIdentity } from "../scripts/unified-identity-resolver.mjs";
import { mergeOfflineBrandSales } from "../scripts/monthly-brand-sales.mjs";
import { rebuildArchiveBrandSales } from "../scripts/archive-brand-attribution.mjs";

const CODE = "B0000COL";
const NAME = "MEANTIME X SUNDAYOFFCLUB";
const SPL = internalIdentityCode(CODE, NAME);
const build = (brands) => ({ brands: brands.map((b) => ({ id: b.brand_code, name: b.brand_name, active: b.active !== false })),
  aliases: brands.flatMap((b) => [b.brand_code, ...(b.name_aliases || [])].map((alias) => ({ alias, brandId: b.brand_code }))) });
const line = (date, productName, salesAmount) => ({ date, slipNo: date, documentNo: date, productName, quantity: 1, salesAmount, isOfflineRevenue: true });
const readJson = async (dir, name) => JSON.parse(await readFile(join(dir, name), "utf8"));
const TRACKED = ["brand-master.json", "brand-commercial-policy.json", "product-registry.json", "intelligence/brand-master-list.json", "intelligence/brand-aliases.json",
  "pending-brand-queue.json", "brand-sourcing-master.json", "monthly/2026-08.json"];
const bytesOf = async (dir) => Object.fromEntries(await Promise.all(TRACKED.map(async (n) => [n, await readFile(join(dir, n), "utf8").catch(() => null)])));

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "rekey-runner-"));
  const brands = [
    { brand_code: "B00000HM", brand_name: "MEANTIME", name_aliases: [], instagram_tag: "", active: true, nameSource: "confirmed" },
    { brand_code: CODE, brand_name: NAME, name_aliases: ["SOC X MEANTIME"], instagram_tag: "", active: false, nameSource: "confirmed" }
  ];
  const lines08 = [line("2026-08-03", `${NAME} / Tee`, 1612800), line("2026-08-04", "MEANTIME / Denim", 500000), line("2026-08-05", "SOC X MEANTIME / Cap", 1000)];
  for (const sub of ["intelligence", "monthly", "ecount-inventory", "ecount-sales"]) await mkdir(join(dir, sub), { recursive: true });
  const files = {
    "brand-master.json": { updatedAt: "2026-10-06T00:00:00.000Z", brands },
    "brand-commercial-policy.json": { policies: [{ brand_code: "B00000HM", canonical_brand_name: "MEANTIME", stylist_discount_percent: 20 }] },
    "product-registry.json": { entries: [] },
    "intelligence/brand-master-list.json": build(brands).brands, "intelligence/brand-aliases.json": build(brands).aliases,
    "pending-brand-queue.json": { version: 1, candidates: [{ id: "x1", status: "PENDING", rawBrandName: "OTHER", sourceBrandCode: "B0000ZZA" }] },
    "ecount-inventory/product-master.json": { schemaVersion: 1, complete: true, totalProducts: 2, products: [
      { productCode: "P1", productName: `${NAME} / Tee`, inPrice: "38", outPrice: "100" }, { productCode: "P2", productName: "MEANTIME / Denim", inPrice: "38", outPrice: "100" }] },
    "ecount-sales/2026-08.json": { month: "2026-08", importedAt: "2026-09-02T00:00:00.000Z", salesLines: lines08 },
    "ecount-sales/2026-09.json": { month: "2026-09", importedAt: "2026-09-29T00:00:00.000Z", salesLines: [] }
  };
  for (const [name, value] of Object.entries(files)) await writeFile(join(dir, name), JSON.stringify(value));
  // Saved 2026-08 archive = the official merge of the current state (so reproduction holds).
  const context = await loadResolverContext({ workDir: dir });
  const brandSales = mergeOfflineBrandSales({ offlineLines: lines08, since: "2026-08-01", until: "2026-08-31", identityContext: context });
  await writeFile(join(dir, "monthly/2026-08.json"), JSON.stringify({ month: "2026-08", archiveStatus: "saved", commerce: { brandSales } }));
  const { refreshBrandSourcingMaster } = await import("../scripts/build-brand-sourcing-master.mjs");
  await refreshBrandSourcingMaster(dir);
  return { dir, cafe24Brands: [{ brand_code: "B00000HM", brand_name: "MEANTIME" }, { brand_code: "B0000BEI", brand_name: "BLUEMARBLE" }] };
}

const snapshotResolver = async (dir) => {
  const context = await loadResolverContext({ workDir: dir });
  const names = [...new Set(context.brandMaster.brands.flatMap((b) => [b.brand_name, ...(b.name_aliases || [])]))];
  return Object.fromEntries(names.map((n) => [n, resolveIdentity({ productName: `${n} / probe` }, context).brand?.brandCode ?? null]));
};

// Same dependency shape as server.mjs, wired to the fixture's work dir and the real modules.
function depsFor(fx, overrides = {}) {
  const { dir } = fx;
  const plan = async (code) => {
    const canonical = await readJson(dir, "brand-master.json");
    const p = planInternalRekey({ canonical, policies: await readJson(dir, "brand-commercial-policy.json"), productRegistry: await readJson(dir, "product-registry.json"),
      cafe24Brands: fx.cafe24Brands, pendingCandidates: (await queue.readPendingBrands(dir)).candidates, input: { code } });
    if (p.status !== "PLANNED") return p;
    const preview = await previewInternalRekey(p, canonical, { workDir: dir, fromMonth: "2026-08", toMonth: "2026-09", closedBefore: "2026-09" });
    const ecount = Object.fromEntries(await Promise.all(["2026-08", "2026-09"].map(async (m) => [m, (await readJson(dir, `ecount-sales/${m}.json`)).salesLines])));
    return { status: p.status, version: p.version, preconditions: p.preconditions, identity: p.identity, diff: { ...p.diff, sourcing: preview.sourcing },
      months: preview.months, sources: { ecount }, resolver: await snapshotResolver(dir) };
  };
  const rebuild = async (month, backupId, dryRun) => {
    const backup = await queue.readIdentitySplitBackup(dir, backupId);
    const archive = await readJson(dir, `monthly/${month}.json`);
    const lines = (await readJson(dir, `ecount-sales/${month}.json`)).salesLines;
    const beforeCtx = await loadResolverContext({ workDir: dir, brandMaster: JSON.parse(await readFile(join(backup.dir, "brand-master.json"), "utf8")) });
    const afterCtx = await loadResolverContext({ workDir: dir });
    const before = mergeOfflineBrandSales({ offlineLines: lines, since: `${month}-01`, until: `${month}-31`, identityContext: beforeCtx });
    const after = mergeOfflineBrandSales({ offlineLines: lines, since: `${month}-01`, until: `${month}-31`, identityContext: afterCtx });
    const result = rebuildArchiveBrandSales({ brandSales: archive.commerce.brandSales, before, after, names: new Map([[SPL, NAME]]) });
    if (!dryRun) await writeFile(join(dir, `monthly/${month}.json`), JSON.stringify({ ...archive, commerce: { ...archive.commerce, brandSales: result.brandSales } }));
    return { ok: true, changes: result.changes, totals: result.totals };
  };
  return {
    enabled: () => true,
    busy: () => false,
    plan,
    write: (code, version, archiveMonths) => queue.rekeyInternalIdentity(dir, { code, expectedVersion: version }, build, { cafe24Brands: fx.cafe24Brands, archiveMonths }),
    verify: async (dry) => {
      const brands = (await readJson(dir, "brand-master.json")).brands;
      assert.deepEqual(brands.filter((b) => b.brand_code === dry.identity.brand_code), [dry.identity]);
      assert.equal(brands.some((b) => b.brand_code === CODE), false);
      const after = await snapshotResolver(dir);
      for (const [name, code] of Object.entries(dry.resolver)) assert.equal(after[name], code === CODE ? SPL : code, name);
    },
    rebuild,
    archiveRows: async (month) => (await readJson(dir, `monthly/${month}.json`)).commerce.brandSales,
    restore: (backupId) => queue.restoreIdentitySplitBackup(dir, backupId),
    ...overrides
  };
}

test("happy path: dry-run token, execute re-keys, rebuilds the archive to the previewed won and keeps totals", async () => {
  const fx = await fixture();
  const runner = createIdentityRekeyRunner(depsFor(fx), { registry: createSplitTokenRegistry() });
  const dry = await runner.dryRun(CODE);
  assert.equal(dry.execution.eligible, true, JSON.stringify(dry.execution.reasons));
  assert.equal(dry.execution.token.length, 48);
  assert.equal(dry.identity.brand_code, SPL);
  const august = dry.months.find((m) => m.month === "2026-08");
  assert.equal(august.archive.reproduction, "OK");
  assert.deepEqual(august.offline.after, { [CODE]: 0, [SPL]: 1613800 });
  const policyBefore = await readJson(fx.dir, "brand-commercial-policy.json");

  const result = await runner.execute(CODE, dry.execution.token);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.status, "COMPLETE");
  assert.deepEqual(result.steps.map((s) => s.stage), ["token", "revalidate", "rekey", "verify", "archive", "final"]);
  const rows = (await readJson(fx.dir, "monthly/2026-08.json")).commerce.brandSales;
  const amount = (c) => rows.filter((r) => r.brand_code === c).reduce((s, r) => s + r.salesAmount, 0);
  assert.equal(amount(CODE), 0);
  assert.equal(amount(SPL), 1613800);
  assert.equal(amount("B00000HM"), 500000);
  assert.deepEqual(result.archives[0].totals.salesAmount, { before: 2113800, after: 2113800 });
  assert.deepEqual(await readJson(fx.dir, "brand-commercial-policy.json"), policyBefore, "unrelated policy untouched");
  const brands = (await readJson(fx.dir, "brand-master.json")).brands;
  assert.deepEqual(brands.find((b) => b.brand_code === SPL).formerCodes, [{ code: CODE, source: "MARKETING_OS_MINTED", until: null }]);
  assert.deepEqual(brands.find((b) => b.brand_code === "B00000HM").name_aliases, []);
  const sourcing = (await readJson(fx.dir, "brand-sourcing-master.json")).brands;
  assert.equal(sourcing.some((b) => b.brand_code === CODE), false);
  assert.equal(sourcing.find((b) => b.brand_code === SPL).sourcing_type, dry.diff.sourcing.before.sourcing_type);
  const backup = await queue.readIdentitySplitBackup(fx.dir, result.backupId);
  assert.ok(backup.manifest.files.find((f) => f.relativePath === "monthly/2026-08.json").sha256);
  assert.equal((await queue.readPendingBrands(fx.dir)).candidates.length, 1, "pending untouched");
});

test("token safety: kill switch, missing, wrong, other code, reused and expired tokens never write", async () => {
  const fx = await fixture();
  const before = await bytesOf(fx.dir);
  let clock = Date.now();
  const registry = createSplitTokenRegistry({ now: () => clock });
  const off = createIdentityRekeyRunner({ ...depsFor(fx), enabled: () => false }, { registry });
  await assert.rejects(off.execute(CODE, "x"), { code: "SPLIT_WRITE_DISABLED", status: 403 });
  const runner = createIdentityRekeyRunner(depsFor(fx), { registry });
  for (const [token, code, error] of [[undefined, CODE, "SPLIT_TOKEN_REQUIRED"], ["f".repeat(48), CODE, "SPLIT_TOKEN_INVALID"]]) {
    const r = await runner.execute(code, token);
    assert.equal(r.error, error);
    assert.equal(r.httpStatus, 403);
  }
  const issued = (await runner.dryRun(CODE)).execution.token;
  assert.equal((await runner.execute("B0000ZZA", issued)).error, "SPLIT_TOKEN_MISMATCH");
  const fresh = (await runner.dryRun(CODE)).execution.token;
  clock += 10 * 60 * 1000 + 1;
  assert.equal((await runner.execute(CODE, fresh)).error, "SPLIT_TOKEN_EXPIRED");
  assert.deepEqual(await bytesOf(fx.dir), before, "nothing written");
  const token = (await runner.dryRun(CODE)).execution.token;
  assert.equal((await runner.execute(CODE, token)).ok, true);
  assert.equal((await runner.execute(CODE, token)).error, "SPLIT_TOKEN_USED");
});

test("revalidation: version change, dry-run result change and new Cafe24 ownership block before any write", async () => {
  for (const [label, mutate, error] of [
    ["version", async (fx) => {
      const bm = await readJson(fx.dir, "brand-master.json");
      bm.brands.find((b) => b.brand_code === CODE).name_aliases.push("COLLAB");
      await writeFile(join(fx.dir, "brand-master.json"), JSON.stringify(bm));
    }, "VERSION_CONFLICT"],
    ["result", async (fx) => {
      await writeFile(join(fx.dir, "ecount-sales/2026-09.json"), JSON.stringify({ month: "2026-09", salesLines: [line("2026-09-02", `${NAME} / Tee`, 7000)] }));
    }, "DRY_RUN_CHANGED"],
    ["cafe24", async (fx) => { fx.cafe24Brands.push({ brand_code: CODE, brand_name: "NEW BRAND" }); }, "CAFE24_OWNED"]
  ]) {
    const fx = await fixture();
    const runner = createIdentityRekeyRunner(depsFor(fx), { registry: createSplitTokenRegistry() });
    const token = (await runner.dryRun(CODE)).execution.token;
    await mutate(fx);
    const before = await bytesOf(fx.dir);
    const r = await runner.execute(CODE, token);
    assert.equal(r.error, error, label);
    assert.equal(r.backupId, null, label);
    assert.deepEqual(await bytesOf(fx.dir), before, `${label}: nothing written`);
  }
});

test("gates: archive reproduction, preserved, balanced, other brands, explicit policy and sourcing withhold the token", async () => {
  const fx = await fixture();
  const archive = await readJson(fx.dir, "monthly/2026-08.json");
  archive.commerce.brandSales.find((r) => r.brand_code === CODE).offlineSalesAmount += 1;
  await writeFile(join(fx.dir, "monthly/2026-08.json"), JSON.stringify(archive));
  const runner = createIdentityRekeyRunner(depsFor(fx), { registry: createSplitTokenRegistry() });
  const dry = await runner.dryRun(CODE);
  assert.deepEqual(dry.execution.reasons, ["2026-08:ARCHIVE_SOURCE_MISMATCH"]);
  assert.equal(dry.execution.token, undefined);

  const ok = { status: "PLANNED", months: [{ month: "2026-08", monthOfflineTotal: { preserved: true }, balanced: true, otherBrandsUnchanged: true, archive: { reproduction: "OK" } }],
    diff: { commercialPolicy: { before: [] }, sourcing: { before: { sourcing_type: "WHOLESALE", coverage: { a: 1 } }, after: { sourcing_type: "WHOLESALE", coverage: { a: 1 } } } } };
  assert.deepEqual(rekeyReasons(ok), []);
  const m = (patch) => ({ ...ok, months: [{ ...ok.months[0], ...patch }] });
  assert.deepEqual(rekeyReasons(m({ monthOfflineTotal: { preserved: false } })), ["2026-08:OFFLINE_TOTAL_NOT_PRESERVED"]);
  assert.deepEqual(rekeyReasons(m({ balanced: false })), ["2026-08:NOT_BALANCED"]);
  assert.deepEqual(rekeyReasons(m({ otherBrandsUnchanged: false })), ["2026-08:OTHER_BRANDS_CHANGED"]);
  assert.deepEqual(rekeyReasons({ ...ok, diff: { ...ok.diff, commercialPolicy: { before: [{ brand_code: CODE }] } } }), ["EXPLICIT_POLICY_PRESENT"]);
  assert.deepEqual(rekeyReasons({ ...ok, diff: { ...ok.diff, sourcing: { before: ok.diff.sourcing.before, after: { sourcing_type: "CONSIGNMENT", coverage: { a: 1 } } } } }), ["SOURCING_CHANGED"]);
  assert.deepEqual(rekeyReasons({ ...ok, months: [] }), ["NO_ATTRIBUTION_PREVIEW"]);
});

test("rollback: write, archive rebuild and archive amount failures restore every file byte for byte", async () => {
  const cases = [
    ["write", (fx) => ({ write: (code, version, months) => {
      let calls = 0;
      const replace = async (from, to) => { if (++calls === 3) throw new Error("disk full"); const { rename } = await import("node:fs/promises"); return rename(from, to); };
      return queue.rekeyInternalIdentity(fx.dir, { code, expectedVersion: version }, build, { cafe24Brands: fx.cafe24Brands, archiveMonths: months, replace });
    } }), "rekey"],
    ["rebuild", () => ({ rebuild: async (month, backupId, dryRun) => { if (!dryRun) throw new Error("archive write failed"); return { ok: true }; } }), "archive"],
    ["amount", (fx, deps) => ({ rebuild: async (month, backupId, dryRun) => {
      const result = await deps.rebuild(month, backupId, dryRun);
      if (!dryRun) {
        const archive = await readJson(fx.dir, `monthly/${month}.json`);
        archive.commerce.brandSales.find((r) => r.brand_code === SPL).salesAmount += 1;
        await writeFile(join(fx.dir, `monthly/${month}.json`), JSON.stringify(archive));
      }
      return result;
    } }), "archive"]
  ];
  for (const [label, override, stage] of cases) {
    const fx = await fixture();
    const before = await bytesOf(fx.dir);
    const base = depsFor(fx);
    const runner = createIdentityRekeyRunner({ ...base, ...override(fx, base) }, { registry: createSplitTokenRegistry() });
    const token = (await runner.dryRun(CODE)).execution.token;
    const r = await runner.execute(CODE, token);
    assert.equal(r.ok, false, label);
    assert.equal(r.stage, stage, label);
    assert.equal(r.rolledBack, true, `${label}: ${r.error} ${r.message}`);
    assert.ok(r.backupId, label);
    assert.deepEqual(await bytesOf(fx.dir), before, `${label}: restored byte for byte`);
  }
});

test("concurrency: a second execute, or one during an identity split, is refused", async () => {
  const fx = await fixture();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const base = depsFor(fx);
  const runner = createIdentityRekeyRunner({ ...base, write: async (...args) => { await gate; return base.write(...args); } }, { registry: createSplitTokenRegistry() });
  const t1 = (await runner.dryRun(CODE)).execution.token;
  const t2 = (await runner.dryRun(CODE)).execution.token;
  const first = runner.execute(CODE, t1);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(runner.execute(CODE, t2), { code: "REKEY_BUSY" });
  release();
  assert.equal((await first).ok, true);
  const busy = createIdentityRekeyRunner({ ...depsFor(fx), busy: () => true }, { registry: createSplitTokenRegistry() });
  await assert.rejects(busy.execute(CODE, "t"), { code: "REKEY_BUSY" });
});

test("routes: operator/internal auth on both rekey routes, execute only through the runner, MCP cannot reach them", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  for (const path of ["/api/brands/rekey/dry-run", "/api/brands/rekey/execute"]) {
    const at = server.indexOf(`url.pathname === "${path}"`);
    const route = server.slice(at, server.indexOf("\n    }\n", at));
    assert.match(route, /if \(req\.method !== "POST"\)[\s\S]*if \(!isAuthorizedOperatorAction\(req\)\) return json\(res, \{ ok: false, error: "Unauthorized" \}, 401\);/, path);
  }
  assert.match(server, /identityRekeyRunner\.execute\(String\(input\?\.code \|\| ""\), input\?\.token\)/);
  assert.match(server, /busy: \(\) => identityRekeyRunner\.isRunning\(\)/);
  assert.match(server, /busy: \(\) => identitySplitRunner\.isRunning\(\)/);
  const { assertSafeUpstreamRequest } = await import("../scripts/mcp/upstream.mjs");
  assert.throws(() => assertSafeUpstreamRequest("GET", "/api/brands/rekey/execute"), /not allowed/);
});
