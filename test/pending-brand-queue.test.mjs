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
import { pendingBrandUiMetadata, reviewedProductEvidence } from "../scripts/pending-brand-ui-metadata.mjs";

const canonical = { brands: [{ brand_code: "B1", brand_name: "Known", name_aliases: ["Known alias"], active: true, nameSource: "suggested" }] };
const detect = input => detectPendingBrands({ canonical, ...input });
const newBrand = { brand_code: "B2", brand_name: "New Brand" };

const safeConfirmBrands = [
  ["B0000BDS", "SOCIETY DE NOBODIES"], ["B0000BCU", "OURSELVES REMAKE"], ["B0000BDD", "TAE GLOBAL"],
  ["B0000BCQ", "KAMIGIN", "카미긴"], ["B0000BDA", "O. FILES"], ["B0000BDP", "PROFESSOR.E"], ["B0000BCN", "SOMAR", "소마"]
];
function confirmFixture() {
  const master = { updatedAt: "unchanged", brands: safeConfirmBrands.map(([brand_code, name, canonicalName]) => ({
    brand_code, brand_name: canonicalName || name, name_aliases: canonicalName ? [name] : [], active: true, nameSource: "suggested", instagram_tag: "keep"
  })) };
  const cafe24Brands = safeConfirmBrands.map(([brand_code, brand_name]) => ({ brand_code, brand_name, created_date: "2026-09-01T00:00:00Z", product_count: 3 }));
  const recentReview = { codes: master.brands.map(b => b.brand_code), since: "2026-09-01", through: "2026-09-13", evidence: "isolated audit fixture" };
  return { master, cafe24Brands, recentReview, queue: detectPendingBrands({ canonical: master, cafe24Brands, recentReview }) };
}

for (const [code, name] of safeConfirmBrands) test(`CONFIRM_EXISTING queue-only: ${name}`, async () => {
  const { master, queue, cafe24Brands, recentReview } = confirmFixture();
  const candidate = queue.candidates.find(c => c.sourceBrandCode === code);
  const input = { id: candidate.id, action: "CONFIRM_EXISTING", canonicalBrandCode: code, note: "human confirmation" };
  const dir = await mkdtemp(join(tmpdir(), "confirm-brand-"));
  try {
    await mkdir(join(dir, "intelligence"));
    const entries = [["brand-master.json", master], ["intelligence/brand-master-list.json", [{ id: code }]],
      ["intelligence/brand-aliases.json", []], ["product-registry.json", { entries: [{ id: "keep" }] }],
      ["monthly-archive.json", { total: 287916120 }], ["pending-brand-queue.json", queue]];
    for (const [file, value] of entries) await writeFile(join(dir, file), JSON.stringify(value));
    const view = await readPendingBrands(dir, { reviewEligibility: true });
    assert.equal(view.candidates.find(c => c.id === candidate.id).confirmExistingBrandCode, code);
    for (const [file, value] of entries) assert.equal(await readFile(join(dir, file), "utf8"), JSON.stringify(value), "GET must not mutate");
    const replaced = [];
    const result = await reviewPendingBrand(dir, input, () => assert.fail("must not build compatibility"), {
      replace: async (from, to) => { replaced.push(to); await rename(from, to); }
    });
    assert.deepEqual(replaced, [join(dir, "pending-brand-queue.json")]);
    assert.equal(result.candidate.status, "APPROVED");
    assert.equal(result.candidate.approvalAction, "CONFIRM_EXISTING");
    assert.equal(result.candidate.canonicalBrandCode, code);
    assert.equal(result.candidate.note, input.note);
    assert.ok(Number.isFinite(Date.parse(result.candidate.approvedAt)));
    for (const [file, value] of entries.slice(0, -1)) assert.equal(await readFile(join(dir, file), "utf8"), JSON.stringify(value));
    const after = await readFile(join(dir, "pending-brand-queue.json"), "utf8");
    await assert.rejects(reviewPendingBrand(dir, input), /already reviewed/);
    assert.equal(await readFile(join(dir, "pending-brand-queue.json"), "utf8"), after);
    const refreshed = detectPendingBrands({ canonical: master, cafe24Brands, recentReview, previous: JSON.parse(after) });
    const confirmed = refreshed.candidates.find(c => c.id === candidate.id);
    for (const field of ["status", "approvalAction", "approvedAt", "canonicalBrandCode", "note"]) assert.equal(confirmed[field], result.candidate[field]);
    assert.equal(refreshed.candidates.length, 7);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("CONFIRM_EXISTING rejects unsafe types, duplicate/collab evidence, mismatches and ambiguous aliases", () => {
  const { master, queue } = confirmFixture();
  const candidate = queue.candidates[0];
  const input = { id: candidate.id, action: "CONFIRM_EXISTING", canonicalBrandCode: candidate.sourceBrandCode };
  for (const patch of [
    ...["CODE_NAME_CONFLICT", "DUPLICATE_IDENTITY_CONFLICT", "COLLAB_REVIEW", "COLLABORATION", "UNRESOLVED", "ALIAS_CONFLICT"].map(reviewReason => ({ reviewReason })),
    { relatedCandidateIds: ["duplicate"] }, { collabCandidates: ["A", "B"] }, { sourceBrandCode: null },
    { rawBrandName: "Unrecognized" }, { cafe24Name: "Different name" }, { ecountVariants: ["Unknown alias"] }
  ]) {
    const changed = { ...queue, candidates: [{ ...candidate, ...patch }] };
    assert.throws(() => planPendingBrandDecision(master, changed, input), /not eligible/);
  }
  assert.throws(() => planPendingBrandDecision(master, queue, { ...input, id: "missing" }), /not found/);
  for (const canonicalBrandCode of [undefined, "OTHER", master.brands[1].brand_code]) {
    assert.throws(() => planPendingBrandDecision(master, queue, { ...input, canonicalBrandCode }), /mismatched/);
  }
  const ambiguous = { brands: [...master.brands, { brand_code: "OTHER", brand_name: "Other", active: false, name_aliases: [candidate.rawBrandName] }] };
  assert.throws(() => planPendingBrandDecision(ambiguous, queue, input), /not eligible/);
  assert.throws(() => planPendingBrandDecision(master, queue, input, undefined, [{ alias: candidate.rawBrandName, brandId: "OTHER" }]), /not eligible/);
  const normalized = { ...queue, candidates: [{ ...candidate, rawBrandName: "  society   de NOBODIES  " }] };
  assert.equal(planPendingBrandDecision(master, normalized, input).candidate.status, "APPROVED");
  assert.deepEqual(planPendingBrandDecision(master, normalized, input).canonical, master);
});

test("CONFIRM_EXISTING eligibility and persistence reject new compatibility ambiguity without writes", async () => {
  const { master, queue } = confirmFixture();
  const dir = await mkdtemp(join(tmpdir(), "confirm-conflict-"));
  try {
    await mkdir(join(dir, "intelligence"));
    const candidate = queue.candidates[0];
    const entries = [["brand-master.json", master], ["pending-brand-queue.json", queue],
      ["intelligence/brand-aliases.json", [{ alias: candidate.rawBrandName, brandId: "OTHER" }]]];
    for (const [file, value] of entries) await writeFile(join(dir, file), JSON.stringify(value));
    assert.equal((await readPendingBrands(dir, { reviewEligibility: true })).candidates[0].confirmExistingBrandCode, null);
    await assert.rejects(reviewPendingBrand(dir, { id: candidate.id, action: "CONFIRM_EXISTING", canonicalBrandCode: candidate.sourceBrandCode }), /not eligible/);
    for (const [file, value] of entries) assert.equal(await readFile(join(dir, file), "utf8"), JSON.stringify(value));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

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
  const result = detect({ cafe24Brands: [{ brand_code: " b1 ", brand_name: " KNOWN  alias " }], ecountLines: [
    { BRAND: " KNOWN  alias " }, { productName: "[known] item" }, { productName: "Compat / item" }
  ], compatibility: [{ id: "C1", name: "Compatibility" }], aliases: [{ alias: "Compat", brandId: "C1" }] });
  assert.equal(result.candidates.length, 0);
});

test("known code requires exact canonical name or unambiguous known alias, never fuzzy", () => {
  for (const name of ["Known", " known ", "KNOWN ALIAS", "Known   alias"]) {
    assert.equal(detect({ cafe24Brands: [{ brand_code: "B1", brand_name: name }] }).candidates.length, 0);
  }
  assert.equal(detect({ cafe24Brands: [{ brand_code: "B1", brand_name: "Knowns" }] }).candidates[0].reviewReason, "CODE_NAME_CONFLICT");
  const ambiguous = { brands: [...canonical.brands, { brand_code: "OTHER", brand_name: "Known alias" }] };
  assert.equal(detect({ canonical: ambiguous, cafe24Brands: [{ brand_code: "B1", brand_name: "Known alias" }] }).candidates[0].reviewReason, "ALIAS_CONFLICT");
});

const driftCases = [["B0000BDG", "BORC", "PERSONSOUL"], ["B0000BDJ", "GKL", "UNDER THE SIGN"], ["B0000BDM", "LAMASKARADE", "PRAYING"]];
test("three real code conflicts enrich existing ECOUNT IDs and preserve all 12 pending rows", () => {
  const brands = driftCases.map(([brand_code, brand_name]) => ({ brand_code, brand_name, name_aliases: [], nameSource: "suggested" }));
  const ecountLines = [...driftCases.map(([, , BRAND]) => ({ BRAND })), ...Array.from({ length: 9 }, (_, i) => ({ BRAND: `Unresolved ${i}` }))];
  const input = { canonical: { brands }, ecountLines };
  const first = detectPendingBrands(input);
  const before = JSON.stringify(input.canonical);
  const cafe24Brands = driftCases.map(([brand_code, , brand_name]) => ({ brand_code, brand_name, product_count: 23 }));
  const second = detectPendingBrands({ ...input, previous: first, cafe24Brands });
  assert.equal(second.candidates.length, 12);
  assert.deepEqual(second.candidates.map(c => c.id), first.candidates.map(c => c.id));
  for (const [code, oldName, name] of driftCases) {
    const c = second.candidates.find(c => c.rawBrandName === name);
    assert.equal(c.reviewReason, "CODE_NAME_CONFLICT");
    assert.equal(c.source, "BOTH");
    assert.equal(c.sourceBrandCode, code);
    assert.equal(c.canonicalName, oldName);
    assert.equal(c.cafe24Name, name);
    assert.equal(c.cafe24ProductCount, 23);
    assert.equal(c.status, "PENDING");
    assert.ok(c.ecountVariants.includes(name));
  }
  const repeated = detectPendingBrands({ ...input, previous: second, cafe24Brands });
  assert.equal(repeated.candidates.length, 12);
  assert.deepEqual(repeated.candidates.map(c => c.id), first.candidates.map(c => c.id));
  assert.equal(JSON.stringify(input.canonical), before);
});

test("recent review is explicit, source-dated, bounded and never requeues 296 suggested by default", () => {
  const brands = Array.from({ length: 297 }, (_, i) => ({ brand_code: `C${i}`, brand_name: `Brand ${i}`, nameSource: i === 296 ? "confirmed" : "suggested" }));
  const cafe24Brands = brands.map(b => ({ ...b, created_date: "2026-09-04T17:12:49+09:00" }));
  const input = { canonical: { brands }, cafe24Brands };
  assert.equal(detectPendingBrands(input).candidates.length, 0);
  const recentReview = { codes: ["C1", "C296"], since: "2026-07-01", through: "2026-09-13", evidence: "Audited Cafe24 registration; onboarding unknown" };
  const queue = detectPendingBrands({ ...input, recentReview });
  assert.equal(queue.candidates.length, 1);
  assert.equal(queue.candidates[0].reviewReason, "RECENT_AUTO_SEEDED_REVIEW");
  assert.equal(queue.candidates[0].sourceBrandCode, "C1");
  assert.deepEqual(queue.candidates[0].recentReviewEvidence.codes, ["C1"]);
  cafe24Brands[1].created_date = undefined;
  assert.equal(detectPendingBrands({ ...input, recentReview }).candidates.length, 0);
  cafe24Brands[1].created_date = "2025-01-01T00:00:00+09:00";
  assert.equal(detectPendingBrands({ ...input, recentReview }).candidates.length, 0);
  assert.throws(() => detectPendingBrands({ ...input, recentReview: { codes: ["C1"] } }), /Invalid recent review/);
  assert.throws(() => detectPendingBrands({ ...input, recentReview: { ...recentReview, since: "2026-02-30" } }), /Invalid recent review/);
});

test("ambiguous ECOUNT names retain IDs and cross-reference separate Cafe24 code reviews", () => {
  const brands = [{ brand_code: "A", brand_name: "Shared" }, { brand_code: "B", brand_name: "Shared" }];
  const first = detectPendingBrands({ canonical: { brands }, ecountLines: [{ BRAND: "Shared" }] });
  const input = { canonical: { brands }, cafe24Brands: brands, ecountLines: [{ BRAND: "Shared" }] };
  const q = detectPendingBrands({ ...input, previous: first });
  assert.equal(q.candidates.length, 3);
  assert.equal(q.candidates.find(c => c.id === first.candidates[0].id).sourceBrandCode, null);
  for (const c of q.candidates) assert.equal(c.relatedCandidateIds.length, 2);
  const repeated = detectPendingBrands({ ...input, previous: q });
  assert.deepEqual(repeated.candidates.map(c => c.id), q.candidates.map(c => c.id));
});

test("explicit reviewed state remains reviewed on refresh, including recent audit input", () => {
  const input = { canonical, cafe24Brands: [{ brand_code: "B1", brand_name: "Known", created_date: "2026-09-04T00:00:00+09:00" }],
    recentReview: { codes: ["B1"], since: "2026-07-01", through: "2026-09-13", evidence: "Audited source registration" } };
  const first = detectPendingBrands(input);
  const reviewed = planPendingBrandDecision(canonical, first, { id: first.candidates[0].id, action: "IGNORE", note: "human decision" });
  const q = detectPendingBrands({ ...input, previous: reviewed.queue });
  assert.equal(q.candidates.length, 1);
  assert.equal(q.candidates[0].status, "IGNORED");
  assert.equal(q.candidates[0].approvedAt, reviewed.candidate.approvedAt);
  assert.equal(q.candidates[0].note, "human decision");
});

test("a later different source identity creates a linked review without overwriting a reviewed decision", () => {
  const first = detect({ cafe24Brands: [{ brand_code: "B1", brand_name: "First change" }] });
  const reviewed = planPendingBrandDecision(canonical, first, { id: first.candidates[0].id, action: "IGNORE", note: "old decision" });
  const input = { cafe24Brands: [{ brand_code: "B1", brand_name: "Second change" }] };
  const next = detect({ ...input, previous: reviewed.queue });
  assert.equal(next.candidates.length, 2);
  assert.deepEqual(next.candidates.find(c => c.id === first.candidates[0].id), reviewed.candidate);
  const pending = next.candidates.find(c => c.status === "PENDING");
  assert.equal(pending.rawBrandName, "Second change");
  assert.ok(pending.relatedCandidateIds.includes(reviewed.candidate.id));
  assert.equal(detect({ ...input, previous: next }).candidates.length, 2);
});

test("conflict review rejects reassignment/old-owner alias; explicit name-only LINK preserves code ownership", () => {
  const master = { brands: [...canonical.brands, { brand_code: "B2", brand_name: "New identity", name_aliases: [] }] };
  const queue = detect({ canonical: master, cafe24Brands: [{ brand_code: "B1", brand_name: "New identity" }] });
  const id = queue.candidates[0].id;
  for (const action of ["NEW", "REASSIGN"]) assert.throws(() => planPendingBrandDecision(master, queue, { id, action, brandName: "New identity" }));
  assert.throws(() => planPendingBrandDecision(master, queue, { id, action: "LINK", canonicalBrandCode: "B1" }), /conflicting code owner/);
  const linked = planPendingBrandDecision(master, queue, { id, action: "LINK", canonicalBrandCode: "B2" });
  assert.deepEqual(linked.canonical, master, "conflict LINK confirms an existing exact claim without global alias writes");
  const unmatchedTarget = { brands: [...master.brands, { brand_code: "B3", brand_name: "Other identity", name_aliases: [] }] };
  assert.throws(() => planPendingBrandDecision(unmatchedTarget, queue, { id, action: "LINK", canonicalBrandCode: "B3" }), /historical identity review/);
  assert.deepEqual(linked.canonical.brands[0], master.brands[0]);
  assert.equal(linked.canonical.brands[1].sourceCafe24Codes, undefined);
  assert.equal(approvedCafe24BrandCode("B1", linked.canonical), "B1");
  assert.equal(linked.candidate.canonicalName, "Known", "old association remains in review history");
  for (const action of ["IGNORE", "HOLD"]) {
    const result = planPendingBrandDecision(master, queue, { id, action, note: "No identity decision" });
    assert.deepEqual(result.canonical, master);
    assert.equal(result.candidate.status, action === "HOLD" ? "PENDING" : "IGNORED");
  }
});

test("drift refresh writes only queue; net unresolved accounting and immutable fixtures untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pending-drift-test-"));
  try {
    const files = ["brand-master.json", "product-registry.json", "july-archive.json", "august-archive.json", "sales-snapshot.json"];
    const bytes = JSON.stringify(canonical);
    for (const file of files) await writeFile(join(dir, file), bytes);
    const lines = [{ productName: "Different / item", date: "2026-09-01", salesAmount: 12000, isOfflineRevenue: true }, { productName: "Different / return", date: "2026-09-01", salesAmount: -2000, isOfflineRevenue: true }];
    const context = { brandMaster: canonical, brandRegistry: buildBrandRegistry(canonical), productRegistry: { entries: [] }, reviewQueue: null };
    const before = mergeOfflineBrandSales({ offlineLines: lines, identityContext: context });
    const queue = await refreshPendingBrands(dir, async () => ({ canonical, cafe24Brands: [{ brand_code: "B1", brand_name: "Different" }], ecountLines: lines }));
    assert.equal(queue.candidates[0].reviewReason, "CODE_NAME_CONFLICT");
    assert.deepEqual(mergeOfflineBrandSales({ offlineLines: lines, identityContext: context }), before);
    assert.equal(before.find(b => b.brand_code === "UNASSIGNED").salesAmount, 10000);
    for (const file of files) assert.equal(await readFile(join(dir, file), "utf8"), bytes);
    await reviewPendingBrand(dir, { id: queue.candidates[0].id, action: "HOLD", note: "await migration" }, () => { throw new Error("must not build compatibility"); });
    for (const file of files) assert.equal(await readFile(join(dir, file), "utf8"), bytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
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
    for (const action of ["NEW", "LINK", "IGNORE", "CONFIRM_EXISTING"]) {
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
    const badRecent = await http(port, "/api/pending-brands/refresh", { method: "POST", token: "test-only", payload: { recentReview: { codes: ["B1"] } } });
    assert.equal(badRecent.status, 400);
    const recent = await http(port, "/api/pending-brands/refresh?dryRun=1", { method: "POST", token: "test-only", payload: { recentReview: {
      codes: ["B1"], since: "2026-07-01", through: "2026-09-13", evidence: "fixture audit"
    } } });
    assert.equal(recent.status, 200);
    assert.equal(recent.body.dryRun, true);
    const fixture = confirmFixture();
    await writeFile(join(dir, "brand-master.json"), JSON.stringify(fixture.master));
    await writeFile(join(dir, "pending-brand-queue.json"), JSON.stringify(fixture.queue));
    const confirmCandidate = fixture.queue.candidates[0];
    const confirmInput = { id: confirmCandidate.id, action: "CONFIRM_EXISTING", canonicalBrandCode: confirmCandidate.sourceBrandCode };
    assert.equal((await http(port, "/api/pending-brands")).body.candidates[0].confirmExistingBrandCode, confirmInput.canonicalBrandCode);
    const confirmed = await http(port, "/api/pending-brands/review", { method: "POST", token: "test-only", payload: confirmInput });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.candidate.approvalAction, "CONFIRM_EXISTING");
    assert.equal(confirmed.body.candidate.status, "APPROVED");
    assert.equal(await readFile(join(dir, "brand-master.json"), "utf8"), JSON.stringify(fixture.master));
    assert.equal((await http(port, "/api/pending-brands/review", { method: "POST", token: "test-only", payload: confirmInput })).status, 400);
    assert.equal((await http(port, "/api/pending-brands/review", { method: "POST", token: "test-only", payload: { ...confirmInput, id: "missing" } })).status, 400);
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
  pending.uiReview = pendingBrandUiMetadata(pending, canonical);
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
  for (const name of ["card", "header", "meta", "evidence", "actions"]) {
    assert.match(rows.innerHTML, new RegExp(`class="[^"]*pending-review-${name}`));
  }
  for (const action of ["NEW", "HOLD", "IGNORE"]) assert.match(rows.innerHTML, new RegExp(`data-pending-action="${action}"`));
  assert.doesNotMatch(rows.innerHTML, /data-pending-action="LINK"/);
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

test("confirm UI uses validated target, removes Pending row and shows reviewed action without other writes", async () => {
  const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  const fn = js.slice(js.indexOf("async function renderPendingBrandReview("), js.indexOf("async function renderBrandMasterSettings("));
  const { master, queue } = confirmFixture();
  let current = queue;
  const candidate = queue.candidates[0];
  const filter = { value: "PENDING" }, rows = { innerHTML: "" };
  const target = { isConnected: true, innerHTML: "", querySelector: s => s === "[data-pending-filter]" ? filter : rows };
  const writes = [];
  const render = runInNewContext(`${fn}; renderPendingBrandReview`, {
    $: () => target, getJson: async () => ({ candidates: [
      ...current.candidates.map(c => ({ ...c, confirmExistingBrandCode: c.status === "PENDING" ? c.sourceBrandCode : null })),
      ...["CODE_NAME_CONFLICT", "DUPLICATE_IDENTITY_CONFLICT", "COLLABORATION", "UNRESOLVED"].map(reviewReason => ({
        ...candidate, id: reviewReason, reviewReason, rawBrandName: reviewReason, confirmExistingBrandCode: null
      }))
    ] }), esc: String, apiNum: Number, confirm: () => true, toast: message => assert.fail(message),
    postJson: async (path, payload) => {
      writes.push({ path, payload });
      const result = planPendingBrandDecision(master, current, payload);
      current = result.queue;
      return { ok: true };
    }, renderBrandMasterSettings: async () => { filter.value = "PENDING"; await render(master.brands); }
  });
  await render(master.brands);
  assert.equal(writes.length, 0);
  assert.equal((rows.innerHTML.match(/data-pending-action="CONFIRM_EXISTING"/g) || []).length, 7);
  assert.match(rows.innerHTML, /기존 등록 확인/);
  for (const type of ["CODE_NAME_CONFLICT", "DUPLICATE_IDENTITY_CONFLICT", "COLLABORATION", "UNRESOLVED"]) {
    const article = rows.innerHTML.split(`data-pending-id="${type}"`)[1].split("</article>")[0];
    assert.doesNotMatch(article, /CONFIRM_EXISTING/);
  }
  const row = { dataset: { pendingId: candidate.id }, querySelector: () => ({ value: "NOT THE TARGET" }) };
  const button = { dataset: { pendingAction: "CONFIRM_EXISTING", confirmBrandCode: candidate.sourceBrandCode }, closest: () => row };
  await target.onclick({ target: { closest: () => button } });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/api/pending-brands/review");
  assert.equal(writes[0].payload.canonicalBrandCode, candidate.sourceBrandCode);
  assert.doesNotMatch(rows.innerHTML, new RegExp(`data-pending-id="${candidate.id}"`));
  filter.value = "REVIEWED"; filter.onchange();
  assert.match(rows.innerHTML, /CONFIRM_EXISTING/);
  assert.ok(rows.innerHTML.includes(candidate.sourceBrandCode));
  assert.doesNotMatch(rows.innerHTML, /data-pending-action/);
});

test("drift UI shows both identities, evidence and hold without read-time writes", async () => {
  const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  const fn = js.slice(js.indexOf("async function renderPendingBrandReview("), js.indexOf("async function renderBrandMasterSettings("));
  const c = detect({ cafe24Brands: [{ brand_code: "B1", brand_name: "PERSONSOUL", product_count: 23 }] }).candidates[0];
  const rows = { innerHTML: "" }, filter = { value: "PENDING" };
  const target = { isConnected: true, innerHTML: "", querySelector: s => s === "[data-pending-filter]" ? filter : rows };
  const writes = [];
  const render = runInNewContext(`${fn}; renderPendingBrandReview`, {
    $: () => target, getJson: async () => ({ candidates: [c] }), esc: String, apiNum: Number,
    confirm: () => true, toast: () => {}, postJson: async (...args) => { writes.push(args); return { ok: true }; }, renderBrandMasterSettings: async () => {}
  });
  await render(canonical.brands);
  for (const text of ["브랜드 코드 이름 충돌", "기존: Known", "현재 Cafe24: PERSONSOUL", "B1", "23개", "별도 검토 필요"]) assert.ok(rows.innerHTML.includes(text), text);
  assert.doesNotMatch(rows.innerHTML, /data-pending-action="(?:NEW|LINK)"/);
  assert.match(rows.innerHTML, /data-pending-action="HOLD"/);
  assert.equal(writes.length, 0);
  const row = { dataset: { pendingId: c.id }, querySelector: () => ({ value: "await review" }) };
  const button = { dataset: { pendingAction: "HOLD" }, closest: () => row };
  await target.onclick({ target: { closest: () => button } });
  assert.equal(writes[0][1].action, "HOLD");
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

test("Master comparison is exact, read-only, and independent of action eligibility", () => {
  const master = { brands: [{ brand_code: "B1", brand_name: "BORC", name_aliases: ["Old Alias"] }, { brand_code: "B2", brand_name: "Known", name_aliases: ["Known Alias"] }] };
  const base = { rawBrandName: "PERSONSOUL", sourceBrandCode: "B1", status: "PENDING", reviewReason: "CODE_NAME_CONFLICT" };
  const before = JSON.stringify(master);
  const comparison = c => pendingBrandUiMetadata(c, master).masterComparison;
  assert.equal(comparison(base).result, "CODE_NAME_CONFLICT");
  assert.equal(comparison(base).codeMatchCanonicalName, "BORC");
  assert.equal(comparison(base).exactNameMatches.length, 0);
  assert.equal(comparison(base).exactAliasMatches.length, 0);
  assert.equal(comparison({ ...base, sourceBrandCode: null, rawBrandName: " known " }).result, "EXACT_EXISTING");
  assert.equal(comparison({ ...base, sourceBrandCode: null, rawBrandName: "known alias" }).result, "ALIAS_EXISTING");
  const duplicate = comparison({ ...base, rawBrandName: "Known" });
  assert.equal(duplicate.result, "DUPLICATE_IDENTITY");
  assert.equal(duplicate.duplicateIdentityCount, 2);
  assert.equal(comparison({ ...base, sourceBrandCode: null, rawBrandName: "Kno" }).result, "NO_EXISTING_IDENTITY", "no fuzzy match");
  assert.equal(pendingBrandUiMetadata(base, null).masterComparison.result, "UNKNOWN");
  assert.equal(pendingBrandUiMetadata(base, master).recommendedUiAction, null);
  assert.equal(JSON.stringify(master), before);
});

test("conflict Master search selection is read-only and IGNORE stays inside secondary disclosure", async () => {
  const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  const fn = js.slice(js.indexOf("async function renderPendingBrandReview("), js.indexOf("async function renderBrandMasterSettings("));
  const brands = [{ brand_code: "B1", brand_name: "BORC", name_aliases: [] }];
  const candidate = { id: "conflict", rawBrandName: "PERSONSOUL", sourceBrandCode: "B1", source: "CAFE24", status: "PENDING", reviewReason: "CODE_NAME_CONFLICT" };
  candidate.uiReview = pendingBrandUiMetadata(candidate, brands);
  const rows = { innerHTML: "" }, fields = { "[data-brand-results]": { innerHTML: "" }, "[data-brand-selected]": { textContent: "" } };
  const target = { isConnected: true, querySelector: s => s === "[data-pending-filter]" ? { value: "PENDING" } : s === "[data-pending-search]" ? { value: "" } : rows };
  const row = { dataset: { pendingId: candidate.id }, querySelector: s => fields[s] || null };
  let writes = 0;
  const render = runInNewContext(`${fn}; renderPendingBrandReview`, { $: () => target, getJson: async () => ({ candidates: [candidate] }), esc: String, apiNum: Number, postJson: async () => { writes++; } });
  await render(brands);
  assert.match(rows.innerHTML, /브랜드 코드 이름 충돌/);
  assert.match(rows.innerHTML, /Brand Master에서 BORC로 등록/);
  assert.match(rows.innerHTML, /CODE: BORC · B1/);
  assert.match(rows.innerHTML, /EXACT NAME: 없음/);
  assert.match(rows.innerHTML, /기존 Brand Master에서 검색/);
  assert.match(rows.innerHTML, /<summary>검토 보류<\/summary>/);
  assert.match(rows.innerHTML, /<summary>기타 작업<\/summary>[\s\S]*data-pending-action="IGNORE"/);
  assert.doesNotMatch(rows.innerHTML, /data-pending-action="(?:NEW|LINK)"|data-pending-target/);
  target.oninput({ target: { value: "borc", matches: () => true, closest: () => row } });
  assert.match(fields["[data-brand-results]"].innerHTML, /BORC/);
  await target.onclick({ target: { closest: () => ({ dataset: { brandChoice: "B1" }, closest: () => row }) } });
  assert.equal(fields["[data-brand-selected]"].textContent, "선택: BORC (B1)");
  assert.equal(writes, 0);
  assert.doesNotMatch(rows.innerHTML, /data-pending-action="LINK"|data-pending-target/);
});

test("search picker filters name/alias/code without selection; only explicit choice plus confirmation writes LINK", async () => {
  const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  const fn = js.slice(js.indexOf("async function renderPendingBrandReview("), js.indexOf("async function renderBrandMasterSettings("));
  const candidate = { id: "candidate", rawBrandName: "LYM", status: "PENDING", source: "ECOUNT", reviewReason: "UNRESOLVED", uiReview: { operationalClass: "ECOUNT_ALIAS_GAP", recommendedUiAction: "LINK", reviewCanonicalTarget: "B00000LI" } };
  const brands = [
    { brand_code: "B00000LI", brand_name: "LIBERAL YOUTH MINISTRY", name_aliases: ["LYM"] },
    { brand_code: "B00000ZT", brand_name: "PACOSPLY", name_aliases: ["Paco Alias"] }
  ];
  const filter = { value: "PENDING" }, search = { value: "" }, rows = { innerHTML: "" };
  const target = { isConnected: true, querySelector: s => s === "[data-pending-filter]" ? filter : s === "[data-pending-search]" ? search : rows };
  const fields = Object.fromEntries(["target", "name", "note"].map(k => [`[data-pending-${k}]`, { value: "" }]));
  fields["[data-brand-results]"] = { innerHTML: "" };
  fields["[data-brand-selected]"] = { textContent: "" };
  const row = { dataset: { pendingId: candidate.id }, querySelector: s => fields[s] };
  const writes = [], notices = [];
  let allow = false, confirmations = 0;
  const render = runInNewContext(`${fn}; renderPendingBrandReview`, {
    $: () => target, getJson: async () => ({ candidates: [candidate] }), esc: String, apiNum: Number,
    confirm: () => { confirmations++; return allow; }, toast: text => notices.push(text),
    postJson: async (...args) => { writes.push(args); return { ok: true }; }, renderBrandMasterSettings: async () => {}
  });
  await render(brands);
  assert.match(rows.innerHTML, /placeholder="기존 브랜드 검색"/);
  assert.doesNotMatch(rows.innerHTML, /<select data-pending-target/);
  const type = value => target.oninput({ target: { value, matches: () => true, closest: () => row } });
  for (const query of ["liberal", "  LiBeRaL   YoUtH  ", "lym", "b00000li"]) {
    type(query);
    assert.match(fields["[data-brand-results]"].innerHTML, /LIBERAL YOUTH MINISTRY/);
    assert.doesNotMatch(fields["[data-brand-results]"].innerHTML, /PACOSPLY/);
    assert.equal(fields["[data-pending-target]"].value, "", "search never selects a target");
  }
  type("paco alias");
  assert.match(fields["[data-brand-results]"].innerHTML, /PACOSPLY/);
  type("no matching brand");
  assert.equal(fields["[data-brand-results]"].innerHTML, "검색 결과 없음");
  type("");
  assert.equal(fields["[data-brand-results]"].innerHTML, "");
  const link = { dataset: { pendingAction: "LINK" }, closest: () => row };
  const clickLink = () => target.onclick({ target: { closest: s => s === "[data-brand-choice]" ? null : link } });
  await clickLink();
  assert.equal(writes.length, 0);
  assert.equal(confirmations, 0, "missing selection is rejected before confirmation");
  assert.equal(notices.length, 1);
  type("lym");
  const choice = { dataset: { brandChoice: "B00000LI" }, closest: () => row };
  await target.onclick({ target: { closest: () => choice } });
  assert.equal(fields["[data-pending-target]"].value, "B00000LI");
  assert.equal(fields["[data-brand-selected]"].textContent, "선택: LIBERAL YOUTH MINISTRY (B00000LI)");
  assert.equal(writes.length, 0, "result click is not a review write");
  await clickLink();
  assert.equal(confirmations, 1);
  assert.equal(writes.length, 0, "cancelled final confirmation cannot write");
  allow = true;
  await clickLink();
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "/api/pending-brands/review");
  assert.equal(writes[0][1].action, "LINK");
  assert.equal(writes[0][1].canonicalBrandCode, "B00000LI");
  type("paco");
  assert.equal(fields["[data-pending-target]"].value, "", "editing search invalidates stale selection");
});

test("queue search combines filters; compact native disclosures preserve evidence and isolate NEW/LINK fields", async () => {
  const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  const fn = js.slice(js.indexOf("async function renderPendingBrandReview("), js.indexOf("async function renderBrandMasterSettings("));
  const filter = { value: "PENDING" }, search = { value: "" }, rows = { innerHTML: "" };
  const target = { isConnected: true, querySelector: s => s === "[data-pending-filter]" ? filter : s === "[data-pending-search]" ? search : rows };
  const candidates = [
    { id: "new", rawBrandName: "New Brand", source: "CAFE24", status: "PENDING", reviewReason: "UNRESOLVED", sourceBrandCode: "BNEW", relatedProductCount: 3, relatedProductExamples: ["Evidence product"], uiReview: { operationalClass: "TRUE_NEW_BRAND", recommendedUiAction: "NEW" } },
    { id: "conflict", rawBrandName: "PERSONSOUL", cafe24Name: "Personsoul current", canonicalName: "BORC", sourceBrandCode: "BCONFLICT", source: "BOTH", status: "PENDING", reviewReason: "CODE_NAME_CONFLICT" },
    { id: "confirmed", rawBrandName: "Existing", source: "CAFE24", status: "PENDING", reviewReason: "RECENT_AUTO_SEEDED_REVIEW", confirmExistingBrandCode: "BEXIST" },
    { id: "reviewed", rawBrandName: "Reviewed", status: "IGNORED", approvalAction: "IGNORE" }
  ];
  const render = runInNewContext(`${fn}; renderPendingBrandReview`, { $: () => target, getJson: async () => ({ candidates }), esc: String, apiNum: Number });
  await render([]);
  assert.match(target.innerHTML, /후보 브랜드 검색/);
  assert.equal((rows.innerHTML.match(/<article /g) || []).length, 3);
  assert.doesNotMatch(rows.innerHTML, /<details[^>]*\sopen(?:[\s=>])/);
  const first = rows.innerHTML.split('data-pending-id="new"')[1].split("</article>")[0];
  assert.match(first, /관련 상품: 3개/);
  assert.match(first, /<details class="pending-review-evidence"><summary>상세 보기<\/summary>[\s\S]*Evidence product[\s\S]*<\/details>/);
  const flows = [...first.matchAll(/<details name="pending-new"[^>]*>([\s\S]*?)<\/details>/g)].map(m => m[1]);
  assert.equal(flows.length, 4, "NEW, read-only search, HOLD and other actions are mutually exclusive disclosures");
  assert.match(flows[0], /data-pending-name/);
  assert.doesNotMatch(flows[0], /data-brand-search/);
  assert.match(first, /data-brand-search/, "TRUE_NEW permits read-only Master search");
  assert.doesNotMatch(first, /data-pending-action="LINK"|data-pending-target/, "read-only search does not expose LINK");
  assert.doesNotMatch(flows[1], /data-pending-name/);
  assert.match(flows[2], /data-pending-action="HOLD"/);
  assert.match(flows[3], /data-pending-action="IGNORE"/);
  const conflict = rows.innerHTML.split('data-pending-id="conflict"')[1].split("</article>")[0];
  assert.doesNotMatch(conflict, /data-pending-action="(?:NEW|LINK|CONFIRM_EXISTING)"/);
  const existing = rows.innerHTML.split('data-pending-id="confirmed"')[1].split("</article>")[0];
  assert.match(existing, /data-confirm-brand-code="BEXIST"/);
  assert.doesNotMatch(existing, /data-pending-action="(?:NEW|LINK)"/);
  for (const query of ["personSOUL", "  Personsoul   current ", "borc", "bconflict"]) {
    search.value = query; search.oninput();
    assert.equal((rows.innerHTML.match(/<article /g) || []).length, 1);
    assert.match(rows.innerHTML, /PERSONSOUL/);
  }
  filter.value = "CAFE24"; filter.onchange();
  assert.doesNotMatch(rows.innerHTML, /<article /);
  search.value = ""; search.oninput();
  assert.equal((rows.innerHTML.match(/<article /g) || []).length, 2);
  filter.value = "REVIEWED"; filter.onchange();
  assert.match(rows.innerHTML, /Reviewed/);
  assert.doesNotMatch(rows.innerHTML, /data-pending-action=/);
});

test("read-only operational metadata requires exact reviewed evidence and fails closed on identity drift", () => {
  for (const proof of reviewedProductEvidence) {
    const rawBrandName = proof.ecountProductName.split(" / ")[0];
    const c = { id: proof.candidateId, rawBrandName, status: "PENDING", source: "ECOUNT", reviewReason: "UNRESOLVED", relatedProductExamples: [proof.ecountProductName], ecountVariants: [rawBrandName] };
    const master = { brands: [{ brand_code: proof.canonicalBrandCode, brand_name: proof.canonicalNames[0], name_aliases: [] }] };
    const before = JSON.stringify({ c, master });
    const metadata = pendingBrandUiMetadata(c, master);
    assert.equal(metadata.operationalClass, "ECOUNT_ALIAS_GAP");
    assert.equal(metadata.recommendedUiAction, "LINK");
    assert.equal(metadata.reviewCanonicalTarget, proof.canonicalBrandCode);
    assert.equal(metadata.reviewEvidence.cafe24ProductNo, proof.cafe24ProductNo);
    assert.equal(JSON.stringify({ c, master }), before);
    for (const changed of [
      { id: "different identity" }, { relatedProductExamples: [] }, { rawBrandName: "Different brand" },
      { ecountVariants: ["different identity"] }, { possibleExistingCanonical: ["OTHER"] },
      { heldAt: "2026-09-18" }, { canonicalName: "Other" }, { relatedCandidateIds: ["duplicate"] },
      ...["CODE_NAME_CONFLICT", "ALIAS_CONFLICT", "DUPLICATE_IDENTITY_CONFLICT", "COLLAB_REVIEW", "COLLABORATION", "UNKNOWN", "HOLD"].map(reviewReason => ({ reviewReason }))
    ]) assert.equal(pendingBrandUiMetadata({ ...c, ...changed }, master).recommendedUiAction, null, JSON.stringify(changed));
    assert.equal(pendingBrandUiMetadata(c, { brands: [] }).recommendedUiAction, null);
    assert.equal(pendingBrandUiMetadata(c, { brands: [{ ...master.brands[0], brand_name: "Changed owner" }] }).recommendedUiAction, null);
    assert.equal(pendingBrandUiMetadata(c, master, [], []).recommendedUiAction, null);
    assert.equal(pendingBrandUiMetadata(c, master, [], [proof, proof]).recommendedUiAction, null);
    assert.equal(pendingBrandUiMetadata(c, master, [{ alias: rawBrandName, brandId: "OTHER" }]).recommendedUiAction, null);
  }
  const c = detect({ cafe24Brands: [newBrand] }).candidates[0];
  assert.equal(pendingBrandUiMetadata(c, canonical).operationalClass, "TRUE_NEW_BRAND");
  assert.equal(pendingBrandUiMetadata(c, null).recommendedUiAction, null);
  assert.equal(pendingBrandUiMetadata({ ...c, source: "ECOUNT", sourceBrandCode: null }, canonical).recommendedUiAction, null);
  assert.equal(pendingBrandUiMetadata(c, { brands: [...canonical.brands, { brand_code: "OTHER", brand_name: c.rawBrandName }] }).recommendedUiAction, null);
  assert.equal(pendingBrandUiMetadata(c, canonical, [{ alias: c.rawBrandName, brandId: "OTHER" }]).recommendedUiAction, null);
});

test("GET metadata never persists, and forged UI hints cannot bypass write validation or change accounting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pending-ui-metadata-"));
  try {
    const queue = detect({ cafe24Brands: [newBrand] });
    await writeFile(join(dir, "brand-master.json"), JSON.stringify(canonical));
    await writeFile(join(dir, "pending-brand-queue.json"), JSON.stringify(queue));
    const before = await readFile(join(dir, "pending-brand-queue.json"), "utf8");
    const response = await readPendingBrands(dir, { reviewEligibility: true });
    assert.equal(response.candidates[0].uiReview.recommendedUiAction, "NEW");
    assert.equal(await readFile(join(dir, "pending-brand-queue.json"), "utf8"), before);
    assert.equal(await readFile(join(dir, "brand-master.json"), "utf8"), JSON.stringify(canonical));
    assert.equal((await readPendingBrands(dir)).candidates[0].uiReview, undefined);
    const c = queue.candidates[0];
    const forged = { operationalClass: "TRUE_NEW_BRAND", recommendedUiAction: "NEW", reviewCanonicalTarget: "B1" };
    for (const uiReview of [undefined, forged]) {
      assert.throws(() => planPendingBrandDecision(canonical, queue, { id: c.id, action: "LINK", canonicalBrandCode: "MISSING", uiReview }), /target not found/);
      assert.throws(() => planPendingBrandDecision(canonical, queue, { id: c.id, action: "CONFIRM_EXISTING", canonicalBrandCode: "B1", uiReview }), /not eligible/);
      const conflict = { ...queue, candidates: [{ ...c, reviewReason: "CODE_NAME_CONFLICT", uiReview }] };
      assert.throws(() => planPendingBrandDecision(canonical, conflict, { id: c.id, action: "NEW", brandName: "Known", uiReview }), /Code reassignment/);
    }
    const input = { id: c.id, action: "NEW", brandName: "New Brand" };
    assert.deepEqual(planPendingBrandDecision(canonical, queue, input, "fixed"), planPendingBrandDecision(canonical, queue, { ...input, uiReview: forged }, "fixed"));
    const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(server, /pendingBrandUiMetadata|reviewedProductEvidence|\.uiReview/);
    for (const path of ["scripts/brand-engine.mjs", "scripts/monthly-brand-sales.mjs", "intelligence-service.mjs"]) {
      const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /pending-brand-ui-metadata|uiReview|reviewedProductEvidence/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("UI hides unsafe actions even with contradictory hints and exposes only NEW, verified LINK or existing confirmation", async () => {
  const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  const fn = js.slice(js.indexOf("async function renderPendingBrandReview("), js.indexOf("async function renderBrandMasterSettings("));
  const rows = { innerHTML: "" }, filter = { value: "PENDING" }, search = { value: "" };
  const target = { isConnected: true, querySelector: s => s === "[data-pending-filter]" ? filter : s === "[data-pending-search]" ? search : rows };
  const newHint = { operationalClass: "TRUE_NEW_BRAND", recommendedUiAction: "NEW" };
  const linkHint = { operationalClass: "ECOUNT_ALIAS_GAP", recommendedUiAction: "LINK", reviewCanonicalTarget: "B1" };
  const base = { status: "PENDING", reviewReason: "UNRESOLVED", rawBrandName: "Example" };
  const candidates = [
    { ...base, id: "new", uiReview: newHint }, { ...base, id: "link", uiReview: linkHint },
    { ...base, id: "missing-target", uiReview: { ...linkHint, reviewCanonicalTarget: "MISSING" } },
    { ...base, id: "no-proof" }, { ...base, id: "held", heldAt: "today", uiReview: newHint },
    { ...base, id: "existing", canonicalName: "Known", uiReview: newHint },
    ...["CODE_NAME_CONFLICT", "DUPLICATE_IDENTITY_CONFLICT", "ALIAS_CONFLICT", "COLLAB_REVIEW", "COLLABORATION", "UNKNOWN", "HOLD"].map(reviewReason => ({ ...base, id: reviewReason, reviewReason, uiReview: newHint })),
    { ...base, id: "confirm", reviewReason: "RECENT_AUTO_SEEDED_REVIEW", confirmExistingBrandCode: "B1", uiReview: newHint }
  ];
  const render = runInNewContext(`${fn}; renderPendingBrandReview`, { $: () => target, getJson: async () => ({ candidates }), esc: String, apiNum: Number });
  await render(canonical.brands);
  const article = id => rows.innerHTML.split(`data-pending-id="${id}"`)[1].split("</article>")[0];
  assert.match(article("new"), /data-pending-action="NEW"/);
  assert.doesNotMatch(article("new"), /data-pending-action="LINK"/);
  assert.match(article("link"), /data-pending-action="LINK"/);
  assert.doesNotMatch(article("link"), /data-pending-action="NEW"/);
  assert.match(article("confirm"), /data-pending-action="CONFIRM_EXISTING"/);
  assert.doesNotMatch(article("confirm"), /data-pending-action="(?:NEW|LINK)"/);
  for (const c of candidates.filter(c => !["new", "link", "confirm"].includes(c.id))) {
    assert.doesNotMatch(article(c.id), /data-pending-action="(?:NEW|LINK|CONFIRM_EXISTING)"/, c.id);
    assert.match(article(c.id), /data-pending-action="HOLD"/);
    assert.match(article(c.id), /data-pending-action="IGNORE"/);
  }
});
