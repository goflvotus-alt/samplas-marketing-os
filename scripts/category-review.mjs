import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const CATEGORY_REVIEW_TAXONOMY = [
  "TOP", "BOTTOM", "OUTER", "DRESS", "BAG", "FOOTWEAR",
  "HEADWEAR", "JEWELRY", "ACCESSORY", "OTHER"
];

const taxonomy = new Set(CATEGORY_REVIEW_TAXONOMY);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function validateAudit(audit) {
  if (!audit || audit.mode !== "read_only_audit" || !Array.isArray(audit.category?.models)) {
    throw Object.assign(new Error("Invalid category review audit artifact"), { status: 500 });
  }
  const keys = new Set();
  for (const model of audit.category.models) {
    if (!model?.modelKey || !Array.isArray(model.productCodes) || !model.productCodes.length || keys.has(model.modelKey)) {
      throw Object.assign(new Error("Invalid or duplicate review model identity"), { status: 500 });
    }
    keys.add(model.modelKey);
  }
}

function validateMaster(master) {
  if (!master || typeof master !== "object" || !Array.isArray(master.manualOverrides || [])) {
    throw Object.assign(new Error("Invalid Category Master v1"), { status: 500 });
  }
  if (master.modelAssignments !== undefined && !Array.isArray(master.modelAssignments)) {
    throw Object.assign(new Error("Invalid Category Master modelAssignments"), { status: 500 });
  }
  const seen = new Set();
  for (const assignment of master.modelAssignments || []) {
    if (!assignment?.modelKey || !taxonomy.has(assignment.categoryCode) || seen.has(assignment.modelKey)) {
      throw Object.assign(new Error("Invalid Category Master model assignment"), { status: 500 });
    }
    seen.add(assignment.modelKey);
  }
}

export function buildCategoryReviewWorkspace(audit, master) {
  validateAudit(audit);
  validateMaster(master);
  const assignments = new Map((master.modelAssignments || []).map((item) => [item.modelKey, item]));
  const models = audit.category.models.map((model) => ({
    ...model,
    assignment: assignments.get(model.modelKey) || null,
    reviewStatus: assignments.has(model.modelKey) ? "COMPLETED" : "REMAINING"
  }));
  const brandMap = new Map();
  for (const model of models) {
    const row = brandMap.get(model.brand) || { brand: model.brand, totalModels: 0, remainingModels: 0, completedModels: 0 };
    row.totalModels += 1;
    row[model.reviewStatus === "COMPLETED" ? "completedModels" : "remainingModels"] += 1;
    brandMap.set(model.brand, row);
  }
  const brands = [...brandMap.values()]
    .map((row) => ({ ...row, progress: row.totalModels ? row.completedModels / row.totalModels : 0 }))
    .sort((left, right) => right.remainingModels - left.remainingModels || left.brand.localeCompare(right.brand));
  return {
    taxonomy: CATEGORY_REVIEW_TAXONOMY,
    summary: {
      totalModels: models.length,
      completedModels: models.filter((model) => model.reviewStatus === "COMPLETED").length,
      remainingModels: models.filter((model) => model.reviewStatus === "REMAINING").length
    },
    brands,
    models
  };
}

export async function loadCategoryReviewWorkspace({ auditPath, masterPath }) {
  return buildCategoryReviewWorkspace(await readJson(auditPath), await readJson(masterPath));
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, path);
}

export async function saveCategoryReviewAssignment({ auditPath, masterPath, modelKey, categoryCode, now = new Date().toISOString() }) {
  if (!taxonomy.has(categoryCode)) throw Object.assign(new Error("Invalid categoryCode"), { status: 400 });
  const audit = await readJson(auditPath);
  validateAudit(audit);
  const model = audit.category.models.find((item) => item.modelKey === modelKey);
  if (!model) throw Object.assign(new Error("Invalid modelKey"), { status: 404 });
  const master = await readJson(masterPath);
  validateMaster(master);
  const assignment = {
    modelKey: model.modelKey,
    categoryCode,
    productCodes: [...model.productCodes],
    brand: model.brand,
    productName: model.productName,
    affectedSkuCount: model.skuCount,
    source: "category_review_manual",
    approvedAt: now
  };
  const modelAssignments = (master.modelAssignments || []).filter((item) => item.modelKey !== modelKey);
  modelAssignments.push(assignment);
  modelAssignments.sort((left, right) => left.modelKey.localeCompare(right.modelKey));
  const next = { ...master, modelAssignments, updatedAt: now };
  validateMaster(next);
  await writeJsonAtomic(masterPath, next);
  return { assignment, categoryMaster: next };
}

export function buildProductCodeCategoryMap(master) {
  validateMaster(master);
  const result = new Map();
  for (const assignment of master.modelAssignments || []) {
    for (const productCode of assignment.productCodes || []) result.set(String(productCode), assignment.categoryCode);
  }
  return result;
}
