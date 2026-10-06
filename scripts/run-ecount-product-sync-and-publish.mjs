// One-click daily ECOUNT refresh, run on the office Mac (ECOUNT only accepts registered IPs,
// so ECOUNT is called locally and Render only receives verified snapshot files):
//   1. local full ECOUNT sync (atomic, aborts on any failure)  2. verify product-master
//   3. upload latest/diagnostic/product-master to Render       4. Production pending refresh,
//   NEW-only AUTO_SAFE (enforced server-side)                 5. lightweight read-only checks
//   (refresh provenance, brand-master, brands/new, pending-brands). /api/inventory/overview is
//   never called here: its full 14,746-row computation restarted the Render instance.
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
// One ~6.5MB request restarted the Render free instance (2026-10-04); these sizes are proven.
// product-master goes last so Production only switches its brand evidence after the inventory.
export const PUBLISH_BATCHES = Object.freeze([["ecount-inventory/latest.json", "ecount-inventory/diagnostic.json"], [PRODUCT_MASTER_FILE]]);
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

// Render answers 502/503/504 (or drops the connection) for a moment right after a heavy
// refresh; those are retried. Auth errors and data mismatches are never retried.
const RETRYABLE_STATUS = new Set([502, 503, 504]);
export const isRetryableProductionError = (error) => (error?.status ? RETRYABLE_STATUS.has(error.status) : true);

export async function withProductionRetry(task, { attempts = 3, delayMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onRetry = () => {} } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try { return await task(); }
    catch (error) {
      if (attempt >= attempts || !isRetryableProductionError(error)) throw error;
      onRetry(attempt, error);
      await sleep(delayMs);
    }
  }
}

// Short, HTML-free message for users; the raw body stays on error.body for debugging.
export function productionErrorMessage(error) {
  if (error?.status) return `Production 확인 실패 (HTTP ${error.status})`;
  return `Production 연결 실패 (${String(error?.message || error).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)})`;
}

export function summarizePending(refresh) {
  const pending = (refresh?.candidates || []).filter((c) => c.status === "PENDING");
  const approved = (refresh?.onboarding || []).filter((e) => e.ok).map((e) => ({ brandCode: e.candidate?.canonicalBrandCode, brandName: e.candidate?.rawBrandName, action: e.candidate?.approvalAction }));
  const failed = (refresh?.onboarding || []).filter((e) => !e.ok).map((e) => ({ id: e.id, error: e.error }));
  const needsReview = pending.filter((c) => c.reviewReason === REVIEW_REASON || c.requiresIdentitySplit).map((c) => ({ brandName: c.rawBrandName, cafe24Code: c.sourceBrandCode,
    reason: c.requiresIdentitySplit ? `code reuse — identity split required (${c.codeReuseClassification}, from ${c.suggestedEffectiveMonth || "review"})` : "inactive code reassignment" }));
  const blocked = {};
  for (const c of pending) {
    if (c.reviewReason === REVIEW_REASON || c.requiresIdentitySplit) continue;
    const key = c.collabCandidates?.length ? "COLLABORATION" : c.reviewReason || "UNRESOLVED";
    blocked[key] = (blocked[key] || 0) + 1;
  }
  return { approved, failed, needsReview, blocked };
}

// sync/upload/production are injected so tests run without ECOUNT or Render.
export async function runEcountSyncAndPublish({ workDir, sync, upload, production, dryRun = false, log = () => {}, verifyAttempts = 3, retryDelayMs = 5000, sleep }) {
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
    await readJson(join(workDir, "ecount-inventory/diagnostic.json")); // must exist and parse before upload
    const latest = await readJson(join(workDir, "ecount-inventory/latest.json"));
    if (master?.source !== PRODUCT_MASTER_FILE || master.complete !== true) throw new Error("product-master.json이 없거나 완전하지 않습니다.");
    if (result.sync && meta.totalProducts !== result.sync.productCount) throw new Error(`product-master 상품 수 불일치: ${meta.totalProducts} ≠ sync ${result.sync.productCount}`);
    if (!Array.isArray(latest) || latest.length !== meta.totalProducts) throw new Error("latest.json 상품 수가 product-master와 다릅니다.");
    result.productMaster = { totalProducts: meta.totalProducts, complete: meta.complete, firstProdCd: meta.firstProdCd, lastProdCd: meta.lastProdCd, pageCount: meta.pageCount, duplicateCount: meta.duplicateCount, fetchedAt: meta.fetchedAt };
    result.newProducts = before?.totalProducts == null || dryRun ? null : meta.totalProducts - before.totalProducts;

    result.stage = "upload";
    log(`[3/5] Production 업로드: ${PUBLISH_FILES.join(", ")}${dryRun ? " (DRY RUN: 전송 생략)" : ""}`);
    result.upload = { dryRun, uploaded: [] };
    if (!dryRun) {
      for (const batch of PUBLISH_BATCHES) {
        await upload([...batch]);
        result.upload.uploaded.push(...batch);
      }
    }

    result.stage = "onboarding";
    log("[4/5] Production pending refresh (NEW만 자동 승인)…");
    try {
      const refresh = await production("POST", `/api/pending-brands/refresh${dryRun ? "?dryRun=1" : ""}`, dryRun ? {} : { autoApprove: true });
      result.onboarding = { ...summarizePending(refresh), provenance: refresh.provenance || null };
    } catch (error) {
      // Inventory is already published and valid; only onboarding is reported as failed.
      result.onboarding = { error: String(error?.message || error) };
    }

    result.stage = "verify-production";
    log("[5/5] Production 반영 확인 중…");
    const provenance = result.onboarding.provenance;
    const failures = [];
    if (!result.onboarding.error) {
      // Proof that Production now reads exactly the uploaded product-master.
      if (provenance?.ecountProductSource !== PRODUCT_MASTER_FILE) failures.push(`Production 상품 마스터 출처가 다릅니다: ${provenance?.ecountProductSource ?? "없음"}`);
      if (provenance?.ecountProductCount !== meta.totalProducts) failures.push(`Production 상품 수 ${provenance?.ecountProductCount ?? "없음"} ≠ 로컬 ${meta.totalProducts}`);
      if (!provenance?.ecountProductsAt) failures.push("Production 상품 마스터 시각(ecountProductsAt)이 없습니다.");
    }
    result.verification = { provenance: { ok: failures.length === 0 && !result.onboarding.error, source: provenance?.ecountProductSource ?? null, count: provenance?.ecountProductCount ?? null, at: provenance?.ecountProductsAt ?? null } };
    for (const [key, path, pick] of [
      ["brandMaster", "/api/brand-master", (b) => ({ brands: b.brands?.length ?? null, updatedAt: b.updatedAt ?? null })],
      ["newBrands", "/api/brands/new?coverage=0", (b) => ({ count: b.count, brands: (b.brands || []).map((x) => x.brandName) })],
      ["pending", "/api/pending-brands", (b) => { const p = summarizePending({ candidates: b.candidates }); return { needsReview: p.needsReview, blocked: p.blocked }; }]
    ]) {
      try {
        result.verification[key] = pick(await withProductionRetry(() => production("GET", path), {
          attempts: verifyAttempts, delayMs: retryDelayMs, ...(sleep ? { sleep } : {}),
          onRetry: (attempt, error) => {
            result.verification.retries = (result.verification.retries || 0) + 1;
            log(`[5/5] Production 반영 확인 중 · 재시도 (시도 ${attempt + 1}/${verifyAttempts}, ${path}, ${error?.status ? `HTTP ${error.status}` : "연결 오류"})`);
          }
        }));
      } catch (error) {
        result.verification[key] = { error: productionErrorMessage(error) };
        failures.push(`${path}: ${result.verification[key].error}`);
      }
    }
    result.verification.failures = failures;
    result.ok = !result.onboarding.error && failures.length === 0;
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
    const partial = r.upload?.uploaded?.length;
    lines.push(`ECOUNT SYNC FAILED (${r.stage})`, "", r.error, "", partial
      ? `Production에 일부 파일만 반영됐습니다: ${r.upload.uploaded.join(", ")} (onboarding 미실행 — 다시 실행하세요)`
      : ["sync", "verify-product-master", "upload"].includes(r.stage) ? "Production에는 아무것도 반영하지 않았습니다." : "");
    return lines.join("\n").trim();
  }
  lines.push(r.onboarding?.error ? "ECOUNT SYNC COMPLETE — ONBOARDING FAILED" : !r.ok ? "ECOUNT SYNC — VERIFICATION FAILED" : r.dryRun ? "ECOUNT SYNC DRY RUN COMPLETE (Production 변경 없음)" : "ECOUNT SYNC COMPLETE", "");
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

  }
  const v = r.verification || {};
  lines.push("", `Production product master: ${v.provenance?.source ?? "-"} ${n(v.provenance?.count)} (${v.provenance?.at ?? "-"}) ${v.provenance?.ok ? "로컬과 일치" : "확인 실패"}`);
  lines.push(`Production brand master: ${v.brandMaster?.error || `${n(v.brandMaster?.brands)} brands`}`);
  lines.push(`Production NEW BRANDS (90일): ${v.newBrands?.error || `${v.newBrands?.count} — ${(v.newBrands?.brands || []).join(", ")}`}`);
  if (v.failures?.length) lines.push("", "Verification failed:", ...v.failures.map((f) => `- ${f}`));
  return lines.join("\n");
}

async function main() {
  const { result, summary } = await runEcountProductSyncFromEnv({ dryRun: process.argv.includes("--dry-run"), log: (line) => console.log(line) });
  console.log(`\n${summary}\n`);
  if (!result.ok) process.exitCode = 1;
}

// Wiring shared by the CLI/.command and the local Marketing OS helper route.
export async function runEcountProductSyncFromEnv({ dryRun = false, log = () => {} } = {}) {
  const env = await loadEnv();
  const workDir = join(root, "work");
  const production = async (method, path, body) => {
    const response = await fetch(`${renderBaseUrl(env)}${path}`, { method, headers: renderAuthHeaders(env), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 300) }; }
    if (!response.ok || parsed.error) {
      // Never put an HTML error page into the message; keep it on .body for debugging only.
      const detail = parsed.error ? ` ${String(parsed.error).slice(0, 200)}` : "";
      throw Object.assign(new Error(`${method} ${path} → HTTP ${response.status}${detail}`), { status: response.status, body: text.slice(0, 2000) });
    }
    return parsed;
  };
  const result = await runEcountSyncAndPublish({
    workDir,
    dryRun,
    sync: () => syncEcountInventory({ env, outDir: join(workDir, "ecount-inventory") }),
    upload: (relativePaths) => uploadWorkSnapshots({ relativePaths, overwrite: true, env, workDir }),
    production,
    log
  });
  return { result, summary: formatSummary(result) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
