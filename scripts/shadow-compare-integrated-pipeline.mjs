// SAMPLAS Marketing OS — Integrated Identity Pipeline Shadow Reconciliation (STEP63-2B)
//
// 읽기 전용 비교 스크립트. 어떤 화면/API도 이 스크립트를 호출하지 않는다(server.mjs/
// intelligence-service.mjs/outputs/*는 이 파일을 import하지 않는다 — 직접 실행 전용).
//
// STEP63-2A(scripts/shadow-compare-resolvers.mjs)는 기존 Resolver F와 STEP63-2 Unified
// Resolver(온라인 카탈로그 2차 조회 없음) 둘을 비교했다. 이 스크립트는 거기에 STEP63-2B가
// 확장한 "Integrated Pipeline"(Unified Resolver + 온라인 카탈로그 2차 조회)을 추가해
// 3-way로 비교한다. 같은 2026-07 ECOUNT 오프라인 판매 라인(1,178건)을 그대로 재사용한다.

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

// STEP63-2A와 동일한 집계 방식(Order Count는 (date|documentNo) distinct pair) — "이 라인이
// 어느 브랜드인가"라는 Identity 판정 결과만 리졸버별로 다르게 넣는다. 집계 로직 자체는
// 바꾸지 않는다(STEP63-1 9번 항목: Identity Resolution ≠ Sales Calculation).
function aggregateWithResolver(offlineLines, resolveFn) {
  const buckets = new Map();
  const documentsByBrand = new Map();

  for (const line of offlineLines) {
    const result = resolveFn(line);
    const brandKey = result.resolved ? result.brand.brandCode : "UNASSIGNED";
    const canonicalName = result.resolved ? result.brand.canonicalName : "UNASSIGNED";
    if (!buckets.has(brandKey)) {
      buckets.set(brandKey, { brandCode: brandKey, canonicalName, revenue: 0, quantity: 0, operationalGroups: new Set() });
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

function totalRevenue(rows, field = "revenue") {
  return rows.reduce((sum, b) => sum + (b[field] || 0), 0);
}
function assignedRevenue(rows, field = "revenue") {
  return rows.filter((b) => b.brandCode !== "UNASSIGNED").reduce((sum, b) => sum + (b[field] || 0), 0);
}
function unassignedRevenue(rows, field = "revenue") {
  const row = rows.find((b) => b.brandCode === "UNASSIGNED");
  return row ? (row[field] || 0) : 0;
}

async function main() {
  const offlineLines = await loadOfflineLines();
  const onlineCatalog = JSON.parse(await readFile(process.argv[2], "utf8"));

  // 1) 기존 Resolver F(무수정).
  const resolverF = mergeOfflineBrandSales({
    brandSales: onlineCatalog.brands || [],
    productSales: onlineCatalog.products || [],
    onlinePaidAmount: Number(onlineCatalog.totals?.paidAmount || 0),
    offlineLines,
    since: SINCE,
    until: UNTIL
  }).map((b) => ({ brandCode: b.brand_code, canonicalName: b.brand_name, revenue: b.offlineSalesAmount || 0, quantity: b.quantitySold || 0, orderCount: b.orderCount || 0 }));

  // 2) STEP63-2A Old Unified(온라인 카탈로그 2차 조회 없음).
  const oldContext = await loadResolverContext();
  const oldUnified = aggregateWithResolver(offlineLines, (line) => resolveIdentity({ productName: line.productName, brandGroup: line.brandGroup || null }, oldContext));

  // 3) STEP63-2B Integrated Pipeline(온라인 카탈로그 2차 조회 포함).
  const newContext = await loadResolverContext({ onlineCatalog });
  const integrated = aggregateWithResolver(offlineLines, (line) => resolveIdentity({ productName: line.productName, brandGroup: line.brandGroup || null }, newContext));

  const summary = {
    period: { since: SINCE, until: UNTIL },
    offlineLineCount: offlineLines.length,
    totals: {
      resolverF: totalRevenue(resolverF),
      oldUnified: totalRevenue(oldUnified),
      integrated: totalRevenue(integrated)
    },
    assignedRevenue: {
      resolverF: assignedRevenue(resolverF),
      oldUnified: assignedRevenue(oldUnified),
      integrated: assignedRevenue(integrated)
    },
    unassignedRevenue: {
      resolverF: unassignedRevenue(resolverF),
      oldUnified: unassignedRevenue(oldUnified),
      integrated: unassignedRevenue(integrated)
    },
    totalQuantity: {
      resolverF: totalRevenue(resolverF, "quantity"),
      oldUnified: totalRevenue(oldUnified, "quantity"),
      integrated: totalRevenue(integrated, "quantity")
    },
    resolvedBrandCount: {
      resolverF: resolverF.filter((b) => b.brandCode !== "UNASSIGNED").length,
      oldUnified: oldUnified.filter((b) => b.brandCode !== "UNASSIGNED").length,
      integrated: integrated.filter((b) => b.brandCode !== "UNASSIGNED").length
    }
  };

  const criticalCodes = {
    "B00000SA": "BONNAE(본네)",
    "B00000HD": "SUNDAY OFF CLUB(선데이오프클럽)",
    "B0000BCU": "OURSELVES REMAKE",
    "B00000WE": "RACER WORLDWIDE(레이서 월드 와이드)",
    "B0000BCQ": "KAMIGIN(카미긴)",
    "B0000BBJ": "424",
    "B00000YL": "COZY WORLDWIDE",
    "B00000TE": "4FEX"
  };
  const critical = [];
  for (const [code, label] of Object.entries(criticalCodes)) {
    critical.push({
      code,
      label,
      resolverF: resolverF.find((b) => b.brandCode === code) || null,
      oldUnified: oldUnified.find((b) => b.brandCode === code) || null,
      integrated: integrated.find((b) => b.brandCode === code) || null
    });
  }

  console.log(JSON.stringify({ summary, critical }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
