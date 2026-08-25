#!/usr/bin/env node
import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recomputeProductRegistrySummary } from "./product-registry-summary.mjs";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const registryPath = join(rootDir, "work", "product-registry.json");
const masterPath = join(rootDir, "work", "ecount-inventory", "full-products-candidate.json");
const APPLY = process.argv.includes("--apply");
const BASELINE_SHA256 = "ff1b1f22d135bed4206fe5f21370c0df7b4d4261130f4bdd74e447b18998d314";
const REVIEW_EXCLUSIONS = new Set(["12858", "11841", "10417", "10423", "10442"]);
const SAFE10 = {
  "11839": ["RUI253BT00102", "RUI253BT00103", "RUI253BT00104"],
  "11840": ["RUI253ST00301", "RUI253ST00302"],
  "10178": ["SKY251SH00102", "SKY251SH00104"],
  "7705": ["SKY243ST00103", "SKY243ST00104", "SKY243ST00105", "SKY243ST00106"],
  "7706": ["SKY243SH00202", "SKY243SH00203"],
  "12388": ["THE253OT00403", "THE253OT00404", "THE253OT00405"],
  "5547": ["UMA243HD01001", "UMA243HD01002", "UMA243HD01003", "UMA243HD01004", "UMA243HD01005"],
  "5550": ["UMA243OT00902", "UMA243OT00903", "UMA243OT00904", "UMA243OT00905"],
  "11519": ["YUE253LT00303", "YUE253LT00304"],
  "11520": ["YUE253OT00102", "YUE253OT00103", "YUE253OT00104"]
};

const s = (value) => String(value ?? "").trim();
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const rowsOf = (value) => Array.isArray(value) ? value : value?.rows || value?.products || value?.items || value?.data || [];
const codeOf = (row) => s(row?.PROD_CD ?? row?.prodCd ?? row?.productCode ?? row?.product_code);
const nameOf = (row) => s(row?.PROD_DES ?? row?.productName ?? row?.product_name);
const sizeOf = (row) => s(row?.SIZE_DES ?? row?.size ?? row?.SIZE);
const priceOf = (row) => {
  const value = Number(String(row?.OUT_PRICE ?? row?.salesPrice ?? row?.price ?? "").replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
};

function ownershipMap(entries) {
  const map = new Map();
  for (const entry of entries) {
    const owner = s(entry?.cafe24?.productNo);
    for (const row of entry?.ecount?.matchedProducts || []) {
      const code = s(row?.prodCd);
      if (!code) continue;
      if (!map.has(code)) map.set(code, new Set());
      map.get(code).add(owner);
    }
  }
  return map;
}

const duplicates = (entries) => new Map([...ownershipMap(entries)].filter(([, owners]) => owners.size > 1));
const sameSet = (left, right) => left?.size === right?.size && [...(left || [])].every((value) => right.has(value));
const evidenceCount = (entries, source) => entries.filter((entry) => entry?.matching?.evidence?.includes(source)).length;

async function main() {
  const registryText = await readFile(registryPath, "utf8");
  const registry = JSON.parse(registryText);
  const master = rowsOf(JSON.parse(await readFile(masterPath, "utf8")));
  const entries = registry.entries || [];
  const targetProductNos = Object.keys(SAFE10);
  const targetCodes = Object.values(SAFE10).flat();

  assert(sha256(registryText) === BASELINE_SHA256, "registry baseline SHA drift");
  assert(targetProductNos.length === 10, "target product count drift");
  assert(targetCodes.length === 30 && new Set(targetCodes).size === 30, "target SKU count/collision drift");
  assert(!targetProductNos.some((id) => REVIEW_EXCLUSIONS.has(id)), "review exclusion entered SAFE10");

  const byProductNo = new Map(entries.map((entry) => [s(entry?.cafe24?.productNo), entry]));
  const fullByCode = new Map(master.map((row) => [codeOf(row), row]).filter(([code]) => code));
  const currentOwners = ownershipMap(entries);
  const problems = [];
  const proposals = [];

  for (const productNo of targetProductNos) {
    const entry = byProductNo.get(productNo);
    if (!entry) { problems.push({ productNo, reason: "registry_entry_missing" }); continue; }
    if (entry.status !== "unmatched") problems.push({ productNo, reason: `status:${entry.status}` });
    if (entry.verified === true) problems.push({ productNo, reason: "already_verified" });
    if ((entry?.ecount?.matchedProducts || []).length) problems.push({ productNo, reason: "already_linked" });
    const matchedProducts = [];
    const prices = new Set();
    for (const code of SAFE10[productNo]) {
      const row = fullByCode.get(code);
      if (!row) { problems.push({ productNo, code, reason: "master_sku_missing" }); continue; }
      if (currentOwners.get(code)?.size) problems.push({ productNo, code, reason: "existing_owner", owners: [...currentOwners.get(code)] });
      const price = priceOf(row);
      if (!price || price <= 0) problems.push({ productNo, code, reason: "invalid_price", price });
      else prices.add(price);
      matchedProducts.push({ prodCd: code, barcode: code, productName: nameOf(row), size: sizeOf(row) || null, supplier: null, consignment: false });
    }
    if (prices.size !== 1) problems.push({ productNo, reason: "non_uniform_price", prices: [...prices] });
    proposals.push({ productNo, entry, matchedProducts, price: [...prices][0] ?? null });
  }

  const stagedOwners = new Map();
  for (const proposal of proposals) for (const row of proposal.matchedProducts) {
    if (stagedOwners.has(row.prodCd)) problems.push({ productNo: proposal.productNo, code: row.prodCd, reason: "intra_batch_collision" });
    stagedOwners.set(row.prodCd, proposal.productNo);
  }
  assert(proposals.length === 10, "proposal count drift");
  assert(problems.length === 0, `preflight problems:\n${JSON.stringify(problems, null, 2)}`);

  const proposalByProductNo = new Map(proposals.map((proposal) => [proposal.productNo, proposal]));
  const nextEntries = entries.map((entry) => {
    const productNo = s(entry?.cafe24?.productNo);
    const proposal = proposalByProductNo.get(productNo);
    if (!proposal) return entry;
    const evidence = ["human_review_approved", "price_audit_safe10", "full_ecount_master_verified", "pure_brand_prefix_scope", "uniform_sales_price", "sku_family_verified", "manual_high_confidence"];
    if (productNo === "11519" || productNo === "11520") evidence.push("brand_alias_yueqi_qi_yue_qiqi_verified");
    return {
      ...entry,
      status: "confirmed",
      confidence: 100,
      verified: true,
      ecount: { ...(entry.ecount || {}), matchedProducts: proposal.matchedProducts },
      matching: {
        ...(entry.matching || {}),
        strategy: "human_review_approved",
        diagnosticType: [proposal.matchedProducts.length === 1 ? "exact_one_to_one" : "exact_one_to_many"],
        evidence,
        pendingReasons: []
      }
    };
  });

  assert(nextEntries.length === entries.length, "registry entry count changed");
  const beforeVerified = entries.filter((entry) => entry.verified === true).length;
  const afterVerified = nextEntries.filter((entry) => entry.verified === true).length;
  assert(afterVerified - beforeVerified === 10, "verified delta invalid");
  const beforeDuplicates = duplicates(entries);
  const afterDuplicates = duplicates(nextEntries);
  assert(afterDuplicates.size === beforeDuplicates.size, "duplicate group count changed");
  for (const [code, owners] of beforeDuplicates) assert(sameSet(owners, afterDuplicates.get(code)), `duplicate owner set changed: ${code}`);
  nextEntries.forEach((entry, index) => {
    if (!proposalByProductNo.has(s(entry?.cafe24?.productNo))) assert(JSON.stringify(entry) === JSON.stringify(entries[index]), `unexpected mutation: ${entry?.cafe24?.productNo}`);
  });
  assert(evidenceCount(nextEntries, "price_audit_safe24") === 24, "SAFE24 provenance changed");
  assert(evidenceCount(nextEntries, "price_audit_safe20") === 20, "SAFE20 provenance changed");
  assert(evidenceCount(nextEntries, "price_audit_safe10") === 10, "SAFE10 provenance invalid");

  const nextSummary = recomputeProductRegistrySummary(nextEntries, registry.summary);
  console.log(JSON.stringify({
    mode: APPLY ? "APPLY" : "DRY_RUN",
    products: proposals.length,
    skus: proposals.reduce((sum, proposal) => sum + proposal.matchedProducts.length, 0),
    problems: problems.length,
    entries: `${entries.length} -> ${nextEntries.length}`,
    verified: `${beforeVerified} -> ${afterVerified}`,
    confirmed: `${entries.filter((entry) => entry.status === "confirmed").length} -> ${nextEntries.filter((entry) => entry.status === "confirmed").length}`,
    unmatched: `${entries.filter((entry) => entry.status === "unmatched").length} -> ${nextEntries.filter((entry) => entry.status === "unmatched").length}`,
    duplicateGroups: `${beforeDuplicates.size} -> ${afterDuplicates.size}`,
    newDuplicateGroups: 0,
    safe24: evidenceCount(nextEntries, "price_audit_safe24"), safe20: evidenceCount(nextEntries, "price_audit_safe20"), safe10: evidenceCount(nextEntries, "price_audit_safe10"),
    summary: nextSummary,
    proposals: proposals.map((proposal) => ({ productNo: proposal.productNo, prodCds: proposal.matchedProducts.map((row) => row.prodCd), price: proposal.price }))
  }, null, 2));
  console.log("SAFETY GATES: PASS");
  if (!APPLY) return console.log("DRY RUN ONLY — NO FILE WRITTEN");

  const now = new Date().toISOString();
  const backupPath = `${registryPath}.backup-safe10-${now.replace(/[:.]/g, "-")}`;
  await copyFile(registryPath, backupPath);
  const finalEntries = nextEntries.map((entry) => proposalByProductNo.has(s(entry?.cafe24?.productNo)) ? { ...entry, updatedAt: now } : entry);
  const nextRegistry = { ...registry, generatedAt: now, summary: recomputeProductRegistrySummary(finalEntries, registry.summary), entries: finalEntries };
  const tempPath = `${registryPath}.tmp-${randomUUID()}`;
  await writeFile(tempPath, `${JSON.stringify(nextRegistry, null, 2)}\n`, "utf8");
  const parsed = JSON.parse(await readFile(tempPath, "utf8"));
  assert(parsed.entries.length === 3596 && parsed.summary?.verifiedCount === 392, "post-write validation failed");
  await rename(tempPath, registryPath);
  console.log(`APPLY COMPLETE\nbackup: ${backupPath.replace(`${rootDir}/`, "")}`);
}

main().catch((error) => { console.error(`SAFE10 APPLY FAILED\n${error.message}`); process.exitCode = 1; });
