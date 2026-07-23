// SAMPLAS Inventory Snapshot — Phase 3A-2 (기반 준비 단계).
//
// 목적: 향후 Sell-through / 재입고 판단 계산에 필요한 "일별 ECOUNT 재고 스냅샷"을 남겨두기
// 위한 준비 작업이다. 이 스크립트는 스냅샷을 저장만 하며, Sell-through/누적입고/누적판매/
// 순이익/재입고 추천 등은 전혀 계산하지 않는다(그 계산은 충분한 스냅샷이 쌓인 다음 Phase에서).
//
// 실행:
//   node scripts/save-inventory-snapshot.mjs                 (오늘 날짜로 저장)
//   node scripts/save-inventory-snapshot.mjs --dry-run        (저장하지 않고 미리보기만)
//   node scripts/save-inventory-snapshot.mjs --date 2026-07-22
//   node scripts/save-inventory-snapshot.mjs --force          (같은 날짜에 다른 sourceGeneratedAt로
//                                                              이미 스냅샷이 있을 때만 필요, 명시적 확인)
//
// 저장 위치: work/inventory-snapshots/YYYY-MM-DD.json
// 원본 work/ecount-inventory/latest.json, diagnostic.json은 읽기만 하고 절대 수정하지 않는다.
// 이 스크립트는 스케줄러에 연결되어 있지 않고, API POST로도 연결되어 있지 않다(명시적 CLI 실행 전용).

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isQqqProductCode,
  splitEcountBrandProduct,
  parseQqqBrandProduct,
  buildLocationInfo
} from "./inventory-overview-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const ecountInventoryLatestFile = join(root, "work", "ecount-inventory", "latest.json");
const ecountInventoryDiagnosticFile = join(root, "work", "ecount-inventory", "diagnostic.json");
const snapshotDir = join(root, "work", "inventory-snapshots");

function parseCliArgs(argv) {
  const options = { dryRun: false, force: false, date: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--date") options.date = argv[i + 1];
  }
  return options;
}

function todayIso() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function classifyProductType(row) {
  if (isQqqProductCode(row.productCode)) return "qqq";
  const split = splitEcountBrandProduct(row.productName);
  return split.brandRaw ? "general" : "admin_code";
}

// 스냅샷 항목은 재고 해석 로직(classifyGeneralStock/classifyQqqStock 등)을 다시 계산하지 않고
// 원자재(stockQuantity, locations, productType)만 남긴다 — 상태 해석은 스냅샷을 "읽을 때" 매번
// 최신 정책 함수로 다시 계산하는 편이 향후 정책이 바뀌어도 과거 스냅샷을 다시 만들 필요가 없다.
function buildSnapshotItem(row) {
  const productType = classifyProductType(row);
  const location = buildLocationInfo(row);
  return {
    productCode: String(row.productCode || "").trim(),
    stockQuantity: Number.isFinite(row.stockQuantity) ? row.stockQuantity : null,
    locations: location.locations,
    productType
  };
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const dateIso = options.date || todayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    console.error(`--date는 YYYY-MM-DD 형식이어야 합니다: ${dateIso}`);
    process.exitCode = 1;
    return;
  }

  let ecountRows;
  try {
    ecountRows = JSON.parse(await readFile(ecountInventoryLatestFile, "utf8"));
  } catch (error) {
    console.error(`ECOUNT 재고 원본을 읽지 못했습니다(${ecountInventoryLatestFile}): ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (!Array.isArray(ecountRows)) {
    console.error("work/ecount-inventory/latest.json은 배열이어야 합니다.");
    process.exitCode = 1;
    return;
  }

  let diagnostic = null;
  try {
    diagnostic = JSON.parse(await readFile(ecountInventoryDiagnosticFile, "utf8"));
  } catch {
    diagnostic = null;
  }
  const sourceGeneratedAt = diagnostic?.finishedAt ?? null;

  const snapshot = {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt,
    source: "ecount",
    items: ecountRows.map(buildSnapshotItem)
  };

  const targetPath = join(snapshotDir, `${dateIso}.json`);
  const exists = await fileExists(targetPath);

  if (exists) {
    let existing;
    try {
      existing = JSON.parse(await readFile(targetPath, "utf8"));
    } catch (error) {
      console.error(`기존 스냅샷 파일을 읽지 못했습니다(${targetPath}): ${error.message}`);
      process.exitCode = 1;
      return;
    }
    if (existing.sourceGeneratedAt === sourceGeneratedAt) {
      console.log(JSON.stringify({
        action: "skipped_duplicate",
        reason: "same sourceGeneratedAt already saved for this date",
        date: dateIso,
        sourceGeneratedAt,
        path: targetPath
      }, null, 2));
      return;
    }
    if (!options.force) {
      console.log(JSON.stringify({
        action: "refused_overwrite",
        reason: "동일 날짜에 다른 sourceGeneratedAt의 스냅샷이 이미 존재합니다. 덮어쓰려면 --force를 사용하세요.",
        date: dateIso,
        existingSourceGeneratedAt: existing.sourceGeneratedAt,
        newSourceGeneratedAt: sourceGeneratedAt,
        path: targetPath
      }, null, 2));
      process.exitCode = 1;
      return;
    }
  }

  if (options.dryRun) {
    console.log(JSON.stringify({
      action: "dry_run",
      date: dateIso,
      sourceGeneratedAt,
      itemCount: snapshot.items.length,
      path: targetPath,
      sample: snapshot.items.slice(0, 3)
    }, null, 2));
    return;
  }

  await mkdir(snapshotDir, { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(JSON.stringify({
    action: exists ? "overwritten" : "created",
    date: dateIso,
    sourceGeneratedAt,
    itemCount: snapshot.items.length,
    path: targetPath
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { buildSnapshotItem, classifyProductType };
