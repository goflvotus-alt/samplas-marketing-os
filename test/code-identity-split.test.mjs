import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as queue from "../scripts/pending-brand-queue.mjs";
import { internalIdentityCode } from "../scripts/cafe24-code-reuse.mjs";
import { planCodeIdentitySplit } from "../scripts/code-identity-split.mjs";
import { loadResolverContext } from "../scripts/unified-identity-resolver.mjs";
import { mergeOfflineBrandSales } from "../scripts/monthly-brand-sales.mjs";
import { runInNewContext } from "node:vm";

// Mirrors Production (2026-10-06): Marketing OS minted B0000BDG/BDJ/BDM for ECOUNT brands, Cafe24
// later issued them to PERSONSOUL / UNDER THE SIGN / PRAYING.
const PAIRS = [["B0000BDG", "BORC", "PERSONSOUL", "2026-08-18T18:53:00+09:00", "SPL_00b4a2e6cc"],
  ["B0000BDJ", "GKL", "UNDER THE SIGN", "2026-08-21T17:55:19+09:00", "SPL_e4af36d3ce"],
  ["B0000BDM", "LAMASKARADE", "PRAYING", "2026-08-26T13:17:16+09:00", "SPL_4e0baa7a30"]];
const build = (brands) => ({ brands: brands.map((b) => ({ id: b.brand_code, name: b.brand_name, active: b.active })), aliases: [] });

function fixture() {
  const canonical = { brands: [
    ...PAIRS.map(([code, old]) => ({ brand_code: code, brand_name: old, name_aliases: [], instagram_tag: "", active: false, nameSource: "suggested" })),
    { brand_code: "B0000BEI", brand_name: "BLUEMARBLE", name_aliases: ["BLUEMARBLE", "B0000BEI"], instagram_tag: "", active: true, nameSource: "confirmed" },
    { brand_code: "B00000MT", brand_name: "AE SYNCTX", name_aliases: [], instagram_tag: "", active: true, nameSource: "suggested" }
  ] };
  const cafe24Brands = [...PAIRS.map(([code, , name, created]) => ({ brand_code: code, brand_name: name, created_date: created })),
    { brand_code: "B0000BEI", brand_name: "BLUEMARBLE" }, { brand_code: "B00000MT", brand_name: "AE SYNCTX" }];
  const products = PAIRS.map(([code, , name], i) => ({ product_no: 100 + i, brand_code: code, product_name: `[${name}] Jacket`, created_date: "2026-08-27T10:00:00+09:00" }));
  const productNames = [...PAIRS.flatMap(([, old, name]) => [`${old} / Knit`, `${name} / Jacket`]), "BLUEMARBLE / Cap", "AE SYNCTX / Pants"];
  const ecountProducts = productNames.map((productName, i) => ({ productName, productCode: `P${i}` }));
  const policies = { policies: [
    ...PAIRS.map(([code, old]) => ({ brand_code: code, canonical_brand_name: old, sourcing_type: "WHOLESALE", stylist_discount_percent: 20, discount_status: "STANDARD", product_rules: [] })),
    { brand_code: "B00000MT", canonical_brand_name: "AE SYNCTX", sourcing_type: "CONSIGNMENT", stylist_discount_percent: 10, discount_status: "STANDARD", product_rules: [] }
  ] };
  const productRegistry = { entries: [
    { id: "reg-borc", brandId: "B0000BDG", status: "confirmed", verified: true, canonicalProductName: "BORC / Knit", ecount: { matchedProducts: [{ prodCd: "P0", productName: "BORC / Knit" }] } },
    { id: "reg-ps", brandId: "B0000BDG", status: "confirmed", verified: true, cafe24: { productNo: 100, productName: "[PERSONSOUL] Jacket" } }
  ] };
  const sources = { canonical, cafe24Brands, products, ecountLines: [], ecountProducts, aliases: [], compatibility: [] };
  return { canonical, sources, policies, productRegistry, productNames };
}

async function setup() {
  const f = fixture();
  const dir = await mkdtemp(join(tmpdir(), "split-"));
  const detected = queue.detectPendingBrands({ ...f.sources, now: "2026-10-06T00:00:00.000Z" });
  const master = { schemaVersion: 1, complete: true, fetchedAt: "2026-10-06T00:00:00Z", totalProducts: f.productNames.length,
    products: f.productNames.map((productName, i) => ({ productCode: `P${i}`, productName, inPrice: "380", outPrice: "1000" })) };
  const lines = PAIRS.flatMap(([, old, name], i) => [
    { date: "2026-09-03", productName: `${old} / Knit`, salesAmount: 100000 * (i + 1), isOfflineRevenue: true, slipNo: `O${i}` },
    { date: "2026-09-04", productName: `${name} / Jacket`, salesAmount: 70000 * (i + 1), isOfflineRevenue: true, slipNo: `N${i}` }
  ]);
  const files = {
    "brand-master.json": f.canonical, "pending-brand-queue.json": detected, "brand-commercial-policy.json": f.policies,
    "product-registry.json": f.productRegistry, "intelligence/brand-master-list.json": [], "intelligence/brand-aliases.json": [],
    "ecount-inventory/product-master.json": master, "ecount-sales/2026-09.json": { month: "2026-09", salesLines: lines }
  };
  for (const sub of ["intelligence", "ecount-inventory", "ecount-sales"]) await mkdir(join(dir, sub), { recursive: true });
  for (const [name, value] of Object.entries(files)) await writeFile(join(dir, name), JSON.stringify(value));
  return { dir, files, f, detected, lines };
}
const read = async (dir, name) => JSON.parse(await readFile(join(dir, name), "utf8"));
const snapshotFiles = async (dir) => {
  const out = {};
  for (const name of ["brand-master.json", "pending-brand-queue.json", "brand-commercial-policy.json", "product-registry.json", "intelligence/brand-master-list.json", "intelligence/brand-aliases.json"]) {
    out[name] = await readFile(join(dir, name), "utf8").catch(() => null);
  }
  return out;
};
const idOf = (detected, name) => detected.candidates.find((c) => c.rawBrandName === name).id;

test("helper codes match the documented SPL identities", () => {
  for (const [code, old, , , spl] of PAIRS) assert.equal(internalIdentityCode(code, old), spl, old);
});

for (const [code, old, name, , spl] of PAIRS) {
  test(`dry-run ${name}: full plan, nothing written`, async () => {
    const { dir, detected, f } = await setup();
    try {
      const before = await snapshotFiles(dir);
      const result = await queue.splitCodeIdentity(dir, { id: idOf(detected, name), action: "SPLIT_CODE_IDENTITY" }, build, { sources: f.sources, dryRun: true });
      assert.equal(result.status, "PLANNED");
      assert.equal(result.dryRun, true);
      assert.equal(result.oldIdentity.brand_code, spl);
      assert.equal(result.oldIdentity.brand_name, old);
      assert.equal(result.oldIdentity.active, false, "active is not changed by the split");
      assert.deepEqual(result.oldIdentity.formerCodes, [{ code, source: "MARKETING_OS_MINTED", until: null }]);
      assert.deepEqual(result.oldIdentity.externalCodes, { cafe24: null });
      assert.deepEqual({ code: result.newIdentity.brand_code, name: result.newIdentity.brand_name, active: result.newIdentity.active, cafe24: result.newIdentity.externalCodes.cafe24 },
        { code, name, active: true, cafe24: { code, since: "2026-08", until: null } });
      assert.equal(result.effectiveMonth, "2026-08");
      assert.deepEqual(result.diff.commercialPolicy.after.map((p) => [p.brand_code, p.canonical_brand_name, p.stylist_discount_percent]), [[spl, old, 20]]);
      assert.deepEqual(result.diff.brandMaster.before.map((b) => b.brand_code), [code]);
      assert.deepEqual(result.diff.compatibility.after.map((b) => [b.id, b.name]).sort(), [[code, name], [spl, old]].sort());
      assert.equal(result.diff.sourcing.new.sourcing_type, "WHOLESALE", "new identity: wholesale evidence → SOURCING_DEFAULT 20%");
      assert.equal(result.diff.sourcing.old.brand_code, spl);
      assert.match(result.version, /^[0-9a-f]{16}$/);
      assert.deepEqual(await snapshotFiles(dir), before, "dry-run writes nothing");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}

test("execute: policy moves to SPL, new identity has no explicit policy, unrelated brands and BLUEMARBLE unchanged; registry split by product identity", async () => {
  const { dir, detected, f } = await setup();
  try {
    const id = idOf(detected, "PERSONSOUL");
    const dry = await queue.splitCodeIdentity(dir, { id, action: "SPLIT_CODE_IDENTITY" }, build, { sources: f.sources, dryRun: true });
    const done = await queue.splitCodeIdentity(dir, { id, action: "SPLIT_CODE_IDENTITY", expectedVersion: dry.version }, build, { sources: f.sources, dryRun: false });
    assert.equal(done.status, "PLANNED");
    assert.equal(done.sourcingRefresh.ok, true);
    const master = await read(dir, "brand-master.json");
    const by = Object.fromEntries(master.brands.map((b) => [b.brand_code, b]));
    assert.equal(by.SPL_00b4a2e6cc.brand_name, "BORC");
    assert.equal(by.B0000BDG.brand_name, "PERSONSOUL");
    for (const unrelated of ["B0000BEI", "B00000MT", "B0000BDJ", "B0000BDM"]) assert.deepEqual(by[unrelated], f.canonical.brands.find((b) => b.brand_code === unrelated), unrelated);
    const policies = (await read(dir, "brand-commercial-policy.json")).policies;
    assert.equal(policies.some((p) => p.brand_code === "B0000BDG"), false, "PERSONSOUL inherits no explicit policy");
    assert.deepEqual(policies.filter((p) => p.brand_code === "SPL_00b4a2e6cc").map((p) => [p.canonical_brand_name, p.stylist_discount_percent]), [["BORC", 20]]);
    assert.deepEqual(policies.find((p) => p.brand_code === "B00000MT").stylist_discount_percent, 10, "AE SYNCTX explicit 10% untouched");
    const registry = (await read(dir, "product-registry.json")).entries;
    assert.equal(registry.find((e) => e.id === "reg-borc").brandId, "SPL_00b4a2e6cc", "ECOUNT BORC product follows BORC");
    assert.equal(registry.find((e) => e.id === "reg-ps").brandId, "B0000BDG", "Cafe24 PERSONSOUL product keeps the code");
    const sourcing = (await read(dir, "brand-sourcing-master.json")).brands;
    assert.equal(sourcing.find((b) => b.brand_code === "B0000BDG").sourcing_type, "WHOLESALE");
    const candidate = (await read(dir, "pending-brand-queue.json")).candidates.find((c) => c.id === id);
    assert.equal(candidate.status, "APPROVED");
    assert.equal(candidate.approvalAction, "SPLIT_CODE_IDENTITY");
    assert.equal(candidate.splitIdentity.oldBrandCode, "SPL_00b4a2e6cc");
    // NEW flow still works on the same state.
    assert.equal(queue.isAutoSafePendingDecision({ id: "x", status: "PENDING", source: "BOTH", reviewReason: "UNRESOLVED", sourceBrandCode: "B0000ZZZ", rawBrandName: "Fresh Label", cafe24Variants: ["Fresh Label"], ecountVariants: ["Fresh Label"], collabCandidates: [], relatedCandidateIds: [] },
      master, { cafe24Brands: [{ brand_code: "B0000ZZZ", brand_name: "Fresh Label" }], products: [], ecountLines: [{ productName: "Fresh Label / Coat" }], ecountProducts: [] })?.action, "NEW");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("attribution: old/new separated, monthly offline total preserved (official pipeline, canonical in memory)", async () => {
  const { dir, detected, f, lines } = await setup();
  try {
    const plan = planCodeIdentitySplit({ canonical: f.canonical, policies: f.policies, productRegistry: f.productRegistry, queue: detected, input: { id: idOf(detected, "PERSONSOUL") }, sources: f.sources });
    const run = async (brandMaster, productRegistry) => mergeOfflineBrandSales({ offlineLines: lines, since: "2026-09-01", until: "2026-09-30",
      identityContext: await loadResolverContext({ workDir: dir, brandMaster, productRegistry }) });
    const before = await run(f.canonical);
    const after = await run(plan.canonical, plan.productRegistry);
    const amount = (rows, code) => rows.find((r) => r.brand_code === code)?.offlineSalesAmount || 0;
    const total = (rows) => rows.reduce((s, r) => s + r.offlineSalesAmount, 0);
    assert.equal(amount(before, "B0000BDG"), 100000, "before: BORC lines on the code");
    assert.equal(amount(before, "UNASSIGNED") >= 70000, true, "before: PERSONSOUL offline had no identity");
    assert.equal(amount(after, "SPL_00b4a2e6cc"), 100000, "after: BORC keeps its sales");
    assert.equal(amount(after, "B0000BDG"), 70000, "after: PERSONSOUL gets its own");
    assert.equal(amount(before, "B0000BDG") + amount(before, "UNASSIGNED") - amount(after, "UNASSIGNED"), amount(after, "SPL_00b4a2e6cc") + amount(after, "B0000BDG"));
    assert.equal(total(before), total(after), "month offline total preserved");
    assert.equal(amount(after, "B0000BDJ"), amount(before, "B0000BDJ"), "other pairs untouched by this split");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("REASSIGN cannot bypass the split; SPLIT is not a plain review action", async () => {
  const { dir, detected, f } = await setup();
  try {
    const id = idOf(detected, "PERSONSOUL");
    await assert.rejects(queue.reviewPendingBrand(dir, { id, action: "REASSIGN_INACTIVE_CODE" }, build, { sources: f.sources }), /identity split/);
    await assert.rejects(queue.reviewPendingBrand(dir, { id, action: "SPLIT_CODE_IDENTITY" }, build, { sources: f.sources }), /Invalid pending brand decision/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("atomic: any failed replace restores every file and keeps the candidate PENDING", async () => {
  const { dir, detected, f } = await setup();
  try {
    const id = idOf(detected, "PERSONSOUL");
    const before = await snapshotFiles(dir);
    const { version } = await queue.splitCodeIdentity(dir, { id, action: "SPLIT_CODE_IDENTITY" }, build, { sources: f.sources, dryRun: true });
    for (let failAt = 1; failAt <= 6; failAt += 1) {
      let n = 0;
      await assert.rejects(queue.splitCodeIdentity(dir, { id, action: "SPLIT_CODE_IDENTITY", expectedVersion: version }, build,
        { sources: f.sources, dryRun: false, replace: async (a, b) => { if (++n === failAt) throw Error("injected"); await rename(a, b); } }), /injected/);
      assert.deepEqual(await snapshotFiles(dir), before, `failAt ${failAt}`);
    }
    assert.equal((await read(dir, "pending-brand-queue.json")).candidates.find((c) => c.id === id).status, "PENDING");
    assert.deepEqual((await readdir(dir)).filter((n) => /\.(tmp|rollback)$/.test(n)), [], "no temp/backup files left");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("idempotent: a second execution returns ALREADY_SPLIT and changes nothing", async () => {
  const { dir, detected, f } = await setup();
  try {
    const id = idOf(detected, "PERSONSOUL");
    const { version } = await queue.splitCodeIdentity(dir, { id, action: "SPLIT_CODE_IDENTITY" }, build, { sources: f.sources, dryRun: true });
    await queue.splitCodeIdentity(dir, { id, action: "SPLIT_CODE_IDENTITY", expectedVersion: version }, build, { sources: f.sources, dryRun: false });
    const after = await snapshotFiles(dir);
    const again = await queue.splitCodeIdentity(dir, { id, action: "SPLIT_CODE_IDENTITY", expectedVersion: version }, build, { sources: f.sources, dryRun: false });
    assert.equal(again.status, "ALREADY_SPLIT");
    assert.deepEqual(await snapshotFiles(dir), after);
    const master = await read(dir, "brand-master.json");
    assert.equal(master.brands.filter((b) => b.brand_code === "SPL_00b4a2e6cc").length, 1);
    assert.equal((await read(dir, "brand-commercial-policy.json")).policies.filter((p) => p.brand_code === "SPL_00b4a2e6cc").length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("stale state: wrong version, missing version, or changed Cafe24 evidence is refused (409)", async () => {
  const { dir, detected, f } = await setup();
  try {
    const id = idOf(detected, "PERSONSOUL");
    const input = { id, action: "SPLIT_CODE_IDENTITY" };
    await assert.rejects(queue.splitCodeIdentity(dir, { ...input, expectedVersion: "0000000000000000" }, build, { sources: f.sources, dryRun: false }), (e) => e.code === "VERSION_CONFLICT" && e.status === 409);
    await assert.rejects(queue.splitCodeIdentity(dir, input, build, { sources: f.sources, dryRun: false }), (e) => e.code === "VERSION_REQUIRED");
    const renamed = { ...f.sources, cafe24Brands: f.sources.cafe24Brands.map((b) => (b.brand_code === "B0000BDG" ? { ...b, brand_name: "PERSONSOUL STUDIO" } : b)) };
    await assert.rejects(queue.splitCodeIdentity(dir, input, build, { sources: renamed, dryRun: true }), (e) => e.code === "VERSION_CONFLICT");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("CAFE24_CODE_REUSED: former owner keeps periods before the boundary; crossing periods are UNASSIGNED", () => {
  const canonical = { brands: [{ brand_code: "B0000CCC", brand_name: "OLDNAME", name_aliases: [], active: false, nameSource: "confirmed" }] };
  const sources = { canonical, cafe24Brands: [{ brand_code: "B0000CCC", brand_name: "NEWCO", created_date: "2025-01-10T10:00:00+09:00" }],
    products: [{ brand_code: "B0000CCC", product_name: "[OLDNAME] Coat", created_date: "2025-03-01T10:00:00+09:00" }, { brand_code: "B0000CCC", product_name: "[NEWCO] Shirt", created_date: "2026-06-10T10:00:00+09:00" }],
    ecountLines: [], ecountProducts: [{ productName: "NEWCO / Shirt", productCode: "N1" }] };
  const detected = queue.detectPendingBrands(sources);
  const c = detected.candidates.find((x) => x.rawBrandName === "NEWCO");
  assert.equal(c.codeReuseClassification, "CAFE24_CODE_REUSED");
  const plan = planCodeIdentitySplit({ canonical, queue: detected, input: { id: c.id }, sources });
  const spl = plan.oldIdentity.brand_code;
  assert.deepEqual(plan.oldIdentity.formerCodes, [{ code: "B0000CCC", source: "CAFE24", until: "2026-05" }]);
  assert.equal(queue.approvedCafe24BrandCode("B0000CCC", plan.canonical, { since: "2026-05-01", until: "2026-05-31" }), spl);
  assert.equal(queue.approvedCafe24BrandCode("B0000CCC", plan.canonical, { since: "2026-06-01", until: "2026-06-30" }), "B0000CCC");
  assert.equal(queue.approvedCafe24BrandCode("B0000CCC", plan.canonical, { since: "2026-05-01", until: "2026-06-30" }), "UNASSIGNED");
  assert.equal(queue.approvedCafe24BrandCode("B0000CCC", plan.canonical), "B0000CCC");
});

test("REVIEW_REQUIRED cannot execute without an explicit effective month and evidence note", () => {
  const canonical = { brands: [{ brand_code: "B0000EEE", brand_name: "AMBIGOLD", name_aliases: [], active: false }] };
  const sources = { canonical, cafe24Brands: [{ brand_code: "B0000EEE", brand_name: "AMBIGNEW" }], products: [], ecountLines: [], ecountProducts: [{ productName: "AMBIGNEW / Hat", productCode: "A1" }] };
  const detected = queue.detectPendingBrands(sources);
  const c = detected.candidates.find((x) => x.rawBrandName === "AMBIGNEW");
  assert.equal(c.codeReuseClassification, "REVIEW_REQUIRED");
  assert.throws(() => planCodeIdentitySplit({ canonical, queue: detected, input: { id: c.id }, sources }), (e) => e.code === "REVIEW_REQUIRED");
  assert.throws(() => planCodeIdentitySplit({ canonical, queue: detected, input: { id: c.id, effectiveMonth: "2026-07" }, sources }), (e) => e.code === "REVIEW_REQUIRED");
  const plan = planCodeIdentitySplit({ canonical, queue: detected, input: { id: c.id, effectiveMonth: "2026-07", evidenceNote: "operator confirmed rename on 2026-07-02" }, sources });
  assert.equal(plan.newIdentity.externalCodes.cafe24.since, "2026-07");
  assert.deepEqual(plan.oldIdentity.formerCodes, [{ code: "B0000EEE", source: "OPERATOR_REVIEWED", until: "2026-06" }]);
});

test("existing supersededBy data keeps resolving exactly as before", () => {
  const master = { brands: [
    { brand_code: "STALE7", brand_name: "Legacy", active: false, supersededBy: { brandCode: "MANUAL_n", effectiveMonth: "2026-10" } },
    { brand_code: "MANUAL_n", brand_name: "Next", active: true, sourceCafe24Codes: ["STALE7"] }] };
  assert.equal(queue.approvedCafe24BrandCode("STALE7", master, { since: "2026-09-01", until: "2026-09-30" }), "STALE7");
  assert.equal(queue.approvedCafe24BrandCode("STALE7", master, { since: "2026-10-01", until: "2026-10-31" }), "MANUAL_n");
  assert.equal(queue.approvedCafe24BrandCode("STALE7", master, { since: "2026-09-01", until: "2026-10-31" }), "UNASSIGNED");
});

test("server wiring: the review route only dry-runs SPLIT; writes need the one-click token route", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /if \(input\.dryRun === false\) \{\s*return json\(res, \{ ok: false, error: "SPLIT_TOKEN_REQUIRED"/);
  assert.match(server, /dryRun: true, preview: buildSplitAttributionPreview \}\)\);/);
  const ui = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  assert.match(ui, /data-split-dry-run>분리 검토 \(Dry Run\)/);
  assert.match(ui, /data-split-execute disabled title="Dry Run 검증 통과 후 활성">분리 실행/);
});

test("UI: split candidate shows Dry Run only; clicking sends a dry-run and renders the preview without other writes", async () => {
  const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  const fn = js.slice(js.indexOf("async function renderPendingBrandReview("), js.indexOf("async function renderBrandMasterSettings("));
  const candidate = { id: "c1", status: "PENDING", source: "BOTH", sourceBrandCode: "B0000BDG", rawBrandName: "PERSONSOUL", reviewReason: "CODE_REUSE_SPLIT_REQUIRED",
    requiresIdentitySplit: true, codeReuseClassification: "MINTED_CODE_COLLISION", previousCanonicalBrand: "BORC", previousCanonicalCode: "B0000BDG", currentCafe24Brand: "PERSONSOUL",
    suggestedEffectiveMonth: "2026-08", relatedProductCount: 49, cafe24Variants: ["PERSONSOUL"], ecountVariants: ["PERSONSOUL"], possibleExistingCanonical: [], collabCandidates: [], relatedCandidateIds: [] };
  const filter = { value: "PENDING" }; const rows = { innerHTML: "" };
  const target = { isConnected: true, innerHTML: "", querySelector: (selector) => (selector === "[data-pending-filter]" ? filter : rows) };
  const writes = []; let reloads = 0;
  const preview = { ok: true, status: "PLANNED", version: "abc", effectiveMonth: "2026-08", preconditions: { code: "B0000BDG" },
    oldIdentity: { brand_code: "SPL_00b4a2e6cc", brand_name: "BORC", active: false }, newIdentity: { brand_code: "B0000BDG", brand_name: "PERSONSOUL" },
    diff: { commercialPolicy: { before: [{}] }, productRegistry: { moved: [] } },
    attribution: { months: [{ month: "2026-09", treatment: "ARCHIVE_REBUILD", before: { total: 15228400 }, after: { old: { total: 6262400 }, new: { total: 8966000 } }, reconciliation: { balanced: true }, monthOfflineTotal: { preserved: true } }] } };
  const render = runInNewContext(`${fn}; renderPendingBrandReview`, {
    $: () => target, getJson: async () => ({ candidates: [candidate] }), esc: (v) => String(v ?? ""), apiNum: Number,
    confirm: () => { throw new Error("dry-run must not ask for confirmation"); }, toast: () => {},
    postJson: async (...args) => { writes.push(args); return preview; }, renderBrandMasterSettings: async () => { reloads++; }
  });
  await render([{ brand_code: "B0000BDG", brand_name: "BORC" }]);
  assert.match(rows.innerHTML, /data-split-dry-run>분리 검토 \(Dry Run\)/);
  assert.match(rows.innerHTML, /data-split-execute disabled/);
  assert.equal(writes.length, 0);
  const box = { innerHTML: "" };
  const row = { dataset: { pendingId: "c1" }, querySelector: (selector) => (selector === "[data-split-preview]" ? box : { value: "" }) };
  const button = { dataset: { splitDryRun: "" }, disabled: false, closest: () => row };
  await target.onclick({ target: { closest: () => button } });
  assert.deepEqual(JSON.parse(JSON.stringify(writes)), [["/api/pending-brands/split/dry-run", { id: "c1" }, 180000]]);
  assert.equal(reloads, 0);
  assert.match(box.innerHTML, /SPL_00b4a2e6cc/);
  assert.match(box.innerHTML, /2026-09<\/td><td>ARCHIVE_REBUILD<\/td>[\s\S]*OK/);
});
