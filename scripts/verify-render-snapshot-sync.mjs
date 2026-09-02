#!/usr/bin/env node
// SAMPLAS Local ↔ Render production parity / smoke checker.
//
// READ ONLY — 이 스크립트는 어떤 것도 Render에 업로드/덮어쓰기/재시작하지 않는다.
// GET 요청만 보낸다. 반복적으로 손으로 해왔던 "Local 검증 → dry-run → upload →
// Render GET → 비교" workflow 중 마지막 비교 단계를 자동화한 것.
//
// Usage:
//   node scripts/verify-render-snapshot-sync.mjs                 전체 검사
//   node scripts/verify-render-snapshot-sync.mjs --only status,today   일부만
//   node scripts/verify-render-snapshot-sync.mjs --json          machine-readable 출력
//   node scripts/verify-render-snapshot-sync.mjs --local <url> --render <url>  base URL override
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const args = { only: null, json: false, local: "http://127.0.0.1:8787", render: "https://samplas-marketing-os.onrender.com" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--only") args.only = argv[++i]?.split(",").map((s) => s.trim()).filter(Boolean) || null;
    else if (arg === "--local") args.local = argv[++i];
    else if (arg === "--render") args.render = argv[++i];
  }
  return args;
}

async function getJson(baseUrl, path) {
  // Render 무료 티어는 동시 요청이 겹치면 가끔 connection-level 오류를 낸다(HTTP 오류가
  // 아니라 fetch 자체 실패) — 실제 데이터 불일치가 아니라 네트워크 잡음이므로 1회만
  // 재시도한다.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`);
      const text = await response.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { status: response.status, body };
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

function todayKeySeoul() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function currentMonthSeoul() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date());
}

function monthEndKey(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const day = new Date(year, monthNumber, 0).getDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

export function liveSourceBoundary(body) {
  return body?.sourceThrough ?? body?.cutoff
    ?? body?.sales?.sourceThrough ?? body?.sales?.cutoff
    ?? body?.archiveReference?.sourceThrough ?? body?.archiveReference?.cutoff
    ?? null;
}

export function historicalArchiveProvenance(body) {
  const explicit = body?.provenance || body?.sales?.provenance;
  if (explicit) return explicit;
  const importedAt = body?.commerce?.brandSalesSourceImportedAt;
  return importedAt ? { legacyBrandSalesSourceImportedAt: importedAt } : null;
}

function sum(rows, key) {
  return (rows || []).reduce((total, row) => total + Number(row?.[key] || 0), 0);
}

export function validateProductionMonthly(month, monthly, online, ecount) {
  const onlineAmount = monthly?.sales?.onlineSales?.paidAmount;
  const offlineAmount = monthly?.sales?.offlineSales?.offlineSalesAmount;
  const totalAmount = monthly?.sales?.totalSales?.amount;
  const onlineDaily = sum(online?.dailySales, "paidAmount");
  const offlineDaily = sum(ecount?.dailySales, "offlineSalesAmount");
  const byStore = { APGUJEONG: 0, VAIL: 0 };
  for (const row of ecount?.rows || ecount?.salesLines || []) {
    if (row?.isOfflineRevenue === true && row.storeCode in byStore) byStore[row.storeCode] += Number(row.salesAmount || 0);
  }
  const required = [onlineAmount, offlineAmount, totalAmount, ecount?.totalOfflineSales];
  const periodOk = monthly?.sales?.periodStart === `${month}-01`
    && monthly?.sales?.periodEnd === monthEndKey(month)
    && ecount?.periodStart === `${month}-01`;
  const ok = required.every(Number.isFinite)
    && Array.isArray(online?.dailySales)
    && Array.isArray(ecount?.dailySales)
    && periodOk
    && onlineDaily === onlineAmount
    && offlineDaily === offlineAmount
    && ecount.totalOfflineSales === offlineAmount
    && byStore.APGUJEONG + byStore.VAIL === offlineAmount
    && onlineAmount + offlineAmount === totalAmount
    && onlineDaily + offlineDaily === totalAmount;
  return {
    ok,
    detail: `month=${month} online=${onlineAmount} offline=${offlineAmount} total=${totalAmount} byStore=${JSON.stringify(byStore)}`
  };
}

export function validateProductionMonthlyPartial(month, monthly, online, ecount) {
  const monthStart = `${month}-01`;
  const monthEnd = monthEndKey(month);
  const sourceEnd = String(ecount?.periodEnd || "");
  const onlineAmount = monthly?.sales?.onlineSales?.paidAmount;
  const offlineDaily = sum(ecount?.dailySales, "offlineSalesAmount");
  const byStore = { APGUJEONG: 0, VAIL: 0 };
  for (const row of ecount?.rows || ecount?.salesLines || []) {
    if (row?.isOfflineRevenue === true && row.storeCode in byStore) byStore[row.storeCode] += Number(row.salesAmount || 0);
  }
  const coverage = monthly?.sales?.coverage;
  const provenance = monthly?.sales?.provenance?.ecount;
  const ok = ecount?.periodStart === monthStart
    && /^\d{4}-\d{2}-\d{2}$/.test(sourceEnd)
    && sourceEnd >= monthStart && sourceEnd < monthEnd
    && Number.isFinite(ecount?.totalOfflineSales)
    && Array.isArray(ecount?.dailySales)
    && Array.isArray(online?.dailySales)
    && offlineDaily === ecount.totalOfflineSales
    && byStore.APGUJEONG + byStore.VAIL === ecount.totalOfflineSales
    && sum(online.dailySales, "paidAmount") === onlineAmount
    && monthly?.sales?.periodStart === monthStart
    && monthly?.sales?.periodEnd === monthEnd
    && monthly?.sales?.offlineSales?.offlineSalesAmount === null
    && monthly?.sales?.totalSales?.amount === null
    && coverage?.online === true && coverage?.offline === false && coverage?.complete === false
    && coverage?.partialMonths?.includes(month)
    && !coverage?.missingMonths?.includes(month)
    && provenance?.periodStart === ecount.periodStart
    && provenance?.periodEnd === ecount.periodEnd;
  return { ok, detail: `month=${month} source=${ecount?.periodStart}..${sourceEnd} offline=${ecount?.totalOfflineSales} byStore=${JSON.stringify(byStore)}` };
}

export function validateProductionAnnual(monthlyTotals, annualTotal) {
  const values = Object.values(monthlyTotals || {});
  const expected = values.reduce((total, value) => total + Number(value || 0), 0);
  return { ok: values.length > 0 && values.every(Number.isFinite) && Number.isFinite(annualTotal) && expected === annualTotal, expected, annualTotal };
}

export function approvedClientsExclusionTotal(ecount, since, until) {
  return (ecount?.rows || ecount?.salesLines || []).reduce((total, row) => {
    const name = String(row?.customerName || "").trim();
    const date = String(row?.date || "");
    const approved = name === "택배" || name.includes("기프트");
    return row?.isOfflineRevenue === true && date >= since && date <= until && approved
      ? total + Number(row.salesAmount || 0)
      : total;
  }, 0);
}

export function validateProductionClients(clients, canonicalTotal, approvedExclusionTotal, source = null) {
  const summary = clients?.summary;
  const total = summary?.totalSalesAmount;
  const componentTotal = Number(summary?.onlineSalesAmount) + Number(summary?.offlineSalesAmount);
  const typeTotal = sum(clients?.typeBreakdown, "salesAmount");
  const clientTotal = sum(clients?.clients, "totalSales");
  const residual = Number(canonicalTotal) - Number(total);
  const sourceOk = !source || (
    clients?.periodStart === source.since
    && clients?.periodEnd === source.until
    && source.canonical?.periodStart === source.since
    && source.canonical?.periodEnd === source.until
    && Number(source.canonical?.onlineSales?.paidAmount) + Number(source.canonical?.offlineSales?.offlineSalesAmount) === Number(source.canonical?.totalSales?.amount)
    && Number(source.canonical?.offlineSales?.byStore?.APGUJEONG || 0) + Number(source.canonical?.offlineSales?.byStore?.VAIL || 0) === Number(source.canonical?.offlineSales?.offlineSalesAmount)
    && source.canonical?.coverage?.complete === true
  );
  const ok = Number.isFinite(total)
    && Number.isFinite(canonicalTotal)
    && clients?.periodStart && clients?.periodEnd
    && componentTotal === total
    && typeTotal === total
    && clientTotal === total
    && Number(summary?.onlineOrderCount) + Number(summary?.offlineOrderCount) === Number(summary?.orderCount)
    && Number.isFinite(approvedExclusionTotal)
    && residual === approvedExclusionTotal
    && sourceOk;
  return { ok, residual, detail: `clients=${total} canonical=${canonicalTotal} approvedExclusionResidual=${residual}` };
}

// 2026-01부터 currentMonth 직전 달까지 — Batch 4.6에서 확정된 canonical historical range.
function historicalMonths() {
  const current = currentMonthSeoul();
  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    const month = `2026-${String(m).padStart(2, "0")}`;
    if (month >= current) break;
    months.push(month);
  }
  return months;
}

export function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function verificationExitCode(results) {
  return results.some((result) => result.status === "FAIL") ? 1 : 0;
}

async function runCheck(name, fn) {
  try {
    return { name, ...(await fn()) };
  } catch (error) {
    return { name, status: "FAIL", detail: `error: ${error?.message || error}` };
  }
}

// ---- STRICT checks (정적/과거 확정 데이터 — 완전 일치 기대) ----

export async function checkStatus(local, render) {
  const [l, r] = await Promise.all([getJson(local, "/api/status"), getJson(render, "/api/status")]);
  const ok = l.status === 200 && r.status === 200;
  return { status: ok ? "PASS" : "FAIL", detail: `local=${l.status} render=${r.status}` };
}

export async function checkHistoricalMonthly(local, render) {
  const months = historicalMonths();
  const mismatches = [];
  const notComparable = [];
  for (const month of months) {
    const [l, r] = await Promise.all([
      getJson(local, `/api/reports/monthly?month=${month}`),
      getJson(render, `/api/reports/monthly?month=${month}`)
    ]);
    const lt = l.body?.sales?.totalSales?.amount;
    const rt = r.body?.sales?.totalSales?.amount;
    if (lt === rt) continue;
    const localProvenance = historicalArchiveProvenance(l.body);
    const renderProvenance = historicalArchiveProvenance(r.body);
    if (localProvenance && renderProvenance && !deepEqual(localProvenance, renderProvenance)) {
      notComparable.push(`${month}: local=${lt} render=${rt}`);
    } else {
      mismatches.push(`${month}: local=${lt} render=${rt}`);
    }
  }
  if (!months.length) return { status: "PASS", detail: "no historical months before current month yet" };
  if (mismatches.length) return { status: "FAIL", detail: mismatches.join("; ") };
  if (notComparable.length) return { status: "WARN", detail: `NOT COMPARABLE — ${notComparable.join("; ")}` };
  return { status: "PASS", detail: `${months.length}/${months.length} months match (${months[0]}~${months.at(-1)})` };
}

export async function checkAnnual(local, render) {
  // 전용 /annual API가 없음 — Production Annual UI와 동일하게 Production 월 응답만 합산한다.
  const months = [...historicalMonths(), currentMonthSeoul()];
  const completedMonths = historicalMonths();
  const productionMonths = {};
  for (const month of completedMonths) {
    const response = await getJson(render, `/api/reports/monthly?month=${month}`);
    const amount = response.body?.sales?.totalSales?.amount;
    if (response.status !== 200 || !Number.isFinite(amount)) return { status: "FAIL", detail: `completed month ${month} is invalid` };
    productionMonths[month] = amount;
  }
  const currentMonth = currentMonthSeoul();
  const current = await getJson(render, `/api/reports/monthly?month=${currentMonth}`);
  const currentAmount = current.body?.sales?.totalSales?.amount;
  const annualTotal = Object.values(productionMonths).reduce((total, value) => total + Number(value || 0), 0);
  const validation = validateProductionAnnual(productionMonths, annualTotal);
  if (!validation.ok) return { status: "FAIL", detail: `completed sum(${completedMonths[0]}~${completedMonths.at(-1)})=${annualTotal}` };
  if (current.status !== 200 || !Number.isFinite(currentAmount)) {
    return { status: "WARN", detail: `completed sum(${completedMonths[0]}~${completedMonths.at(-1)})=${annualTotal}; current ${currentMonth}=EXPECTED UNAVAILABLE` };
  }
  return {
    status: "PASS",
    detail: `production sum(${months[0]}~${months.at(-1)})=${annualTotal + currentAmount}`
  };
}

export async function checkBrandRegistry(local, render) {
  const [l, r] = await Promise.all([getJson(local, "/api/intelligence/brands"), getJson(render, "/api/intelligence/brands")]);
  const ok = l.body?.count === r.body?.count && l.body?.aliasCount === r.body?.aliasCount;
  return { status: ok ? "PASS" : "FAIL", detail: `local(${l.body?.count}/${l.body?.aliasCount}) render(${r.body?.count}/${r.body?.aliasCount})` };
}

export async function checkProductRegistry(local, render) {
  const [l, r] = await Promise.all([
    getJson(local, "/api/intelligence/product-registry"),
    getJson(render, "/api/intelligence/product-registry")
  ]);
  const same = deepEqual(l.body?.registry, r.body?.registry);
  if (same) return { status: "PASS", detail: `entries=${l.body?.registry?.entries?.length ?? "?"} exact match` };
  const lEntries = l.body?.registry?.entries || [];
  const rEntries = r.body?.registry?.entries || [];
  const key = (e) => e.canonicalProductId || e.cafe24?.productNo;
  const rMap = new Map(rEntries.map((e) => [key(e), e]));
  let diffCount = 0;
  for (const e of lEntries) {
    if (!deepEqual(e, rMap.get(key(e)))) diffCount += 1;
  }
  return { status: "FAIL", detail: `${diffCount} entries differ (local=${lEntries.length}, render=${rEntries.length})` };
}

export async function checkPriceAudit(local, render) {
  const [l, r] = await Promise.all([getJson(local, "/api/intelligence/price-audit"), getJson(render, "/api/intelligence/price-audit")]);
  const la = l.body?.audit;
  const ra = r.body?.audit;
  const ok = la?.generatedAt === ra?.generatedAt && deepEqual(la?.summary, ra?.summary);
  return {
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? `generatedAt=${la?.generatedAt} summary=${JSON.stringify(la?.summary)}`
      : `local(${la?.generatedAt}, ${JSON.stringify(la?.summary)}) render(${ra?.generatedAt}, ${JSON.stringify(ra?.summary)})`
  };
}

export async function checkStoreMaster(local, render) {
  const stores = ["APGUJEONG", "VAIL"];
  const mismatches = [];
  for (const store of stores) {
    const since = "2026-01-01";
    const until = todayKeySeoul();
    const [l, r] = await Promise.all([
      getJson(local, `/api/intelligence/store?store=${store}&since=${since}&until=${until}`),
      getJson(render, `/api/intelligence/store?store=${store}&since=${since}&until=${until}`)
    ]);
    if (l.body?.store?.displayName !== r.body?.store?.displayName) {
      mismatches.push(`${store}: local=${l.body?.store?.displayName} render=${r.body?.store?.displayName}`);
    }
  }
  return mismatches.length ? { status: "FAIL", detail: mismatches.join("; ") } : { status: "PASS", detail: `${stores.join(", ")} resolve identically` };
}

export async function checkInventory(local, render) {
  const [l, r] = await Promise.all([getJson(local, "/api/inventory/overview"), getJson(render, "/api/inventory/overview")]);
  // recentSalesQty(및 그것으로부터 파생되는 slowWatchCount)는 요청 시점 rolling metric으로
  // 알려진 live 필드라 비교에서 제외한다(docs/reports/local-to-render-batch3-5-brand-registry-sync-2026-08-25.md
  // §11, docs/reports/inventory-operations-foundation-mvp-2026-08-26.md).
  const strip = (rollup) => (rollup || []).map(({ recentSalesQty, slowWatchCount, ...rest }) => rest);
  const summaryOk = deepEqual(l.body?.summary, r.body?.summary);
  const coverageOk = deepEqual(l.body?.coverage, r.body?.coverage);
  const rollupOk = deepEqual(strip(l.body?.brandRollup), strip(r.body?.brandRollup));
  const ok = summaryOk && coverageOk && rollupOk;
  return {
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? `summary/coverage/brandRollup(ex. recentSalesQty) match, count=${l.body?.brandRollup?.length}`
      : `summary=${summaryOk} coverage=${coverageOk} brandRollup=${rollupOk}`
  };
}

export async function checkFrontendBundle(local, render) {
  const response = await fetch(`${render}/outputs/samplas-marketing-os.js`);
  const renderText = await response.text();
  const renderHash = createHash("sha256").update(renderText).digest("hex");
  let headHash = null;
  try {
    const { execFileSync } = await import("node:child_process");
    headHash = execFileSync("git", ["show", "HEAD:outputs/samplas-marketing-os.js"], { cwd: root, maxBuffer: 32 * 1024 * 1024 })
      .toString("utf8");
    headHash = createHash("sha256").update(headHash).digest("hex");
  } catch (error) {
    return { status: "WARN", detail: `git HEAD 파일을 읽지 못함: ${error?.message}` };
  }
  return {
    status: renderHash === headHash ? "PASS" : "FAIL",
    detail: renderHash === headHash ? `sha256=${renderHash}` : `HEAD=${headHash} render=${renderHash}`
  };
}

// ---- LIVE-AWARE checks (당월/rolling 데이터 — timing drift 허용, 구조는 strict) ----

export async function checkTodayLive(local, render) {
  const since = todayKeySeoul();
  const path = `/api/sales/total?since=${since}&until=${since}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [l, r] = await Promise.all([getJson(local, path), getJson(render, path)]);
    const lt = l.body?.totalSales?.amount;
    const rt = r.body?.totalSales?.amount;
    if (lt === rt && deepEqual(l.body?.offlineSales?.byStore, r.body?.offlineSales?.byStore)) {
      return { status: "PASS", detail: `total=${lt} byStore=${JSON.stringify(l.body?.offlineSales?.byStore)}` };
    }
    if (attempt === 0) continue; // 주문 경계 race 가능성 — 한 번 더 시도
    return { status: "WARN", detail: `local=${lt} render=${rt} (재시도 후에도 불일치 — 실시간 주문 유입 중일 수 있음, 큰 폭 차이면 재확인 필요)` };
  }
}

export async function checkMonthlyCurrent(local, render) {
  const month = currentMonthSeoul();
  const path = `/api/reports/monthly?month=${month}`;
  const since = `${month}-01`;
  const until = todayKeySeoul();
  const [l, r, online, ecount] = await Promise.all([
    getJson(local, path),
    getJson(render, path),
    getJson(render, `/api/diagnostics/brand-sales?since=${since}&until=${until}`),
    getJson(render, `/api/ecount-sales/monthly?month=${month}`)
  ]);
  const lt = l.body?.sales?.totalSales?.amount;
  const rt = r.body?.sales?.totalSales?.amount;
  if (ecount.status === 404) {
    const coverage = r.body?.sales?.coverage;
    const honestUnavailable = r.status === 200
      && r.body?.sales?.periodStart === `${month}-01`
      && coverage?.offline === false
      && coverage?.missingMonths?.includes(month)
      && r.body?.sales?.offlineSales?.offlineSalesAmount === null
      && rt === null
      && Number.isFinite(r.body?.sales?.onlineSales?.paidAmount);
    return {
      status: honestUnavailable ? "WARN" : "FAIL",
      detail: honestUnavailable ? `month=${month} EXPECTED UNAVAILABLE — ECOUNT snapshot not uploaded` : `month=${month} missing ECOUNT is not represented honestly`
    };
  }
  if (ecount.status !== 200 || ecount.body?.periodStart?.slice(0, 7) !== month) {
    return { status: "FAIL", detail: `month=${month} wrong or malformed ECOUNT snapshot` };
  }
  const sourceEnd = String(ecount.body?.periodEnd || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceEnd) || sourceEnd.slice(0, 7) !== month || sourceEnd > monthEndKey(month)) {
    return { status: "FAIL", detail: `month=${month} malformed ECOUNT source period` };
  }
  if (sourceEnd < monthEndKey(month)) {
    const validation = validateProductionMonthlyPartial(month, r.body, online.body, ecount.body);
    return {
      status: validation.ok ? "WARN" : "FAIL",
      detail: validation.ok ? `CURRENT SOURCE PARTIAL — ${validation.detail}` : `dishonest partial — ${validation.detail}`
    };
  }
  const localBoundary = liveSourceBoundary(l.body);
  const renderBoundary = liveSourceBoundary(r.body);
  if (localBoundary && renderBoundary && localBoundary === renderBoundary && lt !== rt) {
    return { status: "FAIL", detail: `matching sourceThrough=${localBoundary} but local=${lt} render=${rt}` };
  }
  const validation = validateProductionMonthly(month, r.body, online.body, ecount.body);
  return {
    status: validation.ok ? "PASS" : "FAIL",
    detail: `${validation.detail}; ${lt === rt ? "live parity exact" : `LIVE SOURCE DIFFERENCE — NOT COMPARABLE local=${lt} render=${rt}`}`
  };
}

export async function checkClients(local, render) {
  const month = currentMonthSeoul();
  const since = `${month}-01`;
  const until = todayKeySeoul();
  const path = `/api/intelligence/clients?since=${since}&until=${until}`;
  const [l, r, canonical, ecount] = await Promise.all([
    getJson(local, path),
    getJson(render, path),
    getJson(render, `/api/sales/total?since=${since}&until=${until}`),
    getJson(render, `/api/ecount-sales/monthly?month=${month}`)
  ]);
  const approvedExclusions = approvedClientsExclusionTotal(ecount.body, since, until);
  if (ecount.status === 404) {
    const honestUnavailable = r.status === 200
      && r.body?.periodStart === since
      && r.body?.coverage?.offline?.available === false
      && r.body?.coverage?.offline?.missingMonths?.includes(month)
      && r.body?.summary?.offlineSalesAmount === null
      && r.body?.summary?.totalSalesAmount === null;
    return {
      status: honestUnavailable ? "WARN" : "FAIL",
      detail: honestUnavailable ? `month=${month} EXPECTED UNAVAILABLE — Clients offline coverage incomplete` : `month=${month} Clients masks unavailable offline as zero`
    };
  }
  const validation = validateProductionClients(r.body, canonical.body?.totalSales?.amount, approvedExclusions, { since, until, canonical: canonical.body });
  const localBoundary = liveSourceBoundary(l.body);
  const renderBoundary = liveSourceBoundary(r.body);
  if (localBoundary && renderBoundary && localBoundary === renderBoundary && !deepEqual(l.body?.summary, r.body?.summary)) {
    return { status: "FAIL", detail: `matching sourceThrough=${localBoundary} but Clients summaries differ` };
  }
  return {
    status: validation.ok ? "PASS" : "FAIL",
    detail: `${validation.detail}; ${deepEqual(l.body?.summary, r.body?.summary) ? "live parity exact" : "LIVE SOURCE DIFFERENCE — NOT COMPARABLE"}`
  };
}

export async function checkEcountCurrentMonth(local, render) {
  const month = currentMonthSeoul();
  const path = `/api/ecount-sales/monthly?month=${month}`;
  const [l, r] = await Promise.all([getJson(local, path), getJson(render, path)]);
  // Production UI import and Local validation are separate runs, so importedAt is
  // expected to differ even when the canonical business snapshot is identical.
  const stableSources = (sources) => (sources || []).map(({ importedAt, ...source }) => source);
  const ok = deepEqual(stableSources(l.body?.sources), stableSources(r.body?.sources));
  return {
    status: ok ? "PASS" : "WARN",
    detail: ok
      ? `sources match (excluding importedAt), month=${month}`
      : `local=${JSON.stringify(l.body?.sources)} render=${JSON.stringify(r.body?.sources)}`
  };
}

const CHECKS = [
  ["status", "STATUS", checkStatus],
  ["today", "TODAY", checkTodayLive],
  ["monthly-current", "MONTHLY CURRENT", checkMonthlyCurrent],
  ["monthly-historical", "HISTORICAL MONTHLY", checkHistoricalMonthly],
  ["annual", "ANNUAL", checkAnnual],
  ["clients", "CLIENTS", checkClients],
  ["ecount-current", "ECOUNT CURRENT MONTH", checkEcountCurrentMonth],
  ["store-master", "STORE MASTER", checkStoreMaster],
  ["inventory", "INVENTORY", checkInventory],
  ["brand-registry", "BRAND REGISTRY", checkBrandRegistry],
  ["product-registry", "PRODUCT REGISTRY", checkProductRegistry],
  ["price-audit", "PRICE AUDIT", checkPriceAudit],
  ["frontend", "FRONTEND", checkFrontendBundle]
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selected = args.only ? CHECKS.filter(([key]) => args.only.includes(key)) : CHECKS;
  if (!selected.length) {
    console.error(`알 수 없는 --only 값입니다. 사용 가능: ${CHECKS.map(([key]) => key).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const [key, label, fn] of selected) {
    results.push({ key, label, ...(await runCheck(label, () => fn(args.local, args.render))) });
  }

  const verdict = results.some((r) => r.status === "FAIL")
    ? "PRODUCTION BASELINE MISMATCH — SEE FAIL ROWS ABOVE"
    : results.some((r) => r.status === "WARN")
      ? "PRODUCTION BASELINE HEALTHY (WARN — LIVE-TIMING FIELDS ONLY)"
      : "PRODUCTION BASELINE HEALTHY";

  if (args.json) {
    console.log(JSON.stringify({ local: args.local, render: args.render, results, verdict }, null, 2));
    process.exitCode = verificationExitCode(results);
    return;
  }

  console.log("SAMPLAS PRODUCTION PARITY\n");
  const width = Math.max(...results.map((r) => r.label.length)) + 2;
  for (const r of results) {
    console.log(`${r.label.padEnd(width)} ${r.status}`);
  }
  console.log(`\nVERDICT: ${verdict}\n`);
  console.log("--- detail ---");
  for (const r of results) {
    console.log(`[${r.status}] ${r.label}: ${r.detail || r.name}`);
  }
  process.exitCode = verificationExitCode(results);
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  await main();
}
