// ECOUNT Open API 연동 Phase 1 — Zone 자동 조회 → Login → SESSION_ID 발급 →
// 품목조회(InventoryBasic/GetBasicProductsList) → 재고조회
// (InventoryBalance/GetListInventoryBalanceStatus) → JSON 저장까지만 수행한다.
// UI, 신규 API 엔드포인트, Inventory 화면은 이번 단계에 포함하지 않는다.
//
// 실행 (운영 모드, 기존과 동일):
//   node scripts/sync-ecount-inventory.mjs
//
// 실행 (테스트 인증키 개발 검증 모드 — sboapi 테스트 서버로 실제 요청을 보낸다):
//   node scripts/sync-ecount-inventory.mjs --test
//   node scripts/sync-ecount-inventory.mjs --test --products-only   (품목조회만 실행)
//
// 테스트 모드는 ECOUNT 공식 절차상 "테스트 인증키 검증은 sboapi 테스트 URL에 실제 요청을
// 전송해야 하고, 요청 성공과 동시에 해당 API가 검증된다"는 조건을 만족하기 위한 것으로,
// API 직접실행 화면 대신 이 스크립트가 sboapi 호스트에 직접 요청을 보낸다.

import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const outputDir = join(root, "work", "ecount-inventory");

const REQUIRED_ENV_KEYS = ["ECOUNT_COM_CODE", "ECOUNT_USER_ID", "ECOUNT_API_CERT_KEY"];

// 운영 호스트는 oapi, 테스트 인증키 검증 호스트는 sboapi를 사용한다.
const HOST_PREFIX_BY_MODE = {
  production: "oapi",
  test: "sboapi"
};

function parseCliArgs(argv) {
  const options = { test: false, productsOnly: false };
  for (const arg of argv) {
    if (arg === "--test") options.test = true;
    else if (arg === "--products-only") options.productsOnly = true;
  }
  return options;
}

async function main() {
  const env = await loadEnv();
  const cli = parseCliArgs(process.argv.slice(2));
  const mode = cli.test ? "test" : "production";
  const hostPrefix = HOST_PREFIX_BY_MODE[mode];
  const diagnostic = {
    startedAt: new Date().toISOString(),
    mode,
    productsOnly: cli.productsOnly,
    steps: [],
    errors: []
  };

  const missing = REQUIRED_ENV_KEYS.filter((key) => !env[key]);
  if (missing.length) {
    const message = `필수 환경변수 누락: ${missing.join(", ")}`;
    diagnostic.errors.push({ step: "env", message });
    console.error(message);
    process.exitCode = 1;
    return;
  }

  const comCode = env.ECOUNT_COM_CODE;
  const userId = env.ECOUNT_USER_ID;
  const certKey = env.ECOUNT_API_CERT_KEY;

  await mkdir(outputDir, { recursive: true });

  // 1) Zone 자동 조회
  let zone;
  try {
    const zoneResponse = await ecountRequest(`https://${hostPrefix}.ecount.com/OAPI/V2/Zone`, {
      COM_CODE: comCode
    });
    diagnostic.steps.push({ step: "zone", ok: true, httpStatus: zoneResponse.httpStatus });
    zone = extractFirst(zoneResponse.body, ["Data.ZONE", "Data.Datas.ZONE", "ZONE", "Datas.ZONE"]);
    if (!zone) {
      throw new Error(`Zone 응답에서 ZONE 값을 찾지 못했습니다: ${JSON.stringify(zoneResponse.body).slice(0, 500)}`);
    }
  } catch (error) {
    diagnostic.errors.push({ step: "zone", message: error.message });
    diagnostic.steps.push({ step: "zone", ok: false });
    console.error(`[Zone 조회 실패] ${error.message}`);
    process.exitCode = 1;
    return;
  }
  diagnostic.zone = zone;

  // 2) Login → 3) SESSION_ID 발급
  let sessionId;
  try {
    const loginUrl = `https://${hostPrefix}${zone}.ecount.com/OAPI/V2/OAPILogin`;
    const loginResponse = await ecountRequest(loginUrl, {
      COM_CODE: comCode,
      USER_ID: userId,
      API_CERT_KEY: certKey,
      LAN_TYPE: "ko-KR",
      ZONE: zone
    });
    diagnostic.steps.push({ step: "login", ok: true, httpStatus: loginResponse.httpStatus });
    sessionId = extractFirst(loginResponse.body, [
      "Data.Datas.SESSION_ID",
      "Data.SESSION_ID",
      "SESSION_ID",
      "Datas.SESSION_ID"
    ]);
    if (!sessionId) {
      throw new Error(`Login 응답에서 SESSION_ID 값을 찾지 못했습니다: ${JSON.stringify(loginResponse.body).slice(0, 500)}`);
    }
  } catch (error) {
    diagnostic.errors.push({ step: "login", message: error.message });
    diagnostic.steps.push({ step: "login", ok: false });
    console.error(`[Login 실패] ${error.message}`);
    process.exitCode = 1;
    return;
  }
  diagnostic.sessionIdMasked = maskSessionId(sessionId);

  // 4) 품목조회 API 호출
  // 테스트 모드에서는 공식 절차상 요구되는 PROD_TYPE: "3" 을 body에 포함해 실제 요청을 보낸다.
  const productsUrl = `https://${hostPrefix}${zone}.ecount.com/OAPI/V2/InventoryBasic/GetBasicProductsList?SESSION_ID=${encodeURIComponent(sessionId)}`;
  const productsBody = mode === "test"
    ? { SESSION_ID: sessionId, PROD_TYPE: "3" }
    : { SESSION_ID: sessionId };
  const productsResponse = await runRequiredStep("products", diagnostic, () => ecountRequest(productsUrl, productsBody));
  const rawProducts = productsResponse.body;
  const productList = requireResultList(rawProducts, "products");

  // 5) 재고조회 API 호출 — 검증 목적의 --products-only 옵션이 켜져 있으면 건너뛴다.
  if (cli.productsOnly) {
    diagnostic.steps.push({ step: "inventory", ok: true, skipped: true, reason: "--products-only" });
    throw new Error("--products-only는 API 검증 전용입니다. 운영 재고 파일은 저장하지 않습니다.");
  }

  const baseDate = todayYyyymmdd();
  const inventoryUrl = `https://${hostPrefix}${zone}.ecount.com/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus?SESSION_ID=${encodeURIComponent(sessionId)}`;
  const inventoryResponse = await runRequiredStep("inventory", diagnostic, () => ecountRequest(inventoryUrl, {
    SESSION_ID: sessionId,
    BASE_DATE: baseDate,
    COM_CODE: comCode,
    USER_ID: userId,
    ZONE: zone
  }), { baseDate });
  const rawInventory = inventoryResponse.body;
  const inventoryList = requireResultList(rawInventory, "inventory");

  // 6) JSON 저장 — PROD_CD 기준으로 품목 + 재고를 합쳐 latest.json 생성
  const { latest, purchasePriceCount } = buildLatestRows(productList, inventoryList);

  diagnostic.finishedAt = new Date().toISOString();
  diagnostic.counts = {
    productCount: productList.length,
    inventoryCount: inventoryList.length,
    latestCount: latest.length,
    purchasePriceCount
  };
  validateOutputPayloads({ rawProducts, rawInventory, latest, diagnostic });
  await writeInventoryOutputsAtomically(outputDir, { rawProducts, rawInventory, latest, diagnostic });

  let historySnapshot = null;
  try {
    historySnapshot = await writeInventoryHistorySnapshot(outputDir, { latest, diagnostic });
  } catch (error) {
    // history는 부가 기능이다 — 실패해도 이미 완료된 latest.json/diagnostic.json 교체를
    // 절대 되돌리지 않고, 경고만 남긴 채 정상 종료한다.
    console.error(`[sync-ecount-inventory] history snapshot 저장 실패(무시하고 계속): ${error?.message || error}`);
  }

  console.log(JSON.stringify({
    mode,
    productsOnly: cli.productsOnly,
    createdFiles: [
      "work/ecount-inventory/raw-products.json",
      "work/ecount-inventory/raw-inventory.json",
      "work/ecount-inventory/latest.json",
      "work/ecount-inventory/diagnostic.json"
    ],
    productCount: productList.length,
    inventoryCount: inventoryList.length,
    purchasePriceCount,
    historySnapshot: historySnapshot ? `work/ecount-inventory/history/${historySnapshot.snapshotDate}.json` : null
  }, null, 2));
}

// ---- helpers ----

async function runRequiredStep(step, diagnostic, operation, extra = {}) {
  try {
    const response = await operation();
    if (!response || typeof response !== "object") throw new Error(`${step} 응답이 비어 있습니다.`);
    if (!Number.isFinite(response.httpStatus) || response.httpStatus < 200 || response.httpStatus >= 300) {
      throw new Error(`${step} HTTP 실패: ${response.httpStatus}`);
    }
    diagnostic.steps.push({ step, ok: true, httpStatus: response.httpStatus, ...extra });
    return response;
  } catch (error) {
    diagnostic.errors.push({ step, message: error.message });
    diagnostic.steps.push({ step, ok: false, ...extra });
    throw error;
  }
}

function requireResultList(body, step) {
  if (body === null || body === undefined || typeof body !== "object") {
    throw new Error(`${step} 응답 구조가 올바르지 않습니다.`);
  }
  const list = normalizeResultList(body);
  if (!Array.isArray(list)) throw new Error(`${step} 결과가 배열이 아닙니다.`);
  return list;
}

function buildLatestRows(productList, inventoryList) {
  const stockByProdCd = new Map();
  for (const row of inventoryList) {
    const prodCd = firstNonEmpty(row, ["PROD_CD", "PRODCD", "ProdCd"]);
    if (!prodCd) continue;
    const qty = toNumberOrNull(firstNonEmpty(row, ["BAL_QTY", "QTY", "STOCK_QTY", "BALANCE_QTY"]));
    const entry = stockByProdCd.get(prodCd) || { stockQuantity: 0, hasAny: false };
    if (qty !== null) {
      entry.stockQuantity += qty;
      entry.hasAny = true;
    }
    stockByProdCd.set(prodCd, entry);
  }

  const latest = [];
  let purchasePriceCount = 0;
  for (const row of productList) {
    const productCode = firstNonEmpty(row, ["PROD_CD", "PRODCD", "ProdCd"]);
    if (!productCode) continue;
    const purchasePrice = toNumberOrNull(firstNonEmpty(row, ["IN_PRICE", "PUR_PRICE", "BUY_PRICE", "PURCHASE_PRICE"]));
    if (purchasePrice !== null) purchasePriceCount += 1;
    const stock = stockByProdCd.get(productCode);
    latest.push({
      productCode,
      productName: firstNonEmpty(row, ["PROD_DES", "PRODDES", "ProdDes"]) || null,
      specification: firstNonEmpty(row, ["SIZE_DES", "SPEC_DES", "SIZE_FLAG_DES", "ITEM_SPEC"]) || null,
      barcode: firstNonEmpty(row, ["BAR_CODE", "BARCODE"]) || null,
      purchasePrice,
      salesPrice: toNumberOrNull(firstNonEmpty(row, ["OUT_PRICE", "SALE_PRICE", "SET_PRICE", "SALES_PRICE"])),
      stockQuantity: stock && stock.hasAny ? stock.stockQuantity : null
    });
  }
  return { latest, purchasePriceCount };
}

function validateOutputPayloads({ rawProducts, rawInventory, latest, diagnostic }) {
  requireResultList(rawProducts, "products");
  requireResultList(rawInventory, "inventory");
  if (!Array.isArray(latest)) throw new Error("latest 결과가 배열이 아닙니다.");
  if (!diagnostic || typeof diagnostic !== "object" || !diagnostic.startedAt || !diagnostic.finishedAt) {
    throw new Error("diagnostic metadata가 올바르지 않습니다.");
  }
}

function outputPayloadsToFiles({ rawProducts, rawInventory, latest, diagnostic }) {
  validateOutputPayloads({ rawProducts, rawInventory, latest, diagnostic });
  return {
    "raw-products.json": rawProducts,
    "raw-inventory.json": rawInventory,
    "latest.json": latest,
    "diagnostic.json": diagnostic
  };
}

async function writeInventoryOutputsAtomically(dir, payloads, fsOps = { mkdir, writeFile, rename, rm }) {
  const files = outputPayloadsToFiles(payloads);
  const token = `${process.pid}-${Date.now()}`;
  const stagingDir = join(dir, `.sync-${token}`);
  const backupDir = join(dir, `.backup-${token}`);
  const moved = [];
  let backupsReady = false;
  try {
    await fsOps.mkdir(stagingDir, { recursive: true });
    for (const [name, data] of Object.entries(files)) {
      await fsOps.writeFile(join(stagingDir, name), `${JSON.stringify(data, null, 2)}\n`);
    }

    await fsOps.mkdir(dir, { recursive: true });
    await fsOps.mkdir(backupDir, { recursive: true });
    for (const name of Object.keys(files)) {
      try {
        await fsOps.rename(join(dir, name), join(backupDir, name));
        moved.push(name);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    backupsReady = true;

    for (const name of Object.keys(files)) {
      await fsOps.rename(join(stagingDir, name), join(dir, name));
    }
    await cleanupDir(fsOps, stagingDir);
    await cleanupDir(fsOps, backupDir);
  } catch (error) {
    await cleanupDir(fsOps, stagingDir);
    if (backupsReady) {
      for (const name of moved.reverse()) {
        try {
          await fsOps.rename(join(backupDir, name), join(dir, name));
        } catch {}
      }
    }
    await cleanupDir(fsOps, backupDir);
    throw error;
  }
}

async function cleanupDir(fsOps, dir) {
  try {
    await fsOps.rm(dir, { recursive: true, force: true });
  } catch {}
}

// Inventory Operations 기반 구축(2026-08-26) — 지금까지는 latest.json 하나만 존재해
// 재고 추세/시계열이 원천적으로 불가능했다(docs/reports/inventory-intelligence-v2-preaudit-2026-08-26.md
// §18). 이 함수는 매 sync 실행 시 그 시점의 latest/diagnostic을 하루에 하나
// (work/ecount-inventory/history/{YYYY-MM-DD}.json, KST 기준 날짜)로 append-only 보존한다.
// 과거 데이터를 추정/backfill하지 않는다 — history는 이 구현 시점부터 시작한다.
// 메인 4파일 원자적 교체(writeInventoryOutputsAtomically)가 이미 성공한 뒤 별도로
// 호출되는 best-effort 스텝이며, 이 함수가 실패해도 호출부가 catch해서 latest/diagnostic
// 자체를 절대 되돌리거나 오염시키지 않는다(호출부 참고).
export async function writeInventoryHistorySnapshot(dir, { latest, diagnostic }, fsOps = { mkdir, writeFile, rename }) {
  if (!Array.isArray(latest)) throw new Error("latest 결과가 배열이 아닙니다.");
  if (!diagnostic?.finishedAt) throw new Error("diagnostic.finishedAt이 필요합니다.");

  const snapshotDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(diagnostic.finishedAt));
  const historyDir = join(dir, "history");
  const targetFile = join(historyDir, `${snapshotDate}.json`);
  const token = `${process.pid}-${Date.now()}`;
  const tempFile = join(historyDir, `.tmp-${token}-${snapshotDate}.json`);

  const payload = {
    schemaVersion: 1,
    snapshotDate,
    generatedAt: diagnostic.finishedAt,
    // 같은 날 여러 번 sync를 돌리면 그날 파일은 최신 실행 결과로 덮어써진다(하루 1개 정책,
    // Section 15 retention 설계와 일치) — 별도 dedupe 판단 없이 date 키 자체가 dedupe다.
    sourceCounts: diagnostic.counts || null,
    latest
  };

  await fsOps.mkdir(historyDir, { recursive: true });
  await fsOps.writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`);
  await fsOps.rename(tempFile, targetFile);
  return { snapshotDate, file: targetFile };
}


async function ecountRequest(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 2000) };
  }
  return { httpStatus: response.status, body: parsed };
}

// "Data.Datas.SESSION_ID" 같은 점(.) 경로 후보 목록을 순서대로 시도해 값을 찾는다.
// Result가 문자열(JSON String)과 배열(Array) 두 형태 모두 올 수 있는 것과 마찬가지로,
// ECOUNT 응답 래핑 구조도 API마다 조금씩 다를 수 있어 후보 경로 여러 개를 관용적으로 시도한다.
function extractFirst(obj, paths) {
  for (const path of paths) {
    const value = getByPath(obj, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function getByPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), obj);
}

// Result가 JSON String으로 오는 경우와 Array로 오는 경우를 모두 정규화해 배열로 반환한다.
function normalizeResultList(body) {
  const candidatePaths = [
    "Data.Result",
    "Data.Datas.Result",
    "Data.ResultDetails",
    "Result",
    "Datas.Result",
    "Data.Datas",
    "Data"
  ];
  let value = null;
  for (const path of candidatePaths) {
    const found = getByPath(body, path);
    if (found !== undefined && found !== null) {
      value = found;
      break;
    }
  }
  if (value === null) return null;

  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (Array.isArray(value)) return value;
  if (typeof value === "object") return [value];
  return null;
}

function firstNonEmpty(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

function maskSessionId(sessionId) {
  const text = String(sessionId || "");
  if (text.length <= 4) return "*".repeat(text.length);
  return `${"*".repeat(text.length - 4)}${text.slice(-4)}`;
}

function todayYyyymmdd() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}


async function loadEnv() {
  const envPath = resolve(root, ".env");
  const parsed = { ...process.env };
  let text = "";
  try {
    text = await readFile(envPath, "utf8");
  } catch {
    return parsed;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!parsed[key]) parsed[key] = value;
  }
  return parsed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { buildLatestRows, outputPayloadsToFiles, requireResultList, runRequiredStep, validateOutputPayloads, writeInventoryOutputsAtomically };
