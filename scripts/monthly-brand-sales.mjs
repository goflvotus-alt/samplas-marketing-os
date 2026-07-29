import {
  extractBracketBrandCandidate,
  extractSlashBrandCandidate,
  normalizeBrandKey
} from "./brand-engine.mjs";

function amountOf(brand = {}) {
  const values = [
    brand?.sales?.paidAmount,
    brand?.canonicalPaidAmount,
    brand?.paidAmount,
    brand?.salesAmount
  ];
  for (const value of values) {
    if (value === null || value === undefined || value === "" || typeof value === "object") continue;
    const amount = Number(value);
    if (Number.isFinite(amount)) return amount;
  }
  return 0;
}

function matchKey(value) {
  return normalizeBrandKey(value).replace(/\s+/g, "");
}

function candidateFromProductName(productName) {
  const bracket = extractBracketBrandCandidate(productName);
  if (bracket?.type === "single") return bracket.candidate;
  return extractSlashBrandCandidate(productName)?.candidate || "";
}

function buildResolver(brands, products) {
  const matches = new Map();
  const conflicts = new Set();
  const register = (value, code) => {
    const key = matchKey(value);
    if (!key) return;
    const previous = matches.get(key);
    if (previous && previous !== code) conflicts.add(key);
    else matches.set(key, code);
  };
  for (const brand of brands) {
    const code = String(brand.brand_code || brand.brandCode || "").trim();
    if (!code || code === "UNASSIGNED") continue;
    const values = [
      code,
      brand.brand_name,
      brand.brandName,
      brand.manufacturer_name,
      ...(Array.isArray(brand.name_aliases) ? brand.name_aliases : [])
    ];
    for (const value of values) register(value, code);
  }
  for (const product of products) {
    const code = String(product.brand_code || product.brandCode || "").trim();
    const candidate = extractBracketBrandCandidate(product.productName || product.product_name);
    if (code && code !== "UNASSIGNED" && candidate?.type === "single") register(candidate.candidate, code);
  }
  return (value) => {
    const key = matchKey(value);
    return key && !conflicts.has(key) ? matches.get(key) || null : null;
  };
}

function cloneBrand(brand = {}) {
  const paidAmount = amountOf(brand);
  return {
    ...brand,
    salesAmount: paidAmount,
    canonicalPaidAmount: paidAmount,
    sales: {
      ...(brand.sales || {}),
      grossAmount: Number(brand?.sales?.grossAmount ?? paidAmount),
      paidAmount,
      discountAmount: Number(brand?.sales?.discountAmount || 0)
    },
    onlinePaidAmount: paidAmount,
    offlineSalesAmount: 0
  };
}

function unassignedBrand() {
  return cloneBrand({
    brand_code: "UNASSIGNED",
    brand_name: "UNASSIGNED",
    quantitySold: 0,
    orderCount: 0,
    soldProductCount: 0,
    sales: { grossAmount: 0, paidAmount: 0, discountAmount: 0 }
  });
}

export function mergeOfflineBrandSales({
  brandSales = [],
  productSales = [],
  onlinePaidAmount = 0,
  offlineLines = [],
  since = "",
  until = ""
} = {}) {
  const resolveBrand = buildResolver(brandSales, productSales);
  const buckets = new Map(brandSales.map((brand) => {
    const cloned = cloneBrand(brand);
    return [String(cloned.brand_code || cloned.brandCode || "").trim(), cloned];
  }).filter(([code]) => code));
  const offlineDocuments = new Map();

  for (const line of offlineLines) {
    const date = String(line?.date || "");
    const amount = Number(line?.salesAmount);
    if (line?.isOfflineRevenue !== true || !Number.isFinite(amount) || (since && date < since) || (until && date > until)) continue;
    const code = resolveBrand(candidateFromProductName(line.productName)) || "UNASSIGNED";
    const brand = buckets.get(code) || unassignedBrand();
    brand.offlineSalesAmount += amount;
    brand.salesAmount += amount;
    brand.canonicalPaidAmount += amount;
    brand.sales.grossAmount += amount;
    brand.sales.paidAmount += amount;
    brand.quantitySold = Number(brand.quantitySold || 0) + (Number.isFinite(Number(line.quantity)) ? Number(line.quantity) : 0);
    const document = String(line.documentNo || line.slipNo || "").trim();
    if (document) {
      const documents = offlineDocuments.get(code) || new Set();
      documents.add(`${date}|${document}`);
      offlineDocuments.set(code, documents);
    }
    buckets.set(code, brand);
  }

  const onlineBrandTotal = brandSales.reduce((total, brand) => total + amountOf(brand), 0);
  const onlineAdjustment = Number(onlinePaidAmount || 0) - onlineBrandTotal;
  if (onlineAdjustment) {
    const brand = buckets.get("UNASSIGNED") || unassignedBrand();
    brand.onlinePaidAmount += onlineAdjustment;
    brand.salesAmount += onlineAdjustment;
    brand.canonicalPaidAmount += onlineAdjustment;
    brand.sales.grossAmount += onlineAdjustment;
    brand.sales.paidAmount += onlineAdjustment;
    buckets.set("UNASSIGNED", brand);
  }

  for (const [code, documents] of offlineDocuments) {
    const brand = buckets.get(code);
    brand.orderCount = Number(brand.orderCount || 0) + documents.size;
  }

  return [...buckets.values()].sort((left, right) => amountOf(right) - amountOf(left));
}
