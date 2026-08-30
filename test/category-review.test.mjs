import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  CATEGORY_REVIEW_TAXONOMY,
  buildCategoryReviewWorkspace,
  buildProductCodeCategoryMap,
  loadCategoryReviewWorkspace,
  saveCategoryReviewAssignment
} from "../scripts/category-review.mjs";

const root = resolve(".");
const realAuditPath = join(root, "work/category-unclassified-model-audit.json");
const realMasterPath = join(root, "work/category-master.json");

function fixtureAudit(models = [
  { modelKey: "CODE_PREFIX:PAC001", brand: "PACOSPLY", productName: "WonderLand T-shirts BLACK / S SIZE", skuCount: 2, productCodes: ["PAC00102", "PAC00103"], barcodes: ["PAC00102", "PAC00103"], options: ["S", "M"], currentStockQuantity: 4, classifierFailureReasons: ["unsupported_suffix:ST"] },
  { modelKey: "SKU:OTHER00100", brand: "OTHER", productName: "Other", skuCount: 1, productCodes: ["OTHER00100"], barcodes: [], options: ["OS"], currentStockQuantity: 0, classifierFailureReasons: ["unsupported_suffix:AC"] }
]) {
  return { mode: "read_only_audit", category: { models } };
}

function fixtureMaster() {
  return { version: "v1", note: "fixture", manualOverrides: [] };
}

async function fixtureFiles() {
  const dir = await mkdtemp(join(tmpdir(), "samplas-category-review-"));
  const auditPath = join(dir, "audit.json");
  const masterPath = join(dir, "category-master.json");
  await writeFile(auditPath, JSON.stringify(fixtureAudit()));
  await writeFile(masterPath, JSON.stringify(fixtureMaster()));
  return { auditPath, masterPath };
}

// 2026-08 deterministic-rules update: 확정 suffix(ST/LT/HD/DR/AC)/RESURRECITON 13 내부
// 품번/이름 tail-first/개별 예외를 활성화한 뒤 감사를 재생성해 unclassified 모델이
// 1342개 -> 6개로 급감했고(docs/reports/CATEGORY-MASTER-DETERMINISTIC-RULES-AND-
// SUBCATEGORY.md 참고), 2026-08-15 마지막 6개를 사용자 확인값(개별 예외)으로 반영해
// 0개(전량 분류 완료)가 됐다. PACOSPLY는 전량 LT suffix로 자동 분류되어 이 감사(=아직
// review가 필요한 모델 목록)에서 완전히 빠졌다 — 기존 수동 승인 8건은
// work/category-master.json의 modelAssignments에 별도로 보존된다(아래 "existing
// PACOSPLY manual assignments" 테스트).
test("review artifact loads and reflects the fully-classified post-rules-update set (0 remaining)", async () => {
  const workspace = await loadCategoryReviewWorkspace({ auditPath: realAuditPath, masterPath: realMasterPath });
  assert.equal(workspace.summary.totalModels, 0);
  assert.equal(workspace.summary.remainingModels, 0);
  assert.equal(workspace.brands.find((brand) => brand.brand === "PACOSPLY"), undefined, "PACOSPLY has zero remaining unclassified models post-rules-update");
});

test("existing PACOSPLY manual assignments are preserved untouched in category-master.json", async () => {
  const master = JSON.parse(await readFile(realMasterPath, "utf8"));
  const pacosplyAssignments = (master.modelAssignments || []).filter((a) => a.brand === "PACOSPLY");
  assert.equal(pacosplyAssignments.length, 8);
  assert.deepEqual(pacosplyAssignments.map((a) => a.modelKey).sort(), [
    "CODE_PREFIX:PAC253LT005", "CODE_PREFIX:PAC253LT006", "CODE_PREFIX:PAC253LT007", "CODE_PREFIX:PAC253LT008",
    "CODE_PREFIX:PAC261LT014", "CODE_PREFIX:PAC261LT015", "CODE_PREFIX:PAC261LT016", "SKU:PAC261LT01701"
  ]);
  assert.ok(pacosplyAssignments.every((a) => a.categoryCode === "TOP" && a.source === "category_review_manual"));
});

test("excluded product codes (payment/operational lines) never appear in the Category Review audit", async () => {
  const audit = JSON.parse(await readFile(realAuditPath, "utf8"));
  const excludedCodes = new Set(["00000", "00001", "00002", "A0001", "MAKE001", "QQQ00262"]);
  for (const model of audit.category.models) {
    for (const productCode of model.productCodes || []) assert.ok(!excludedCodes.has(String(productCode)), `${productCode} must be excluded`);
  }
});

test("taxonomy is the existing Category Master v1 set without UNCLASSIFIED assignment", () => {
  assert.deepEqual(CATEGORY_REVIEW_TAXONOMY, ["TOP", "BOTTOM", "OUTER", "DRESS", "BAG", "FOOTWEAR", "HEADWEAR", "JEWELRY", "ACCESSORY", "OTHER"]);
});

test("manual save persists one model assignment and resolves every member SKU", async () => {
  const paths = await fixtureFiles();
  const saved = await saveCategoryReviewAssignment({ ...paths, modelKey: "CODE_PREFIX:PAC001", categoryCode: "TOP", now: "2026-08-14T00:00:00.000Z" });
  assert.equal(saved.assignment.affectedSkuCount, 2);
  const reloaded = JSON.parse(await readFile(paths.masterPath, "utf8"));
  assert.equal(reloaded.manualOverrides.length, 0);
  const map = buildProductCodeCategoryMap(reloaded);
  assert.equal(map.get("PAC00102"), "TOP");
  assert.equal(map.get("PAC00103"), "TOP");
  assert.equal((await loadCategoryReviewWorkspace(paths)).summary.completedModels, 1);
});

test("invalid category and invalid model are rejected without changing Category Master", async () => {
  const paths = await fixtureFiles();
  const before = await readFile(paths.masterPath, "utf8");
  await assert.rejects(() => saveCategoryReviewAssignment({ ...paths, modelKey: "CODE_PREFIX:PAC001", categoryCode: "UNCLASSIFIED" }), /Invalid categoryCode/);
  await assert.rejects(() => saveCategoryReviewAssignment({ ...paths, modelKey: "MISSING", categoryCode: "TOP" }), /Invalid modelKey/);
  assert.equal(await readFile(paths.masterPath, "utf8"), before);
});

test("hold is UI session state only and never calls the save endpoint", async () => {
  const source = await readFile(join(root, "outputs/samplas-marketing-os.js"), "utf8");
  const holdHandler = source.match(/\$\("\[data-category-review-hold\]"\)[\s\S]*?\n  \}\);/)?.[0] || "";
  assert.match(holdHandler, /heldModelKeys\.add/);
  assert.doesNotMatch(holdHandler, /patchJson|postJson/);
});

test("workspace builder reports remaining/completed progress deterministically", () => {
  const master = { ...fixtureMaster(), modelAssignments: [{ modelKey: "CODE_PREFIX:PAC001", categoryCode: "TOP", productCodes: ["PAC00102", "PAC00103"] }] };
  const workspace = buildCategoryReviewWorkspace(fixtureAudit(), master);
  assert.deepEqual(workspace.summary, { totalModels: 2, completedModels: 1, remainingModels: 1 });
  assert.equal(workspace.brands.find((brand) => brand.brand === "PACOSPLY").progress, 1);
});

test("missing diagnostic artifact is an explicit P3 INCOMPLETE state, not an uncontrolled error", async () => {
  const paths = await fixtureFiles();
  const workspace = await loadCategoryReviewWorkspace({
    auditPath: `${paths.auditPath}.missing`,
    masterPath: paths.masterPath
  });
  assert.equal(workspace.available, false);
  assert.equal(workspace.status, "INCOMPLETE");
  assert.equal(workspace.summary, null);
  assert.deepEqual(workspace.models, []);
});

test("incomplete Category Review is hidden from Production navigation and shown explicitly on direct access", async () => {
  const source = await readFile(join(root, "outputs/samplas-marketing-os.js"), "utf8");
  assert.match(source, /view: "CategoryReview"[^\n]+hidden: true/);
  assert.match(source, /CATEGORY REVIEW INCOMPLETE/);
});

test("APGUJEONG and VAIL canonical offline totals remain unchanged", async () => {
  const apgujeong = JSON.parse(await readFile(join(root, "work/ecount-sales/2026-08.APGUJEONG.json"), "utf8"));
  const vail = JSON.parse(await readFile(join(root, "work/ecount-sales/2026-08.VAIL.json"), "utf8"));
  assert.equal(apgujeong.totalOfflineSales, 97177900);
  assert.equal(vail.totalOfflineSales, 70200);
  assert.equal(vail.salesLines.filter((line) => line.isOfflineRevenue).reduce((sum, line) => sum + line.salesAmount, 0), 70200);
});
