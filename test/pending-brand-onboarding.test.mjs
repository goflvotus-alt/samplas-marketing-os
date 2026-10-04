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
  test(`inactive reuse preserves legacy identity: ${args[2]}`, () => {
    const sources = fixture(...args);
    const before = structuredClone(sources.canonical);
    const detected = queue.detectPendingBrands(sources);
    const c = detected.candidates[0];
    assert.equal(c.source, "BOTH");
    assert.equal(c.reviewReason, "INACTIVE_CODE_REUSED");
    assert.equal(queue.isAutoSafePendingDecision(c, sources.canonical, sources)?.action, "REASSIGN_INACTIVE_CODE");
    const result = queue.planPendingBrandDecision(sources.canonical, detected, { id: c.id, action: "REASSIGN_INACTIVE_CODE" }, "2026-09-30T12:00:00Z", [], sources);
    const old = result.canonical.brands[0];
    const added = result.canonical.brands[1];
    assert.deepEqual({ ...old, supersededBy: undefined }, { ...before.brands[0], supersededBy: undefined });
    assert.notEqual(added.brand_code, args[0]);
    assert.equal(added.brand_name, args[2]);
    assert.deepEqual(added.sourceCafe24Codes, [args[0]]);
    assert.equal(queue.approvedCafe24BrandCode(args[0], result.canonical), added.brand_code);
    assert.equal(queue.approvedCafe24BrandCode(args[0], result.canonical, { since: "2026-08-01", until: "2026-08-31" }), args[0]);
    assert.equal(resolveBrand(args[1], buildBrandRegistry(result.canonical)).brandId, args[0]);
    assert.equal(resolveBrand(args[2], buildBrandRegistry(result.canonical)).brandId, added.brand_code);
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
    assert.throws(() => queue.planPendingBrandDecision(sources.canonical, { candidates: [current] }, { id: current.id, action: "REASSIGN_INACTIVE_CODE" }, undefined, sources.aliases || [], sources), /evidence|eligible/i);
  }
  for (const patch of [{ heldAt: "hold" }, { status: "APPROVED" }, { relatedCandidateIds: ["other"] }, { collabCandidates: ["A", "B"] }]) {
    assert.equal(queue.isAutoSafePendingDecision({ ...current, ...patch }, good.canonical, good), null);
  }
  assert.throws(() => queue.planPendingBrandDecision(good.canonical, { candidates: [current] }, { id: current.id, action: "REASSIGN_INACTIVE_CODE" }), /evidence|eligible/i);
});

test("fresh reuse evidence reclassifies an existing conflict without changing its ID", () => {
  const sources = fixture();
  const previous = queue.detectPendingBrands({ ...sources, canonical: { brands: [{ ...sources.canonical.brands[0], active: true }] } });
  assert.equal(previous.candidates[0].reviewReason, "CODE_NAME_CONFLICT");
  const next = queue.detectPendingBrands({ ...sources, previous });
  assert.equal(next.candidates[0].id, previous.candidates[0].id);
  assert.equal(next.candidates[0].reviewReason, "INACTIVE_CODE_REUSED");
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

test("reassignment atomic rollback and post-commit sourcing refresh", async () => {
  const sources = fixture(); const { dir, files } = await setup(sources);
  try {
    const input = { id: files["pending-brand-queue.json"].candidates[0].id, action: "REASSIGN_INACTIVE_CODE" };
    for (const failAt of [1, 2, 3, 4]) {
      let n = 0;
      await assert.rejects(queue.reviewPendingBrand(dir, input, build, { sources, replace: async (a, b) => { if (++n === failAt) throw Error("injected"); await rename(a, b); } }), /injected/);
      for (const [name, value] of Object.entries(files)) assert.equal(await readFile(join(dir, name), "utf8"), JSON.stringify(value));
    }
    const result = await queue.reviewPendingBrand(dir, input, build, { sources });
    assert.equal(result.sourcingRefresh.ok, true);
    const sourcing = JSON.parse(await readFile(join(dir, "brand-sourcing-master.json"), "utf8"));
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
  const sources = fixture(); const detected = queue.detectPendingBrands(sources);
  const master = queue.planPendingBrandDecision(sources.canonical, detected, { id: detected.candidates[0].id, action: "REASSIGN_INACTIVE_CODE" }, "2026-09-30T15:00:00Z", [], sources).canonical;
  assert.equal(master.brands[0].supersededBy.effectiveMonth, "2026-10", "KST month boundary");
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
    const req = request({ host: "127.0.0.1", port, path, method, headers: { host: "production.example", ...(authorized ? { "x-samplas-internal-token": "test-only" } : {}) } }, res => {
      let text = ""; res.on("data", c => text += c); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on("error", reject); req.end(method === "POST" ? JSON.stringify(payload) : undefined);
  });
}

test("authenticated HTTP refresh onboards and immediately serves sourcing policy; GET/dry-run are pure", { timeout: 30000 }, async () => {
  const sources = fixture(); const { dir, files } = await setup(sources);
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
      env: { ...process.env, WORK_DIR: dir, HOST: "127.0.0.1", PORT: String(port), CAFE24_PROXY_BASE_URL: `http://127.0.0.1:${proxy.address().port}`, CAFE24_PROXY_SECRET: "test-only", META_ACCESS_TOKEN: "", INSTAGRAM_ACCESS_TOKEN: "" }, stdio: ["ignore", "pipe", "pipe"] });
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
    assert.equal((await http(port, "/api/pending-brands")).status, 200);
    const dry = await http(port, "/api/pending-brands/refresh?dryRun=1", "POST", true, { autoApprove: true });
    assert.equal(dry.status, 200);
    assert.equal(await readFile(join(dir, "brand-master.json"), "utf8"), beforeMaster);
    assert.equal(await readFile(join(dir, "pending-brand-queue.json"), "utf8"), beforeQueue);
    const queueOnly = await http(port, "/api/pending-brands/refresh", "POST", true);
    assert.equal(queueOnly.body.candidates[0].status, "PENDING");
    const refresh = await http(port, "/api/pending-brands/refresh", "POST", true, { autoApprove: true });
    assert.equal(refresh.status, 200);
    assert.equal(refresh.body.candidates[0].status, "APPROVED", JSON.stringify(refresh.body.onboarding));
    assert.equal(refresh.body.onboarding[0].sourcingRefresh.ok, true);
    const master = (await http(port, "/api/brand-master")).body;
    assert.ok(master.brands.find(b => b.brand_code === "STALE7").supersededBy, "read normalization preserves provenance");
    const policy = await http(port, "/api/intelligence/commercial-policy?name=Next%20Season&product_name=Jacket");
    assert.equal(policy.status, 200);
    assert.equal(policy.body.brand.brandId, refresh.body.candidates[0].canonicalBrandCode);
    assert.equal(policy.body.policy_status, "SOURCING_DEFAULT");
    assert.equal(policy.body.effective_policy.effective_discount_percent, 10);
    assert.equal(policy.body.online_price, null, "no fabricated price without Product Registry link");
    const nextProduct = await http(port, "/api/intelligence/commercial-policy?name=Next%20Season&product_name=New%20Bag");
    assert.equal(nextProduct.body.effective_policy.effective_discount_percent, 10);
    assert.equal((await http(port, "/api/intelligence/commercial-policy?name=Unregistered")).body.policy_status, "UNRESOLVED");
    const repeated = await http(port, "/api/pending-brands/refresh", "POST", true, { autoApprove: true });
    assert.equal(repeated.body.onboarding.length, 0);
    assert.equal((await http(port, "/api/brand-master")).body.brands.length, 2);
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
