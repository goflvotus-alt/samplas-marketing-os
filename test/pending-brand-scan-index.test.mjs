import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as queue from "../scripts/pending-brand-queue.mjs";

// 2026-10-06: the auto-safe check re-parsed every ECOUNT product row for every candidate. On Render
// free CPU that blocked the event loop past the 5 s health check and the instance was restarted.
// The ECOUNT evidence is now indexed once per source arrays; decisions must stay identical.

const BRANDS = 120;
const sources = (ecountProducts) => ({
  canonical: { brands: [] },
  cafe24Brands: Array.from({ length: BRANDS }, (_, i) => ({ brand_code: `NEWB${i}`, brand_name: `Label ${i}` })),
  products: [],
  ecountLines: [],
  ecountProducts
});
const candidate = (i) => ({ id: `c${i}`, status: "PENDING", source: "BOTH", reviewReason: "UNRESOLVED", sourceBrandCode: `NEWB${i}`, rawBrandName: `Label ${i}`, cafe24Variants: [`Label ${i}`], ecountVariants: [`Label ${i}`], collabCandidates: [], relatedCandidateIds: [] });

test("auto-safe decisions use ECOUNT evidence exactly as before", () => {
  const rows = [
    { productName: "Label 1 / Coat", productCode: "L1" },
    { productName: "[Label 2 X Other] Tee", productCode: "L2" },  // collaboration only: no evidence for Label 2
    { productName: "QQQ / Label 3", productCode: "QQQ001" },       // QQQ rows never count
    { productName: "Label 4 / Bag", productCode: "QQQ9" }            // QQQ product code never counts
  ];
  const s = sources(rows);
  assert.equal(queue.isAutoSafePendingDecision(candidate(1), s.canonical, s)?.action, "NEW");
  for (const i of [0, 2, 3, 4]) assert.equal(queue.isAutoSafePendingDecision(candidate(i), s.canonical, s), null, `Label ${i}`);
  // Sales lines are evidence too; personal-payment sales lines are not.
  assert.equal(queue.isAutoSafePendingDecision(candidate(0), s.canonical, { ...s, ecountLines: [{ productName: "Label 0 / Coat" }] })?.action, "NEW");
  assert.equal(queue.isAutoSafePendingDecision(candidate(0), s.canonical, { ...s, ecountLines: [{ productName: "Label 0 / Coat", isPersonalPayment: true }] }), null);
  // A different array is a different source: the index never leaks between scans.
  assert.equal(queue.isAutoSafePendingDecision(candidate(1), s.canonical, { ...s, ecountProducts: [] }), null);
});

test("evaluating every candidate costs about one product-master pass, not one per candidate", () => {
  const rows = Array.from({ length: 15000 }, (_, i) => ({ productName: `Label ${i % (BRANDS * 2)} / Item ${i}`, productCode: `P${i}` }));
  const time = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };
  const one = sources([...rows]);
  const single = time(() => queue.isAutoSafePendingDecision(candidate(0), one.canonical, one));
  const all = sources([...rows]);
  let approved = 0;
  const every = time(() => { for (let i = 0; i < BRANDS; i += 1) if (queue.isAutoSafePendingDecision(candidate(i), all.canonical, all)?.action === "NEW") approved += 1; });
  assert.equal(approved, BRANDS);
  assert.ok(every < single * 10, `${BRANDS} candidates took ${every.toFixed(0)} ms vs ${single.toFixed(0)} ms for one (index must be reused)`);
});

test("server: /healthz answers before any other route with no I/O; render.yaml points the health check at it", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const start = server.indexOf('if (url.pathname === "/healthz")');
  assert.ok(start > 0 && start < server.indexOf("if (mcpEnabled &&"), "healthz is the first route");
  const block = server.slice(start, server.indexOf("}", server.indexOf("return;", start)) + 1);
  assert.doesNotMatch(block, /await|fetch|readFile|Status\(|integrationStatus/);
  assert.match(server, /if \(url\.pathname === "\/api\/status"\) \{\n\s+const integrations = integrationStatus\(\);/, "/api/status unchanged");
  const render = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
  assert.match(render, /healthCheckPath: \/healthz/);
});
