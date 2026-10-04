import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { buildBrandRegistry, extractSlashBrandCandidate, resolveBrand } from "./brand-engine.mjs";
import { KNOWN_STORE_CODES, readEcountOfflineSalesSnapshot } from "./read-ecount-offline-sales-snapshot.mjs";
import { readEcountProductMaster } from "./ecount-product-master.mjs";

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

export function classifyBrandSourcing(evidence = {}, ownProduction = false) {
  if (ownProduction) return "OWN_PRODUCTION";

  // 과거 sourcing 후보값은 판정에 사용하지 않는다.
  // 현재 운영 데이터만 사용:
  // 위탁: CO 그룹 / CON- prefix / 입고가가 판매가의 정확히 30%
  // 사입: 비-CO 판매행 / 위탁 신호가 없는 일반 상품
  const hasConsignment =
    evidence.co_sales_lines > 0 ||
    evidence.con_prefix_products > 0 ||
    evidence.exact_30_products > 0;

  const hasWholesale =
    evidence.non_co_sales_lines > 0 ||
    evidence.wholesale_products > 0;

  if (hasConsignment && hasWholesale) return "HYBRID";
  if (hasConsignment) return "CONSIGNMENT";
  if (hasWholesale) return "WHOLESALE";
  return "UNKNOWN";
}

function resolveProductName(name, registry) {
  const extracted = extractSlashBrandCandidate(stripConsignmentPrefix(name));
  return extracted ? resolveBrand(extracted.candidate, registry) : null;
}

export function buildBrandSourcingMaster({ brandMaster, products, salesSnapshots, inventorySource = "ecount-inventory/raw-products.json" }) {
  const registry = buildBrandRegistry(brandMaster);
  const evidence = new Map(registry.brands.map((brand) => [brand.id, {
    resolved_products: 0,
    con_prefix_products: 0,
    exact_30_products: 0,
    wholesale_products: 0,
    resolved_sales_lines: 0,
    co_sales_lines: 0,
    non_co_sales_lines: 0
  }]));
  const exact30Active = products.some((product) => isExactThirtyPercent(product.IN_PRICE, product.OUT_PRICE));

  for (const product of products) {
    const resolved = resolveProductName(product.PROD_DES, registry);
    const row = resolved && evidence.get(resolved.brandId);
    if (!row) continue;
    row.resolved_products += 1;
    const hasConPrefix = stripConsignmentPrefix(product.PROD_DES) !== String(product.PROD_DES || "");
    const exactThirty = exact30Active && isExactThirtyPercent(product.IN_PRICE, product.OUT_PRICE);
    if (hasConPrefix) row.con_prefix_products += 1;
    if (exactThirty) row.exact_30_products += 1;
    if (!hasConPrefix && !exactThirty) row.wholesale_products += 1;
  }

  for (const snapshot of salesSnapshots) {
    for (const line of snapshot.salesLines || []) {
      const resolved = resolveProductName(line.productName, registry);
      const row = resolved && evidence.get(resolved.brandId);
      if (!row) continue;
      row.resolved_sales_lines += 1;
      if (isOperationalCoGroup(line.brandGroup)) row.co_sales_lines += 1;
      else row.non_co_sales_lines += 1;
    }
  }

  const entries = registry.brands.map((brand) => {
    const row = evidence.get(brand.id);
    const sourcing_type = classifyBrandSourcing(row, brand.id === "B00000HM");
    return {
      brand_code: brand.id,
      brand_name: brand.name,
      sourcing_type,
      evidence: {
        operational_co_sales_lines: row.co_sales_lines,
        operational_non_co_sales_lines: row.non_co_sales_lines,
        con_prefix_products: row.con_prefix_products,
        exact_30_percent_products: row.exact_30_products,
        wholesale_products: row.wholesale_products
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
      inventory: `work/${inventorySource}`,
      sales_months: salesSnapshots.map((row) => row.month).sort(),
      exact_30_percent_signal: exact30Active ? "ACTIVE" : "NOT_ACTIVE"
    },
    brands: entries
  };
}

async function loadInputs(workDir = WORK) {
  const brandMaster = JSON.parse(await readFile(join(workDir, "brand-master.json"), "utf8"));
  // product-master.json first, raw-products.json fallback (mapped to the raw field names).
  const master = await readEcountProductMaster(workDir);
  // Sourcing은 현재 운영 데이터만 사용하며 과거 후보 파일은 읽지 않는다.
  const salesFiles = await readdir(join(workDir, "ecount-sales"));
  const salesMonths = [...new Set(salesFiles.flatMap((name) => {
    const match = name.match(/^(\d{4}-(?:0[1-9]|1[0-2]))(?:\.([A-Z0-9_-]+))?\.json$/);
    if (!match) return [];
    if (match[2] && !KNOWN_STORE_CODES.includes(match[2])) return [];
    return [match[1]];
  }))].sort();
  const salesSnapshots = (await Promise.all(
    salesMonths.map((month) => readEcountOfflineSalesSnapshot(month, { workDir }))
  )).filter(Boolean);
  const products = master?.products.map((p) => ({ PROD_CD: p.productCode, PROD_DES: p.productName, IN_PRICE: p.inPrice, OUT_PRICE: p.outPrice }));
  if (!Array.isArray(brandMaster?.brands) || !Array.isArray(products)) {
    throw new Error("Brand sourcing input structure is invalid.");
  }
  return { brandMaster, products, salesSnapshots, inventorySource: master.source };
}

async function writeAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(temp, file);
}

export async function refreshBrandSourcingMaster(workDir = WORK) {
  const result = buildBrandSourcingMaster(await loadInputs(workDir));
  await writeAtomic(join(workDir, "brand-sourcing-master.json"), result);
  return result;
}

export async function main() {
  const result = await refreshBrandSourcingMaster();
  console.log(JSON.stringify({ output: OUTPUT, brands: result.brands.length, summary: result.summary }, null, 2));
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && existsSync(WORK)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
