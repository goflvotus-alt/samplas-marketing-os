// SAMPLAS Marketing OS — Unified Resolver Shadow Reconciliation (STEP63-2A)
//
// 읽기 전용 비교 스크립트. 어떤 화면/API도 이 스크립트를 호출하지 않는다(server.mjs/
// intelligence-service.mjs/outputs/*는 이 파일을 import하지 않는다 — 직접 실행 전용).
//
// 목적: 2026-07 ECOUNT 오프라인 판매 라인 전체에 대해
//   (a) 기존 Resolver F(scripts/monthly-brand-sales.mjs의 mergeOfflineBrandSales, 이미
//       Monthly Report가 매달 실제로 쓰는 로직, 무수정)
//   (b) 신규 Unified Resolver(scripts/unified-identity-resolver.mjs의 resolveIdentity,
//       STEP63-2, 무수정)
// 를 **같은 입력 데이터**에 병렬로 실행하고, 브랜드별 Revenue/Quantity/Order Count/
// Canonical Brand/Operational Group/Confidence/Source를 비교한다. 두 Resolver 모두
// work/brand-master.json, work/product-registry.json을 읽기만 한다(쓰지 않음).

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { mergeOfflineBrandSales } from "./monthly-brand-sales.mjs";
import { resolveIdentity, loadResolverContext } from "./unified-identity-resolver.mjs";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const workDir = join(rootDir, "work");

const SINCE = "2026-07-01";
const UNTIL = "2026-07-31";

async function loadOfflineLines() {
  const snapshot = JSON.parse(await readFile(join(workDir, "ecount-sales", "2026-07.json"), "utf8"));
  const lines = Array.isArray(snapshot.salesLines) ? snapshot.salesLines : (Array.isArray(snapshot.rows) ? snapshot.rows : []);
  return lines.filter((line) => (
    line?.isOfflineRevenue === true &&
    Number.isFinite(Number(line?.salesAmount)) &&
    String(line?.date || "") >= SINCE &&
    String(line?.date || "") <= UNTIL
  ));
}

async function loadOnlineBrandSales(scratchPath) {
  // 이미 이번 세션에서 확보해 둔, 같은 기간(2026-07) `/api/diagnostics/brand-sales`(읽기
  // 전용 GET, 기존 엔드포인트, 무수정) 응답 스냅샷을 그대로 쓴다 — Resolver F(기존)가
  // 원래 요구하는 입력(brands/products/onlinePaidAmount)과 정확히 같은 모양이다.
  return JSON.parse(await readFile(scratchPath, "utf8"));
}

// ---------------------------------------------------------------------------
// Unified Resolver 쪽 집계: Resolver F(mergeOfflineBrandSales)와 최대한 같은 방식으로
// 브랜드별 Revenue/Quantity/Order Count를 만든다(Order Count는 Resolver F와 동일하게
// (date|documentNo) distinct pair 기준 — "집계 방식"은 이 STEP이 바꾸지 않고, 오직
// "이 라인이 어느 브랜드인가"라는 Identity 판정 결과만 다르게 넣어 비교한다).
// ---------------------------------------------------------------------------
function aggregateWithUnifiedResolver(offlineLines, resolverContext) {
  const buckets = new Map(); // brandKey -> { canonicalName, brandCode, confidence, source, revenue, quantity, documents:Map<brandKey,Set> }
  const documentsByBrand = new Map();

  for (const line of offlineLines) {
    const result = resolveIdentity(
      { productName: line.productName, brandGroup: line.brandGroup || null },
      resolverContext
    );
    const brandKey = result.resolved ? result.brand.brandCode : "UNASSIGNED";
    const canonicalName = result.resolved ? result.brand.canonicalName : "UNASSIGNED";
    if (!buckets.has(brandKey)) {
      buckets.set(brandKey, {
        brandCode: brandKey,
        canonicalName,
        confidence: result.resolved ? result.brand.confidence : null,
        source: result.source,
        operationalGroups: new Set(),
        revenue: 0,
        quantity: 0
      });
    }
    const bucket = buckets.get(brandKey);
    bucket.revenue += Number(line.salesAmount) || 0;
    bucket.quantity += Number(line.quantity) || 0;
    if (result.operational?.brandGroup) bucket.operationalGroups.add(result.operational.brandGroup);

    const document = String(line.documentNo || line.slipNo || "").trim();
    if (document) {
      const set = documentsByBrand.get(brandKey) || new Set();
      set.add(`${line.date}|${document}`);
      documentsByBrand.set(brandKey, set);
    }
  }

  for (const [brandKey, bucket] of buckets) {
    bucket.orderCount = (documentsByBrand.get(brandKey) || new Set()).size;
    bucket.operationalGroups = [...bucket.operationalGroups].sort();
  }
  return [...buckets.values()];
}

function summarizeResolverF(mergedBrandSales) {
  return mergedBrandSales
    .filter((b) => (b.offlineSalesAmount || 0) !== 0 || (b.brand_code === "UNASSIGNED" && (b.offlineSalesAmount || 0) !== 0))
    .map((b) => ({
      brandCode: b.brand_code,
      canonicalName: b.brand_name,
      offlineRevenue: b.offlineSalesAmount || 0,
      quantity: b.quantitySold || 0, // 참고: Resolver F의 quantitySold는 온라인+오프라인 합계다(monthly-brand-sales.mjs 참고)
      orderCount: b.orderCount || 0
    }));
}

async function main() {
  const offlineLines = await loadOfflineLines();
  const onlineBrandSales = await loadOnlineBrandSales(process.argv[2] || join(workDir, "..", "scratch-brand-sales.json"));
  const resolverContext = await loadResolverContext();

  // 기존 Resolver F(무수정) — Monthly Report가 실제로 호출하는 것과 완전히 동일한 함수.
  const resolverFResult = mergeOfflineBrandSales({
    brandSales: onlineBrandSales.brands || [],
    productSales: onlineBrandSales.products || [],
    onlinePaidAmount: Number(onlineBrandSales.totals?.paidAmount || 0),
    offlineLines,
    since: SINCE,
    until: UNTIL
  });
  const resolverFByCode = new Map(resolverFResult.map((b) => [b.brand_code, b]));

  // 신규 Unified Resolver.
  const unifiedResult = aggregateWithUnifiedResolver(offlineLines, resolverContext);
  const unifiedByCode = new Map(unifiedResult.map((b) => [b.brandCode, b]));

  const allCodes = new Set([...resolverFByCode.keys(), ...unifiedByCode.keys()]);
  const rows = [];
  for (const code of allCodes) {
    const f = resolverFByCode.get(code);
    const u = unifiedByCode.get(code);
    rows.push({
      brandCode: code,
      resolverF: f ? { canonicalName: f.brand_name, offlineRevenue: f.offlineSalesAmount || 0, orderCount: f.orderCount || 0 } : null,
      unified: u ? { canonicalName: u.canonicalName, revenue: u.revenue, quantity: u.quantity, orderCount: u.orderCount, confidence: u.confidence, source: u.source, operationalGroups: u.operationalGroups } : null
    });
  }
  rows.sort((a, b) => (b.resolverF?.offlineRevenue || 0) - (a.resolverF?.offlineRevenue || 0));

  console.log(JSON.stringify({
    period: { since: SINCE, until: UNTIL },
    offlineLineCount: offlineLines.length,
    resolverFTotalOffline: resolverFResult.reduce((sum, b) => sum + (b.offlineSalesAmount || 0), 0),
    unifiedTotalRevenue: unifiedResult.reduce((sum, b) => sum + b.revenue, 0),
    rows
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
