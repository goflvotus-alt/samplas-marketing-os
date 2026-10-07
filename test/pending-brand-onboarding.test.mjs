import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import * as queue from "../scripts/pending-brand-queue.mjs";
import { buildBrandRegistry, resolveBrand } from "../scripts/brand-engine.mjs";
import { refreshBrandSourcingMaster } from "../scripts/build-brand-sourcing-master.mjs";

function fixture(code = "STALE7", oldName = "Legacy Seven", name = "Next Season") {
  return { canonical: { brands: [{ brand_code: code, brand_name: oldName, active: false, name_aliases: [], nameSource: "suggested" }] },
    cafe24Brands: [{ brand_code: code, brand_name: name, product_count: 23 }],
    products: [{ brand_code: code, product_name: `[${name} : 테스트] Jacket`, product_no: 17 }],
    ecountLines: [{ productName: `${name} / Jacket` }] };
}
const build = brands => ({ brands: brands.map(b => ({ id: b.brand_code, name: b.brand_name, active: b.active })), aliases: [] });

for (const args of [["B0000BDG", "BORC", "PERSONSOUL"], ["STALE7", "Legacy Seven", "Next Season"]]) {
  // 2026-10: code reuse is split into old/new identities (Phase 2); an in-place REASSIGN would
  // attribute the new brand's earlier Cafe24 sales to the legacy identity, so it is refused.
  test(`code reuse keeps legacy identity and refuses in-place reassignment: ${args[2]}`, () => {
    const sources = fixture(...args);
    const before = structuredClone(sources.canonical);
    const detected = queue.detectPendingBrands(sources);
    const c = detected.candidates[0];
    assert.equal(c.source, "BOTH");
    assert.equal(c.reviewReason, "CODE_REUSE_SPLIT_REQUIRED");
    assert.equal(c.requiresIdentitySplit, true);
    assert.equal(c.previousCanonicalBrand, args[1]);
    assert.equal(c.codeReuseClassification, "REVIEW_REQUIRED", "no Cafe24 creation date in this fixture");
    assert.equal(queue.isAutoSafePendingDecision(c, sources.canonical, sources), null);
    assert.throws(() => queue.planPendingBrandDecision(sources.canonical, detected, { id: c.id, action: "REASSIGN_INACTIVE_CODE" }, "2026-09-30T12:00:00Z", [], sources), /identity split/);
    assert.equal(resolveBrand(args[1], buildBrandRegistry(sources.canonical)).brandId, args[0]);
    assert.deepEqual(sources.canonical, before);
  });
}

test("AUTO_SAFE rejects missing, stale, contradictory and competing evidence", () => {
  const good = fixture();
  const current = queue.detectPendingBrands(good).candidates[0];
  const cases = [
    { ...good, cafe24Brands: [] }, { ...good, ecountLines: [] },
    { ...good, ecountLines: [{ BRAND: "Other Name" }] },
    { ...good, cafe24Brands: [...good.cafe24Brands, { brand_code: "SECOND", brand_name: "Next Season" }] },
    { ...good, cafe24Brands: [...good.cafe24Brands, { brand_code: "STALE7", brand_name: "Other Name" }] },
    { ...good, products: [{ brand_code: "STALE7", product_name: "[Other Name] Jacket" }] },
    { ...good, canonical: { brands: [{ ...good.canonical.brands[0], active: true }] } },
    ...[{ brand_name: "Next Season" }, { name_aliases: ["Next Season"] }, { sourceCafe24Codes: ["STALE7"] }].map(claim => ({ ...good, canonical: { brands: [...good.canonical.brands, { brand_code: "ACTIVE", brand_name: "Other", active: true, ...claim }] } })),
    { ...good, canonical: { brands: [...good.canonical.brands, { ...good.canonical.brands[0] }] } },
    { ...good, aliases: [{ alias: "Next Season", brandId: "OTHER" }] }
  ];
  for (const sources of cases) {
    assert.equal(queue.isAutoSafePendingDecision(current, sources.canonical, sources), null);
    assert.throws(() => queue.planPendingBrandDecision(sources.canonical, { candidates: [current] }, { id: current.id, action: "REASSIGN_INACTIVE_CODE" }, undefined, sources.aliases || [], sources), /evidence|eligible|identity split/i);
  }
  for (const patch of [{ heldAt: "hold" }, { status: "APPROVED" }, { relatedCandidateIds: ["other"] }, { collabCandidates: ["A", "B"] }]) {
    assert.equal(queue.isAutoSafePendingDecision({ ...current, ...patch }, good.canonical, good), null);
  }
  assert.throws(() => queue.planPendingBrandDecision(good.canonical, { candidates: [current] }, { id: current.id, action: "REASSIGN_INACTIVE_CODE" }), /evidence|eligible|identity split/i);
});

test("fresh reuse evidence reclassifies an existing conflict without changing its ID", () => {
  const sources = fixture();
  const previous = queue.detectPendingBrands({ ...sources, canonical: { brands: [{ ...sources.canonical.brands[0], active: true }] } });
  assert.equal(previous.candidates[0].reviewReason, "CODE_NAME_CONFLICT");
  const next = queue.detectPendingBrands({ ...sources, previous });
  assert.equal(next.candidates[0].id, previous.candidates[0].id);
  assert.equal(next.candidates[0].reviewReason, "CODE_REUSE_SPLIT_REQUIRED");
  assert.equal(next.candidates[0].canonicalName, undefined);
});

test("AUTO_SAFE NEW rebuild retains UNKNOWN rather than inventing sourcing evidence", async () => {
  const sources = { ...fixture(), canonical: { brands: [] } }; const { dir } = await setup(sources);
  try {
    await writeFile(join(dir, "ecount-inventory/raw-products.json"), JSON.stringify({ Data: { Result: [] } }));
    const result = await queue.refreshPendingBrands(dir, async () => sources, { autoApprove: true, buildCompatibility: build });
    assert.equal(result.candidates[0].approvalAction, "NEW");
    assert.equal(result.onboarding[0].sourcingRefresh.ok, true);
    const sourcing = await refreshBrandSourcingMaster(dir);
    assert.equal(sourcing.brands.find(b => b.brand_code === "STALE7").sourcing_type, "UNKNOWN");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("true new BOTH observation uses NEW; old BOTH history does not count as fresh evidence", () => {
  const sources = { ...fixture(), canonical: { brands: [] } };
  const first = queue.detectPendingBrands(sources);
  assert.equal(queue.isAutoSafePendingDecision(first.candidates[0], sources.canonical, sources)?.action, "NEW");
  for (const partial of [{ ...sources, ecountLines: [] }, { ...sources, cafe24Brands: [], products: [] }]) {
    const again = queue.detectPendingBrands({ ...partial, previous: first });
    assert.equal(queue.isAutoSafePendingDecision(again.candidates[0], partial.canonical, partial), null);
  }
});

async function setup(sources) {
  const dir = await mkdtemp(join(tmpdir(), "brand-onboarding-"));
  await mkdir(join(dir, "ecount-inventory")); await mkdir(join(dir, "ecount-sales")); await mkdir(join(dir, "intelligence"));
  const files = { "brand-master.json": sources.canonical, "pending-brand-queue.json": queue.detectPendingBrands(sources),
    "intelligence/brand-master-list.json": [], "intelligence/brand-aliases.json": [],
    "ecount-inventory/raw-products.json": { Data: { Result: [{ PROD_DES: "CON - Next Season / Jacket", IN_PRICE: 0, OUT_PRICE: 0 }] } },
    "brand-sourcing-candidates.json": [], "monthly-archive.json": { total: 287916120 }, "product-registry.json": { entries: [] } };
  for (const [name, value] of Object.entries(files)) await writeFile(join(dir, name), JSON.stringify(value));
  return { dir, files };
}

test("code-reuse REASSIGN is refused before any write", async () => {
  const sources = fixture(); const { dir, files } = await setup(sources);
  try {
    const input = { id: files["pending-brand-queue.json"].candidates[0].id, action: "REASSIGN_INACTIVE_CODE" };
    await assert.rejects(queue.reviewPendingBrand(dir, input, build, { sources, replace: async () => { throw Error("must not write"); } }), /identity split/);
    for (const [name, value] of Object.entries(files)) assert.equal(await readFile(join(dir, name), "utf8"), JSON.stringify(value));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("decision atomic rollback and post-commit sourcing refresh (NEW path)", async () => {
  const sources = { ...fixture(), canonical: { brands: [] } };
  const count = await setup(sources);
  let writes = 0;
  try {
    const id = count.files["pending-brand-queue.json"].candidates[0].id;
    await queue.reviewPendingBrand(count.dir, { id, action: "NEW", brandName: "Next Season" }, build, { sources, replace: async (a, b) => { writes += 1; await rename(a, b); } });
  } finally { await rm(count.dir, { recursive: true, force: true }); }
  assert.ok(writes >= 2, "brand master and queue are both replaced");
  const { dir, files } = await setup(sources);
  try {
    const input = { id: files["pending-brand-queue.json"].candidates[0].id, action: "NEW", brandName: "Next Season" };
    for (let failAt = 1; failAt <= writes; failAt += 1) {
      let n = 0;
      await assert.rejects(queue.reviewPendingBrand(dir, input, build, { sources, replace: async (a, b) => { if (++n === failAt) throw Error("injected"); await rename(a, b); } }), /injected/);
      for (const [name, value] of Object.entries(files)) assert.equal(await readFile(join(dir, name), "utf8"), JSON.stringify(value));
    }
    const result = await queue.reviewPendingBrand(dir, input, build, { sources });
    assert.equal(result.sourcingRefresh.ok, true);
    const sourcing = JSON.parse(await readFile(join(dir, "brand-sourcing-master.json"), "utf8"));
    assert.equal(result.candidate.canonicalBrandCode, "STALE7");
    assert.equal(sourcing.brands.find(b => b.brand_code === result.candidate.canonicalBrandCode).sourcing_type, "CONSIGNMENT");
    for (const name of ["monthly-archive.json", "product-registry.json"]) assert.equal(await readFile(join(dir, name), "utf8"), JSON.stringify(files[name]));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("refresh opt-in only; dry-run and GET never auto-write; failed sourcing is explicit", async () => {
  const sources = { ...fixture(), canonical: { brands: [] } }; const { dir, files } = await setup(sources);
  try {
    await queue.refreshPendingBrands(dir, async () => sources, { dryRun: true, autoApprove: true, buildCompatibility: build });
    await queue.readPendingBrands(dir, { reviewEligibility: true });
    assert.equal(await readFile(join(dir, "brand-master.json"), "utf8"), JSON.stringify(files["brand-master.json"]));
    const normal = await queue.refreshPendingBrands(dir, async () => sources);
    assert.equal(normal.candidates[0].status, "PENDING");
    await rm(join(dir, "ecount-inventory/raw-products.json"));
    const actual = await queue.refreshPendingBrands(dir, async () => sources, { autoApprove: true, buildCompatibility: build });
    assert.equal(actual.candidates[0].status, "APPROVED");
    assert.equal(actual.onboarding[0].sourcingRefresh.ok, false);
    assert.ok(actual.onboarding[0].sourcingRefresh.error);
    assert.equal(JSON.parse(await readFile(join(dir, "brand-master.json"), "utf8")).brands.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("supersession is explicit, unique and period-bound; active owners still win", () => {
  // Existing supersededBy data (e.g. entries written before 2026-10) keeps resolving period-bound.
  const master = { brands: [
    { brand_code: "STALE7", brand_name: "Legacy Seven", active: false, name_aliases: [], supersededBy: { brandCode: "MANUAL_next", effectiveMonth: "2026-10" } },
    { brand_code: "MANUAL_next", brand_name: "Next Season", active: true, name_aliases: [], sourceCafe24Codes: ["STALE7"] }
  ] };
  assert.equal(queue.approvedCafe24BrandCode("STALE7", master, { since: "2026-09-01", until: "2026-09-30" }), "STALE7");
  assert.equal(queue.approvedCafe24BrandCode("STALE7", master, { since: "2026-10-01", until: "2026-10-31" }), master.brands[1].brand_code);
  assert.equal(queue.approvedCafe24BrandCode("STALE7", master, { since: "2026-09-01", until: "2026-10-31" }), "UNASSIGNED");
  for (const patch of [{ active: true }, { supersededBy: undefined }, { supersededBy: { brandCode: "OTHER", effectiveMonth: "2026-10" } }]) {
    assert.equal(queue.approvedCafe24BrandCode("STALE7", { brands: [{ ...master.brands[0], ...patch }, master.brands[1]] }), "STALE7");
  }
  assert.equal(queue.approvedCafe24BrandCode("STALE7", { brands: [...master.brands, { brand_code: "SECOND", active: true, sourceCafe24Codes: ["STALE7"] }] }), "STALE7");
});

function http(port, path, method = "GET", authorized = false, payload = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { host: "production.example", ...(authorized ? { authorization: `Basic ${Buffer.from("test:only").toString("base64")}` } : {}) } }, res => {
      let text = ""; res.on("data", c => text += c); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on("error", reject); req.end(method === "POST" ? JSON.stringify(payload) : undefined);
  });
}

test("authenticated HTTP bulk refresh onboards NEW only; reassignment needs explicit review; GET/dry-run are pure", { timeout: 30000 }, async () => {
  const sources = fixture();
  // A genuinely new brand next to the inactive-code reuse candidate.
  sources.cafe24Brands.push({ brand_code: "FRESH1", brand_name: "Fresh Label", product_count: 3 });
  sources.products.push({ brand_code: "FRESH1", product_name: "[Fresh Label : 테스트] Coat", product_no: 18 });
  sources.ecountLines.push({ productName: "Fresh Label / Coat" });
  const { dir, files } = await setup(sources);
  const proxy = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ brands: sources.cafe24Brands, products: sources.products, orders: [], manufacturers: [], totals: {} }));
  });
  proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  let child;
  try {
    const month = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 7);
    // CO group keeps the fixture consignment-only; a non-CO line is a wholesale signal (HYBRID).
    await writeFile(join(dir, "ecount-sales", `${month}.json`), JSON.stringify({ month, salesLines: sources.ecountLines.map(line => ({ ...line, brandGroup: "NS CO" })) }));
    await writeFile(join(dir, "cafe24-product-catalog.json"), JSON.stringify({ products: sources.products }));
    for (const [name, value] of Object.entries({ "brand-commercial-policy.json": { policies: [] }, "brand-sourcing-master.json": { brands: [] }, "product-registry-review-queue.json": { entries: [] } })) await writeFile(join(dir, name), JSON.stringify(value));
    child = spawn(process.execPath, [fileURLToPath(new URL("../server.mjs", import.meta.url))], { cwd: dir,
      env: { ...process.env, WORK_DIR: dir, HOST: "127.0.0.1", PORT: String(port), CAFE24_PROXY_BASE_URL: `http://127.0.0.1:${proxy.address().port}`, CAFE24_PROXY_BASIC_AUTH: "test:only", META_ACCESS_TOKEN: "", INSTAGRAM_ACCESS_TOKEN: "" }, stdio: ["ignore", "pipe", "pipe"] });
    child.stderr.resume();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("server timeout")), 15000);
      child.stdout.on("data", c => { if (String(c).includes("running at")) { clearTimeout(timer); resolve(); } });
      child.once("exit", code => { clearTimeout(timer); reject(Error(`server exit ${code}`)); });
    });
    const beforeMaster = await readFile(join(dir, "brand-master.json"), "utf8");
    const beforeQueue = await readFile(join(dir, "pending-brand-queue.json"), "utf8");
    assert.equal((await http(port, "/api/pending-brands/refresh", "POST")).status, 401);
    assert.equal((await http(port, "/api/pending-brands/review", "POST", false, { action: "REASSIGN_INACTIVE_CODE" })).status, 401);
    assert.equal((await http(port, "/api/pending-brands")).status, 401, "anonymous read is refused");
    assert.equal((await http(port, "/api/pending-brands", "GET", true)).status, 200);
    const dry = await http(port, "/api/pending-brands/refresh?dryRun=1", "POST", true, { autoApprove: true });
    assert.equal(dry.status, 200);
    assert.equal(await readFile(join(dir, "brand-master.json"), "utf8"), beforeMaster);
    assert.equal(await readFile(join(dir, "pending-brand-queue.json"), "utf8"), beforeQueue);
    const queueOnly = await http(port, "/api/pending-brands/refresh", "POST", true);
    assert.ok(queueOnly.body.candidates.every(c => c.status === "PENDING"));
    const refresh = await http(port, "/api/pending-brands/refresh", "POST", true, { autoApprove: true });
    assert.equal(refresh.status, 200);
    const fresh = refresh.body.candidates.find(c => c.sourceBrandCode === "FRESH1");
    const reuse = refresh.body.candidates.find(c => c.sourceBrandCode === "STALE7");
    assert.equal(fresh.status, "APPROVED", JSON.stringify(refresh.body.onboarding));
    assert.equal(fresh.approvalAction, "NEW");
    assert.deepEqual(refresh.body.onboarding.map(e => e.candidate?.canonicalBrandCode), ["FRESH1"], "bulk refresh approves NEW only");
    assert.equal(refresh.body.onboarding[0].sourcingRefresh.ok, true);
    assert.equal(reuse.status, "PENDING", "code reuse is never bulk-approved");
    assert.equal(reuse.reviewReason, "CODE_REUSE_SPLIT_REQUIRED");
    assert.equal(reuse.requiresIdentitySplit, true);
    const afterBulk = (await http(port, "/api/brand-master", "GET", true)).body;
    assert.equal(afterBulk.brands.length, 2);
    assert.equal(afterBulk.brands.find(b => b.brand_code === "STALE7").supersededBy, undefined);
    const manual = await http(port, "/api/pending-brands/review", "POST", true, { id: reuse.id, action: "REASSIGN_INACTIVE_CODE" });
    assert.equal(manual.status, 400, JSON.stringify(manual.body));
    assert.match(JSON.stringify(manual.body), /identity split/);
    const master = (await http(port, "/api/brand-master", "GET", true)).body;
    assert.equal(master.brands.length, 2, "manual REASSIGN wrote nothing");
    assert.equal(master.brands.find(b => b.brand_code === "STALE7").supersededBy, undefined);
    assert.equal((await http(port, "/api/intelligence/commercial-policy?name=Unregistered", "GET", true)).body.policy_status, "UNRESOLVED");
    const repeated = await http(port, "/api/pending-brands/refresh", "POST", true, { autoApprove: true });
    assert.equal(repeated.body.onboarding.length, 0);
    assert.equal((await http(port, "/api/brand-master", "GET", true)).body.brands.length, 2);
    assert.equal(await readFile(join(dir, "monthly-archive.json"), "utf8"), JSON.stringify(files["monthly-archive.json"]));
    assert.equal(await readFile(join(dir, "product-registry.json"), "utf8"), JSON.stringify(files["product-registry.json"]));
  } finally {
    if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    await new Promise(resolve => proxy.close(resolve)); await rm(dir, { recursive: true, force: true });
  }
});

test("Extension standard parsing/request accepts generic new brands without rescue changes", async t => {
  const path = "/Users/binggu/Dropbox/SAMPLAS WORK/INTELLIGENCE/SAMPLAS-Extension/content.js";
  let src;
  try { src = await readFile(path, "utf8"); } catch (e) { if (e.code === "ENOENT") return t.skip("External Extension checkout unavailable"); throw e; }
  const split = src.slice(src.indexOf("  function splitItem("), src.indexOf("  function findCurrentTable("));
  const requestCode = src.slice(src.indexOf("  async function fetchCommercialPolicy("), src.indexOf("  const clean ="));
  const urls = [];
  const context = { clean: v => String(v ?? "").replace(/\s+/g, " ").trim(), COMMERCIAL_POLICY_API: "http://local.test/api/intelligence/commercial-policy", commercialPolicyCache: new Map(), console,
    fetch: async url => { urls.push(url); return { ok: true, json: async () => ({ policy_status: "SOURCING_DEFAULT" }) }; } };
  runInNewContext(`${split}\n${requestCode}\nthis.splitItem=splitItem;this.requestPolicy=fetchCommercialPolicy;`, context);
  for (const text of ["New Season Label / Jacket", "[New Season Label : 새브랜드] Jacket"]) {
    const result = context.splitItem(text);
    assert.equal(result.brand, "New Season Label"); assert.equal(result.product, "Jacket");
    await context.requestPolicy(result.brand, result.product);
  }
  assert.equal(new URL(urls[0]).searchParams.get("name"), "New Season Label");
  assert.equal(new URL(urls[0]).searchParams.get("product_name"), "Jacket");
  assert.equal(context.splitItem("LYM / Jacket").brand, "LIBERAL YOUTH MINISTRY");
  assert.equal(context.splitItem("ADIDAS X AVAVAV / Jacket").brand, "AVAVAV");
});

const driftLikeReuse = [["B0000BDG", "BORC", "PERSONSOUL"], ["B0000BDJ", "GKL", "UNDER THE SIGN"], ["B0000BDM", "LAMASKARADE", "PRAYING"]];

test("unattended onboarding approves NEW only; inactive-code reuse waits for an explicit review", async () => {
  assert.deepEqual([...queue.UNATTENDED_AUTO_APPROVE_ACTIONS], ["NEW"]);
  const fresh = { ...fixture("NEWB9", "Unused", "Brand Nine"), canonical: { brands: [] } };
  const created = await setup(fresh);
  const reused = fixture(); const reuseDir = await setup(reused);
  try {
    const a = await queue.refreshPendingBrandsUnattended(created.dir, async () => fresh, { buildCompatibility: build });
    assert.equal(a.candidates[0].status, "APPROVED");
    assert.equal(a.candidates[0].approvalAction, "NEW");

    const masterBefore = await readFile(join(reuseDir.dir, "brand-master.json"), "utf8");
    const b = await queue.refreshPendingBrandsUnattended(reuseDir.dir, async () => reused, { buildCompatibility: build });
    assert.equal(queue.isAutoSafePendingDecision(b.candidates[0], reused.canonical, reused), null, "code reuse is never auto-safe");
    assert.equal(b.onboarding.length, 0);
    assert.equal(b.candidates[0].status, "PENDING");
    assert.equal(b.candidates[0].reviewReason, "CODE_REUSE_SPLIT_REQUIRED");
    assert.equal(await readFile(join(reuseDir.dir, "brand-master.json"), "utf8"), masterBefore);

    await assert.rejects(queue.reviewPendingBrand(reuseDir.dir, { id: b.candidates[0].id, action: "REASSIGN_INACTIVE_CODE" }, build, { sources: reused }), /identity split/);
    assert.equal(await readFile(join(reuseDir.dir, "brand-master.json"), "utf8"), masterBefore, "manual REASSIGN refused, nothing written");
  } finally { for (const d of [created.dir, reuseDir.dir]) await rm(d, { recursive: true, force: true }); }
});

test("PERSONSOUL / UNDER THE SIGN / PRAYING type reuse is never reassigned by bulk autoApprove", async () => {
  for (const args of driftLikeReuse) {
    const sources = fixture(...args); const { dir } = await setup(sources);
    try {
      const masterBefore = await readFile(join(dir, "brand-master.json"), "utf8");
      const result = await queue.refreshPendingBrands(dir, async () => sources, { autoApprove: true, buildCompatibility: build });
      const c = result.candidates[0];
      assert.equal(queue.isAutoSafePendingDecision(c, sources.canonical, sources), null, `${args[2]} is never auto-safe`);
      assert.equal(result.onboarding.length, 0, args[2]);
      assert.equal(c.status, "PENDING");
      assert.equal(c.reviewReason, "CODE_REUSE_SPLIT_REQUIRED");
      assert.equal(c.previousCanonicalBrand, args[1]);
      assert.equal(await readFile(join(dir, "brand-master.json"), "utf8"), masterBefore, `${args[2]} Brand Master untouched`);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});
