import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { runInNewContext } from "node:vm";
import { detectPendingBrands, refreshPendingBrands, readPendingBrands, planPendingBrandDecision, reviewPendingBrand, approvedCafe24BrandCode } from "../scripts/pending-brand-queue.mjs";
import { buildBrandRegistry, resolveBrand } from "../scripts/brand-engine.mjs";
import { mergeOfflineBrandSales } from "../scripts/monthly-brand-sales.mjs";

const canonical = { brands: [{ brand_code: "B1", brand_name: "Known", name_aliases: ["Known alias"], active: true, nameSource: "suggested" }] };
const detect = input => detectPendingBrands({ canonical, ...input });
const newBrand = { brand_code: "B2", brand_name: "New Brand" };

test("new Cafe24 code is PENDING, not a canonical write; grandfathered entries untouched", () => {
  assert.throws(() => detect({ cafe24Brands: {} }), /Invalid pending/);
  const before = JSON.stringify(canonical);
  const result = detect({ cafe24Brands: [newBrand] });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].status, "PENDING");
  assert.equal(result.candidates[0].sourceBrandCode, "B2");
  assert.equal(JSON.stringify(canonical), before);
});

test("existing code, exact name, aliases and case/whitespace variants do not create false candidates", () => {
  const result = detect({ cafe24Brands: [{ brand_code: " b1 ", brand_name: "renamed source" }], ecountLines: [
    { BRAND: " KNOWN  alias " }, { productName: "[known] item" }, { productName: "Compat / item" }
  ], compatibility: [{ id: "C1", name: "Compatibility" }], aliases: [{ alias: "Compat", brandId: "C1" }] });
  assert.equal(result.candidates.length, 0);
});

test("unknown Cafe24 code sharing an accepted name still requires review, never gets approved", () => {
  const result = detect({ cafe24Brands: [{ brand_code: "B2", brand_name: "Known" }] });
  assert.deepEqual(result.candidates[0].possibleExistingCanonical, ["B1"]);
  assert.equal(result.candidates[0].status, "PENDING");
});

test("repeated scan is stable; distinct source codes never merge by display name", () => {
  const input = { cafe24Brands: [newBrand], products: [{ ...newBrand, product_no: 1, product_name: "item" }], ecountLines: [{ BRAND: "new brand" }] };
  const first = detect(input);
  const second = detect({ ...input, previous: first });
  assert.equal(second.candidates.length, 1);
  assert.equal(second.candidates[0].id, first.candidates[0].id);
  assert.equal(second.candidates[0].relatedProductCount, first.candidates[0].relatedProductCount);
  assert.equal(second.candidates[0].source, "BOTH");
  const ecountOnly = detect({ previous: second, ecountLines: [{ BRAND: "NEW BRAND" }] });
  assert.equal(ecountOnly.candidates.length, 1);
  assert.equal(ecountOnly.candidates[0].id, first.candidates[0].id);
  assert.equal(detect({ cafe24Brands: [newBrand, { ...newBrand, brand_code: "B3" }] }).candidates.length, 2);
});

test("ECOUNT-first candidate retains identity when unique Cafe24 code is later observed", () => {
  const first = detect({ ecountLines: [{ BRAND: "New Brand" }] });
  const second = detect({ previous: first, cafe24Brands: [newBrand], ecountLines: [{ BRAND: "new brand" }] });
  assert.equal(second.candidates.length, 1);
  assert.equal(second.candidates[0].id, first.candidates[0].id);
  assert.equal(second.candidates[0].source, "BOTH");
});

test("conflicting aliases stay review candidates, including compatibility aliases", () => {
  const result = detect({ compatibility: [{ id: "C1", name: "First" }, { id: "C2", name: "Second" }], aliases: [{ alias: "conflict", brandId: "C1" }, { alias: "conflict", brandId: "C2" }], ecountLines: [{ BRAND: "conflict" }] });
  assert.equal(result.candidates[0].reviewReason, "ALIAS_CONFLICT");
  assert.deepEqual(result.candidates[0].possibleExistingCanonical, []);
});

test("bracket, raw and slash collaboration candidates never become canonical brands", () => {
  const before = JSON.stringify(canonical);
  for (const productName of ["[A x B] item", "A X B / item"]) {
    const c = detect({ ecountLines: [{ productName }] }).candidates[0];
    assert.equal(c.reviewReason, "COLLABORATION");
    assert.deepEqual(c.collabCandidates, ["A", "B"]);
    assert.equal(c.status, "PENDING");
  }
  assert.equal(detect({ ecountLines: [{ BRAND: "A X B" }] }).candidates[0].reviewReason, "COLLABORATION");
  assert.equal(detect({ ecountLines: [{ BRAND: "[A x B]" }] }).candidates[0].reviewReason, "COLLABORATION");
  assert.equal(detect({ ecountLines: [{ candidates: ["A", "B"] }] }).candidates[0].reviewReason, "COLLABORATION");
  assert.equal(detect({ canonical: { brands: [{ brand_code: "COL", brand_name: "A X B" }] }, ecountLines: [{ BRAND: "A X B" }] }).candidates.length, 0);
  assert.equal(JSON.stringify(canonical), before);
});

test("QQQ and existing personal-payment policy excluded; gift/TAXFREE customer types do not erase brands", () => {
  const r = detect({ ecountLines: [{ productName: "QQQ / item" }, { BRAND: "Other", customerName: "개인결제창(이름)" },
    { BRAND: "GiftBrand", customerName: "기프트" }, { BRAND: "TaxBrand", customerName: "TAXFREE" }] });
  assert.equal(r.scan.excluded, 2);
  assert.equal(r.candidates.length, 2);
});

test("pending does not alter identity or drop unresolved net revenue", () => {
  const lines = [{ productName: "Unknown / shirt", date: "2026-09-01", salesAmount: 12000, isOfflineRevenue: true },
    { productName: "Unknown / return", date: "2026-09-01", salesAmount: -2000, isOfflineRevenue: true }];
  const context = { brandMaster: canonical, brandRegistry: buildBrandRegistry(canonical), productRegistry: { entries: [] }, reviewQueue: null };
  const before = mergeOfflineBrandSales({ offlineLines: lines, identityContext: context });
  const queue = detect({ ecountLines: lines });
  assert.equal(queue.candidates.length, 1);
  const after = mergeOfflineBrandSales({ offlineLines: lines, identityContext: context });
  assert.deepEqual(after, before);
  assert.equal(after.find(b => b.brand_code === "UNASSIGNED").salesAmount, 10000);
});

test("queue persistence, concurrent refresh, dry-run and failure preserve canonical bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pending-brand-test-"));
  try {
    const bytes = JSON.stringify(canonical);
    await writeFile(join(dir, "brand-master.json"), bytes);
    assert.equal((await readPendingBrands(dir)).candidates.length, 0);
    assert.deepEqual(await readdir(dir), ["brand-master.json"]);
    const load = async () => ({ canonical, cafe24Brands: [newBrand] });
    await refreshPendingBrands(dir, load, { dryRun: true });
    assert.deepEqual(await readdir(dir), ["brand-master.json"]);
    await Promise.all([refreshPendingBrands(dir, load), refreshPendingBrands(dir, load)]);
    assert.equal((await readPendingBrands(dir)).candidates.length, 1);
    const saved = await readFile(join(dir, "pending-brand-queue.json"), "utf8");
    await assert.rejects(refreshPendingBrands(dir, async () => { throw new Error("source unavailable"); }));
    assert.equal(await readFile(join(dir, "pending-brand-queue.json"), "utf8"), saved);
    assert.equal(await readFile(join(dir, "brand-master.json"), "utf8"), bytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function http(port, path, { method = "GET", token, payload } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { host: "production.example", ...(token ? { "x-samplas-internal-token": token } : {}) } }, res => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on("error", reject); req.end(payload ? JSON.stringify(payload) : undefined);
  });
}

test("real HTTP read/refresh contract: auth, pure GET, missing canonical and grandfathered flags", { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "pending-brand-http-"));
  const proxy = createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ brands: [newBrand], products: [], orders: [], manufacturers: [], totals: {} })); });
  proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const portProbe = createServer(); portProbe.listen(0, "127.0.0.1"); await once(portProbe, "listening");
  const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
  let child;
  try {
    for (const name of ["product-registry.json", "product-registry-review-queue.json", "brand-commercial-policy.json", "brand-sourcing-master.json"]) await writeFile(join(dir, name), JSON.stringify({ entries: [], brands: [] }));
    await writeFile(join(dir, "brand-master.json"), JSON.stringify(canonical));
    await writeFile(join(dir, "cafe24-product-catalog.json"), JSON.stringify({ products: [{ ...newBrand, product_no: 1, product_name: "[New Brand] item" }] }));
    child = spawn(process.execPath, [join(root, "server.mjs")], { cwd: dir, env: { ...process.env, WORK_DIR: dir, HOST: "127.0.0.1", PORT: String(port), CAFE24_PROXY_BASE_URL: `http://127.0.0.1:${proxy.address().port}`, CAFE24_PROXY_SECRET: "test-only", META_ACCESS_TOKEN: "", INSTAGRAM_ACCESS_TOKEN: "" }, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", c => stderr += c);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server start timeout")), 15000);
      child.stdout.on("data", c => { if (String(c).includes("running at")) { clearTimeout(timer); resolve(); } });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`server exit ${code}: ${stderr}`)); });
    });
    const before = await readFile(join(dir, "brand-master.json"), "utf8");
    const read = await http(port, "/api/brand-master");
    assert.equal(read.status, 200);
    assert.equal(read.body.brands.length, 1);
    assert.equal(read.body.brands[0].active, true);
    assert.equal((await http(port, "/api/pending-brands")).body.candidates.length, 0);
    assert.equal((await http(port, "/api/pending-brands/refresh", { method: "POST" })).status, 401);
    assert.equal((await http(port, "/api/pending-brands/refresh")).status, 405);
    const dry = await http(port, "/api/pending-brands/refresh?dryRun=1", { method: "POST", token: "test-only" });
    assert.equal(dry.status, 200); assert.equal(dry.body.candidates.length, 1);
    assert.equal((await http(port, "/api/pending-brands")).body.candidates.length, 0);
    const refresh = await http(port, "/api/pending-brands/refresh", { method: "POST", token: "test-only" });
    assert.equal(refresh.status, 200); assert.equal(refresh.body.candidates.length, 1);
    assert.equal((await http(port, "/api/pending-brands")).body.candidates.length, 1);
    for (const path of ["/api/diagnostics/brand-sales?since=2026-09-01&until=2026-09-02", "/api/promotion/1/summary?since=2026-09-01&until=2026-09-02"]) {
      const response = await http(port, path);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(await readFile(join(dir, "brand-master.json"), "utf8"), before);
    }
    assert.equal(await readFile(join(dir, "brand-master.json"), "utf8"), before);
    const id = refresh.body.candidates[0].id;
    for (const action of ["NEW", "LINK", "IGNORE"]) {
      assert.equal((await http(port, "/api/pending-brands/review", { method: "POST", payload: { id, action } })).status, 401);
    }
    const approved = await http(port, "/api/pending-brands/review", { method: "POST", token: "test-only", payload: { id, action: "NEW", brandName: "Human Approved" } });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.candidate.status, "APPROVED");
    const master = (await http(port, "/api/brand-master")).body;
    assert.equal(master.brands.length, 2);
    assert.deepEqual(master.brands.find(b => b.brand_code === "B1"), read.body.brands[0]);
    assert.equal(master.brands.find(b => b.brand_code === "B2").nameSource, "confirmed");
    assert.notEqual((await http(port, "/api/pending-brands/review", { method: "POST", token: "test-only", payload: { id, action: "NEW", brandName: "Again" } })).status, 200);
    const afterRefresh = await http(port, "/api/pending-brands/refresh", { method: "POST", token: "test-only" });
    assert.equal(afterRefresh.body.candidates[0].status, "APPROVED");
    const approvedCanonical = JSON.parse(await readFile(join(dir, "brand-master.json"), "utf8"));
    const extraQueue = detectPendingBrands({ canonical: approvedCanonical, previous: afterRefresh.body, cafe24Brands: [{ brand_code: "B3", brand_name: "Known alternate" }, { brand_code: "B4", brand_name: "Not a brand" }] });
    await writeFile(join(dir, "pending-brand-queue.json"), JSON.stringify(extraQueue));
    for (const [code, action] of [["B3", "LINK"], ["B4", "IGNORE"]]) {
      const response = await http(port, "/api/pending-brands/review", { method: "POST", token: "test-only", payload: {
        id: extraQueue.candidates.find(c => c.sourceBrandCode === code).id, action, canonicalBrandCode: "B1", note: "human decision"
      } });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.candidate.status, action === "LINK" ? "LINKED" : "IGNORED");
    }
    const aliases = JSON.parse(await readFile(join(dir, "intelligence/brand-aliases.json"), "utf8"));
    assert.ok(aliases.some(a => a.alias === "Known alternate" && a.brandId === "B1"));
    assert.ok(aliases.some(a => a.alias === "B3" && a.brandId === "B1"));
    const finalMaster = (await http(port, "/api/brand-master")).body.brands;
    assert.equal(finalMaster.length, 2);
    assert.deepEqual(finalMaster.find(b => b.brand_code === "B1").sourceCafe24Codes, ["B3"]);
    await rm(join(dir, "brand-master.json"));
    assert.equal((await http(port, "/api/brand-master")).body.brands.length, 0);
    await assert.rejects(readFile(join(dir, "brand-master.json")), { code: "ENOENT" });
  } finally {
    if (child && child.exitCode === null) { child.kill(); await once(child, "exit"); }
    await new Promise(resolve => proxy.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("explicit NEW preserves grandfather entries and requires unique human name/code", () => {
  const queue = detect({ cafe24Brands: [newBrand] });
  const input = { id: queue.candidates[0].id, action: "NEW", brandName: "Human name" };
  const result = planPendingBrandDecision(canonical, queue, input);
  assert.deepEqual(result.canonical.brands[0], canonical.brands[0]);
  assert.equal(result.canonical.brands[1].brand_code, "B2");
  assert.equal(result.canonical.brands[1].nameSource, "confirmed");
  assert.equal(result.candidate.status, "APPROVED");
  assert.throws(() => planPendingBrandDecision(result.canonical, result.queue, input), /already reviewed/);
  for (const brandName of ["", "Known", "known alias"]) assert.throws(() => planPendingBrandDecision(canonical, queue, { ...input, brandName }));
  assert.equal(queue.candidates[0].status, "PENDING");
  const refreshed = detectPendingBrands({ canonical: result.canonical, previous: result.queue, cafe24Brands: [newBrand], now: "2026-09-13T02:00:00Z" });
  assert.equal(refreshed.candidates[0].status, "APPROVED");
  assert.equal(refreshed.candidates[0].lastSeenAt, "2026-09-13T02:00:00Z");
  const ecount = detect({ ecountLines: [{ BRAND: "A X B" }] });
  const collab = planPendingBrandDecision(canonical, ecount, { id: ecount.candidates[0].id, action: "NEW", brandName: "A X B" });
  assert.match(collab.candidate.canonicalBrandCode, /^MANUAL_/);
  assert.equal(collab.candidate.status, "APPROVED");
});

test("LINK exact ECOUNT and Cafe24 aliases; primary keys and conflicts remain safe", () => {
  for (const source of [{ ecountLines: [{ BRAND: "New spelling" }] }, { cafe24Brands: [newBrand] }]) {
    const queue = detect(source);
    const result = planPendingBrandDecision(canonical, queue, { id: queue.candidates[0].id, action: "LINK", canonicalBrandCode: "B1" });
    assert.equal(result.canonical.brands.length, 1);
    assert.equal(result.candidate.status, "LINKED");
    assert.equal(resolveBrand(queue.candidates[0].rawBrandName, buildBrandRegistry(result.canonical)).brandId, "B1");
    if (source.cafe24Brands) {
      assert.equal(approvedCafe24BrandCode("B2", result.canonical), "B1");
      assert.equal(approvedCafe24BrandCode("B1", result.canonical), "B1");
      assert.equal(approvedCafe24BrandCode("B3", result.canonical), "B3");
      assert.equal(approvedCafe24BrandCode("B2", canonical), "B2");
    }
    const conflict = { brands: [...canonical.brands, { brand_code: "OTHER", brand_name: queue.candidates[0].rawBrandName }] };
    assert.throws(() => planPendingBrandDecision(conflict, queue, { id: queue.candidates[0].id, action: "LINK", canonicalBrandCode: "B1" }), /Alias conflict/);
  }
});

test("IGNORE and reviewed collabs survive refresh without canonical approval or lost observations", () => {
  const source = { ecountLines: [{ BRAND: "A X B", productName: "one" }] };
  const queue = detect(source);
  const result = planPendingBrandDecision(canonical, queue, { id: queue.candidates[0].id, action: "IGNORE", note: "not a standalone brand" });
  assert.deepEqual(result.canonical, canonical);
  const refreshed = detect({ ...source, previous: result.queue, now: "2026-09-13T01:00:00Z" });
  assert.equal(refreshed.candidates.length, 1);
  assert.equal(refreshed.candidates[0].status, "IGNORED");
  assert.equal(refreshed.candidates[0].note, "not a standalone brand");
  assert.equal(refreshed.candidates[0].lastSeenAt, "2026-09-13T01:00:00Z");
  assert.equal(queue.candidates[0].reviewReason, "COLLABORATION");
});

test("multi-file decision failure restores every original byte; successful decision persists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pending-review-"));
  const build = brands => ({ brands: brands.map(b => ({ id: b.brand_code, name: b.brand_name, active: true })), aliases: [] });
  try {
    await mkdir(join(dir, "intelligence"));
    const queue = detect({ cafe24Brands: [newBrand] });
    const entries = [["brand-master.json", canonical], ["pending-brand-queue.json", queue], ["intelligence/brand-master-list.json", []], ["intelligence/brand-aliases.json", []]];
    for (const [file, value] of entries) await writeFile(join(dir, file), JSON.stringify(value));
    const input = { id: queue.candidates[0].id, action: "NEW", brandName: "New Brand" };
    for (const failAt of [1, 2, 3, 4]) {
      let calls = 0;
      await assert.rejects(reviewPendingBrand(dir, input, build, { replace: async (from, to) => { if (++calls === failAt) throw new Error("injected write failure"); await rename(from, to); } }), /injected/);
      for (const [file, value] of entries) assert.equal(await readFile(join(dir, file), "utf8"), JSON.stringify(value));
    }
    await reviewPendingBrand(dir, input, build);
    assert.equal((await readPendingBrands(dir)).candidates[0].status, "APPROVED");
    await assert.rejects(reviewPendingBrand(dir, input, build), /already reviewed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("review UI defaults Pending, exposes history, and writes only after explicit action", async () => {
  const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  const fn = js.slice(js.indexOf("async function renderPendingBrandReview("), js.indexOf("async function renderBrandMasterSettings("));
  const pending = detect({ cafe24Brands: [newBrand] }).candidates[0];
  const reviewed = { ...pending, id: "reviewed", rawBrandName: "Reviewed name", status: "IGNORED", note: "Keep accounting", approvalAction: "IGNORE" };
  const filter = { value: "PENDING" };
  const rows = { innerHTML: "" };
  const target = { isConnected: true, innerHTML: "", querySelector: selector => selector === "[data-pending-filter]" ? filter : rows };
  const writes = [];
  let reloads = 0;
  const render = runInNewContext(`${fn}; renderPendingBrandReview`, {
    $: () => target, getJson: async () => ({ candidates: [pending, reviewed] }),
    esc: value => String(value ?? "").replaceAll("<", "&lt;").replaceAll('"', "&quot;"), apiNum: Number,
    confirm: () => true, toast: () => {}, postJson: async (...args) => { writes.push(args); return { ok: true }; },
    renderBrandMasterSettings: async () => { reloads++; }
  });
  await render(canonical.brands);
  assert.match(target.innerHTML, /신규 브랜드 검토 1/);
  assert.match(rows.innerHTML, /New Brand/);
  assert.doesNotMatch(rows.innerHTML, /Reviewed name/);
  assert.equal(writes.length, 0, "GET/render must not refresh or approve");
  filter.value = "REVIEWED"; filter.onchange();
  assert.match(rows.innerHTML, /Reviewed name/);
  assert.match(rows.innerHTML, /Keep accounting/);
  assert.doesNotMatch(rows.innerHTML, /data-pending-action=/);
  filter.value = "PENDING"; filter.onchange();
  const row = { dataset: { pendingId: pending.id }, querySelector: selector => ({ value: selector === "[data-pending-target]" ? "B1" : "Reviewed input" }) };
  const button = { dataset: { pendingAction: "LINK" }, closest: () => row };
  await target.onclick({ target: { closest: () => button } });
  assert.equal(writes[0][0], "/api/pending-brands/review");
  assert.equal(writes[0][1].canonicalBrandCode, "B1");
  assert.equal(reloads, 1, "successful action reloads canonical targets and pending rows");
  button.dataset = {};
  await target.onclick({ target: { closest: () => button } });
  assert.equal(writes[1][0], "/api/pending-brands/refresh");
  assert.equal(reloads, 2);
});

test("all existing read consumers use the pure reader; no seed write or active mutation remains", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const reader = source.split("async function readBrandMasterWithSeed() {")[1].split("async function saveBrandMasterUpdates")[0];
  assert.doesNotMatch(reader, /writeBrandMasterFile|writeJsonAtomic|fetchCafe24BrandList|active\s*[:=]\s*false/);
  for (const [start, end] of [["async function buildBrandSalesDiagnostics", "async function buildPromotionSummary"], ["async function buildPromotionSummary", "export async function buildCanonicalTotalSales"]]) {
    const body = source.split(start)[1].split(end)[0];
    assert.match(body, /readBrandMasterWithSeed\(\)/);
    assert.doesNotMatch(body, /writeBrandMasterFile\(/);
  }
});
