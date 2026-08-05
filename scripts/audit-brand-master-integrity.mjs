import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { normalizeBrandCode, normalizeBrandKey, normalizeBrandName, parseBrandAliases } from "./brand-engine.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  master: join(root, "work/brand-master.json"),
  products: join(root, "work/product-registry.json"),
  universe: join(root, "work/brand-universe.json"),
  json: join(root, "work/brand-master-integrity-report.json"),
  markdown: join(root, "work/brand-master-integrity-report.md"),
  csv: join(root, "work/brand-master-integrity-report.csv")
};
const priorities = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const text = (value) => String(value ?? "").trim();
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const groupBy = (items, keyOf) => {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const values = groups.get(key) || [];
    values.push(item);
    groups.set(key, values);
  }
  return groups;
};
const aggressiveBrandKey = (value) => normalizeBrandKey(value)
  .replace(/\band\b/g, "&")
  .replace(/[^\p{L}\p{N}]+/gu, "");
const csvCell = (value) => {
  const raw = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
};
const markdownCell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

const makeIssue = (priority, type, key, entries, detail, recommendation) => ({
  priority,
  type,
  normalized_key: key,
  brand_codes: [...new Set(entries.map((item) => item.brand_code).filter(Boolean))].sort(),
  brand_names: [...new Set(entries.map((item) => item.brand_name).filter(Boolean))].sort(),
  detail,
  recommendation
});

export function auditBrandOwnership(sourceBrands = []) {
  const brands = sourceBrands.map((brand) => ({
    brand_code: normalizeBrandCode(brand?.brand_code),
    brand_name: normalizeBrandName(brand?.brand_name),
    aliases: parseBrandAliases(brand?.name_aliases ?? brand?.aliases),
    active: brand?.active !== false
  }));
  const canonicalGroups = groupBy(brands, (brand) => normalizeBrandKey(brand.brand_name));
  const claims = [];
  for (const brand of brands) {
    claims.push({ ...brand, source_type: "CANONICAL", raw_value: brand.brand_name });
    for (const alias of brand.aliases) claims.push({ ...brand, source_type: "ALIAS", raw_value: alias });
  }
  const ownerGroups = groupBy(claims, (claim) => normalizeBrandKey(claim.raw_value));
  const issues = [];
  for (const [key, group] of ownerGroups) {
    const owners = group.filter((claim, index) => group.findIndex((candidate) => candidate.brand_code === claim.brand_code) === index);
    if (owners.length < 2) continue;
    const active = owners.filter((owner) => owner.active !== false);
    const activeSources = new Set(active.map((owner) => owner.source_type));
    const allSources = new Set(owners.map((owner) => owner.source_type));
    if (active.length >= 2) {
      const type = activeSources.size > 1 ? "CANONICAL_ALIAS_CONFLICT" : activeSources.has("ALIAS") ? "ALIAS_ALIAS_CONFLICT" : "ACTIVE_DUPLICATE_CANONICAL";
      issues.push(makeIssue("Critical", type, key, active, "동일 normalized key를 서로 다른 active brand_code가 소유합니다.", "active 소유 브랜드를 수동 확정하고 충돌 해소 전 자동 연결 금지"));
    } else if (active.length === 1) {
      issues.push(makeIssue("Low", "ACTIVE_OWNER_WITH_INACTIVE_LEGACY", key, owners, "유일한 active 소유자와 inactive legacy code가 동일 key를 공유합니다.", "active 소유자를 유지하고 inactive code는 이력/fallback으로 보존"));
    } else {
      const type = allSources.size > 1 ? "INACTIVE_CANONICAL_ALIAS_CONFLICT" : allSources.has("ALIAS") ? "INACTIVE_ALIAS_CONFLICT" : "INACTIVE_DUPLICATE_CANONICAL";
      issues.push(makeIssue("Medium", type, key, owners, "inactive brand_code끼리 동일 normalized key를 공유합니다.", "이력 보존 필요성을 확인하고 대표 승인 후 정리 검토"));
    }
  }
  const duplicateCanonicalGroups = [...canonicalGroups.values()].filter((group) => new Set(group.map((brand) => brand.brand_code)).size >= 2);
  return {
    issues,
    duplicateCanonicalGroups,
    activeDuplicateGroups: duplicateCanonicalGroups.filter((group) => group.filter((brand) => brand.active !== false).length >= 2),
    inactiveDuplicateGroups: duplicateCanonicalGroups.filter((group) => group.filter((brand) => brand.active === false).length >= 2),
    canonicalAliasConflicts: issues.filter((issue) => issue.type === "CANONICAL_ALIAS_CONFLICT"),
    aliasAliasConflicts: issues.filter((issue) => issue.type === "ALIAS_ALIAS_CONFLICT")
  };
}

async function main() {
const [masterFile, productFile, universeFile] = await Promise.all([
  readJson(paths.master), readJson(paths.products), readJson(paths.universe)
]);
const brands = (Array.isArray(masterFile) ? masterFile : masterFile?.brands || []).map((brand) => ({
  brand_code: normalizeBrandCode(brand?.brand_code),
  brand_name: normalizeBrandName(brand?.brand_name),
  aliases: parseBrandAliases(brand?.name_aliases),
  active: brand?.active === undefined ? true : Boolean(brand.active)
}));
const products = Array.isArray(productFile) ? productFile : productFile?.entries || [];
const universe = Array.isArray(universeFile) ? universeFile : universeFile?.brands || [];
const masterByCode = new Map(brands.filter((brand) => brand.brand_code).map((brand) => [brand.brand_code, brand]));
const universeCodes = new Set(universe.map((item) => normalizeBrandCode(item?.brand_code)).filter(Boolean));
const productCounts = new Map();
for (const product of products) {
  const code = normalizeBrandCode(product?.brandId ?? product?.brand_code ?? product?.brandCode);
  if (code) productCounts.set(code, (productCounts.get(code) || 0) + 1);
}

const issues = [];
const addIssue = (priority, type, key, entries, detail, recommendation) => issues.push(makeIssue(priority, type, key, entries, detail, recommendation));
const ownership = auditBrandOwnership(brands);
issues.push(...ownership.issues);

const normalizedCollisions = [];
for (const [key, group] of groupBy(brands, (brand) => aggressiveBrandKey(brand.brand_name))) {
  const codes = new Set(group.map((brand) => brand.brand_code));
  const standardKeys = new Set(group.map((brand) => normalizeBrandKey(brand.brand_name)));
  if (codes.size < 2 || standardKeys.size < 2) continue;
  normalizedCollisions.push(group);
  addIssue("Medium", "NORMALIZED_NAME_COLLISION", key, group, "띄어쓰기·대소문자·하이픈·AND/& 제거 후 canonical name이 같습니다.", "동일 브랜드 여부를 수동 검토하고 승인된 경우에만 병합");
}

const missingUniverseCodes = [...universeCodes].filter((code) => !masterByCode.has(code)).sort();
for (const code of missingUniverseCodes) addIssue("High", "UNIVERSE_MISSING_BRAND", code, [{ brand_code: code, brand_name: "" }], "Brand Universe가 Brand Master에 없는 code를 참조합니다.", "Universe 참조 code와 Master 생성 이력을 확인");

const productMissingCodes = [...productCounts.keys()].filter((code) => !masterByCode.has(code)).sort();
for (const code of productMissingCodes) addIssue("High", "PRODUCT_REGISTRY_MISSING_BRAND", code, [{ brand_code: code, brand_name: "" }], `Product Registry 상품 ${productCounts.get(code)}개가 Master에 없는 code를 참조합니다.`, "상품 참조를 유지한 채 canonical brand code를 수동 확인");

const productNameConflicts = [];
for (const product of products) {
  const code = normalizeBrandCode(product?.brandId ?? product?.brand_code ?? product?.brandCode);
  const master = masterByCode.get(code);
  const registryName = normalizeBrandName(product?.brandName ?? product?.brand_name);
  if (!master || !registryName || normalizeBrandKey(registryName) === normalizeBrandKey(master.brand_name)) continue;
  productNameConflicts.push({ code, master, registryName });
}
for (const [code, group] of groupBy(productNameConflicts, (item) => item.code)) {
  const master = masterByCode.get(code);
  addIssue("High", "PRODUCT_REGISTRY_NAME_CONFLICT", code, [master], `Product Registry 상품 ${group.length}개의 brandName이 Master canonical name과 다릅니다: ${[...new Set(group.map((item) => item.registryName))].join(", ")}`, "code 기준 연결은 유지하고 표시명 생성 경로를 점검");
}

const productOutsideUniverse = [...productCounts.keys()].filter((code) => masterByCode.has(code) && !universeCodes.has(code)).sort();
for (const code of productOutsideUniverse) {
  const brand = masterByCode.get(code);
  addIssue("High", "PRODUCT_BRAND_OUTSIDE_UNIVERSE", code, [brand], `Product Registry 상품 ${productCounts.get(code)}개가 사용하지만 Brand Universe에는 없습니다.`, "Universe 포함 여부를 수동 검토");
}

const orphanBrands = brands.filter((brand) => brand.brand_code && !universeCodes.has(brand.brand_code) && !productCounts.has(brand.brand_code));
for (const brand of orphanBrands) addIssue("Low", "ORPHAN_BRAND", brand.brand_code, [brand], "Brand Universe와 Product Registry 어디에서도 참조되지 않습니다.", "삭제하지 말고 이력·향후 사용 여부 검토");
const unusedActiveBrands = orphanBrands.filter((brand) => brand.active);
for (const brand of unusedActiveBrands) addIssue("Low", "UNUSED_ACTIVE_BRAND", brand.brand_code, [brand], "active 상태지만 Universe와 Product Registry에서 사용되지 않습니다.", "active 유지 필요성을 검토");

issues.sort((left, right) => priorities[left.priority] - priorities[right.priority] || left.type.localeCompare(right.type) || left.normalized_key.localeCompare(right.normalized_key));
const issueCounts = Object.fromEntries(Object.keys(priorities).map((priority) => [priority, issues.filter((issue) => issue.priority === priority).length]));
const usage = brands.map((brand) => ({
  brand_code: brand.brand_code,
  brand_name: brand.brand_name,
  active: brand.active,
  universe_referenced: universeCodes.has(brand.brand_code),
  product_count: productCounts.get(brand.brand_code) || 0,
  orphan: !universeCodes.has(brand.brand_code) && !productCounts.has(brand.brand_code)
}));
const report = {
  generated_at: new Date().toISOString(),
  sources: {
    brand_master: "work/brand-master.json",
    product_registry: "work/product-registry.json",
    brand_universe: "work/brand-universe.json"
  },
  policy: {
    mutation: "diagnostic_only",
    canonical_key: "normalizeBrandKey",
    collision_key: "normalizeBrandKey + remove spacing/punctuation/hyphen + AND/& equivalence"
  },
  summary: {
    total_brands: brands.length,
    active_brands: brands.filter((brand) => brand.active).length,
    inactive_brands: brands.filter((brand) => !brand.active).length,
    product_registry_entries: products.length,
    universe_brands: universeCodes.size,
    priorities: issueCounts,
    duplicate_canonical_groups: ownership.duplicateCanonicalGroups.length,
    active_duplicate_groups: ownership.activeDuplicateGroups.length,
    inactive_duplicate_groups: ownership.inactiveDuplicateGroups.length,
    canonical_alias_conflicts: ownership.canonicalAliasConflicts.length,
    alias_alias_conflicts: ownership.aliasAliasConflicts.length,
    normalized_name_collisions: normalizedCollisions.length,
    universe_missing_codes: missingUniverseCodes.length,
    product_registry_missing_codes: productMissingCodes.length,
    product_registry_name_conflict_codes: new Set(productNameConflicts.map((item) => item.code)).size,
    product_brands_outside_universe: productOutsideUniverse.length,
    orphan_brands: orphanBrands.length,
    unused_active_brands: unusedActiveBrands.length
  },
  brand_usage: usage,
  issues
};

const prioritySections = Object.keys(priorities).map((priority) => {
  const rows = issues.filter((issue) => issue.priority === priority);
  return `## ${priority} (${rows.length})\n\n${rows.length ? [
    "| Type | Key | Brand Codes | Brand Names | Detail | Recommendation |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((issue) => `| ${issue.type} | ${markdownCell(issue.normalized_key)} | ${markdownCell(issue.brand_codes.join(", "))} | ${markdownCell(issue.brand_names.join(", "))} | ${markdownCell(issue.detail)} | ${markdownCell(issue.recommendation)} |`)
  ].join("\n") : "없음"}`;
}).join("\n\n");
const markdown = `# Brand Master Integrity Audit\n\n- 생성 시각: ${report.generated_at}\n- 모드: 진단 전용 (원본 변경 없음)\n- Brand Master: ${report.summary.total_brands}개 (active ${report.summary.active_brands}, inactive ${report.summary.inactive_brands})\n- Product Registry: ${report.summary.product_registry_entries}개 상품\n- Brand Universe: ${report.summary.universe_brands}개 브랜드\n\n${prioritySections}\n`;
const csvHeaders = ["priority", "type", "normalized_key", "brand_codes", "brand_names", "detail", "recommendation"];
const csv = `\uFEFF${csvHeaders.join(",")}\n${issues.map((issue) => csvHeaders.map((header) => csvCell(issue[header])).join(",")).join("\n")}\n`;

if (brands.length !== masterByCode.size || usage.length !== brands.length || Object.values(issueCounts).reduce((sum, count) => sum + count, 0) !== issues.length) throw new Error("Audit self-check failed");
await Promise.all([
  writeFile(paths.json, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(paths.markdown, markdown, "utf8"),
  writeFile(paths.csv, csv, "utf8")
]);
console.log(JSON.stringify(report.summary, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
