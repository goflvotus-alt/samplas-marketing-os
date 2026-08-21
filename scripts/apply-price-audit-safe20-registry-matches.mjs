#!/usr/bin/env node

/**
 * SAMPLAS INTELLIGENCE
 * SAFE20 Product Registry apply
 *
 * SAFETY
 * - Default DRY RUN
 * - --apply required to mutate Registry
 * - Exactly 20 Cafe24 products / 50 ECOUNT SKUs
 * - Only unmatched + unverified + currently unlinked entries
 * - Every SKU must exist in full ECOUNT master
 * - Uniform OUT_PRICE inside each Cafe24 product
 * - No current ECOUNT ownership collision
 * - No intra-batch collision
 * - No new duplicate ownership
 * - Existing duplicate owner sets must remain unchanged
 * - Registry entry count fixed
 * - verified delta locked to +20
 * - Cafe24 4583 must remain untouched
 * - Atomic temp write + backup before apply
 */

import {
  copyFile,
  readFile,
  rename,
  writeFile
} from "node:fs/promises";

import {
  createHash,
  randomUUID
} from "node:crypto";

import {
  join,
  resolve
} from "node:path";

import {
  fileURLToPath
} from "node:url";

import {
  recomputeProductRegistrySummary
} from "./product-registry-summary.mjs";

const rootDir = resolve(
  fileURLToPath(import.meta.url),
  "..",
  ".."
);

const workDir = join(rootDir, "work");
const registryPath = join(workDir, "product-registry.json");
const fullPath = join(
  workDir,
  "ecount-inventory",
  "full-products-candidate.json"
);

const APPLY = process.argv.includes("--apply");

const EXPECTED_PRODUCTS = 20;
const EXPECTED_SKUS = 50;

const EXPECTED_BASELINE_SHA256 =
  "93289d668ccb6480e89738d80ad530244c51d0799e5d0d2531f2037110f08adf";

const SAFE20 = {
  "7957": ["SSS00201","SSS00203"],
  "11726": ["SFE253AC00600"],
  "11728": ["SFE253AC00700"],
  "11711": ["SFE253AC01103","SFE253AC01104","SFE253AC01105","SFE253AC01106"],
  "12849": ["RUI261BT00202","RUI261BT00203"],
  "12850": ["RUI261BT00302","RUI261BT00303","RUI261BT00304"],
  "12860": ["RUI261ST00502","RUI261ST00503"],
  "12712": ["SIA253AC01717","SIA253AC01720"],
  "12702": ["SIA253AC00248","SIA253AC00256","SIA253AC00258"],
  "12703": ["SIA253AC00348","SIA253AC00356","SIA253AC00358"],
  "12716": ["SIA253AC01343","SIA253AC01349"],
  "7190": ["UMA243OT00302","UMA243OT00303"],
  "5551": ["UMA243BT01802","UMA243BT01803","UMA243BT01805"],
  "7185": ["UMA243OT00502","UMA243OT00503","UMA243OT00504"],
  "6694": ["UMA243OT00802","UMA243OT00804","UMA243OT00805"],
  "6972": ["UMA243OT00603","UMA243OT00604"],
  "6175": ["UMA243ST01802","UMA243ST01803","UMA243ST01804"],
  "6973": ["UMA243HD00802","UMA243HD00803","UMA243HD00804"],
  "4990": ["UMA243LT02201","UMA243LT02202"],
  "5320": ["UMA243LT02101","UMA243LT02102","UMA243LT02103","UMA243LT02104"]
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function s(value) {
  return String(value ?? "").trim();
}

function rowsOf(data) {
  if (Array.isArray(data)) return data;

  for (const key of [
    "rows",
    "products",
    "items",
    "entries",
    "data",
    "inventory"
  ]) {
    if (Array.isArray(data?.[key])) {
      return data[key];
    }
  }

  return [];
}

function codeOf(row) {
  return s(
    row?.PROD_CD ??
    row?.prodCd ??
    row?.product_code ??
    row?.productCode ??
    row?.code
  );
}

function nameOf(row) {
  return s(
    row?.PROD_DES ??
    row?.productName ??
    row?.product_name ??
    row?.name
  );
}

function sizeOf(row) {
  return s(
    row?.SIZE_DES ??
    row?.size ??
    row?.SIZE ??
    row?.sizeName
  );
}

function priceOf(row) {
  const raw =
    row?.OUT_PRICE ??
    row?.salesPrice ??
    row?.salePrice ??
    row?.price ??
    null;

  if (
    raw === null ||
    raw === undefined ||
    raw === ""
  ) {
    return null;
  }

  const value = Number(
    String(raw).replace(/,/g, "").trim()
  );

  return Number.isFinite(value)
    ? value
    : null;
}

function sha256(text) {
  return createHash("sha256")
    .update(text)
    .digest("hex");
}

function ownershipMap(entries) {
  const map = new Map();

  for (const entry of entries) {
    const owner = s(entry?.cafe24?.productNo);

    for (const matched of entry?.ecount?.matchedProducts || []) {
      const code = s(matched?.prodCd);

      if (!code) continue;

      if (!map.has(code)) {
        map.set(code, new Set());
      }

      map.get(code).add(owner);
    }
  }

  return map;
}

function duplicateCodes(entries) {
  const owners = ownershipMap(entries);
  const duplicates = new Map();

  for (const [code, set] of owners) {
    if (set.size > 1) {
      duplicates.set(
        code,
        [...set].sort()
      );
    }
  }

  return duplicates;
}

function sameOwnerSet(a, b) {
  const A = new Set(a || []);
  const B = new Set(b || []);

  return (
    A.size === B.size &&
    [...A].every(value => B.has(value))
  );
}

async function main() {
  const registryText =
    await readFile(registryPath, "utf8");

  const registrySha =
    sha256(registryText);

  const registry =
    JSON.parse(registryText);

  const fullRaw =
    JSON.parse(
      await readFile(fullPath, "utf8")
    );

  const fullRows =
    rowsOf(fullRaw);

  const entries =
    registry.entries || [];

  const targetProductNos =
    Object.keys(SAFE20);

  const allTargetCodes =
    Object.values(SAFE20).flat();

  console.log(
    "============================================================"
  );
  console.log(
    "SAFE20 PRODUCT REGISTRY APPLY"
  );
  console.log(
    APPLY
      ? "MODE: APPLY"
      : "MODE: DRY RUN"
  );
  console.log(
    "============================================================"
  );

  console.log(
    "registry SHA256:",
    registrySha
  );

  assert(
    registrySha === EXPECTED_BASELINE_SHA256,
    `registry baseline SHA drift: ${registrySha}`
  );

  assert(
    targetProductNos.length === EXPECTED_PRODUCTS,
    `target product count drift: ${targetProductNos.length}`
  );

  assert(
    allTargetCodes.length === EXPECTED_SKUS,
    `target SKU count drift: ${allTargetCodes.length}`
  );

  assert(
    new Set(allTargetCodes).size === EXPECTED_SKUS,
    "duplicate SKU exists inside SAFE20 mapping"
  );

  const fullByCode =
    new Map(
      fullRows
        .map(row => [codeOf(row), row])
        .filter(([code]) => code)
    );

  const byProductNo =
    new Map(
      entries.map(entry => [
        s(entry?.cafe24?.productNo),
        entry
      ])
    );

  const currentOwnership =
    ownershipMap(entries);

  const proposals = [];
  const problems = [];

  for (const productNo of targetProductNos) {
    const entry =
      byProductNo.get(productNo);

    if (!entry) {
      problems.push({
        productNo,
        reason: "registry_entry_missing"
      });

      continue;
    }

    if (entry.status !== "unmatched") {
      problems.push({
        productNo,
        reason: "status_not_unmatched",
        status: entry.status
      });
    }

    if (entry.verified === true) {
      problems.push({
        productNo,
        reason: "already_verified"
      });
    }

    if (
      Array.isArray(entry?.ecount?.matchedProducts) &&
      entry.ecount.matchedProducts.length > 0
    ) {
      problems.push({
        productNo,
        reason: "already_ecount_linked"
      });
    }

    const codes =
      SAFE20[productNo];

    const matchedProducts = [];
    const prices = new Set();

    for (const code of codes) {
      const master =
        fullByCode.get(code);

      if (!master) {
        problems.push({
          productNo,
          code,
          reason: "master_sku_missing"
        });

        continue;
      }

      const currentOwners =
        currentOwnership.get(code);

      if (
        currentOwners &&
        currentOwners.size > 0
      ) {
        problems.push({
          productNo,
          code,
          reason: "existing_owner_collision",
          owners: [...currentOwners]
        });
      }

      const price =
        priceOf(master);

      if (
        price === null ||
        price <= 0
      ) {
        problems.push({
          productNo,
          code,
          reason: "invalid_master_price",
          price
        });
      } else {
        prices.add(price);
      }

      matchedProducts.push({
        prodCd: code,
        barcode: code,
        productName: nameOf(master),
        size: sizeOf(master) || null,
        supplier: null,
        consignment: false
      });
    }

    if (prices.size !== 1) {
      problems.push({
        productNo,
        reason: "non_uniform_master_price",
        prices: [...prices]
      });
    }

    proposals.push({
      productNo,
      entry,
      codes,
      price: [...prices][0] ?? null,
      matchedProducts
    });
  }

  const stagedOwners =
    new Map();

  for (const proposal of proposals) {
    for (const matched of proposal.matchedProducts) {
      const code =
        matched.prodCd;

      if (
        stagedOwners.has(code) &&
        stagedOwners.get(code) !== proposal.productNo
      ) {
        problems.push({
          productNo: proposal.productNo,
          code,
          reason: "intra_batch_collision",
          owner: stagedOwners.get(code)
        });
      }

      stagedOwners.set(
        code,
        proposal.productNo
      );
    }
  }

  assert(
    proposals.length === EXPECTED_PRODUCTS,
    `proposal count drift: ${proposals.length}`
  );

  assert(
    problems.length === 0,
    `preflight problems:\n${JSON.stringify(problems, null, 2)}`
  );

  const proposalByProductNo =
    new Map(
      proposals.map(proposal => [
        proposal.productNo,
        proposal
      ])
    );

  const nextEntries =
    entries.map(entry => {
      const productNo =
        s(entry?.cafe24?.productNo);

      const proposal =
        proposalByProductNo.get(productNo);

      if (!proposal) {
        return entry;
      }

      return {
        ...entry,

        status: "confirmed",

        confidence: 100,

        verified: true,

        ecount: {
          ...(entry?.ecount || {}),
          matchedProducts:
            proposal.matchedProducts
        },

        matching: {
          ...(entry?.matching || {}),

          strategy:
            "human_review_approved",

          diagnosticType: [
            proposal.matchedProducts.length === 1
              ? "exact_one_to_one"
              : "exact_one_to_many"
          ],

          evidence: [
            "human_review_approved",
            "price_audit_safe20",
            "full_ecount_master_verified",
            "pure_brand_prefix_scope",
            "uniform_sales_price",
            "sku_family_verified",
            "manual_high_confidence"
          ],

          pendingReasons: []
        }
      };
    });

  assert(
    nextEntries.length === entries.length,
    "registry entry count would change"
  );

  const beforeVerified =
    entries.filter(
      entry => entry?.verified === true
    ).length;

  const afterVerified =
    nextEntries.filter(
      entry => entry?.verified === true
    ).length;

  assert(
    afterVerified - beforeVerified === EXPECTED_PRODUCTS,
    `verified delta invalid: ${beforeVerified} -> ${afterVerified}`
  );

  const beforeDuplicates =
    duplicateCodes(entries);

  const afterDuplicates =
    duplicateCodes(nextEntries);

  const newlyDuplicated = [];

  for (const [code, owners] of afterDuplicates) {
    if (!beforeDuplicates.has(code)) {
      newlyDuplicated.push({
        code,
        owners
      });
    }
  }

  assert(
    newlyDuplicated.length === 0,
    `new duplicate ownership detected:\n${JSON.stringify(newlyDuplicated, null, 2)}`
  );

  const changedExistingDuplicates = [];

  for (const [code, owners] of beforeDuplicates) {
    const after =
      afterDuplicates.get(code);

    if (
      !after ||
      !sameOwnerSet(owners, after)
    ) {
      changedExistingDuplicates.push({
        code,
        before: owners,
        after: after || []
      });
    }
  }

  assert(
    changedExistingDuplicates.length === 0,
    `existing duplicate owner-set changed:\n${JSON.stringify(changedExistingDuplicates, null, 2)}`
  );

  const entry4583Before =
    byProductNo.get("4583");

  const entry4583After =
    nextEntries.find(
      entry =>
        s(entry?.cafe24?.productNo) === "4583"
    );

  assert(
    JSON.stringify(entry4583Before) ===
      JSON.stringify(entry4583After),
    "Cafe24 4583 changed unexpectedly"
  );

  const nextSummary =
    recomputeProductRegistrySummary(
      nextEntries,
      registry.summary
    );

  console.log();
  console.log("=== PREFLIGHT ===");
  console.log(
    "products:",
    proposals.length
  );
  console.log(
    "SKUs:",
    proposals.reduce(
      (sum, p) =>
        sum + p.matchedProducts.length,
      0
    )
  );
  console.log(
    "problems:",
    problems.length
  );
  console.log(
    "verified:",
    `${beforeVerified} -> ${afterVerified}`
  );
  console.log(
    "duplicate SKU sets:",
    `${beforeDuplicates.size} -> ${afterDuplicates.size}`
  );
  console.log(
    "new duplicate codes:",
    newlyDuplicated.length
  );
  console.log(
    "changed duplicate owner sets:",
    changedExistingDuplicates.length
  );
  console.log(
    "4583 untouched:",
    JSON.stringify(entry4583Before) ===
      JSON.stringify(entry4583After)
  );

  console.log();
  console.log("=== PROPOSALS ===");

  for (
    const proposal of proposals.sort(
      (a, b) =>
        Number(a.productNo) -
        Number(b.productNo)
    )
  ) {
    console.log(
      `${proposal.productNo} | ${proposal.entry.brandName} | ${proposal.entry.canonicalProductName}`
    );

    console.log(
      `  ${proposal.matchedProducts
        .map(item => item.prodCd)
        .join(", ")} | price=${proposal.price}`
    );
  }

  console.log();
  console.log("=== SUMMARY SIMULATION ===");
  console.log(
    JSON.stringify(
      nextSummary,
      null,
      2
    )
  );

  console.log();
  console.log("SAFETY GATES: PASS");

  if (!APPLY) {
    console.log("DRY RUN ONLY");
    console.log("NO REGISTRY FILE WRITTEN");
    return;
  }

  const now =
    new Date().toISOString();

  const timestamp =
    now.replace(/[:.]/g, "-");

  const backupPath =
    `${registryPath}.backup-safe20-${timestamp}`;

  await copyFile(
    registryPath,
    backupPath
  );

  const finalEntries =
    nextEntries.map(entry => {
      const productNo =
        s(entry?.cafe24?.productNo);

      return proposalByProductNo.has(productNo)
        ? {
            ...entry,
            updatedAt: now
          }
        : entry;
    });

  const nextRegistry = {
    ...registry,
    generatedAt: now,
    summary:
      recomputeProductRegistrySummary(
        finalEntries,
        registry.summary
      ),
    entries: finalEntries
  };

  const tempPath =
    `${registryPath}.tmp-${randomUUID()}`;

  await writeFile(
    tempPath,
    `${JSON.stringify(nextRegistry, null, 2)}\n`,
    "utf8"
  );

  const parsed =
    JSON.parse(
      await readFile(tempPath, "utf8")
    );

  assert(
    parsed.entries.length === entries.length,
    "post-write entry count changed"
  );

  assert(
    parsed.summary?.verifiedCount ===
      beforeVerified + EXPECTED_PRODUCTS,
    "post-write verified count invalid"
  );

  const tempDuplicates =
    duplicateCodes(parsed.entries);

  assert(
    tempDuplicates.size === beforeDuplicates.size,
    `post-write duplicate baseline drift: ${beforeDuplicates.size} -> ${tempDuplicates.size}`
  );

  for (const [code, owners] of beforeDuplicates) {
    assert(
      sameOwnerSet(
        owners,
        tempDuplicates.get(code)
      ),
      `post-write existing duplicate owner-set changed: ${code}`
    );
  }

  await rename(
    tempPath,
    registryPath
  );

  console.log();
  console.log("APPLY COMPLETE");
  console.log(
    "backup:",
    backupPath.replace(
      `${rootDir}/`,
      ""
    )
  );
  console.log(
    "verified:",
    `${beforeVerified} -> ${parsed.summary.verifiedCount}`
  );
}

main().catch(error => {
  console.error();
  console.error("SAFE20 APPLY FAILED");
  console.error(error.message);
  process.exitCode = 1;
});
