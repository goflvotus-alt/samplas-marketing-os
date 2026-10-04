// One-click daily ECOUNT refresh, run on the office Mac (ECOUNT only accepts registered IPs,
// so ECOUNT is called locally and Render only receives verified snapshot files):
//   1. local full ECOUNT sync (atomic, aborts on any failure)  2. verify product-master
//   3. upload latest/diagnostic/product-master to Render       4. Production pending refresh,
//   NEW-only AUTO_SAFE (enforced server-side)                 5. read-only Production checks.
// Usage: node scripts/run-ecount-product-sync-and-publish.mjs [--dry-run]
// --dry-run: no ECOUNT call, no upload, Production refresh with ?dryRun=1 (no writes).
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { syncEcountInventory } from "./sync-ecount-inventory.mjs";
import { readEcountProductMaster, PRODUCT_MASTER_FILE } from "./ecount-product-master.mjs";
import { loadEnv, uploadWorkSnapshots, renderBaseUrl, renderAuthHeaders } from "./upload-work-snapshots-to-render.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLISH_FILES = Object.freeze(["ecount-inventory/latest.json", "ecount-inventory/diagnostic.json", PRODUCT_MASTER_FILE]);
const REVIEW_REASON = "INACTIVE_CODE_REUSED";

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
async function readJsonOrNull(file) {
  try { return await readJson(file); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

// Single local run at a time; a lock left by a dead process is cleared.
async function acquireLock(workDir) {
  const file = join(workDir, "ecount-inventory", ".sync-publish.lock");
  await mkdir(dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { flag: "wx" });
      return () => unlink(file).catch(() => {});
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const lock = await readJsonOrNull(file);
      let alive = false;
      try { process.kill(lock?.pid, 0); alive = true; } catch {}
      if (alive) throw new Error(`이미 실행 중입니다 (pid ${lock.pid}, ${lock.startedAt}).`);
      await unlink(file).catch(() => {});
    }
  }
  throw new Error("실행 잠금을 얻지 못했습니다.");
}

export function summarizePending(refresh) {
  const pending = (refresh?.candidates || []).filter((c) => c.status === "PENDING");
  const approved = (refresh?.onboarding || []).filter((e) => e.ok).map((e) => ({ brandCode: e.candidate?.canonicalBrandCode, brandName: e.candidate?.rawBrandName, action: e.candidate?.approvalAction }));
  const failed = (refresh?.onboarding || []).filter((e) => !e.ok).map((e) => ({ id: e.id, error: e.error }));
  const needsReview = pending.filter((c) => c.reviewReason === REVIEW_REASON).map((c) => ({ brandName: c.rawBrandName, cafe24Code: c.sourceBrandCode, reason: "inactive code reassignment" }));
  const blocked = {};
  for (const c of pending) {
    if (c.reviewReason === REVIEW_REASON) continue;
    const key = c.collabCandidates?.length ? "COLLABORATION" : c.reviewReason || "UNRESOLVED";
    blocked[key] = (blocked[key] || 0) + 1;
  }
  return { approved, failed, needsReview, blocked };
}

// sync/upload/production are injected so tests run without ECOUNT or Render.
export async function runEcountSyncAndPublish({ workDir, sync, upload, production, dryRun = false, log = () => {} }) {
  const result = { ok: false, dryRun, stage: "start" };
  const release = await acquireLock(workDir);
  try {
    const before = await readJsonOrNull(join(workDir, PRODUCT_MASTER_FILE));
    result.before = { products: before?.totalProducts ?? null };

    result.stage = "sync";
    if (dryRun) log("[1/5] DRY RUN: ECOUNT 호출 생략, 현재 로컬 canonical 사용");
    else {
      log("[1/5] ECOUNT 전체 상품 sync…");
      result.sync = await summarizeSync(await sync());
    }

    result.stage = "verify-product-master";
    log("[2/5] product-master 검증…");
    const master = await readEcountProductMaster(workDir); // throws on an invalid product-master
    const meta = await readJson(join(workDir, PRODUCT_MASTER_FILE));
    const diagnostic = await readJson(join(workDir, "ecount-inventory/diagnostic.json"));
    const latest = await readJson(join(workDir, "ecount-inventory/latest.json"));
    if (master?.source !== PRODUCT_MASTER_FILE || master.complete !== true) throw new Error("product-master.json이 없거나 완전하지 않습니다.");
    if (result.sync && meta.totalProducts !== result.sync.productCount) throw new Error(`product-master 상품 수 불일치: ${meta.totalProducts} ≠ sync ${result.sync.productCount}`);
    if (!Array.isArray(latest) || latest.length !== meta.totalProducts) throw new Error("latest.json 상품 수가 product-master와 다릅니다.");
    result.productMaster = { totalProducts: meta.totalProducts, complete: meta.complete, firstProdCd: meta.firstProdCd, lastProdCd: meta.lastProdCd, pageCount: meta.pageCount, duplicateCount: meta.duplicateCount, fetchedAt: meta.fetchedAt };
    result.newProducts = before?.totalProducts == null || dryRun ? null : meta.totalProducts - before.totalProducts;

    result.stage = "upload";
    log(`[3/5] Production 업로드: ${PUBLISH_FILES.join(", ")}${dryRun ? " (DRY RUN: 전송 생략)" : ""}`);
    result.upload = dryRun ? { dryRun: true, files: [...PUBLISH_FILES] } : await upload([...PUBLISH_FILES]);

    result.stage = "onboarding";
    log("[4/5] Production pending refresh (NEW만 자동 승인)…");
    try {
      const refresh = await production("POST", `/api/pending-brands/refresh${dryRun ? "?dryRun=1" : ""}`, dryRun ? {} : { autoApprove: true });
      result.onboarding = { ...summarizePending(refresh), provenance: refresh.provenance || null };
      const source = refresh.provenance?.ecountProductSource;
      if (source !== PRODUCT_MASTER_FILE || refresh.provenance?.ecountProductCount !== meta.totalProducts) {
        result.onboarding.warning = `Production이 읽은 상품 마스터가 다릅니다: ${source} / ${refresh.provenance?.ecountProductCount}`;
      }
    } catch (error) {
      // Inventory is already published and valid; only onboarding is reported as failed.
      result.onboarding = { error: String(error?.message || error) };
    }

    result.stage = "verify-production";
    log("[5/5] Production 확인(읽기 전용)…");
    result.verification = {};
    for (const [key, path, pick] of [
      ["inventory", "/api/inventory/overview?limit=1", (b) => ({ itemsTotal: b.itemsTotal, generatedAt: b.generatedAt, matchesLocal: b.itemsTotal === latest.length && b.generatedAt === diagnostic.finishedAt })],
      ["brandMaster", "/api/brand-master", (b) => ({ brands: b.brands?.length ?? null, updatedAt: b.updatedAt ?? null })],
      ["newBrands", "/api/brands/new", (b) => ({ count: b.count, brands: (b.brands || []).map((x) => x.brandName) })]
    ]) {
      try { result.verification[key] = pick(await production("GET", path)); }
      catch (error) { result.verification[key] = { error: String(error?.message || error) }; }
    }
    result.ok = !result.onboarding.error;
    result.stage = "done";
    return result;
  } catch (error) {
    result.error = String(error?.message || error);
    return result;
  } finally {
    await release();
  }
}

function summarizeSync(syncResult) {
  return { productCount: syncResult.productCount, pageCount: syncResult.productPagination?.pageCount ?? null, duplicateCount: syncResult.productPagination?.duplicateCount ?? null, inventoryCount: syncResult.inventoryCount ?? null };
}

export function formatSummary(r) {
  const n = (v) => (typeof v === "number" ? v.toLocaleString("en-US") : "-");
  const lines = [];
  if (r.error) {
    lines.push(`ECOUNT SYNC FAILED (${r.stage})`, "", r.error, "", r.stage === "sync" || r.stage === "verify-product-master" || r.stage === "upload"
      ? "Production에는 아무것도 반영하지 않았습니다." : "");
    return lines.join("\n").trim();
  }
  lines.push(r.dryRun ? "ECOUNT SYNC DRY RUN COMPLETE (Production 변경 없음)" : r.ok ? "ECOUNT SYNC COMPLETE" : "ECOUNT SYNC COMPLETE — ONBOARDING FAILED", "");
  lines.push(`Products: ${n(r.productMaster?.totalProducts)} (pages ${r.productMaster?.pageCount}, duplicates ${r.productMaster?.duplicateCount}, ${r.productMaster?.firstProdCd} ~ ${r.productMaster?.lastProdCd})`);
  if (r.newProducts !== null && r.newProducts !== undefined) lines.push(`New products: ${r.newProducts >= 0 ? "+" : ""}${r.newProducts}`);
  const o = r.onboarding || {};
  if (o.error) lines.push("", `Onboarding error: ${o.error}`, "(상품 마스터 업로드는 반영된 상태입니다.)");
  else {
    lines.push(`New brands onboarded: ${o.approved.length}${r.dryRun ? " (dry run)" : ""}`);
    if (o.approved.length) lines.push("", "Approved:", ...o.approved.map((a) => `- ${a.brandName} (${a.brandCode})`));
    if (o.failed.length) lines.push("", "Failed:", ...o.failed.map((f) => `- ${f.id}: ${f.error}`));
    if (o.needsReview.length) lines.push("", "Needs review:", ...o.needsReview.map((c) => `- ${c.brandName} — ${c.reason}`));
    const blocked = Object.entries(o.blocked);
    if (blocked.length) lines.push("", "Blocked:", ...blocked.map(([reason, count]) => `- ${reason.toLowerCase().replace(/_/g, " ")} ${count}`));
    if (o.warning) lines.push("", `Warning: ${o.warning}`);
  }
  const v = r.verification || {};
  lines.push("", `Production inventory: ${v.inventory?.error || `${n(v.inventory?.itemsTotal)} items, ${v.inventory?.matchesLocal ? "로컬과 일치" : "로컬과 불일치"}`}`);
  lines.push(`Production NEW BRANDS (90일): ${v.newBrands?.error || `${v.newBrands?.count} — ${(v.newBrands?.brands || []).join(", ")}`}`);
  return lines.join("\n");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const env = await loadEnv();
  const workDir = join(root, "work");
  const production = async (method, path, body) => {
    const response = await fetch(`${renderBaseUrl(env)}${path}`, { method, headers: renderAuthHeaders(env), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 300) }; }
    if (!response.ok || parsed.error) throw new Error(`${method} ${path} → ${response.status} ${parsed.error || parsed.raw || ""}`.trim());
    return parsed;
  };
  const result = await runEcountSyncAndPublish({
    workDir,
    dryRun,
    sync: () => syncEcountInventory({ env, outDir: join(workDir, "ecount-inventory") }),
    upload: (relativePaths) => uploadWorkSnapshots({ relativePaths, overwrite: true, env, workDir }),
    production,
    log: (line) => console.log(line)
  });
  console.log(`\n${formatSummary(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
