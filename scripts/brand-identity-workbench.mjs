import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeBrandKey, parseBrandAliases } from "./brand-engine.mjs";
import { readEcountOfflineSalesSnapshot } from "./read-ecount-offline-sales-snapshot.mjs";

// Read model only: never imported by an identity resolver or review planner.
export async function readWorkbenchSources(workDir, now = new Date()) {
  const month = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 7);
  const read = async file => { try { return JSON.parse(await readFile(join(workDir, file), "utf8")); } catch { return null; } };
  const [catalog, registry, snapshot] = await Promise.all([
    read("cafe24-full-catalog.json"), read("product-registry.json"),
    readEcountOfflineSalesSnapshot(month, { workDir }).catch(() => null)
  ]);
  return {
    products: Array.isArray(catalog?.products) ? catalog.products : null,
    entries: Array.isArray(registry?.entries) ? registry.entries : null,
    lines: snapshot?.month === month && Array.isArray(snapshot.salesLines) ? snapshot.salesLines.filter(l => String(l.date || "").startsWith(month)) : null,
    provenance: { month, catalog: "cafe24-full-catalog.json (저장된 카탈로그; live 아님)", catalogAt: catalog?.generatedAt || null,
      registryAt: registry?.generatedAt || null, ecountAt: snapshot?.importedAt || null,
      periodStart: snapshot?.periodStart || null, periodEnd: snapshot?.periodEnd || null, storesMissing: snapshot?.storesMissing || [] }
  };
}

const key = value => normalizeBrandKey(value || "");
const rawBrand = value => String(value || "").split("/")[0].replace(/^CON\s*-\s*/i, "").trim();
const acronym = value => {
  const words = String(value || "").match(/[A-Za-z]+/g) || [];
  return words.length >= 2 ? words.map(w => w[0]).join("").toUpperCase() : "";
};

export function buildIdentityWorkbench(candidate, canonical, sources = {}) {
  if (candidate.reviewReason !== "CODE_NAME_CONFLICT") return null;
  const brands = Array.isArray(canonical) ? canonical : canonical?.brands || [];
  const owners = brands.filter(b => b.brand_code === candidate.sourceBrandCode);
  const names = [candidate.rawBrandName, candidate.cafe24Name, ...owners.map(b => b.brand_name)].filter(Boolean);
  const namesKey = names.map(key);
  const describe = (b, evidence = []) => {
    const aliases = parseBrandAliases(b.name_aliases);
    const relatedRaw = [...new Set([b.brand_name, ...aliases, ...evidence.filter(e => e.basis === "ACRONYM").map(e => e.value)])];
    const lines = sources.lines?.filter(l => relatedRaw.some(n => key(n) === key(rawBrand(l.productName))));
    const products = sources.products?.filter(p => (p.brand_code || p.brandCode) === b.brand_code);
    return { brandCode: b.brand_code, canonicalName: b.brand_name, aliases, active: b.active !== false, evidence,
      confidence: evidence.some(e => e.basis === "EXACT_NAME") ? "EXACT" : evidence.some(e => e.basis === "EXACT_ALIAS") ? "ALIAS" : evidence.some(e => e.basis === "PRODUCT_IDENTITY") ? "PRODUCT_EVIDENCE" : "RELATED_ONLY",
      productCount: products?.length ?? null, sellingCount: products?.filter(p => p.selling === "T").length ?? null,
      ecountRawNames: [...new Set((lines || []).map(l => rawBrand(l.productName)))], ecountRowCount: lines?.length ?? null,
      salesPresence: lines ? lines.some(l => Number.isFinite(Number(l.salesAmount)) && Number(l.salesAmount) !== 0) : null,
      registryDependencies: sources.entries?.filter(e => e.brandId === b.brand_code).length ?? null };
  };
  const related = brands.filter(b => b.brand_code !== candidate.sourceBrandCode).map(b => {
    const evidence = [];
    if (namesKey.includes(key(b.brand_name))) evidence.push({ basis: "EXACT_NAME", value: b.brand_name });
    for (const a of parseBrandAliases(b.name_aliases)) if (namesKey.includes(key(a))) evidence.push({ basis: "EXACT_ALIAS", value: a });
    const abbr = acronym(b.brand_name);
    for (const n of names) if (abbr.length >= 3 && key(n) === key(abbr)) evidence.push({ basis: "ACRONYM", value: n });
    for (const e of sources.entries || []) {
      if (e.brandId !== b.brand_code || e.verified !== true || e.status !== "confirmed") continue;
      const match = e.ecount?.matchedProducts?.find(p => candidate.relatedProductExamples?.some(v => key(v) === key(p.productName)));
      if (match) evidence.push({ basis: "PRODUCT_IDENTITY", value: match.productName, productId: e.canonicalProductId });
    }
    const products = sources.products?.filter(p => (p.brand_code || p.brandCode) === b.brand_code && namesKey.includes(key(rawBrand(p.product_name || p.productName))));
    if (products?.length) evidence.push({ basis: "CAFE24_PRODUCT_PREFIX", value: String(products.length) + " cached products (prefix only)" });
    return evidence.length ? describe(b, evidence) : null;
  }).filter(Boolean);
  return { current: { name: candidate.cafe24Name || candidate.rawBrandName, brandCode: candidate.sourceBrandCode,
    detectedProductCount: candidate.cafe24ProductCount ?? null, detectedAt: candidate.lastSeenAt || null },
    owners: owners.map(b => describe(b)), related, provenance: sources.provenance || {}, executionAllowed: false,
    blocker: "Historical Clients detail은 현재 Brand Master로 귀속을 다시 계산합니다. 날짜별 identity 소유권 또는 historical detail 고정, old-brand 보존, current 소비자 일관성 검증 전에는 재지정할 수 없습니다.",
    warning: "후보 관계는 동일 브랜드 확정이 아닙니다. acronym·상품 prefix·ECOUNT raw 표기는 후보 근거일 뿐 자동 연결/귀속에 사용하지 않습니다." };
}
