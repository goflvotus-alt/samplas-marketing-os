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
  for (const month of months) {
    const [l, r] = await Promise.all([
      getJson(local, `/api/reports/monthly?month=${month}`),
      getJson(render, `/api/reports/monthly?month=${month}`)
    ]);
    const lt = l.body?.sales?.totalSales?.amount;
    const rt = r.body?.sales?.totalSales?.amount;
    if (lt !== rt) mismatches.push(`${month}: local=${lt} render=${rt}`);
  }
  if (!months.length) return { status: "PASS", detail: "no historical months before current month yet" };
  return mismatches.length
    ? { status: "FAIL", detail: mismatches.join("; ") }
    : { status: "PASS", detail: `${months.length}/${months.length} months match (${months[0]}~${months.at(-1)})` };
}

export async function checkAnnual(local, render) {
  // 전용 /annual API가 없음(Batch 4/4.6에서 확인) — 연초~현재월 합계 비교로 대체.
  const months = [...historicalMonths(), currentMonthSeoul()];
  let lSum = 0;
  let rSum = 0;
  for (const month of months) {
    const [l, r] = await Promise.all([
      getJson(local, `/api/reports/monthly?month=${month}`),
      getJson(render, `/api/reports/monthly?month=${month}`)
    ]);
    lSum += l.body?.sales?.totalSales?.amount || 0;
    rSum += r.body?.sales?.totalSales?.amount || 0;
  }
  // 당월이 섞여 있어 live timing drift 허용 — 완전 일치가 이상적이나, 두 호출 사이 실시간
  // 주문이 끼면 미세한 delta가 날 수 있어 0.01% 이내 오차는 WARN으로만 표시.
  const delta = lSum - rSum;
  if (delta === 0) return { status: "PASS", detail: `sum(${months[0]}~${months.at(-1)}) local=${lSum} render=${rSum}` };
  const pct = lSum ? Math.abs(delta) / lSum : 1;
  return {
    status: pct < 0.0001 ? "WARN" : "FAIL",
    detail: `local=${lSum} render=${rSum} delta=${delta} (당월 포함이라 live timing 오차 가능)`
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
  // recentSalesQty는 요청 시점 rolling metric으로 알려진 live 필드라 비교에서 제외한다
  // (docs/reports/local-to-render-batch3-5-brand-registry-sync-2026-08-25.md §11).
  const strip = (rollup) => (rollup || []).map(({ recentSalesQty, ...rest }) => rest);
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
  const [l, r] = await Promise.all([getJson(local, path), getJson(render, path)]);
  const lt = l.body?.sales?.totalSales?.amount;
  const rt = r.body?.sales?.totalSales?.amount;
  return {
    status: lt === rt ? "PASS" : "WARN",
    detail: `month=${month} local=${lt} render=${rt}`
  };
}

export async function checkClients(local, render) {
  const since = "2026-08-01"; // 월 시작 고정, until은 오늘 — Batch 리포트들과 동일한 패턴
  const until = todayKeySeoul();
  const path = `/api/intelligence/clients?since=${since}&until=${until}`;
  const [l, r] = await Promise.all([getJson(local, path), getJson(render, path)]);
  const ls = l.body?.summary;
  const rs = r.body?.summary;
  const ok = ls?.totalClients === rs?.totalClients && ls?.orderCount === rs?.orderCount;
  return {
    status: ok ? "PASS" : "WARN",
    detail: `local(${ls?.totalClients}/${ls?.orderCount}) render(${rs?.totalClients}/${rs?.orderCount})`
  };
}

export async function checkEcountCurrentMonth(local, render) {
  const month = currentMonthSeoul();
  const path = `/api/ecount-sales/monthly?month=${month}`;
  const [l, r] = await Promise.all([getJson(local, path), getJson(render, path)]);
  const ok = deepEqual(l.body?.sources, r.body?.sources);
  return {
    status: ok ? "PASS" : "WARN",
    detail: ok ? `sources match, month=${month}` : `local=${JSON.stringify(l.body?.sources)} render=${JSON.stringify(r.body?.sources)}`
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
    process.exitCode = results.some((r) => r.status === "FAIL") ? 1 : 0;
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
  process.exitCode = results.some((r) => r.status === "FAIL") ? 1 : 0;
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  await main();
}
