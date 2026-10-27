import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { mirrorProductionBrandPolicy, replaceFilesTogether, runEcountSyncAndPublish, runMirrorOnly, MIRROR_FILES } from "../scripts/run-ecount-product-sync-and-publish.mjs";
import { syncEcountInventory } from "../scripts/sync-ecount-inventory.mjs";
import { buildBrandSourcingMaster, loadInputs } from "../scripts/build-brand-sourcing-master.mjs";

const env = { ECOUNT_COM_CODE: "c", ECOUNT_USER_ID: "u", ECOUNT_API_CERT_KEY: "k" };
// IN 500 / OUT 1000 is not the 30% consignment signal, so every brand here sources as WHOLESALE.
const rows = [
  { PROD_CD: "AZV001", PROD_DES: "AZVA / Rest Stop Hoodie - Vintage Black" },
  { PROD_CD: "FUT001", PROD_DES: "FUTURE BRAND / Field Coat" },
  { PROD_CD: "EXP001", PROD_DES: "EXPLICIT ONE / Tee" }
];
function ecount() {
  const sorted = rows.map((r) => ({ IN_PRICE: "500", OUT_PRICE: "1000", ...r })).sort((a, b) => (a.PROD_CD < b.PROD_CD ? -1 : 1));
  return async (url, body) => {
    if (url.includes("/Zone")) return { httpStatus: 200, body: { Data: { ZONE: "AC" } } };
    if (url.includes("/OAPILogin")) return { httpStatus: 200, body: { Data: { Datas: { SESSION_ID: "s-1234" } } } };
    if (url.includes("GetBasicProductsList")) return { httpStatus: 200, body: { Data: { Result: sorted.filter((r) => !body.FROM_PROD_CD || (r.PROD_CD >= body.FROM_PROD_CD && r.PROD_CD <= body.TO_PROD_CD)) } } };
    return { httpStatus: 200, body: { Data: { Result: [] } } };
  };
}

const brand = (code, name) => ({ brand_code: code, brand_name: name, active: true, name_aliases: [], nameSource: "confirmed" });
const explicitPolicy = { brand_code: "B0000EXP", canonical_brand_name: "EXPLICIT ONE", source_brand_name: "EXPLICIT ONE", resolution_status: "RESOLVED", sourcing_type: "WHOLESALE", stylist_discount_percent: 15, discount_status: "STANDARD", note: null, product_rules: [] };

// Local mirror before the fix: knows only EXPLICIT ONE (explicit 15%).
async function localWork() {
  const dir = await mkdtemp(join(tmpdir(), "brand-mirror-local-"));
  for (const sub of ["ecount-inventory", "ecount-sales", "intelligence"]) await mkdir(join(dir, sub));
  for (const name of ["product-registry.json", "product-registry-review-queue.json"]) await writeFile(join(dir, name), JSON.stringify({ entries: [] }));
  await syncEcountInventory({ env, outDir: join(dir, "ecount-inventory"), request: ecount(), delayMs: 0 });
  const master = { updatedAt: "2026-10-06T00:00:00.000Z", brands: [brand("B0000EXP", "EXPLICIT ONE")] };
  await writeFile(join(dir, "brand-master.json"), JSON.stringify(master));
  await writeFile(join(dir, "brand-commercial-policy.json"), JSON.stringify({ schemaVersion: 1, source: { file: "seed" }, summary: { total: 1 }, policies: [explicitPolicy] }));
  await writeFile(join(dir, "brand-sourcing-master.json"), JSON.stringify(buildBrandSourcingMaster({ ...(await loadInputs(dir)), brandMaster: master })));
  return dir;
}

// Production canonical: AZVA and a brand the extension has never seen were onboarded there.
// /api/brand-master answers like the real route (brand list + sourcing_type from Production's sourcing).
async function fakeProduction(local, { brands = [brand("B0000EXP", "EXPLICIT ONE"), brand("B0000BEL", "AZVA"), brand("B0000FUT", "FUTURE BRAND")], tweak = (x) => x, fail = null } = {}) {
  const master = { updatedAt: "2026-10-09T10:09:55.000Z", brands };
  const sourcing = new Map(buildBrandSourcingMaster({ ...(await loadInputs(local)), brandMaster: master }).brands.map((b) => [b.brand_code, b.sourcing_type]));
  const calls = [];
  const production = async (method, path) => {
    calls.push(`${method} ${path}`);
    if (fail === path) throw Object.assign(new Error(`GET ${path} → HTTP 502`), { status: 502 });
    if (path === "/api/brand-master") return tweak({ ok: true, updatedAt: master.updatedAt, source: "brand-master", brandCount: brands.length, brands: brands.map((b) => ({ ...b, sourcing_type: sourcing.get(b.brand_code) || null })) });
    if (path === "/api/intelligence/commercial-policy") return tweak({ ok: true, count: 1, summary: { total: 1, resolved: 1 }, policies: [explicitPolicy] });
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { production, calls };
}

const snapshot = async (dir) => Object.fromEntries(await Promise.all(MIRROR_FILES.map(async (f) => [f, await readFile(join(dir, f), "utf8")])));
const leftovers = async (dir) => (await readdir(dir)).filter((f) => /\.mirror-/.test(f));

// The real local API the ECOUNT extension calls, on the mirrored work dir.
async function withIntelligence(dir, run) {
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../intelligence-service.mjs", import.meta.url))], { cwd: dir, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WORK_DIR: dir, INTELLIGENCE_HOST: "127.0.0.1", INTELLIGENCE_PORT: String(port) } });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("intelligence start timeout")), 15000);
      child.stdout.on("data", (c) => { if (String(c).includes("running at")) { clearTimeout(timer); resolve(); } });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`exit ${code}`)); });
    });
    const policy = (name, product = "") => new Promise((resolve, reject) => {
      request({ host: "127.0.0.1", port, path: `/api/intelligence/commercial-policy?name=${encodeURIComponent(name)}${product ? `&product_name=${encodeURIComponent(product)}` : ""}` }, (res) => {
        let body = ""; res.on("data", (c) => { body += c; }); res.on("end", () => resolve(JSON.parse(body)));
      }).on("error", reject).end();
    });
    await run(policy);
  } finally {
    child.kill("SIGTERM");
  }
}

// What the extension shows (content.js: effective = policy || fallback; discount = effective_discount_percent ?? stylist).
const extensionView = (data) => {
  const effective = data?.policy || data?.fallback || null;
  if (!effective) return "브랜드 정책 확인 필요";
  return { status: data.policy_status, discount: data.effective_policy?.effective_discount_percent ?? effective.stylist_discount_percent };
};

test("Production-only brands (AZVA, any new brand) resolve locally after the mirror; explicit stays first; unknown stays unresolved", { timeout: 60000 }, async () => {
  const local = await localWork();
  const prod = await fakeProduction(local);
  try {
    await withIntelligence(local, async (policy) => {
      assert.equal(extensionView(await policy("AZVA", "Rest Stop Hoodie - Vintage Black")), "브랜드 정책 확인 필요", "before mirror");
      assert.equal(extensionView(await policy("FUTURE BRAND")), "브랜드 정책 확인 필요");
      const mirrored = await mirrorProductionBrandPolicy({ workDir: local, production: prod.production });
      assert.deepEqual(mirrored, { files: [...MIRROR_FILES], brands: 3, policies: 1 });
      assert.deepEqual(prod.calls, ["GET /api/brand-master", "GET /api/intelligence/commercial-policy"], "read-only Production calls");
      const azva = await policy("AZVA", "Rest Stop Hoodie - Vintage Black");
      assert.equal(azva.brand.brandId, "B0000BEL");
      assert.equal(azva.fallback.sourcing_type, "WHOLESALE");
      assert.deepEqual(extensionView(azva), { status: "SOURCING_DEFAULT", discount: 20 });
      const future = await policy("FUTURE BRAND", "Field Coat");
      assert.equal(future.brand.brandId, "B0000FUT");
      assert.deepEqual(extensionView(future), { status: "SOURCING_DEFAULT", discount: 20 }, "no brand-specific code anywhere");
      assert.deepEqual(extensionView(await policy("EXPLICIT ONE", "Tee")), { status: "EXPLICIT_POLICY", discount: 15 }, "explicit policy beats the sourcing default");
      assert.equal(extensionView(await policy("NOT A BRAND")), "브랜드 정책 확인 필요", "unknown brand gets no invented discount");
    });
    const master = JSON.parse(await readFile(join(local, "brand-master.json"), "utf8"));
    assert.equal(master.brands.some((b) => "sourcing_type" in b), false, "route-only field is not written into brand-master");
    assert.equal(JSON.parse(await readFile(join(local, "brand-commercial-policy.json"), "utf8")).schemaVersion, 1, "local policy metadata kept");
    assert.deepEqual(await leftovers(local), []);
  } finally {
    await rm(local, { recursive: true, force: true });
  }
});

test("fail closed: Production error, malformed snapshot or sourcing mismatch leave all local files untouched", async () => {
  const local = await localWork();
  const before = await snapshot(local);
  const cases = [
    [{ fail: "/api/intelligence/commercial-policy" }, /HTTP 502/],
    [{ tweak: (body) => (body.brands ? { ...body, brands: [...body.brands, body.brands[0]], brandCount: body.brands.length + 1 } : body) }, /중복/],
    [{ tweak: (body) => (body.policies ? { ...body, count: 2 } : body) }, /commercial policy/],
    [{ tweak: (body) => (body.brands ? { ...body, brandCount: 99 } : body) }, /개수/],
    [{ tweak: (body) => (body.brands ? { ...body, brands: body.brands.map((b) => (b.brand_code === "B0000FUT" ? { ...b, sourcing_type: "CONSIGNMENT" } : b)) } : body) }, /sourcing이 Production과 다릅니다 \(1\): B0000FUT/]
  ];
  for (const [options, error] of cases) {
    const prod = await fakeProduction(local, options);
    await assert.rejects(mirrorProductionBrandPolicy({ workDir: local, production: prod.production }), error);
    assert.deepEqual(await snapshot(local), before);
    assert.deepEqual(await leftovers(local), []);
  }
  await rm(local, { recursive: true, force: true });
});

test("multi-file replace is all-or-nothing: a failed second rename restores the first file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brand-mirror-tx-"));
  await writeFile(join(dir, "a.json"), '{"v":1}');
  await writeFile(join(dir, "b.json"), '{"v":1}');
  let renames = 0;
  const { rename } = await import("node:fs/promises");
  const renameFile = async (from, to) => { renames += 1; if (renames === 2) throw new Error("disk full"); return rename(from, to); };
  await assert.rejects(replaceFilesTogether(dir, { "a.json": { v: 2 }, "b.json": { v: 2 } }, { renameFile }), /disk full/);
  assert.equal(await readFile(join(dir, "a.json"), "utf8"), '{"v":1}');
  assert.equal(await readFile(join(dir, "b.json"), "utf8"), '{"v":1}');
  assert.deepEqual(await leftovers(dir), []);
  await replaceFilesTogether(dir, { "a.json": { v: 2 }, "b.json": { v: 2 } });
  assert.deepEqual([JSON.parse(await readFile(join(dir, "a.json"), "utf8")).v, JSON.parse(await readFile(join(dir, "b.json"), "utf8")).v], [2, 2]);
  await rm(dir, { recursive: true, force: true });
});

// Runner stage 6: only after a verified publish, inside the shared lock; a mirror failure fails the run.
async function runnerWith(mirror, { verifyCount } = {}) {
  const local = await localWork();
  const prodCalls = [];
  const production = async (method, path) => {
    prodCalls.push(`${method} ${path}`);
    if (path.startsWith("/api/pending-brands/refresh")) return { ok: true, candidates: [], onboarding: [], provenance: { ecountProductSource: "ecount-inventory/product-master.json", ecountProductCount: verifyCount ?? 3, ecountProductsAt: "2026-10-09T10:09:49.828Z" } };
    if (path === "/api/brand-master") return { brands: [] };
    if (path === "/api/brands/new?coverage=0") return { count: 0, brands: [] };
    if (path === "/api/pending-brands") return { ok: true, candidates: [] };
    throw new Error(`unexpected ${path}`);
  };
  let lockHeld = null;
  const result = await runEcountSyncAndPublish({ workDir: local, verifyAttempts: 1, production,
    sync: () => syncEcountInventory({ env, outDir: join(local, "ecount-inventory"), request: ecount(), delayMs: 0 }),
    upload: async () => {},
    mirror: async () => { lockHeld = (await readdir(join(local, "ecount-inventory"))).includes(".sync-publish.lock"); return mirror(); } });
  await rm(local, { recursive: true, force: true });
  return { result, lockHeld };
}

test("runner: mirror runs after verification inside the lock; verification failure skips it; mirror failure fails the run", async () => {
  const ok = await runnerWith(async () => ({ files: [...MIRROR_FILES], brands: 3, policies: 1 }));
  assert.equal(ok.result.ok, true);
  assert.deepEqual(ok.result.mirror, { ok: true, files: [...MIRROR_FILES], brands: 3, policies: 1 });
  assert.equal(ok.lockHeld, true, "shared file lock still held");
  let called = false;
  const unverified = await runnerWith(async () => { called = true; return {}; }, { verifyCount: 999 });
  assert.equal(unverified.result.ok, false);
  assert.equal(called, false, "no mirror after a failed verification");
  assert.equal(unverified.result.mirror, undefined);
  const broken = await runnerWith(async () => { throw new Error("sourcing이 Production과 다릅니다 (1): X"); });
  assert.equal(broken.result.ok, false, "a mirror failure is never reported as success");
  assert.deepEqual(broken.result.mirror, { ok: false, error: "sourcing이 Production과 다릅니다 (1): X" });
  assert.match(broken.result.verification.failures.at(-1), /^Local brand mirror: /);
});

test("wiring: the shared runner (auto 04:00, button, .command) mirrors with the same Production reader", async () => {
  const source = await readFile(new URL("../scripts/run-ecount-product-sync-and-publish.mjs", import.meta.url), "utf8");
  assert.match(source, /mirror: \(\) => mirrorProductionBrandPolicy\(\{ workDir, production \}\)/);
  assert.match(await readFile(new URL("../server.mjs", import.meta.url), "utf8"), /runPublish: \(\) => runEcountRunner\(\{ log: \(line\) => console\.log\(`\[ECOUNT_AUTO_SYNC\] \$\{line\}`\) \}\)/);
});

test("--mirror-only: Production GETs only, no ECOUNT/upload/refresh; failures keep local files; lock shared", async () => {
  const local = await localWork();
  const before = await snapshot(local);
  // Fetch failure and sourcing mismatch: nothing replaced, failure reported.
  for (const options of [{ fail: "/api/brand-master" }, { tweak: (body) => (body.brands ? { ...body, brands: body.brands.map((b) => (b.brand_code === "B0000BEL" ? { ...b, sourcing_type: "CONSIGNMENT" } : b)) } : body) }]) {
    const prod = await fakeProduction(local, options);
    const failed = await runMirrorOnly({ workDir: local, production: prod.production });
    assert.equal(failed.ok, false);
    assert.equal(failed.mirror.ok, false);
    assert.deepEqual(await snapshot(local), before);
  }
  const prod = await fakeProduction(local);
  const result = await runMirrorOnly({ workDir: local, production: prod.production });
  assert.equal(result.ok, true);
  assert.deepEqual(result.mirror, { ok: true, files: [...MIRROR_FILES], brands: 3, policies: 1 });
  assert.deepEqual(prod.calls, ["GET /api/brand-master", "GET /api/intelligence/commercial-policy"], "no refresh, no upload, no write");
  assert.ok(JSON.parse(await readFile(join(local, "brand-master.json"), "utf8")).brands.some((b) => b.brand_code === "B0000BEL"));
  // The same file lock as a full run: a held lock refuses the mirror.
  await writeFile(join(local, "ecount-inventory", ".sync-publish.lock"), JSON.stringify({ pid: process.pid, startedAt: "now" }));
  await assert.rejects(runMirrorOnly({ workDir: local, production: prod.production }), /이미 실행 중/);
  await rm(local, { recursive: true, force: true });
});

test("--mirror-only wiring: CLI flag routes to runMirrorOnly before any ECOUNT/upload step; normal runs unchanged", async () => {
  const source = await readFile(new URL("../scripts/run-ecount-product-sync-and-publish.mjs", import.meta.url), "utf8");
  assert.match(source, /mirrorOnly: process\.argv\.includes\("--mirror-only"\)/);
  const entry = source.slice(source.indexOf("export async function runEcountProductSyncFromEnv"));
  assert.ok(entry.indexOf("if (mirrorOnly)") < entry.indexOf("runEcountSyncAndPublish("), "mirror-only returns before the full runner");
  assert.match(source, /if \(method !== "GET"\) throw new Error\(`mirror-only: Production/);
});
