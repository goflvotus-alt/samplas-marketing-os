import { execFileSync } from "node:child_process";
import { basename, posix as pathPosix } from "node:path";
import { fileURLToPath } from "node:url";

const detailDatePattern = /^(\d{4})\/(\d{2})\/(\d{2})\s*-\s*(\d+)$/;

export function loadEcountOfflineSalesExcel(filePath, options = {}) {
  if (!filePath) throw new Error("ECOUNT Excel file path is required");
  const sheetName = options.sheetName || "판매현황";
  const workbook = readWorkbook(filePath);
  const sheet = workbook.sheets.find((item) => item.name === sheetName);
  if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);
  const sharedStrings = readSharedStrings(filePath);
  const rows = readSheetRows(filePath, sheet.path, sharedStrings);
  const header = findHeader(rows);
  if (!header) throw new Error("ECOUNT 판매현황 header row was not found");
  const salesLines = [];
  for (const row of rows.slice(header.rowIndex + 1)) {
    const rawDateNo = cleanText(row[header.columns.dateNo] || "");
    const match = rawDateNo.match(detailDatePattern);
    if (!match) continue;
    const [, year, month, day, slipNo] = match;
    const date = `${year}-${month}-${day}`;
    const salesAmount = parseNumber(row[header.columns.salesAmount]);
    const quantity = parseNumber(row[header.columns.quantity]);
    salesLines.push({
      date,
      slipNo,
      documentNo: slipNo,
      productName: cleanText(row[header.columns.productName] || ""),
      specification: cleanText(row[header.columns.specification] || ""),
      quantity,
      brandGroup: cleanText(row[header.columns.brandGroup] || ""),
      customerName: cleanText(row[header.columns.customerName] || ""),
      poNo: cleanText(row[header.columns.poNo] || ""),
      salesAmount,
      isOfflineRevenue: Number.isFinite(salesAmount)
    });
  }
  return buildOfflineSalesResult({ filePath, sheetName, salesLines });
}

function buildOfflineSalesResult({ filePath, sheetName, salesLines }) {
  const dailyMap = new Map();
  let totalOfflineSales = 0;
  let revenueLineCount = 0;
  let quantity = 0;
  for (const line of salesLines) {
    if (!dailyMap.has(line.date)) {
      dailyMap.set(line.date, {
        date: line.date,
        offlineSalesAmount: 0,
        revenueLineCount: 0,
        totalLineCount: 0,
        quantity: 0
      });
    }
    const day = dailyMap.get(line.date);
    day.totalLineCount += 1;
    if (Number.isFinite(line.quantity)) {
      day.quantity += line.quantity;
      quantity += line.quantity;
    }
    if (line.isOfflineRevenue) {
      day.offlineSalesAmount += line.salesAmount;
      day.revenueLineCount += 1;
      totalOfflineSales += line.salesAmount;
      revenueLineCount += 1;
    }
  }
  const dates = [...dailyMap.keys()].sort();
  return {
    source: "ecount_sales_status_excel",
    fileName: basename(filePath),
    sheetName,
    periodStart: dates[0] || null,
    periodEnd: dates[dates.length - 1] || null,
    totalOfflineSales,
    totalLineCount: salesLines.length,
    revenueLineCount,
    nonRevenueLineCount: salesLines.length - revenueLineCount,
    quantity,
    dailySales: [...dailyMap.values()].sort((left, right) => left.date.localeCompare(right.date)),
    salesLines,
    rows: salesLines
  };
}

function readWorkbook(filePath) {
  const workbookXml = readZipText(filePath, "xl/workbook.xml");
  const relsXml = readZipText(filePath, "xl/_rels/workbook.xml.rels");
  const relationships = new Map();
  for (const tag of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const attrs = parseAttributes(tag[0]);
    if (attrs.Id && attrs.Target) relationships.set(attrs.Id, normalizeWorkbookTarget(attrs.Target));
  }
  const sheets = [];
  for (const tag of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const attrs = parseAttributes(tag[0]);
    const relId = attrs["r:id"];
    const target = relationships.get(relId);
    if (attrs.name && target) sheets.push({ name: decodeXml(attrs.name), path: target });
  }
  return { sheets };
}

function readSharedStrings(filePath) {
  let xml = "";
  try {
    xml = readZipText(filePath, "xl/sharedStrings.xml");
  } catch {
    return [];
  }
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => {
    const texts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((textMatch) => decodeXml(textMatch[1]));
    return texts.join("");
  });
}

function readSheetRows(filePath, sheetPath, sharedStrings) {
  const xml = readZipText(filePath, sheetPath);
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = parseAttributes(cellMatch[1]);
      const column = columnIndex(attrs.r || "");
      if (column === null) continue;
      row[column] = cellValue(cellMatch[2], attrs, sharedStrings);
    }
    rows.push(row);
  }
  return rows;
}

function cellValue(cellXml, attrs, sharedStrings) {
  const inline = cellXml.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
  if (attrs.t === "inlineStr" && inline) return decodeXml(inline[1]);
  const value = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
  if (!value) return "";
  const text = decodeXml(value[1]);
  if (attrs.t === "s") return sharedStrings[Number(text)] || "";
  return text;
}

function findHeader(rows) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const normalized = rows[rowIndex].map(normalizeHeader);
    const columns = {
      dateNo: normalized.indexOf("일자no"),
      productName: normalized.indexOf("품목명"),
      specification: normalized.indexOf("규격"),
      quantity: normalized.indexOf("수량"),
      brandGroup: normalized.indexOf("품목그룹1명"),
      customerName: normalized.indexOf("거래처명"),
      poNo: normalized.indexOf("pono"),
      salesAmount: normalized.indexOf("합계")
    };
    if (columns.dateNo >= 0 && columns.productName >= 0 && columns.salesAmount >= 0) return { rowIndex, columns };
  }
  return null;
}

function parseAttributes(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/([\w:]+)="([^"]*)"/g)) attrs[match[1]] = decodeXml(match[2]);
  return attrs;
}

function normalizeWorkbookTarget(target) {
  const normalized = target.startsWith("/") ? target.slice(1) : pathPosix.normalize(pathPosix.join("xl", target));
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
}

function columnIndex(reference) {
  const letters = String(reference).match(/^[A-Z]+/i)?.[0];
  if (!letters) return null;
  return [...letters.toUpperCase()].reduce((index, char) => index * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function parseNumber(value) {
  const text = cleanText(value);
  if (!text) return null;
  const normalized = text.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalizeHeader(value) {
  return cleanText(value).toLowerCase().replace(/[.\s-]/g, "");
}

function cleanText(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function readZipText(filePath, entry) {
  return execFileSync("unzip", ["-p", filePath, entry], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("Usage: node scripts/load-ecount-offline-sales.mjs /path/to/ecount-sales.xlsx [...]");
    process.exit(1);
  }
  const results = files.map((file) => loadEcountOfflineSalesExcel(file));
  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}
