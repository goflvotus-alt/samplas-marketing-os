import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { buildIdentityWorkbench, readWorkbenchSources } from "../scripts/brand-identity-workbench.mjs";
import { readPendingBrands } from "../scripts/pending-brand-queue.mjs";
import { pendingBrandUiMetadata } from "../scripts/pending-brand-ui-metadata.mjs";

const candidate = { id: "c", sourceBrandCode: "B0000BDG", rawBrandName: "PERSONSOUL", canonicalName: "BORC", reviewReason: "CODE_NAME_CONFLICT", status: "PENDING", relatedProductExamples: ["PERSONSOUL / Exact Jacket"] };
const master = { brands: [
  { brand_code: "B0000BDG", brand_name: "BORC", active: false },
  { brand_code: "B00000WK", brand_name: "Birth of Royal Child", active: true },
  { brand_code: "NAME", brand_name: "personsoul" },
  { brand_code: "ALIAS", brand_name: "Alias owner", name_aliases: ["PERSONSOUL"] },
  { brand_code: "PRODUCT", brand_name: "Product owner" },
  { brand_code: "UNRELATED", brand_name: "Unrelated" }
] };
const sources = { products: [{ brand_code: "B00000WK", selling: "T", product_name: "BORC / A" }],
  lines: [{ productName: "BORC / A", salesAmount: 100 }],
  entries: [{ brandId: "PRODUCT", verified: true, status: "confirmed", canonicalProductId: "P1", ecount: { matchedProducts: [{ productName: "PERSONSOUL / Exact Jacket" }] } }], provenance: { month: "2026-09" } };

test("related candidates separate exact, alias, acronym, product and raw ECOUNT evidence without matching", () => {
  const before = JSON.stringify({ master, sources, candidate });
  const w = buildIdentityWorkbench(candidate, master, sources);
  assert.equal(w.executionAllowed, false);
  assert.equal(w.related.find(b => b.brandCode === "NAME").confidence, "EXACT");
  assert.equal(w.related.find(b => b.brandCode === "ALIAS").confidence, "ALIAS");
  assert.equal(w.related.find(b => b.brandCode === "PRODUCT").confidence, "PRODUCT_EVIDENCE");
  const borc = w.related.find(b => b.brandCode === "B00000WK");
  assert.equal(borc.confidence, "RELATED_ONLY");
  assert.equal(borc.productCount, 1);
  assert.equal(borc.ecountRowCount, 1);
  assert.equal(borc.salesPresence, true);
  assert.deepEqual(borc.ecountRawNames, ["BORC"]);
  assert.equal(w.related.some(b => b.brandCode === "UNRELATED"), false);
  assert.equal(pendingBrandUiMetadata(candidate, master).recommendedUiAction, null);
  assert.equal(JSON.stringify({ master, sources, candidate }), before);
});

test("three real conflict shapes fail closed; missing sources never become confirmed zero", () => {
  for (const [code, old, next] of [["B0000BDG", "BORC", "PERSONSOUL"], ["B0000BDJ", "GKL", "UNDER THE SIGN"], ["B0000BDM", "LAMASKARADE", "PRAYING"]]) {
    const w = buildIdentityWorkbench({ ...candidate, sourceBrandCode: code, rawBrandName: next }, { brands: [{ brand_code: code, brand_name: old }] });
    assert.equal(w.current.name, next);
    assert.equal(w.owners[0].canonicalName, old);
    assert.equal(w.owners[0].productCount, null);
    assert.equal(w.owners[0].salesPresence, null);
    assert.equal(w.executionAllowed, false);
    assert.match(w.blocker, /Historical Clients/);
  }
  assert.equal(buildIdentityWorkbench({ ...candidate, reviewReason: "COLLABORATION" }, master), null);
});

test("GET enrichment is response-only; KST month and July/August bytes remain unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "identity-workbench-"));
  try {
    await mkdir(join(dir, "ecount-sales"));
    const files = { "brand-master.json": master, "pending-brand-queue.json": { version: 1, candidates: [candidate] }, "product-registry.json": { entries: sources.entries }, "cafe24-full-catalog.json": { generatedAt: "2026-08-28", products: sources.products }, "ecount-sales/2026-07.json": { month: "2026-07", salesLines: [] }, "ecount-sales/2026-08.json": { month: "2026-08", salesLines: [] }, "ecount-sales/2026-09.json": { month: "2026-09", importedAt: "2026-09-01", salesLines: [{ date: "2026-09-01", productName: "BORC / A", salesAmount: 1 }, { date: "2026-08-31", productName: "BORC / A", salesAmount: 99 }] } };
    for (const [p,j] of Object.entries(files)) await writeFile(join(dir,p), JSON.stringify(j));
    const s = await readWorkbenchSources(dir, new Date("2026-08-31T15:00:00Z"));
    assert.equal(s.provenance.month, "2026-09");
    assert.equal(s.lines.length, 1);
    const response = await readPendingBrands(dir, { reviewEligibility: true });
    assert.equal(response.candidates[0].uiReview.workbench.executionAllowed, false);
    assert.equal((await readPendingBrands(dir)).candidates[0].uiReview, undefined);
    for (const [p,j] of Object.entries(files)) assert.equal(await readFile(join(dir,p), "utf8"), JSON.stringify(j));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Workbench UI proposal is local-only and execution disabled; write actions remain absent", async () => {
  const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  const fn = js.slice(js.indexOf("async function renderPendingBrandReview("), js.indexOf("async function renderBrandMasterSettings("));
  const c = { ...candidate, uiReview: { ...pendingBrandUiMetadata(candidate, master), workbench: buildIdentityWorkbench(candidate, master, sources) } };
  const rows = { innerHTML: "" }, preview = { textContent: "" };
  const target = { isConnected: true, querySelector: s => s === "[data-pending-filter]" ? { value: "PENDING" } : s === "[data-pending-search]" ? { value: "" } : rows };
  let writes = 0;
  const render = runInNewContext(`${fn}; renderPendingBrandReview`, { $: () => target, esc: String, apiNum: Number, getJson: async () => ({ candidates: [c] }), postJson: () => writes++ });
  await render(master.brands);
  assert.match(rows.innerHTML, /관련 기존 Brand Master 후보/);
  assert.match(rows.innerHTML, /Birth of Royal Child/);
  assert.match(rows.innerHTML, /RELATED_ONLY/);
  assert.match(rows.innerHTML, /disabled>실제 재지정 불가/);
  assert.match(rows.innerHTML, /historical saved months/);
  assert.doesNotMatch(rows.innerHTML, /data-pending-action="(?:NEW|LINK|REASSIGN_CURRENT_CODE)"/);
  target.onchange({ target: { matches: () => true, value: "보존 후보 검토", closest: () => ({ querySelector: () => preview }) } });
  assert.match(preview.textContent, /저장\/실행 없음/);
  assert.equal(writes, 0);
});
