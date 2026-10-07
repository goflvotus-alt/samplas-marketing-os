import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as queue from "../scripts/pending-brand-queue.mjs";
import { rebuildArchiveBrandSales } from "../scripts/archive-brand-attribution.mjs";
import { createIdentitySplitRunner, createSplitTokenRegistry, checkSplitReadBack } from "../scripts/code-identity-split-runner.mjs";
import { ALLOWED_UPSTREAM_PATHS, assertSafeUpstreamRequest } from "../scripts/mcp/upstream.mjs";

const build = (brands) => ({ brands: brands.map((b) => ({ id: b.brand_code, name: b.brand_name, active: b.active })), aliases: [] });
const bucket = (code, name, offline) => ({ brand_code: code, brand_name: name, salesAmount: offline, canonicalPaidAmount: offline, offlineSalesAmount: offline,
  onlinePaidAmount: 0, quantitySold: 1, orderCount: 1, sales: { grossAmount: offline, paidAmount: offline } });
const row = (code, name, online, offline) => ({ ...bucket(code, name, offline), salesAmount: online + offline, canonicalPaidAmount: online + offline, onlinePaidAmount: online,
  sales: { grossAmount: online + offline, paidAmount: online + offline } });

// PERSONSOUL-style: BORC's minted code reused by Cafe24; offline moves from the code row to the split identity.
// UNDER THE SIGN-style: GKL's minted code reused; the new brand's offline is recovered from UNASSIGNED.
const FIXTURES = {
  PERSONSOUL: { oldName: "BORC", code: "B0000BDG", spl: "SPL_00b4a2e6cc", created: "2026-08-18T18:53:00+09:00",
    saved: [row("B0000BDG", "BORC", 198000, 8416800), row("UNASSIGNED", "UNASSIGNED", 0, 1000)],
    before: [bucket("B0000BDG", "BORC", 8416800), bucket("UNASSIGNED", "UNASSIGNED", 1000)],
    after: (spl) => [bucket(spl, "BORC", 5087200), bucket("B0000BDG", "PERSONSOUL", 3329600), bucket("UNASSIGNED", "UNASSIGNED", 1000)],
    expected: { old: 5087200, new: 3527600 } },
  "UNDER THE SIGN": { oldName: "GKL", code: "B0000BDJ", spl: "SPL_e4af36d3ce", created: "2026-08-17T10:00:00+09:00",
    saved: [row("B0000OTH", "OTHER", 0, 500000), row("UNASSIGNED", "UNASSIGNED", 0, 10519400)],
    before: [bucket("B0000OTH", "OTHER", 500000), bucket("UNASSIGNED", "UNASSIGNED", 10519400)],
    after: () => [bucket("B0000OTH", "OTHER", 500000), bucket("B0000BDJ", "UNDER THE SIGN", 5265600), bucket("UNASSIGNED", "UNASSIGNED", 5253800)],
    expected: { old: 0, new: 5265600 } }
};

async function fixture(newName) {
  const f = FIXTURES[newName];
  const canonical = { brands: [{ brand_code: f.code, brand_name: f.oldName, name_aliases: [], instagram_tag: "", active: false, nameSource: "suggested" },
    { brand_code: "B0000OTH", brand_name: "OTHER", name_aliases: [], instagram_tag: "", active: true, nameSource: "confirmed" }] };
  const sources = { canonical, cafe24Brands: [{ brand_code: f.code, brand_name: newName, created_date: f.created }], products: [], ecountLines: [],
    ecountProducts: [{ productName: `${newName} / Jacket`, productCode: "P1" }, { productName: `${f.oldName} / Knit`, productCode: "P2" }] };
  const dir = await mkdtemp(join(tmpdir(), "split-runner-"));
  const detected = queue.detectPendingBrands({ ...sources, now: "2026-10-07T00:00:00.000Z" });
  const files = {
    "brand-master.json": canonical, "pending-brand-queue.json": detected,
    "brand-commercial-policy.json": { policies: [{ brand_code: f.code, canonical_brand_name: f.oldName, stylist_discount_percent: 20 }] },
    "intelligence/brand-master-list.json": [], "intelligence/brand-aliases.json": [],
    "monthly/2026-08.json": { month: "2026-08", archiveStatus: "saved", commerce: { brandSales: f.saved } },
    "ecount-inventory/product-master.json": { schemaVersion: 1, complete: true, totalProducts: 2, products: [{ productCode: "P1", productName: `${newName} / Jacket`, inPrice: "38", outPrice: "100" }, { productCode: "P2", productName: `${f.oldName} / Knit`, inPrice: "38", outPrice: "100" }] },
    "ecount-sales/2026-09.json": { month: "2026-09", salesLines: [] }
  };
  for (const sub of ["intelligence", "monthly", "ecount-inventory", "ecount-sales"]) await mkdir(join(dir, sub), { recursive: true });
  for (const [name, value] of Object.entries(files)) await writeFile(join(dir, name), JSON.stringify(value));
  const id = detected.candidates.find((c) => c.rawBrandName === newName).id;
  return { dir, sources, id, f, newName };
}

const readJson = async (dir, name) => JSON.parse(await readFile(join(dir, name), "utf8"));
const TRACKED = ["brand-master.json", "pending-brand-queue.json", "brand-commercial-policy.json", "intelligence/brand-master-list.json", "intelligence/brand-aliases.json", "monthly/2026-08.json", "product-registry.json", "brand-sourcing-master.json"];
const bytesOf = async (dir) => Object.fromEntries(await Promise.all(TRACKED.map(async (n) => [n, await readFile(join(dir, n), "utf8").catch(() => null)])));

// Same dependency shape as server.mjs, against the fixture's work dir. Archive math uses the real
// rebuildArchiveBrandSales with the fixture's before/after offline buckets.
function depsFor({ dir, sources, f }, overrides = {}) {
  const archivePath = "monthly/2026-08.json";
  const preview = async (plan) => ({ months: [{ month: "2026-08", treatment: "ARCHIVE_REBUILD",
    before: { total: 0, unassignedOffline: 0 }, after: { old: { total: f.expected.old }, new: { total: f.expected.new } },
    monthOfflineTotal: { preserved: true }, reconciliation: { balanced: true } }] });
  const rebuildWith = async (before, after, dryRun) => {
    const archive = await readJson(dir, archivePath);
    const result = rebuildArchiveBrandSales({ brandSales: archive.commerce.brandSales, before, after });
    if (!dryRun) await writeFile(join(dir, archivePath), JSON.stringify({ ...archive, commerce: { ...archive.commerce, brandSales: result.brandSales } }));
    return { ok: true, changes: result.changes, totals: result.totals };
  };
  return {
    enabled: () => true,
    planDryRun: (id) => queue.splitCodeIdentity(dir, { id, action: "SPLIT_CODE_IDENTITY" }, build, { sources, dryRun: true, preview: overrides.preview || preview }),
    readCandidate: async (id) => (await queue.readPendingBrands(dir)).candidates.find((c) => c.id === id),
    archiveCheck: () => rebuildWith(f.before, f.before, true),
    split: (id, version) => queue.splitCodeIdentity(dir, { id, action: "SPLIT_CODE_IDENTITY", expectedVersion: version }, build, { sources, dryRun: false }),
    verifySplit: async (dry) => {
      const brands = (await readJson(dir, "brand-master.json")).brands;
      checkSplitReadBack(dry, { brands, policies: (await readJson(dir, "brand-commercial-policy.json")).policies,
        candidate: (await queue.readPendingBrands(dir)).candidates.find((c) => c.id === dry.preconditions.pendingId),
        resolveName: (name) => brands.find((b) => b.brand_name === name)?.brand_code ?? null });
    },
    rebuild: (month, backupId, dryRun) => rebuildWith(f.before, f.after(f.spl), dryRun),
    archiveRows: async () => (await readJson(dir, archivePath)).commerce.brandSales,
    restore: (backupId) => queue.restoreIdentitySplitBackup(dir, backupId),
    ...overrides
  };
}

async function withFixture(newName, fn) {
  const ctx = await fixture(newName);
  try { await fn(ctx); } finally { await rm(ctx.dir, { recursive: true, force: true }); }
}

for (const newName of ["PERSONSOUL", "UNDER THE SIGN"]) {
  test(`${newName}: dry-run issues a token; one click backs up, splits, rebuilds the archive and verifies`, () => withFixture(newName, async (ctx) => {
    const runner = createIdentitySplitRunner(depsFor(ctx));
    const dry = await runner.dryRun(ctx.id);
    assert.equal(dry.preconditions.classification, "MINTED_CODE_COLLISION");
    assert.equal(dry.execution.eligible, true, String(dry.execution.reasons));
    assert.match(dry.execution.token, /^[0-9a-f]{48}$/);
    assert.equal(JSON.stringify(dry).includes(ctx.f.code) && !JSON.stringify(dry.execution).includes(ctx.f.code), true, "token carries no data");
    const result = await runner.execute(ctx.id, dry.execution.token);
    assert.equal(result.ok, true, `${result.stage}: ${result.error} ${result.message}`);
    assert.equal(result.status, "COMPLETE");
    assert.deepEqual(result.steps.map((s) => s.stage), ["token", "revalidate", "split", "verify", "archive", "final"]);
    assert.match(result.backupId, /split-/);
    const manifest = JSON.parse(await readFile(join(ctx.dir, "backups/identity-split", result.backupId, "manifest.json"), "utf8"));
    assert.ok(manifest.files.some((x) => x.relativePath === "monthly/2026-08.json" && x.existed));
    const brands = (await readJson(ctx.dir, "brand-master.json")).brands;
    assert.deepEqual(brands.find((b) => b.brand_code === ctx.f.spl).formerCodes, [{ code: ctx.f.code, source: "MARKETING_OS_MINTED", until: null }]);
    assert.equal(brands.find((b) => b.brand_code === ctx.f.code).brand_name, newName);
    assert.deepEqual((await readJson(ctx.dir, "brand-commercial-policy.json")).policies.map((p) => p.brand_code), [ctx.f.spl]);
    const rows = (await readJson(ctx.dir, "monthly/2026-08.json")).commerce.brandSales;
    const amount = (code) => rows.filter((r) => r.brand_code === code).reduce((s, r) => s + r.salesAmount, 0);
    assert.deepEqual([amount(ctx.f.spl), amount(ctx.f.code)], [ctx.f.expected.old, ctx.f.expected.new]);
    assert.equal(rows.reduce((s, r) => s + r.salesAmount, 0), ctx.f.saved.reduce((s, r) => s + r.salesAmount, 0), "month total preserved");
    assert.equal((await queue.readPendingBrands(ctx.dir)).candidates.find((c) => c.id === ctx.id).status, "APPROVED");
    assert.equal((await runner.dryRun(ctx.id)).status, "ALREADY_SPLIT");
  }));
}

test("global kill switch off blocks execution entirely; dry-run still works and says why", () => withFixture("PERSONSOUL", async (ctx) => {
  const original = await bytesOf(ctx.dir);
  const runner = createIdentitySplitRunner(depsFor(ctx, { enabled: () => false }));
  const dry = await runner.dryRun(ctx.id);
  assert.equal(dry.execution.writeEnabled, false);
  await assert.rejects(runner.execute(ctx.id, dry.execution.token), (e) => e.code === "SPLIT_WRITE_DISABLED");
  assert.deepEqual(await bytesOf(ctx.dir), original);
}));

test("token: missing, wrong candidate, expired and reused tokens are refused without writing", () => withFixture("PERSONSOUL", async (ctx) => {
  const original = await bytesOf(ctx.dir);
  let clock = 1_000_000;
  const registry = createSplitTokenRegistry({ now: () => clock });
  const runner = createIdentitySplitRunner(depsFor(ctx), { registry });
  const fail = async (token, id, code) => {
    const r = await runner.execute(id, token);
    assert.deepEqual([r.ok, r.error, r.stage, r.backupId, r.rolledBack], [false, code, "token", null, false]);
    assert.equal(r.httpStatus, 403);
  };
  await fail(undefined, ctx.id, "SPLIT_TOKEN_REQUIRED");
  await fail("f".repeat(48), ctx.id, "SPLIT_TOKEN_INVALID");
  const { execution } = await runner.dryRun(ctx.id);
  await fail(execution.token, "another-candidate", "SPLIT_TOKEN_MISMATCH");
  clock += 10 * 60 * 1000;
  await fail(execution.token, ctx.id, "SPLIT_TOKEN_EXPIRED");
  assert.deepEqual(await bytesOf(ctx.dir), original);
  const fresh = (await runner.dryRun(ctx.id)).execution.token;
  assert.equal((await runner.execute(ctx.id, fresh)).ok, true);
  const reused = await runner.execute(ctx.id, fresh);
  assert.equal(reused.error, "SPLIT_TOKEN_USED");
}));

test("state change after the dry-run (version) invalidates the token before any backup", () => withFixture("PERSONSOUL", async (ctx) => {
  const runner = createIdentitySplitRunner(depsFor(ctx));
  const { execution } = await runner.dryRun(ctx.id);
  // The Cafe24 brand on the code is renamed after the dry-run.
  ctx.sources.cafe24Brands[0].brand_name = "PERSONSOUL STUDIO";
  const original = await bytesOf(ctx.dir);
  const r = await runner.execute(ctx.id, execution.token);
  assert.deepEqual([r.ok, r.stage, r.error, r.backupId, r.rolledBack], [false, "revalidate", "VERSION_CONFLICT", null, false]);
  assert.deepEqual(await bytesOf(ctx.dir), original);
  assert.equal((await queue.readPendingBrands(ctx.dir)).candidates.find((c) => c.id === ctx.id).status, "PENDING");
}));

test("a changed dry-run result (same version) invalidates the token", () => withFixture("PERSONSOUL", async (ctx) => {
  let calls = 0;
  const base = depsFor(ctx);
  const runner = createIdentitySplitRunner({ ...base, planDryRun: async (id) => {
    const dry = await base.planDryRun(id);
    if (++calls > 1) dry.attribution.months[0].after.new.total += 1;
    return dry;
  } });
  const { execution } = await runner.dryRun(ctx.id);
  const r = await runner.execute(ctx.id, execution.token);
  assert.deepEqual([r.ok, r.stage, r.error, r.backupId], [false, "revalidate", "DRY_RUN_CHANGED", null]);
}));

test("no token unless every check passes: preserved, balanced, archive reproduction, policy preview, classification", async () => {
  const dry = (patch = {}) => ({ ok: true, status: "PLANNED", version: "v1", effectiveMonth: "2026-08",
    preconditions: { pendingId: "c1", code: "B0000BDJ", previousCanonicalCode: "B0000BDJ", previousCanonicalBrand: "GKL", currentCafe24Brand: "UNDER THE SIGN", classification: "MINTED_CODE_COLLISION", suggestedEffectiveMonth: "2026-08", ...patch.pre },
    oldIdentity: { brand_code: "SPL_e4af36d3ce", brand_name: "GKL", active: false }, newIdentity: { brand_code: "B0000BDJ", brand_name: "UNDER THE SIGN" },
    diff: { commercialPolicy: { before: [{ brand_code: "B0000BDJ" }], after: [{ brand_code: patch.policyTo || "SPL_e4af36d3ce" }] } },
    attribution: { months: [{ month: "2026-08", treatment: "ARCHIVE_REBUILD", after: { old: { total: 0 }, new: { total: 5265600 } },
      monthOfflineTotal: { preserved: patch.preserved ?? true }, reconciliation: { balanced: patch.balanced ?? true } }] } });
  const candidate = { status: "PENDING", reviewReason: "CODE_REUSE_SPLIT_REQUIRED", requiresIdentitySplit: true };
  const reasonsFor = async (patch, archiveCheck = async () => ({ ok: true, changes: [] })) => {
    const runner = createIdentitySplitRunner({ enabled: () => true, planDryRun: async () => dry(patch), readCandidate: async () => candidate, archiveCheck });
    const result = await runner.dryRun("c1");
    assert.equal(result.execution.token, undefined);
    return result.execution.reasons;
  };
  assert.deepEqual(await reasonsFor({ pre: { classification: "REVIEW_REQUIRED" } }), ["MANUAL_REVIEW_CLASSIFICATION"]);
  assert.deepEqual(await reasonsFor({ pre: { classification: "CAFE24_CODE_REUSED" } }), ["MANUAL_REVIEW_CLASSIFICATION"]);
  assert.deepEqual(await reasonsFor({ preserved: false }), ["OFFLINE_TOTAL_NOT_PRESERVED"]);
  assert.deepEqual(await reasonsFor({ balanced: false }), ["NOT_BALANCED"]);
  assert.deepEqual(await reasonsFor({ policyTo: "B0000BDJ" }), ["POLICY_PREVIEW_MISMATCH"]);
  assert.deepEqual(await reasonsFor({}, async () => { throw Object.assign(new Error("x"), { code: "ARCHIVE_SOURCE_MISMATCH" }); }), ["ARCHIVE_SOURCE_MISMATCH"]);
  assert.deepEqual(await reasonsFor({}, async () => ({ ok: true, changes: [{}] })), ["ARCHIVE_SOURCE_MISMATCH"]);
});

test("rollback on split write failure: partial state is restored byte for byte, candidate stays PENDING", () => withFixture("PERSONSOUL", async (ctx) => {
  const original = await bytesOf(ctx.dir);
  let renames = 0;
  const flakyRename = async (from, to) => { if (++renames === 3) throw Object.assign(new Error("disk full"), { code: "EIO" }); return rename(from, to); };
  const base = depsFor(ctx);
  const runner = createIdentitySplitRunner({ ...base, split: (id, version) => queue.splitCodeIdentity(ctx.dir, { id, action: "SPLIT_CODE_IDENTITY", expectedVersion: version }, build, { sources: ctx.sources, dryRun: false, replace: flakyRename }) });
  const { execution } = await runner.dryRun(ctx.id);
  const r = await runner.execute(ctx.id, execution.token);
  assert.deepEqual([r.ok, r.stage, r.rolledBack], [false, "split", true]);
  assert.match(r.backupId, /split-/);
  assert.deepEqual(await bytesOf(ctx.dir), original);
  assert.equal((await queue.readPendingBrands(ctx.dir)).candidates.find((c) => c.id === ctx.id).status, "PENDING");
}));

test("rollback on archive failure: split and archive are both reverted", () => withFixture("UNDER THE SIGN", async (ctx) => {
  const original = await bytesOf(ctx.dir);
  const base = depsFor(ctx);
  const runner = createIdentitySplitRunner({ ...base, rebuild: async (month, backupId, dryRun) => {
    if (!dryRun) { await base.rebuild(month, backupId, false); throw Object.assign(new Error("boom"), { code: "ARCHIVE_TOTAL_MISMATCH" }); }
    return base.rebuild(month, backupId, true);
  } });
  const { execution } = await runner.dryRun(ctx.id);
  const r = await runner.execute(ctx.id, execution.token);
  assert.deepEqual([r.ok, r.stage, r.error, r.rolledBack, r.httpStatus], [false, "archive", "ARCHIVE_TOTAL_MISMATCH", true, 409]);
  assert.deepEqual(await bytesOf(ctx.dir), original);
  assert.equal((await queue.readPendingBrands(ctx.dir)).candidates.find((c) => c.id === ctx.id).status, "PENDING");
}));

test("rollback when the archive lands somewhere other than the reviewed preview", () => withFixture("UNDER THE SIGN", async (ctx) => {
  const original = await bytesOf(ctx.dir);
  const base = depsFor(ctx);
  const runner = createIdentitySplitRunner({ ...base, rebuild: (month, backupId, dryRun) =>
    (async () => { const archive = await readJson(ctx.dir, "monthly/2026-08.json"); const result = rebuildArchiveBrandSales({ brandSales: archive.commerce.brandSales, before: ctx.f.before, after: ctx.f.before });
      return { ok: true, changes: result.changes, totals: result.totals }; })() });
  const { execution } = await runner.dryRun(ctx.id);
  const r = await runner.execute(ctx.id, execution.token);
  assert.deepEqual([r.ok, r.stage, r.error, r.rolledBack], [false, "archive", "ARCHIVE_ATTRIBUTION_MISMATCH", true]);
  assert.deepEqual(await bytesOf(ctx.dir), original);
}));

test("runs never overlap, and a batch stops at the first failure", () => withFixture("PERSONSOUL", async (ctx) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const base = depsFor(ctx);
  const runner = createIdentitySplitRunner({ ...base, split: async (...args) => { await gate; return base.split(...args); } });
  const { execution } = await runner.dryRun(ctx.id);
  const first = runner.execute(ctx.id, execution.token);
  await assert.rejects(runner.execute(ctx.id, "x"), (e) => e.code === "SPLIT_BUSY");
  release();
  assert.equal((await first).ok, true);
  const batch = await runner.runBatch([{ id: "a", token: "nope" }, { id: ctx.id, token: "never-reached" }]);
  assert.deepEqual([batch.ok, batch.results.length, batch.results[0].error], [false, 1, "SPLIT_TOKEN_INVALID"]);
}));

test("server wiring: one-click routes need operator auth, execution needs the kill switch, MCP stays read-only", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const route = server.slice(server.indexOf('url.pathname === "/api/pending-brands/split/dry-run"'), server.indexOf("// Identity-split maintenance"));
  assert.match(route, /if \(req\.method !== "POST"\)[\s\S]*if \(!isAuthorizedOperatorAction\(req\)\) return json\(res, \{ ok: false, error: "Unauthorized" \}, 401\);[\s\S]*identitySplitRunner\.execute/);
  assert.match(server, /enabled: \(\) => env\.CODE_IDENTITY_SPLIT_WRITE === "on"/);
  assert.match(server, /function isAuthorizedOperatorAction\(req\) \{\n  if \(isLocalRequest\(req\) \|\| isAuthorizedInternalRequest\(req\)\) return true;[\s\S]*?return hasOperatorSession\(req\);/);
  for (const path of ALLOWED_UPSTREAM_PATHS) assert.doesNotMatch(path, /split|review|restore|rebuild/);
  assert.throws(() => assertSafeUpstreamRequest("POST", "/api/pending-brands"), /GET only/);
  assert.throws(() => assertSafeUpstreamRequest("GET", "/api/pending-brands/split/execute"), /not allowed/);
});

test("UI: passing dry-run enables 분리 실행; one click posts the token once and shows the result", async () => {
  const { runInNewContext } = await import("node:vm");
  const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  const fn = js.slice(js.indexOf("async function renderPendingBrandReview("), js.indexOf("async function renderBrandMasterSettings("));
  const candidate = { id: "c1", status: "PENDING", source: "BOTH", sourceBrandCode: "B0000BDJ", rawBrandName: "UNDER THE SIGN", reviewReason: "CODE_REUSE_SPLIT_REQUIRED",
    requiresIdentitySplit: true, codeReuseClassification: "MINTED_CODE_COLLISION", previousCanonicalBrand: "GKL", previousCanonicalCode: "B0000BDJ", currentCafe24Brand: "UNDER THE SIGN",
    suggestedEffectiveMonth: "2026-08", relatedProductCount: 1, cafe24Variants: [], ecountVariants: [], possibleExistingCanonical: [], collabCandidates: [], relatedCandidateIds: [] };
  const filter = { value: "PENDING" }; const rows = { innerHTML: "" };
  const target = { isConnected: true, innerHTML: "", querySelector: (selector) => (selector === "[data-pending-filter]" ? filter : rows) };
  const posts = []; let reloads = 0; const toasts = [];
  const dry = { ok: true, status: "PLANNED", version: "v", effectiveMonth: "2026-08", preconditions: { code: "B0000BDJ" },
    oldIdentity: { brand_code: "SPL_e4af36d3ce", brand_name: "GKL", active: false }, newIdentity: { brand_code: "B0000BDJ", brand_name: "UNDER THE SIGN" },
    diff: { commercialPolicy: { before: [{}] }, productRegistry: { moved: [] }, sourcing: { new: { sourcing_type: "WHOLESALE" } } },
    attribution: { months: [{ month: "2026-08", treatment: "ARCHIVE_REBUILD", before: { total: 0, unassignedOffline: 10519400 }, after: { old: { total: 0 }, new: { total: 5265600 }, unassignedOffline: 5253800 }, reconciliation: { balanced: true }, monthOfflineTotal: { preserved: true } }] },
    execution: { eligible: true, writeEnabled: true, token: "t".repeat(48), expiresAt: "2026-10-07T03:00:00.000Z", archiveChecks: [{ month: "2026-08", ok: true }] } };
  const done = { ok: true, status: "COMPLETE", backupId: "b1", oldIdentity: { brand_code: "SPL_e4af36d3ce", brand_name: "GKL" }, newIdentity: { brand_code: "B0000BDJ", brand_name: "UNDER THE SIGN" }, archives: [{ month: "2026-08", old: 0, new: 5265600 }] };
  const render = runInNewContext(`${fn}; renderPendingBrandReview`, {
    $: () => target, getJson: async () => ({ candidates: [candidate] }), esc: (v) => String(v ?? ""), apiNum: Number, confirm: () => true, toast: (m) => toasts.push(m),
    authorizeEcountProductionUpload: async () => false,
    postJson: async (...args) => { posts.push(args); return args[0].endsWith("/dry-run") ? dry : done; }, renderBrandMasterSettings: async () => { reloads++; }
  });
  await render([]);
  assert.match(rows.innerHTML, /Dry Run 검증 통과 시 분리 실행 가능/);
  const box = { innerHTML: "" };
  const execute = { dataset: { splitExecute: "" }, disabled: true, closest: () => row };
  const row = { dataset: { pendingId: "c1" }, querySelector: (s) => (s === "[data-split-preview]" ? box : s === "[data-split-execute]" ? execute : { value: "" }) };
  const dryButton = { dataset: { splitDryRun: "" }, disabled: false, closest: () => row };
  await target.onclick({ target: { closest: (s) => (s === "[data-split-dry-run]" ? dryButton : null) } });
  assert.equal(execute.disabled, false);
  assert.match(box.innerHTML, /UNASSIGNED 복구[\s\S]*5,265,600/);
  assert.match(box.innerHTML, /SOURCING_DEFAULT \(WHOLESALE\)/);
  assert.match(box.innerHTML, /자동 backup 생성/);
  await target.onclick({ target: { closest: (s) => (s === "[data-split-execute]" ? execute : null) } });
  assert.deepEqual(JSON.parse(JSON.stringify(posts.at(-1))), ["/api/pending-brands/split/execute", { id: "c1", token: "t".repeat(48) }, 600000]);
  assert.equal(execute.dataset.splitToken, "", "token is used once");
  assert.match(box.innerHTML, /분리 완료[\s\S]*backup b1/);
  assert.equal(reloads, 1);
  // Not eligible -> the button stays disabled and shows why.
  posts.length = 0;
  dry.execution = { eligible: false, reasons: ["MANUAL_REVIEW_CLASSIFICATION"], archiveChecks: [] };
  await target.onclick({ target: { closest: (s) => (s === "[data-split-dry-run]" ? dryButton : null) } });
  assert.equal(execute.disabled, true);
  assert.match(box.innerHTML, /분리 실행 불가: MANUAL_REVIEW_CLASSIFICATION/);
});
