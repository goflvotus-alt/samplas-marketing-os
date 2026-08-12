import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { buildBrandRegistry, extractSlashBrandCandidate, resolveBrand } from "./brand-engine.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORK = join(ROOT, "work");
const OUTPUT = join(WORK, "brand-sourcing-master.json");

export const isOperationalCoGroup = (value) => / CO$/i.test(String(value || "").trim());

export function stripConsignmentPrefix(value) {
  const raw = String(value || "");
  return raw.replace(/^\s*CON(?:\s+-|-)\s*/i, "");
}

function decimal(value) {
  const match = String(value ?? "").trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  return { value: BigInt(`${match[1]}${match[2] || ""}`), scale: (match[2] || "").length };
}

export function isExactThirtyPercent(inPrice, outPrice) {
  const input = decimal(inPrice);
  const output = decimal(outPrice);
  if (!input || !output || input.value <= 0n || output.value <= 0n) return false;
  return input.value * 100n * 10n ** BigInt(output.scale) === output.value * 30n * 10n ** BigInt(input.scale);
}

export function classifyBrandSourcing(evidence = {}, historicalType = null, ownProduction = false) {
  if (ownProduction) return "OWN_PRODUCTION";
  const consignmentCount = evidence.co_sales_lines + evidence.con_prefix_products + evidence.exact_30_products;
  if (historicalType === "WHOLESALE") return consignmentCount ? "HYBRID" : "WHOLESALE";
  if (historicalType === "CONSIGNMENT") return "CONSIGNMENT";
  const allSalesConsignment = evidence.resolved_sales_lines > 0 && evidence.co_sales_lines === evidence.resolved_sales_lines;
  const allProductsConsignment = evidence.resolved_products > 0
    && (evidence.con_prefix_products === evidence.resolved_products || evidence.exact_30_products === evidence.resolved_products);
  if (allSalesConsignment || allProductsConsignment) return "CONSIGNMENT";
  return consignmentCount ? "PARTIAL" : "UNKNOWN";
}

function resolveProductName(name, registry) {
  const extracted = extractSlashBrandCandidate(stripConsignmentPrefix(name));
  return extracted ? resolveBrand(extracted.candidate, registry) : null;
}

export function buildBrandSourcingMaster({ brandMaster, products, salesSnapshots, candidates }) {
  const registry = buildBrandRegistry(brandMaster);
  const evidence = new Map(registry.brands.map((brand) => [brand.id, {
    resolved_products: 0,
    con_prefix_products: 0,
    exact_30_products: 0,
    resolved_sales_lines: 0,
    co_sales_lines: 0
  }]));
  const exact30Active = products.some((product) => isExactThirtyPercent(product.IN_PRICE, product.OUT_PRICE));

  for (const product of products) {
    const resolved = resolveProductName(product.PROD_DES, registry);
    const row = resolved && evidence.get(resolved.brandId);
    if (!row) continue;
    row.resolved_products += 1;
    if (stripConsignmentPrefix(product.PROD_DES) !== String(product.PROD_DES || "")) row.con_prefix_products += 1;
    if (exact30Active && isExactThirtyPercent(product.IN_PRICE, product.OUT_PRICE)) row.exact_30_products += 1;
  }

  for (const snapshot of salesSnapshots) {
    for (const line of snapshot.salesLines || []) {
      const resolved = resolveProductName(line.productName, registry);
      const row = resolved && evidence.get(resolved.brandId);
      if (!row) continue;
      row.resolved_sales_lines += 1;
      if (isOperationalCoGroup(line.brandGroup)) row.co_sales_lines += 1;
    }
  }

  const historical = new Map(candidates.map((row) => [row.brand_code, row.sourcing_type]));
  const entries = registry.brands.map((brand) => {
    const row = evidence.get(brand.id);
    const historicalType = historical.get(brand.id) || null;
    const sourcing_type = classifyBrandSourcing(row, historicalType, brand.id === "B00000HM");
    return {
      brand_code: brand.id,
      brand_name: brand.name,
      sourcing_type,
      evidence: {
        historical_candidate: historicalType,
        operational_co_sales_lines: row.co_sales_lines,
        con_prefix_products: row.con_prefix_products,
        exact_30_percent_products: row.exact_30_products
      },
      coverage: {
        resolved_products: row.resolved_products,
        resolved_sales_lines: row.resolved_sales_lines
      }
    };
  }).sort((a, b) => a.brand_code.localeCompare(b.brand_code));

  return {
    schemaVersion: 1,
    generatedAt: [brandMaster.updatedAt, ...salesSnapshots.map((row) => row.importedAt)].filter(Boolean).sort().at(-1) || null,
    summary: entries.reduce((out, row) => ({ ...out, [row.sourcing_type]: (out[row.sourcing_type] || 0) + 1 }), {}),
    sources: {
      brand_master: "work/brand-master.json",
      inventory: "work/ecount-inventory/raw-products.json",
      sales_months: salesSnapshots.map((row) => row.month).sort(),
      historical_candidates: "work/brand-sourcing-candidates.json",
      exact_30_percent_signal: exact30Active ? "ACTIVE" : "NOT_ACTIVE"
    },
    brands: entries
  };
}

async function loadInputs() {
  const brandMaster = JSON.parse(await readFile(join(WORK, "brand-master.json"), "utf8"));
  const inventory = JSON.parse(await readFile(join(WORK, "ecount-inventory/raw-products.json"), "utf8"));
  const candidates = JSON.parse(await readFile(join(WORK, "brand-sourcing-candidates.json"), "utf8"));
  const salesFiles = (await readdir(join(WORK, "ecount-sales"))).filter((name) => /^\d{4}-(?:0[1-9]|1[0-2])\.json$/.test(name)).sort();
  const salesSnapshots = await Promise.all(salesFiles.map(async (name) => JSON.parse(await readFile(join(WORK, "ecount-sales", name), "utf8"))));
  const products = inventory?.Data?.Result;
  if (!Array.isArray(brandMaster?.brands) || !Array.isArray(products) || !Array.isArray(candidates)) {
    throw new Error("Brand sourcing input structure is invalid.");
  }
  return { brandMaster, products, salesSnapshots, candidates };
}

async function writeAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(temp, file);
}

export async function main() {
  const result = buildBrandSourcingMaster(await loadInputs());
  await writeAtomic(OUTPUT, result);
  console.log(JSON.stringify({ output: OUTPUT, brands: result.brands.length, summary: result.summary }, null, 2));
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && existsSync(WORK)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
