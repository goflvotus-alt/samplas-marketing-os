import { resolveIdentity } from "./unified-identity-resolver.mjs";

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

// 온라인 매출이 이달 0건이라 brandSales에 미리 seed되지 않은 브랜드(예: 오프라인
// 전용 브랜드)도 새 code로 정확히 bucket을 만들어야 한다 — unassignedBrand()의
// brand_code:"UNASSIGNED" 하드코딩을 재사용하면 실제 code로 저장은 되지만 데이터
// 필드는 "UNASSIGNED"로 잘못 남는다(STEP67-3에서 발견, Unified Identity가 온라인
// 미판매 브랜드까지 해석할 수 있게 되면서 처음 드러난 버그).
function emptyBucket(code, name) {
  return cloneBrand({
    brand_code: code,
    brand_name: name || code,
    quantitySold: 0,
    orderCount: 0,
    soldProductCount: 0,
    sales: { grossAmount: 0, paidAmount: 0, discountAmount: 0 }
  });
}

function unassignedBrand() {
  return emptyBucket("UNASSIGNED", "UNASSIGNED");
}

// STEP67-3: 오프라인 브랜드 귀속은 이 파일이 자체 파싱/매칭 로직(옛 buildResolver)을
// 갖지 않고, 프로젝트의 공식 Unified Identity Pipeline(scripts/unified-identity-
// resolver.mjs의 resolveIdentity)에만 위임한다. identityContext는 호출자가
// loadResolverContext()로 미리 로딩해 넘긴다(이 함수 자체는 여전히 파일 I/O를 하지
// 않는 순수 함수로 유지).
export function mergeOfflineBrandSales({
  brandSales = [],
  onlinePaidAmount = 0,
  offlineLines = [],
  since = "",
  until = "",
  identityContext = null
} = {}) {
  if (!identityContext) {
    throw new Error("mergeOfflineBrandSales requires identityContext (scripts/unified-identity-resolver.mjs loadResolverContext() result)");
  }
  const buckets = new Map(brandSales.map((brand) => {
    const cloned = cloneBrand(brand);
    return [String(cloned.brand_code || cloned.brandCode || "").trim(), cloned];
  }).filter(([code]) => code));
  const offlineDocuments = new Map();

  for (const line of offlineLines) {
    const date = String(line?.date || "");
    const amount = Number(line?.salesAmount);
    if (line?.isOfflineRevenue !== true || !Number.isFinite(amount) || (since && date < since) || (until && date > until)) continue;
    const identity = resolveIdentity({ productName: line.productName, brandGroup: line.brandGroup }, identityContext);
    const code = identity.resolved ? identity.brand.brandCode : "UNASSIGNED";
    const brand = buckets.get(code) || emptyBucket(code, identity.resolved ? identity.brand.canonicalName : "UNASSIGNED");
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
