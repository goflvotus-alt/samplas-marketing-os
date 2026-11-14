import test from "node:test";
import assert from "node:assert/strict";
import { buildCrmDataset, createPseudonymizer, crmMonthly, crmCohort, crmAcquisition, crmDataQuality } from "../scripts/crm-analytics.mjs";
import { runReadTool } from "../scripts/mcp/read-tools.mjs";

// Synthetic orders only. Shapes follow cafe24-proxy-orders-*.json (Admin API orders).
let seq = 0;
function order({ date, member = "", first = null, canceled = "F", amount = 100000, market = "self", pay = ["card"], product = "[BRAND : 브랜드] JACKET", status = "N40", paid = "T", orderPrice = amount, extraItems = [] }) {
  seq += 1;
  return {
    order_id: `${date.replaceAll("-", "")}-${String(seq).padStart(7, "0")}`,
    order_date: `${date}T12:00:00+09:00`,
    member_id: member, member_email: member ? `${member}@example.com` : null, billing_name: member ? `홍${member}` : "비회원",
    first_order: first, canceled, paid, market_id: market, payment_method: pay,
    actual_order_amount: { payment_amount: String(canceled === "T" ? 0 : amount), order_price_amount: String(orderPrice) },
    items: [{ product_name: product, order_status: canceled === "T" ? "C40" : status, quantity: 1 }, ...extraItems]
  };
}
// Every day of the range gets a filler guest order so coverage spans are continuous.
function fill(since, until) {
  const out = [];
  for (let d = since; d <= until; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) out.push(order({ date: d, amount: 1000 }));
  return out;
}
const records = (orders, name = "cafe24-proxy-orders-a.json", mtimeMs = Date.parse("2026-11-01T00:00:00Z")) =>
  orders.map((o, index) => ({ order: o, type: "api", file: { name, mtimeMs }, index }));
const pseudonymize = createPseudonymizer("test-key");

function scenario() {
  seq = 0;
  const o = {
    // A: first order fully canceled in Sep, real first purchase in Oct.
    aCancel: order({ date: "2026-09-10", member: "a", first: "T", canceled: "T" }),
    aReal: order({ date: "2026-10-05", member: "a", first: "F", amount: 200000 }),
    // B: first order partially canceled in Sep (remaining amount stays), repurchase in Oct.
    bPartial: order({ date: "2026-09-12", member: "b", first: "T", canceled: "M", amount: 50000, orderPrice: 150000,
      extraItems: [{ product_name: "X", order_status: "C40", quantity: 1 }] }),
    bRepeat: order({ date: "2026-10-07", member: "b", first: "F", amount: 70000 }),
    // C: no first_order=T in data (history before the caches) -> UNVERIFIED.
    cOld: order({ date: "2026-10-08", member: "c", first: "F", amount: 90000 }),
    // D: clean new member in Oct with a second purchase 10 days later.
    dFirst: order({ date: "2026-10-10", member: "d", first: "T", amount: 120000 }),
    dSecond: order({ date: "2026-10-20", member: "d", first: "F", amount: 80000 }),
    // Guests: Naver Pay prepaid (payment_amount 0, restored from order price) and a site guest.
    npay: order({ date: "2026-10-11", market: "NCHECKOUT", pay: ["prepaid"], amount: 0, orderPrice: 198000 }),
    guest: order({ date: "2026-10-12", amount: 60000 }),
    // Personal payment window order from a member: excluded from customer analysis.
    pp: order({ date: "2026-10-13", member: "e", first: "T", amount: 300000, product: "개인결제창 스타일리스트" })
  };
  return o;
}

test("first real purchase, repeat, unverified, guests and personal payment (2026-10)", () => {
  const o = scenario();
  const cache = records([...fill("2026-09-01", "2026-10-31"), ...Object.values(o)]);
  const m = crmMonthly(buildCrmDataset({ cacheRecords: cache, pseudonymize }), "2026-10");
  assert.equal(m.newMembers.members, 2);              // a (after full cancel) and d
  assert.equal(m.newMembers.amount, 200000 + 120000 + 80000);
  assert.equal(m.repeatMembers.members, 1);           // b: partial-canceled first purchase still counts
  assert.equal(m.repeatMembers.amount, 70000);
  assert.equal(m.unverifiedMembers.members, 1);       // c
  assert.deepEqual(m.newMemberRange, { min: 2, max: 3 });
  assert.equal(m.guests.naverPay.amount, 198000);     // prepaid restored like Marketing OS
  assert.equal(m.personalPayment.amount, 300000);
  assert.equal(m.firstOrderFlagCheck.newMembersWhoseFirstValidOrderWasNotFlaggedFirst, 1); // a
  assert.equal(m.secondPurchaseDays.withSecondPurchase, 1);
  assert.equal(m.secondPurchaseDays.medianDays, 10);
  assert.equal(m.staffPurchases.status, "UNAVAILABLE");
});

test("partial-cancel first purchase is the first real purchase, at the remaining amount", () => {
  const o = scenario();
  const ds = buildCrmDataset({ cacheRecords: records([...fill("2026-09-01", "2026-10-31"), ...Object.values(o)]), pseudonymize });
  const sep = crmMonthly(ds, "2026-09");
  assert.equal(sep.newMembers.members, 1);
  assert.equal(sep.newMembers.amount, 50000);
});

test("coverage gap between first_order=T and the first valid purchase -> UNVERIFIED", () => {
  seq = 0;
  const t = order({ date: "2026-08-05", member: "g", first: "T", canceled: "T" });
  const later = order({ date: "2026-10-05", member: "g", first: "F" });
  // No data at all for September: the member may have bought (and kept) something then.
  const cache = [...records([...fill("2026-08-01", "2026-08-31"), t], "aug.json"), ...records([...fill("2026-10-01", "2026-10-31"), later], "oct.json")];
  const ds = buildCrmDataset({ cacheRecords: cache, pseudonymize });
  const m = crmMonthly(ds, "2026-10");
  assert.equal(m.newMembers.members, 0);
  assert.equal(m.unverifiedMembers.members, 1);
  assert.deepEqual(crmDataQuality(ds, "2026-10").history.gaps, [{ since: "2026-09-01", until: "2026-09-30" }]);
});

test("same order in cache and later snapshot is counted once, latest observation wins", () => {
  const o = scenario();
  const cache = records([...fill("2026-10-01", "2026-10-31"), o.dFirst, o.guest], "c.json", Date.parse("2026-10-31T03:31:00Z"));
  const canceledLater = { ...structuredClone(o.guest), canceled: "T", actual_order_amount: { payment_amount: "0", order_price_amount: "60000" }, items: [{ product_name: "x", order_status: "C40", quantity: 1 }] };
  const late = order({ date: "2026-10-31", amount: 284000 });
  // Tracking snapshots carry no member fields (as in production): strip them.
  const strip = ({ member_id, member_email, billing_name, first_order, ...rest }) => rest;
  const snap = { name: "SAMPLAS_MONTHLY_TRACKING_2026-10_v2.json", observedAt: Date.parse("2026-11-01T09:11:00Z"), orders: [canceledLater, late, o.dFirst].map(strip), analyticsBatches: [] };
  const ds = buildCrmDataset({ cacheRecords: cache, snapshots: [snap], pseudonymize });
  assert.equal(ds.orders.filter((x) => x.id === o.guest.order_id).length, 1);
  assert.equal(ds.duplicateObservations, 2);
  const q = crmDataQuality(ds, "2026-10");
  assert.equal(q.orderStates.fullyCanceled, 1);
  assert.equal(q.sources.ordersFromLatestSnapshot, 3);
  assert.equal(q.closeStatus, "NOT_FINAL");
  assert.ok(q.issues.includes("POST_SNAPSHOT_CANCELS_UNVERIFIED"));
  const m = crmMonthly(ds, "2026-10");
  assert.equal(m.guests.amount, 31 * 1000);            // canceled guest order gone
  assert.equal(m.identityUnknown.amount, 284000);      // late order seen only in the stripped snapshot
  assert.equal(m.newMembers.members, 1);               // d keeps its member identity from the cache
  assert.equal(m.total.amount, 31 * 1000 + 284000 + 120000);
});

test("cohort cells are IMMATURE until the window has fully passed", () => {
  const o = scenario();
  const ds = buildCrmDataset({ cacheRecords: records([...fill("2026-09-01", "2026-10-31"), ...Object.values(o)]), pseudonymize });
  const c = crmCohort(ds, "2026-09", "2026-10", [30, 60]);
  assert.equal(c.dataThrough, "2026-10-31");
  const sep = c.cohorts.find((x) => x.month === "2026-09");
  assert.equal(sep.members, 1); // b (a's September order was canceled)
  assert.equal(sep.cells[0].status, "MATURE");          // 09-30 + 30d = 10-30 <= 10-31
  assert.equal(sep.cells[0].rate, 100);                 // b repurchased 10-07 (25 days)
  assert.equal(sep.cells[1].status, "IMMATURE");
  assert.equal(sep.cells[1].rate, null);
  const oct = c.cohorts.find((x) => x.month === "2026-10");
  assert.ok(oct.cells.every((cell) => cell.status === "IMMATURE" && cell.rate === null));
});

test("acquisition joins Analytics by order id; Analytics amount is never revenue; missing row is UNKNOWN", () => {
  const o = scenario();
  const analyticsBatches = [{ since: "2026-10-01", until: "2026-10-31", ok: true, completeness: "COMPLETE", rows: [
    { order_id: o.aReal.order_id, ad: "네이버", medium: "shopping", order_amount: 999999 },
    { order_id: o.dFirst.order_id, ad: "", medium: "", order_amount: 120000 }
  ] }];
  const ds = buildCrmDataset({ cacheRecords: records([...fill("2026-10-01", "2026-10-31"), ...Object.values(o)]), snapshots: [{ name: "s", observedAt: 0, orders: [], analyticsBatches }], pseudonymize });
  const a = crmAcquisition(ds, "2026-10");
  assert.equal(a.analyticsCoverage, "COMPLETE");
  const naver = a.firstPurchaseChannels.find((r) => r.channel === "네이버");
  assert.equal(naver.amount, 200000);                  // MOS amount, not 999999
  assert.ok(a.firstPurchaseChannels.find((r) => r.channel === "(no ad / direct)"));
  const unknown = a.allOrderChannels.find((r) => r.channel === "UNKNOWN");
  assert.ok(unknown.orders > 0);
  assert.equal(crmDataQuality(ds, "2026-10").analytics.validOrdersWithAmountDifferentFromAnalytics, 1);
});

test("no member id, email, name or pseudonymous key in any CRM output or MCP tool result", async () => {
  const o = scenario();
  const ds = buildCrmDataset({ cacheRecords: records([...fill("2026-09-01", "2026-10-31"), ...Object.values(o)]), pseudonymize });
  const outputs = [crmMonthly(ds, "2026-10"), crmCohort(ds, "2026-09", "2026-10"), crmAcquisition(ds, "2026-10"), crmDataQuality(ds, "2026-10")];
  const text = JSON.stringify(outputs);
  for (const id of ["a", "b", "c", "d", "e"]) {
    assert.ok(!text.includes(`${id}@example.com`));
    assert.ok(!text.includes(`홍${id}`));
    assert.ok(!text.includes(pseudonymize(id)));
  }
  assert.ok(!/[0-9a-f]{64}/.test(text));
  // Through the MCP tools with a stub upstream serving the same aggregates.
  const routes = { "/api/crm/monthly": outputs[0], "/api/crm/cohort": outputs[1], "/api/crm/acquisition": outputs[2], "/api/crm/data-quality": outputs[3] };
  const up = { async getJson(path) { return structuredClone(routes[path]); } };
  for (const [name, args] of [["get_crm_monthly", { month: "2026-10" }], ["get_crm_cohort", { from: "2026-09", to: "2026-10" }], ["get_crm_acquisition", { month: "2026-10" }], ["get_crm_data_quality", { month: "2026-10" }]]) {
    const result = await runReadTool(name, args, up);
    assert.equal(result.ok, true, name);
    assert.ok(!/@example\.com|[0-9a-f]{64}/.test(JSON.stringify(result)), name);
  }
});

test("CRM MCP tools validate input before calling upstream", async () => {
  let called = 0;
  const up = { async getJson() { called++; return {}; } };
  for (const [name, args] of [["get_crm_monthly", { month: "2026-13" }], ["get_crm_cohort", { from: "2026-10", to: "2026-09" }], ["get_crm_cohort", { from: "2026-09", to: "2026-10", windows: "30;60" }], ["get_crm_acquisition", {}]]) {
    const result = await runReadTool(name, args, up);
    assert.equal(result.ok, false, `${name} ${JSON.stringify(args)}`);
  }
  assert.equal(called, 0);
});

// ---------------------------------------------------------------------------------------------------------
// Loader: same winners as the canonical cache loader, parsing fewer files; single-flight memo.
import { mkdtemp, writeFile, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCacheWinners, cachedCrmDataset } from "../scripts/crm-analytics.mjs";
import { loadCanonicalCafe24OrderCache } from "../scripts/cafe24-order-cache.mjs";

async function cacheDir(files) {
  const dir = await mkdtemp(join(tmpdir(), "crm-cache-"));
  for (const [name, orders, mtime, raw] of files) {
    await writeFile(join(dir, name), raw ?? JSON.stringify({ orders }, null, 2));
    await utimes(join(dir, name), mtime, mtime);
  }
  return dir;
}
const winners = (records) => records.map((r) => `${r.order.order_id}@${r.file.name}:${JSON.stringify(r.order)}`).sort();

test("loadCacheWinners picks exactly the canonical winners and skips superseded files", async () => {
  seq = 0;
  const a = order({ date: "2026-09-01", member: "a", first: "T" });
  const b = order({ date: "2026-09-02", member: "b", first: "T" });
  const bLater = { ...structuredClone(b), canceled: "T" };
  const c = order({ date: "2026-09-03", member: "c", first: "T" });
  const tieLow = { ...structuredClone(c) };                                 // same fileEnd + mtime: completeness decides
  const tieHigh = { ...structuredClone(c), extra_field: "more complete" };
  const dir = await cacheDir([
    ["cafe24-proxy-orders-2026-09-01_2026-09-02.json", [a, b], 1_000],      // fully superseded by the next file
    ["cafe24-proxy-orders-2026-09-01_2026-09-03.json", [a, bLater], 2_000],
    ["cafe24-proxy-orders-2026-09-03_2026-09-03.json", [tieLow], 3_000],
    ["cafe24-proxy-orders-2026-09-02_2026-09-03.json", [tieHigh], 3_000]
  ]);
  try {
    const mine = await loadCacheWinners(dir);
    const canon = await loadCanonicalCafe24OrderCache({ workDir: dir });
    assert.deepEqual(winners(mine.records), winners(canon.records));
    assert.equal(mine.fallback, false);
    assert.equal(mine.filesScanned, 4);
    assert.equal(mine.filesParsed, 3);   // the first file holds no winner and is never parsed
  } finally { await rm(dir, { recursive: true }); }
});

test("loadCacheWinners parses files whose id scan is not trustworthy, and falls back on invalid dates", async () => {
  seq = 0;
  const a = order({ date: "2026-09-01", member: "a", first: "T" });
  const badDate = { ...structuredClone(a), order_date: "not-a-date" };
  const noDateKey = order({ date: "2026-09-05", member: "z", first: "T" });
  delete noDateKey.order_date; noDateKey.payment_date = "2026-09-05T10:00:00+09:00";
  const dir = await cacheDir([
    ["cafe24-proxy-orders-2026-09-01_2026-09-01.json", [a], 1_000],
    ["cafe24-proxy-orders-2026-09-01_2026-09-30.json", [badDate], 2_000],   // best file but invalid date
    ["cafe24-proxy-orders-2026-09-05_2026-09-05.json", [noDateKey], 2_000]  // id count != order_date keys
  ]);
  try {
    const mine = await loadCacheWinners(dir);
    const canon = await loadCanonicalCafe24OrderCache({ workDir: dir });
    assert.deepEqual(winners(mine.records), winners(canon.records));
    assert.equal(mine.fallback, true);
  } finally { await rm(dir, { recursive: true }); }
});

test("concurrent CRM requests share one in-flight load", async () => {
  let loads = 0;
  const loader = async () => { loads++; await new Promise((r) => setTimeout(r, 20)); return { n: loads }; };
  const opts = { workDir: "/nonexistent-single-flight-test" };
  const results = await Promise.all(Array.from({ length: 5 }, () => cachedCrmDataset(opts, 600_000, loader)));
  assert.equal(loads, 1);
  assert.ok(results.every((r) => r === results[0]));
});
