import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = join(root, "work");
const paths = {
  master: join(work, "brand-master.json"),
  products: join(work, "product-registry.json"),
  universe: join(work, "brand-universe.json"),
  audit: join(work, "brand-master-integrity-report.json"),
  reviewQueue: join(work, "brand-sourcing-review-queue.json"),
  proposalWorkbook: join(work, "brand-sourcing-representative-decision-proposal.xlsx"),
  candidates: join(work, "brand-sourcing-candidates.json"),
  json: join(work, "brand-master-merge-plan.json"),
  markdown: join(work, "brand-master-merge-plan.md"),
  csv: join(work, "brand-master-merge-plan.csv")
};
const text = (value) => String(value ?? "").trim();
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const list = (value, keys) => Array.isArray(value) ? value : keys.map((key) => value?.[key]).find(Array.isArray) || [];
const countByCode = (items, codeOf) => {
  const counts = new Map();
  for (const item of items) {
    const code = text(codeOf(item));
    if (code) counts.set(code, (counts.get(code) || 0) + 1);
  }
  return counts;
};
const csvCell = (value) => {
  const raw = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
};
const md = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

const nodeModules = process.env.CODEX_NODE_MODULES;
if (!nodeModules) throw new Error("CODEX_NODE_MODULES is required");
const require = createRequire(join(nodeModules, "package.json"));
const { FileBlob, SpreadsheetFile } = require("@oai/artifact-tool");

const [masterFile, productFile, universeFile, audit, reviewQueueFile, candidateFile] = await Promise.all([
  readJson(paths.master), readJson(paths.products), readJson(paths.universe), readJson(paths.audit),
  readJson(paths.reviewQueue), readJson(paths.candidates)
]);
const brands = list(masterFile, ["brands"]);
const products = list(productFile, ["entries", "products"]);
const universe = list(universeFile, ["brands"]);
const reviewQueue = list(reviewQueueFile, ["rows", "items"]);
const candidates = list(candidateFile, ["rows", "candidates", "items"]);
const masterByCode = new Map(brands.map((brand) => [text(brand?.brand_code), brand]).filter(([code]) => code));
const universeCounts = countByCode(universe, (item) => item?.brand_code);
const productCounts = countByCode(products, (item) => item?.brandId ?? item?.brand_code ?? item?.brandCode);
const reviewCounts = countByCode(reviewQueue, (item) => item?.brand_code ?? item?.universe_brand_code);
const candidateCounts = countByCode(candidates, (item) => item?.brand_code ?? item?.universe_brand_code);

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(paths.proposalWorkbook));
const proposalSheet = workbook.worksheets.getItem("대표 검토");
const proposalValues = proposalSheet.getUsedRange(true)?.values || [];
const proposalHeaders = new Map((proposalValues[0] || []).map((header, index) => [text(header), index]));
const proposalCodes = proposalHeaders.has("universe_brand_code")
  ? proposalValues.slice(1).map((row) => text(row[proposalHeaders.get("universe_brand_code")])).filter(Boolean)
  : [];
const proposalCounts = countByCode(proposalCodes, (code) => code);

const record = (code) => {
  const brand = masterByCode.get(code);
  if (!brand) throw new Error(`Unknown Brand Master code: ${code}`);
  return {
    brand_code: code,
    brand_name: text(brand.brand_name),
    active: brand.active === undefined ? true : Boolean(brand.active),
    universe_referenced: Boolean(universeCounts.get(code)),
    product_registry_count: productCounts.get(code) || 0,
    alias_count: Array.isArray(brand.name_aliases) ? brand.name_aliases.length : 0
  };
};
const unknownRecord = () => ({
  brand_code: "UNKNOWN",
  brand_name: "",
  active: null,
  universe_referenced: null,
  product_registry_count: null,
  alias_count: null
});
const impactFor = (codes) => {
  const count = (map) => codes.reduce((sum, code) => sum + (map.get(code) || 0), 0);
  const counts = {
    brand_master: codes.filter((code) => masterByCode.has(code)).length,
    brand_universe: count(universeCounts),
    product_registry: count(productCounts),
    review_queue: count(reviewCounts),
    proposal_workbook: count(proposalCounts),
    sourcing_candidates: count(candidateCounts)
  };
  const files = [
    ["work/brand-master.json", counts.brand_master],
    ["work/brand-universe.json", counts.brand_universe],
    ["work/product-registry.json", counts.product_registry],
    ["work/brand-sourcing-review-queue.json", counts.review_queue],
    ["work/brand-sourcing-representative-decision-proposal.xlsx", counts.proposal_workbook],
    ["work/brand-sourcing-candidates.json", counts.sourcing_candidates]
  ].filter(([, countValue]) => countValue > 0).map(([file]) => file);
  return { counts, affected_files: files };
};
const plan = ({ order, label, reason, approved, keepCode, mergeCodes, candidateCodes, sourceIssue, aliasProposal = "" }) => {
  const evidenceCodes = [...new Set(candidateCodes)];
  return {
    priority: order,
    label,
    merge_status: "PENDING",
    representative_approved: approved,
    decision: {
      keep_brand_code: keepCode || "UNKNOWN",
      merge_brand_codes: mergeCodes?.length ? mergeCodes : ["UNKNOWN"]
    },
    keep_candidate: keepCode ? record(keepCode) : unknownRecord(),
    merge_candidates: mergeCodes?.length ? mergeCodes.map(record) : [unknownRecord()],
    candidate_records: evidenceCodes.map(record),
    impact: impactFor(evidenceCodes),
    merge_reason: reason,
    alias_proposal: aliasProposal,
    source_issue: sourceIssue,
    execution: "NOT_PERFORMED"
  };
};

const plans = [
  plan({
    order: 1,
    label: "MEANTIME",
    reason: "Representative Approved",
    approved: true,
    keepCode: "B00000HM",
    mergeCodes: ["B00000KS"],
    candidateCodes: ["B00000HM", "B00000KS"],
    sourceIssue: "REPRESENTATIVE_DECISION",
    aliasProposal: "MEANTIME"
  }),
  plan({
    order: 2,
    label: "BARRAGAN",
    reason: "Representative Approved - Current Cafe24 brand code is B0000BCX; B00000KI is legacy",
    approved: true,
    keepCode: "B0000BCX",
    mergeCodes: ["B00000KI"],
    candidateCodes: ["B00000KI", "B0000BCX"],
    sourceIssue: "ACTIVE_DUPLICATE_CANONICAL"
  })
];

const inactiveIssues = audit.issues
  .filter((issue) => issue.type === "INACTIVE_DUPLICATE_CANONICAL")
  .sort((left, right) => text(left.normalized_key).localeCompare(text(right.normalized_key)));
for (const [index, issue] of inactiveIssues.entries()) {
  plans.push(plan({
    order: index + 3,
    label: issue.brand_names.join(" / ") || issue.normalized_key,
    reason: "Inactive Duplicate - Representative Decision Required",
    approved: false,
    keepCode: null,
    mergeCodes: null,
    candidateCodes: issue.brand_codes,
    sourceIssue: issue.type
  }));
}

const report = {
  generated_at: new Date().toISOString(),
  mode: "PLAN_ONLY_NO_MUTATION",
  sources: {
    required: ["work/brand-master.json", "work/product-registry.json", "work/brand-universe.json", "work/brand-master-integrity-report.json"],
    impact_only: ["work/brand-sourcing-review-queue.json", "work/brand-sourcing-representative-decision-proposal.xlsx", "work/brand-sourcing-candidates.json"]
  },
  summary: {
    merge_candidates: plans.length,
    representative_approved: plans.filter((item) => item.representative_approved).length,
    representative_pending: plans.filter((item) => !item.representative_approved).length,
    explicit_candidates: 2,
    inactive_duplicate_candidates: inactiveIssues.length
  },
  plans
};

const sections = plans.map((item) => {
  const candidatesText = item.candidate_records.map((brand) => `${brand.brand_code} / ${brand.brand_name} / active=${brand.active} / Universe=${brand.universe_referenced} / Products=${brand.product_registry_count} / Aliases=${brand.alias_count}`).join("<br>");
  return `## ${item.priority}. ${item.label}\n\n- 상태: ${item.merge_status}\n- 대표 승인 완료: ${item.representative_approved}\n- KEEP: ${item.decision.keep_brand_code}\n- MERGE: ${item.decision.merge_brand_codes.join(", ")}\n- Alias proposal: ${item.alias_proposal || "없음"}\n- 이유: ${item.merge_reason}\n- 후보 근거: ${candidatesText}\n- 영향 파일: ${item.impact.affected_files.join(", ") || "없음"}\n- 영향 건수: Brand Master ${item.impact.counts.brand_master}, Universe ${item.impact.counts.brand_universe}, Product Registry ${item.impact.counts.product_registry}, Review Queue ${item.impact.counts.review_queue}, Proposal Workbook ${item.impact.counts.proposal_workbook}, Candidate ${item.impact.counts.sourcing_candidates}\n`;
}).join("\n");
const markdown = `# Brand Master Merge Plan\n\n> 계획 전용 문서입니다. Brand Master, Universe, Product Registry 또는 Workbook을 수정하지 않습니다.\n\n- Merge candidates: ${report.summary.merge_candidates}\n- 대표 확정: ${report.summary.representative_approved}\n- 대표 미확정: ${report.summary.representative_pending}\n\n${sections}`;
const csvHeaders = ["priority", "label", "merge_status", "representative_approved", "keep_brand_code", "merge_brand_codes", "candidate_brand_codes", "alias_proposal", "merge_reason", "affected_files", "brand_master_refs", "universe_refs", "product_registry_refs", "review_queue_refs", "proposal_workbook_refs", "candidate_refs"];
const csvRows = plans.map((item) => ({
  priority: item.priority,
  label: item.label,
  merge_status: item.merge_status,
  representative_approved: item.representative_approved,
  keep_brand_code: item.decision.keep_brand_code,
  merge_brand_codes: item.decision.merge_brand_codes,
  candidate_brand_codes: item.candidate_records.map((brand) => brand.brand_code),
  alias_proposal: item.alias_proposal,
  merge_reason: item.merge_reason,
  affected_files: item.impact.affected_files,
  brand_master_refs: item.impact.counts.brand_master,
  universe_refs: item.impact.counts.brand_universe,
  product_registry_refs: item.impact.counts.product_registry,
  review_queue_refs: item.impact.counts.review_queue,
  proposal_workbook_refs: item.impact.counts.proposal_workbook,
  candidate_refs: item.impact.counts.sourcing_candidates
}));
const csv = `\uFEFF${csvHeaders.join(",")}\n${csvRows.map((row) => csvHeaders.map((header) => csvCell(row[header])).join(",")).join("\n")}\n`;

if (plans.length !== inactiveIssues.length + 2 || plans[0].decision.keep_brand_code !== "B00000HM" || plans[0].decision.merge_brand_codes[0] !== "B00000KS" || plans[0].alias_proposal !== "MEANTIME" || plans[1].decision.keep_brand_code !== "B0000BCX" || plans[1].decision.merge_brand_codes[0] !== "B00000KI" || !plans[1].representative_approved) throw new Error("Merge plan self-check failed");
await Promise.all([
  writeFile(paths.json, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(paths.markdown, markdown, "utf8"),
  writeFile(paths.csv, csv, "utf8")
]);
console.log(JSON.stringify(report.summary, null, 2));
