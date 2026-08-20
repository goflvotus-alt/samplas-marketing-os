import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeProductName, splitEcountProductName } from "./diagnose-cafe24-ecount-product-matching.mjs";
import { recomputeProductRegistrySummary } from "./product-registry-summary.mjs";

const text = (value) => String(value ?? "").trim();
const amount = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function inventoryCandidatesForSale(sale, inventoryProducts) {
  const saleName = normalizeProductName(sale?.productName);
  if (!saleName) return [];
  return inventoryProducts.filter((product) => normalizeProductName(splitEcountProductName(product?.productName).nameRaw) === saleName).map((product) => ({
    prodCd: text(product.prodCd || product.productCode),
    barcode: text(product.barcode),
    productName: text(product.productName),
    size: text(product.size || product.specification),
    supplier: product.supplier ?? null,
    stockQuantity: product.stockQuantity ?? null,
    consignment: Boolean(product.consignment),
    special: /^QQQ/i.test(text(product.prodCd || product.productCode))
  }));
}

export function buildRevenueReviewQueue({ productSales = [], registry = {}, reviewQueue = {}, inventoryProducts = [] } = {}) {
  const entries = Array.isArray(registry.entries) ? registry.entries : [];
  const reviewItems = Array.isArray(reviewQueue.items) ? reviewQueue.items : [];
  const entryByProductNo = new Map(entries.map((entry) => [text(entry?.cafe24?.productNo), entry]));
  const reviewByProductNo = new Map(reviewItems.map((item) => [text(item?.recommendedCandidate?.cafe24?.productNo), item]));
  const rows = productSales.filter((sale) => amount(sale?.canonicalPaidAmount ?? sale?.sales?.paidAmount ?? sale?.salesAmount) > 0).map((sale) => {
    const productNo = text(sale.productNo);
    const entry = entryByProductNo.get(productNo) || null;
    const review = reviewByProductNo.get(productNo) || null;
    const candidates = entry?.ecount?.matchedProducts || review?.recommendedCandidate?.ecount || inventoryCandidatesForSale(sale, inventoryProducts);
    const confirmed = entry?.verified === true && entry?.status === "confirmed";
    return {
      canonicalProductId: entry?.canonicalProductId || `CP-C24-${productNo}`,
      productNo,
      productCode: text(sale.productCode || entry?.cafe24?.productCode),
      productName: text(sale.productName || entry?.cafe24?.productName),
      brandCode: text(sale.brand_code || sale.brandCode || entry?.brandId),
      brandName: text(sale.brand_name || entry?.brandName),
      revenue: amount(sale.canonicalPaidAmount ?? sale.sales?.paidAmount ?? sale.salesAmount),
      quantitySold: amount(sale.quantitySold),
      orderCount: amount(sale.orderCount),
      registryStatus: entry ? (entry.status || "unverified") : "no_registry_entry",
      verified: entry?.verified === true,
      confirmed,
      candidateCount: candidates.length,
      candidates,
      matching: entry?.matching || null,
      reviewReason: review?.reason || (entry ? "Human confirmation required" : "No Product Registry entry"),
      impacts: confirmed ? [] : ["Stock", "Color", "SKU Detail"]
    };
  });
  rows.sort((a, b) => b.revenue - a.revenue || b.quantitySold - a.quantitySold || b.orderCount - a.orderCount || a.productNo.localeCompare(b.productNo));
  return {
    items: rows,
    reviewItems: rows.filter((row) => !row.confirmed),
    summary: {
      salesProducts: rows.length,
      revenuePriorityCount: rows.filter((row) => !row.confirmed).length,
      confirmedCount: rows.filter((row) => row.confirmed).length,
      revenueAtRisk: rows.filter((row) => !row.confirmed).reduce((sum, row) => sum + row.revenue, 0)
    }
  };
}

export async function approveRevenueReviewItem({ registryPath, productNo, prodCds, product, candidateProducts = [], now = new Date().toISOString(), backupDir } = {}) {
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const entries = Array.isArray(registry.entries) ? registry.entries : [];
  const entry = entries.find((item) => text(item?.cafe24?.productNo) === text(productNo));
  const candidates = entry ? (Array.isArray(entry?.ecount?.matchedProducts) ? entry.ecount.matchedProducts : []) : candidateProducts;
  if (!entry && (!text(product?.productNo) || text(product.productNo) !== text(productNo))) throw new Error("NO_REGISTRY_ENTRY requires trusted Cafe24 product evidence");
  const selected = new Set((prodCds || []).map(text).filter(Boolean));
  if (!selected.size) throw new Error("At least one ECOUNT candidate is required");
  const matchedProducts = candidates.filter((candidate) => selected.has(text(candidate.prodCd)));
  if (matchedProducts.length !== selected.size) throw new Error("Invalid ECOUNT candidate");
  if (matchedProducts.some((candidate) => /^QQQ/i.test(text(candidate.prodCd)))) throw new Error("QQQ / SPECIAL cannot be auto-approved");

  const nextEntry = {
    ...(entry || {
      canonicalProductId: `CP-C24-${text(productNo)}`,
      brandId: text(product.brandCode),
      brandName: text(product.brandName),
      canonicalProductName: text(product.productName),
      cafe24: { productNo: text(productNo), productCode: text(product.productCode), productName: text(product.productName) },
      createdAt: now
    }),
    status: "confirmed",
    confidence: 100,
    verified: true,
    ecount: { ...(entry?.ecount || {}), matchedProducts },
    matching: {
      ...(entry?.matching || {}),
      strategy: "human_review_approved",
      diagnosticType: ["human_approved"],
      pendingReasons: []
    },
    updatedAt: now
  };
  const wasReviewEntry = Boolean(entry) && entry.verified !== true;
  const nextEntries = entry
    ? entries.map((item) => item === entry ? nextEntry : item)
    : [...entries, nextEntry];

  const existingSummary = {
    ...(registry.summary || {}),
    reviewQueueCount: Math.max(
      0,
      amount(registry.summary?.reviewQueueCount) - (wasReviewEntry ? 1 : 0)
    )
  };

  const next = {
    ...registry,
    generatedAt: now,
    summary: recomputeProductRegistrySummary(nextEntries, existingSummary),
    entries: nextEntries
  };
  if (nextEntry.status !== "confirmed" || nextEntry.verified !== true || !nextEntry.ecount.matchedProducts.length) throw new Error("Invalid Product Registry approval");

  const targetBackupDir = backupDir || join(dirname(registryPath), "backups");
  await mkdir(targetBackupDir, { recursive: true });
  const backupPath = join(targetBackupDir, `product-registry.json.pre-revenue-review-${now.replace(/[:.]/g, "-")}`);
  await copyFile(registryPath, backupPath);
  const tempPath = `${registryPath}.tmp-${randomUUID()}`;
  await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`);
  JSON.parse(await readFile(tempPath, "utf8"));
  await rename(tempPath, registryPath);
  return { entry: nextEntry, backupPath };
}
