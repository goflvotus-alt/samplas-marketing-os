// Lightweight canonical ECOUNT product master (work/ecount-inventory/product-master.json).
// Only the fields brand onboarding and sourcing need, so Production can receive the full
// catalog through the snapshot upload allowlist without the 40MB raw-products.json.
// Prices stay as the raw ECOUNT decimal strings: isExactThirtyPercent compares them exactly.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const PRODUCT_MASTER_FILE = "ecount-inventory/product-master.json";
const RAW_PRODUCTS_FILE = "ecount-inventory/raw-products.json";

const code = row => row?.PROD_CD ?? row?.PRODCD ?? row?.ProdCd ?? null;

export function buildProductMaster(productList, pagination) {
  if (!Array.isArray(productList) || pagination?.complete !== true) throw new Error("product master requires a complete product list");
  const products = productList.map(row => ({
    productCode: String(code(row) ?? ""),
    productName: String(row.PROD_DES ?? ""),
    inPrice: row.IN_PRICE ?? null,
    outPrice: row.OUT_PRICE ?? null
  }));
  const master = {
    schemaVersion: 1,
    fetchedAt: pagination.fetchedAt,
    totalProducts: products.length,
    complete: true,
    pageCount: pagination.pageCount,
    duplicateCount: pagination.duplicateCount,
    firstProdCd: pagination.firstProdCd,
    lastProdCd: pagination.lastProdCd,
    products
  };
  validateProductMaster(master);
  return master;
}

// Returns null when valid, otherwise the first problem found.
export function productMasterProblem(master) {
  if (!master || typeof master !== "object" || Array.isArray(master)) return "not an object";
  if (master.schemaVersion !== 1) return "unsupported schemaVersion";
  if (master.complete !== true) return "complete is not true";
  if (!Array.isArray(master.products)) return "products is not an array";
  if (master.totalProducts !== master.products.length) return "totalProducts does not match products";
  const seen = new Set();
  for (const p of master.products) {
    if (!p || typeof p.productCode !== "string" || !p.productCode || typeof p.productName !== "string") return "product without productCode/productName";
    if (seen.has(p.productCode)) return `duplicate productCode ${p.productCode}`;
    seen.add(p.productCode);
  }
  return null;
}

export function validateProductMaster(master) {
  const problem = productMasterProblem(master);
  if (problem) throw new Error(`Invalid ECOUNT product master: ${problem}`);
  return master;
}

async function readJsonOrNull(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

// product-master.json first; raw-products.json only when product-master is absent.
// A present but invalid product-master throws instead of silently using older raw data.
export async function readEcountProductMaster(workDir) {
  const master = await readJsonOrNull(join(workDir, PRODUCT_MASTER_FILE));
  if (master) {
    validateProductMaster(master);
    return { source: PRODUCT_MASTER_FILE, fetchedAt: master.fetchedAt ?? null, complete: true, products: master.products };
  }
  const raw = await readJsonOrNull(join(workDir, RAW_PRODUCTS_FILE));
  const rows = Array.isArray(raw?.Data?.Result) ? raw.Data.Result : null;
  if (!rows) return null;
  return {
    source: RAW_PRODUCTS_FILE,
    fetchedAt: raw.Pagination?.fetchedAt ?? raw.Timestamp ?? null,
    complete: raw.Pagination?.complete === true,
    products: rows.map(row => ({ productCode: String(code(row) ?? ""), productName: String(row.PROD_DES ?? ""), inPrice: row.IN_PRICE ?? null, outPrice: row.OUT_PRICE ?? null }))
  };
}
